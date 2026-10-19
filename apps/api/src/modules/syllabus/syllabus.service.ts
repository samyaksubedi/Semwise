import {
  ErrorCode,
  LOW_CONFIDENCE,
  type AddTopicInput,
  type ChangeRequestView,
  type ConfirmSubjectInput,
  type DecideChangesInput,
  type ProposedOp,
  type StartDraftInput,
  type SyllabusStatusRow,
  type SyllabusVersionView,
  type TopicKind,
  type UpdateTopicInput,
  type UpdateVersionInput,
} from "@semwise/shared";
import type { Job } from "bullmq";
import { transaction, type TenantScope } from "../../common/db/scope.js";
import { AppError } from "../../common/errors/app-error.js";
import { env } from "../../config/env.js";
import { logger } from "../../lib/logger.js";
import { looksScanned, pdfPages } from "../../lib/pdf.js";
import { QueueName, enqueue } from "../../lib/queue.js";
import { aiService, isAiConfigured } from "../ai/index.js";
import { auditService } from "../audit/index.js";
import { Action, can, type Actor, type Resource } from "../authz/index.js";
import { filesService } from "../files/index.js";
import { knowledgeService } from "../knowledge/index.js";
import { fromDateOnly, structureService, toDateOnly } from "../structure/index.js";
import { syllabusRepository as repo, type TopicRow } from "./syllabus.repository.js";
import {
  buildTree,
  childKind,
  chunksFor,
  cloneRows,
  newStableKey,
  newTopicId,
  outlineForAi,
  pathOf,
  rowsFromExtraction,
} from "./syllabus.tree.js";

export const EXTRACT_JOB = "syllabus-extract";
export const PUBLISH_JOB = "syllabus-publish";

type Version = NonNullable<Awaited<ReturnType<typeof repo.findVersion>>>;
type Syllabus = NonNullable<Awaited<ReturnType<typeof repo.findSyllabus>>>;

export interface PublishedEvent {
  tenantId: string;
  subjectId: string;
  versionId: string;
  previousVersionId: string | null;
}
type PublishedListener = (event: PublishedEvent) => Promise<void>;
const publishedListeners: PublishedListener[] = [];

/** Later features react to a new live version (class entries re-check their topic mappings). */
export function onSyllabusPublished(listener: PublishedListener): void {
  publishedListeners.push(listener);
}

interface StoredOp {
  id: string;
  op: ProposedOp["op"];
  targetId: string | null;
  parentId: string | null;
  kind: TopicKind | null;
  title: string | null;
  position: number | null;
  reason: string;
  before: string | null;
  after: string | null;
  decision: ProposedOp["decision"];
}

const scopeOf = (actor: Actor): TenantScope => ({ tenantId: actor.tenantId! });

function syllabusResource(s: {
  tenantId: string;
  programId: string;
  batchId: string;
  semesterId: string;
  subjectId: string | null;
}): Resource {
  return {
    tenantId: s.tenantId,
    programId: s.programId,
    batchId: s.batchId,
    semesterId: s.semesterId,
    subjectId: s.subjectId,
  };
}

/** 404 when the actor may not even read the syllabus, 403 when they read it but may not act. */
function check(actor: Actor, action: Action, resource: Resource): void {
  if (can(actor, action, resource)) return;
  const readable =
    can(actor, Action.SYLLABUS_READ_DRAFT, resource) ||
    can(actor, Action.SYLLABUS_READ_PUBLISHED, resource);
  throw readable ? AppError.forbidden() : AppError.notFound("Syllabus not found");
}

async function loadVersion(actor: Actor, id: string, action?: Action): Promise<Version> {
  const version = await repo.findVersion(scopeOf(actor), id);
  if (!version) throw AppError.notFound("Syllabus not found");
  const resource = syllabusResource(version.syllabus);
  // Students and teachers read only the live version; drafts and old versions are admin data.
  const readAction =
    version.status === "PUBLISHED" ? Action.SYLLABUS_READ_PUBLISHED : Action.SYLLABUS_READ_DRAFT;
  if (!can(actor, readAction, resource)) throw AppError.notFound("Syllabus not found");
  if (action) check(actor, action, resource);
  return version;
}

function editable(version: Version): void {
  if (version.status !== "DRAFT") throw AppError.invalidState("Only a draft can be changed");
  if (version.extraction !== "DONE") {
    throw AppError.invalidState("Wait until the syllabus has been read");
  }
}

function toView(v: Version): SyllabusVersionView {
  return {
    id: v.id,
    syllabusId: v.syllabusId,
    subjectId: v.syllabus.subjectId,
    semesterId: v.syllabus.semesterId,
    versionNo: v.versionNo,
    status: v.status,
    extraction: v.extraction,
    extractionError: v.extractionError,
    usedOcr: v.usedOcr,
    suggestedName: v.suggestedName,
    suggestedCode: v.suggestedCode,
    credits: v.credits,
    references: (v.references as SyllabusVersionView["references"]) ?? [],
    effectiveFrom: toDateOnly(v.effectiveFrom),
    publishedAt: v.publishedAt?.toISOString() ?? null,
    sourceFileId: v.sourceFileId,
    copiedFromVersionId: v.copiedFromVersionId,
    pageCount: v._count.pages,
    lowConfidenceCount: v.topics.filter((t) => t.confidence < LOW_CONFIDENCE).length,
    topics: buildTree(v.topics),
  };
}

function toChangeView(row: {
  id: string;
  versionId: string;
  requestText: string;
  status: ChangeRequestView["status"];
  note: string | null;
  proposedOps: unknown;
  createdAt: Date;
}): ChangeRequestView {
  const ops = (row.proposedOps as StoredOp[]).map((o) => ({
    id: o.id,
    op: o.op,
    before: o.before,
    after: o.after,
    reason: o.reason,
    decision: o.decision,
  }));
  return {
    id: row.id,
    versionId: row.versionId,
    requestText: row.requestText,
    status: row.status,
    note: row.note,
    ops,
    createdAt: row.createdAt.toISOString(),
  };
}

function audit(
  actor: Actor | { userId: string; tenantId: string },
  programId: string,
  action: string,
  entityId: string,
  before: object | null,
  after: object | null,
) {
  return auditService.record({
    tenantId: actor.tenantId,
    programId,
    actorId: actor.userId,
    action,
    entityType: "SyllabusVersion",
    entityId,
    before,
    after,
  });
}

// ---------- Tree operations (direct edits and accepted AI changes share these) ----------

/** Puts `id` at `position` among the children of `parentId`, renumbering the siblings. */
async function placeAmongSiblings(
  scope: TenantScope,
  rows: TopicRow[],
  id: string,
  parentId: string | null,
  position: number | undefined | null,
) {
  const siblings = rows
    .filter((r) => r.parentId === parentId && r.id !== id)
    .sort((a, b) => a.orderIndex - b.orderIndex);
  const at =
    position === undefined || position === null
      ? siblings.length
      : Math.min(position, siblings.length);
  const ordered = [
    ...siblings.slice(0, at).map((s) => s.id),
    id,
    ...siblings.slice(at).map((s) => s.id),
  ];
  for (const [index, rowId] of ordered.entries()) {
    const row = rows.find((r) => r.id === rowId);
    if (!row || row.orderIndex !== index || rowId === id) {
      await repo.updateTopic(scope, rowId, {
        orderIndex: index,
        ...(rowId === id ? { parentId } : {}),
      });
    }
  }
}

function requireParentFor(rows: TopicRow[], parentId: string | null, kind: TopicKind): void {
  const parent = parentId ? rows.find((r) => r.id === parentId) : null;
  if (parentId && !parent) throw AppError.invalid("The parent is not in this syllabus");
  if (childKind(parent?.kind ?? null) !== kind) {
    throw AppError.invalid(
      parent
        ? `A ${parent.kind.toLowerCase()} cannot contain a ${kind.toLowerCase()}`
        : "Only units sit at the top",
    );
  }
}

async function addTopic(
  scope: TenantScope,
  versionId: string,
  rows: TopicRow[],
  input: AddTopicInput,
) {
  requireParentFor(rows, input.parentId, input.kind);
  const row: TopicRow = {
    id: newTopicId(),
    parentId: input.parentId,
    stableKey: newStableKey(),
    kind: input.kind,
    title: input.title,
    description: input.description ?? null,
    hours: input.hours ?? null,
    orderIndex: 10_000,
    sourcePage: null,
    confidence: 100,
  };
  await repo.createTopics(scope, versionId, [row]);
  await placeAmongSiblings(scope, [...rows, row], row.id, input.parentId, input.position);
  return row;
}

async function updateTopic(
  scope: TenantScope,
  rows: TopicRow[],
  id: string,
  input: UpdateTopicInput,
) {
  const row = rows.find((r) => r.id === id);
  if (!row) throw AppError.notFound("Topic not found");
  // A person checked it, so it is no longer an uncertain AI guess.
  await repo.updateTopic(scope, id, {
    ...(input.title !== undefined ? { title: input.title } : {}),
    ...(input.description !== undefined ? { description: input.description } : {}),
    ...(input.hours !== undefined ? { hours: input.hours } : {}),
    confidence: 100,
  });
  if (input.parentId !== undefined || input.position !== undefined) {
    const parentId = input.parentId === undefined ? row.parentId : input.parentId;
    requireParentFor(rows, parentId, row.kind);
    await placeAmongSiblings(scope, rows, id, parentId, input.position);
  }
}

async function deleteTopic(scope: TenantScope, rows: TopicRow[], id: string) {
  if (!rows.some((r) => r.id === id)) throw AppError.notFound("Topic not found");
  await repo.deleteTopic(scope, id);
}

// ---------- The service ----------

export const syllabusService = {
  /** Upload for a semester before the subject exists: the AI suggests the subject. */
  async importForSemester(
    actor: Actor,
    semesterId: string,
    fileId: string,
  ): Promise<SyllabusVersionView> {
    const scope = scopeOf(actor);
    const semester = await structureService.findSemester(scope, semesterId);
    if (!semester) throw AppError.notFound("Semester not found");
    const resource = syllabusResource({ ...semester, semesterId: semester.id, subjectId: null });
    check(actor, Action.SYLLABUS_MANAGE, resource);
    if (!isAiConfigured()) throw AppError.notConfigured("AI");
    await filesService.requireReady(scope, fileId, "SYLLABUS_PDF");
    const version = await transaction(scope, async () => {
      const syllabus = await repo.createSyllabus(scope, {
        programId: semester.programId,
        batchId: semester.batchId,
        semesterId: semester.id,
        subjectId: null,
      });
      return this.createFileDraft(actor, syllabus, fileId);
    });
    await this.enqueueExtraction(scope, version.id, actor.userId);
    return this.view(actor, version.id);
  },

  /** A new draft for a subject: from a PDF, or a copy of the live version to edit. */
  async startDraft(
    actor: Actor,
    subjectId: string,
    input: StartDraftInput,
  ): Promise<SyllabusVersionView> {
    const scope = scopeOf(actor);
    const subject = await structureService.findSubject(scope, subjectId);
    if (!subject) throw AppError.notFound("Subject not found");
    check(actor, Action.SYLLABUS_MANAGE, syllabusResource({ ...subject, subjectId: subject.id }));
    if ("fileId" in input) {
      if (!isAiConfigured()) throw AppError.notConfigured("AI");
      await filesService.requireReady(scope, input.fileId, "SYLLABUS_PDF");
    }
    const version = await transaction(scope, async () => {
      let syllabus = await repo.findSyllabusBySubject(scope, subjectId);
      syllabus ??= await repo.createSyllabus(scope, {
        programId: subject.programId,
        batchId: subject.batchId,
        semesterId: subject.semesterId,
        subjectId,
      });
      if (await repo.findOpenVersion(scope, syllabus.id)) {
        throw AppError.conflict(
          ErrorCode.CONFLICT,
          "This subject already has a draft; finish or discard it first",
        );
      }
      if ("fileId" in input) return this.createFileDraft(actor, syllabus, input.fileId);
      if (!syllabus.currentVersionId)
        throw AppError.invalidState("There is no published version to start from");
      const live = await repo.findVersion(scope, syllabus.currentVersionId);
      const draft = await repo.createVersion(scope, {
        syllabusId: syllabus.id,
        versionNo: await repo.nextVersionNo(scope, syllabus.id),
        sourceFileId: live!.sourceFileId,
        copiedFromVersionId: live!.id,
        extraction: "DONE",
        createdById: actor.userId,
        credits: live!.credits,
        references: live!.references as object,
      });
      await repo.createTopics(scope, draft.id, cloneRows(live!.topics, true));
      await repo.copyPages(scope, live!.id, draft.id);
      await audit(actor, subject.programId, "syllabus.draft.create", draft.id, null, {
        fromVersion: live!.versionNo,
      });
      return draft;
    });
    if ("fileId" in input) await this.enqueueExtraction(scope, version.id, actor.userId);
    return this.view(actor, version.id);
  },

  /** Inside a transaction: a draft waiting for extraction. */
  async createFileDraft(actor: Actor, syllabus: Syllabus, fileId: string) {
    const scope = scopeOf(actor);
    const draft = await repo.createVersion(scope, {
      syllabusId: syllabus.id,
      versionNo: await repo.nextVersionNo(scope, syllabus.id),
      sourceFileId: fileId,
      copiedFromVersionId: null,
      extraction: "QUEUED",
      createdById: actor.userId,
    });
    await audit(actor, syllabus.programId, "syllabus.upload", draft.id, null, { fileId });
    return draft;
  },

  async enqueueExtraction(scope: TenantScope, versionId: string, userId: string) {
    await enqueue(
      QueueName.ai,
      EXTRACT_JOB,
      { tenantId: scope.tenantId, versionId, userId },
      {
        jobId: `syllabus-extract-${versionId}`,
      },
    );
  },

  /** Copies another batch's published syllabus of this program as an independent draft. */
  async copyFromSubject(
    actor: Actor,
    subjectId: string,
    fromSubjectId: string,
  ): Promise<SyllabusVersionView> {
    const scope = scopeOf(actor);
    const [subject, source] = await Promise.all([
      structureService.findSubject(scope, subjectId),
      structureService.findSubject(scope, fromSubjectId),
    ]);
    if (!subject || !source) throw AppError.notFound("Subject not found");
    check(actor, Action.SYLLABUS_MANAGE, syllabusResource({ ...subject, subjectId: subject.id }));
    if (
      !can(
        actor,
        Action.SYLLABUS_READ_PUBLISHED,
        syllabusResource({ ...source, subjectId: source.id }),
      )
    ) {
      throw AppError.notFound("Subject not found");
    }
    if (source.programId !== subject.programId) {
      throw AppError.invalid("Copy from the same program");
    }
    const sourceSyllabus = await repo.findSyllabusBySubject(scope, fromSubjectId);
    if (!sourceSyllabus?.currentVersionId)
      throw AppError.invalidState("That subject has no published syllabus");
    const live = await repo.findVersion(scope, sourceSyllabus.currentVersionId);
    const draft = await transaction(scope, async () => {
      let syllabus = await repo.findSyllabusBySubject(scope, subjectId);
      syllabus ??= await repo.createSyllabus(scope, {
        programId: subject.programId,
        batchId: subject.batchId,
        semesterId: subject.semesterId,
        subjectId,
      });
      if (await repo.findOpenVersion(scope, syllabus.id)) {
        throw AppError.conflict(
          ErrorCode.CONFLICT,
          "This subject already has a draft; finish or discard it first",
        );
      }
      const created = await repo.createVersion(scope, {
        syllabusId: syllabus.id,
        versionNo: await repo.nextVersionNo(scope, syllabus.id),
        sourceFileId: live!.sourceFileId,
        copiedFromVersionId: live!.id,
        extraction: "DONE",
        createdById: actor.userId,
        credits: live!.credits,
        references: live!.references as object,
      });
      // New stable keys: the copy is independent of the source from now on.
      await repo.createTopics(scope, created.id, cloneRows(live!.topics, false));
      await repo.copyPages(scope, live!.id, created.id);
      await audit(actor, subject.programId, "syllabus.copy", created.id, null, {
        fromSubjectId,
        fromVersionId: live!.id,
      });
      return created;
    });
    return this.view(actor, draft.id);
  },

  // ---------- Extraction (worker) ----------

  async runExtraction(data: { tenantId: string; versionId: string; userId: string }, job: Job) {
    const scope = { tenantId: data.tenantId };
    const version = await repo.findVersion(scope, data.versionId);
    if (!version || version.status !== "DRAFT" || version.extraction === "DONE")
      return { skipped: true };
    if (!version.sourceFileId) throw new Error("Draft without a source file");
    await repo.updateVersion(scope, version.id, { extraction: "RUNNING", extractionError: null });
    try {
      const { bytes } = await filesService.readBytes(scope, version.sourceFileId);
      const pages = await pdfPages(bytes);
      const scanned = looksScanned(pages);
      if (scanned && pages.length > env.AI_SCAN_MAX_PAGES) {
        // Not worth retrying: the same file fails the same way, and no AI call is made.
        await repo.updateVersion(scope, version.id, {
          extraction: "FAILED",
          extractionError: `This looks like a scanned PDF of ${pages.length} pages; scans can have at most ${env.AI_SCAN_MAX_PAGES}. Upload only the syllabus pages, or a PDF with selectable text.`,
        });
        return { skipped: true, pages: pages.length };
      }
      const ai = { tenantId: data.tenantId, userId: data.userId };
      // Done outside any transaction: the AI call is slow.
      const extraction = await aiService.extractSyllabus(
        ai,
        scanned ? { pdf: bytes, filename: `syllabus-${version.id}.pdf` } : { pages },
      );
      const previous = version.syllabus.currentVersionId
        ? await repo.listTopics(scope, version.syllabus.currentVersionId)
        : [];
      await transaction(scope, async () => {
        await repo.deleteTopicsOfVersion(scope, version.id);
        await repo.createTopics(scope, version.id, rowsFromExtraction(extraction, previous));
        await repo.replacePages(scope, version.id, pages);
        await repo.updateVersion(scope, version.id, {
          extraction: "DONE",
          usedOcr: scanned,
          suggestedName: extraction.subjectName,
          suggestedCode: extraction.subjectCode,
          credits: extraction.credits,
          references: extraction.references,
        });
      });
      return { units: extraction.units.length, scanned };
    } catch (err) {
      const final = job.attemptsMade + 1 >= (job.opts?.attempts ?? 1);
      const message =
        err instanceof Error ? err.message.slice(0, 300) : "Reading the syllabus failed";
      await repo.updateVersion(scope, version.id, {
        extraction: final ? "FAILED" : "QUEUED",
        extractionError: final ? message : null,
      });
      logger.warn({ versionId: version.id, final, err: message }, "Syllabus extraction failed");
      throw err;
    }
  },

  /** Queues a failed extraction again. */
  async retryExtraction(actor: Actor, versionId: string) {
    const version = await loadVersion(actor, versionId, Action.SYLLABUS_MANAGE);
    if (version.extraction !== "FAILED")
      throw AppError.invalidState("Only a failed reading can be retried");
    const scope = scopeOf(actor);
    await repo.updateVersion(scope, version.id, { extraction: "QUEUED", extractionError: null });
    await enqueue(
      QueueName.ai,
      EXTRACT_JOB,
      { tenantId: scope.tenantId, versionId, userId: actor.userId },
      {
        jobId: `syllabus-extract-${versionId}-retry-${Date.now()}`,
      },
    );
    return this.view(actor, versionId);
  },

  // ---------- Reading ----------

  async view(actor: Actor, versionId: string): Promise<SyllabusVersionView> {
    return toView(await loadVersion(actor, versionId));
  },

  /** The live syllabus of a subject (what teachers and students see). */
  async published(actor: Actor, subjectId: string): Promise<SyllabusVersionView> {
    const scope = scopeOf(actor);
    const subject = await structureService.findSubject(scope, subjectId);
    const resource = subject && syllabusResource({ ...subject, subjectId: subject.id });
    if (!resource || !can(actor, Action.SYLLABUS_READ_PUBLISHED, resource)) {
      throw AppError.notFound("Subject not found");
    }
    const syllabus = await repo.findSyllabusBySubject(scope, subjectId);
    if (!syllabus?.currentVersionId) throw AppError.notFound("No published syllabus yet");
    return toView((await repo.findVersion(scope, syllabus.currentVersionId))!);
  },

  async versions(actor: Actor, subjectId: string) {
    const scope = scopeOf(actor);
    const subject = await structureService.findSubject(scope, subjectId);
    const resource = subject && syllabusResource({ ...subject, subjectId: subject.id });
    if (!resource || !can(actor, Action.SYLLABUS_READ_DRAFT, resource))
      throw AppError.notFound("Subject not found");
    const syllabus = await repo.findSyllabusBySubject(scope, subjectId);
    if (!syllabus) return [];
    return (await repo.listVersions(scope, syllabus.id)).map((v) => ({
      id: v.id,
      versionNo: v.versionNo,
      status: v.status,
      extraction: v.extraction,
      effectiveFrom: toDateOnly(v.effectiveFrom),
      publishedAt: v.publishedAt?.toISOString() ?? null,
      live: v.id === syllabus.currentVersionId,
    }));
  },

  /** The extracted text of one page: the "source page" next to a low-confidence item. */
  async page(actor: Actor, versionId: string, pageNo: number) {
    const version = await loadVersion(actor, versionId, Action.SYLLABUS_READ_DRAFT);
    const page = await repo.findPage(scopeOf(actor), version.id, pageNo);
    if (!page) throw AppError.notFound("Page not found");
    return { pageNo: page.pageNo, text: page.text, pageCount: version._count.pages };
  },

  // ---------- Review ----------

  /** For an imported syllabus: create the subject (or link an existing one without a syllabus). */
  async confirmSubject(actor: Actor, versionId: string, input: ConfirmSubjectInput) {
    const version = await loadVersion(actor, versionId, Action.SYLLABUS_MANAGE);
    const scope = scopeOf(actor);
    if (version.syllabus.subjectId)
      throw AppError.invalidState("This syllabus already has its subject");
    await transaction(scope, async () => {
      let subjectId: string;
      if ("subjectId" in input) {
        const subject = await structureService.findSubject(scope, input.subjectId);
        if (!subject || subject.semesterId !== version.syllabus.semesterId) {
          throw AppError.invalid("Choose a subject of the same semester");
        }
        if (await repo.findSyllabusBySubject(scope, subject.id)) {
          throw AppError.conflict(ErrorCode.ALREADY_EXISTS, "That subject already has a syllabus");
        }
        subjectId = subject.id;
      } else {
        const created = await structureService.createSubject(actor, version.syllabus.semesterId, {
          name: input.name,
          code: input.code,
          credits: input.credits ?? version.credits ?? null,
        });
        subjectId = created.id;
      }
      await repo.linkSubject(scope, version.syllabus.id, subjectId);
      await audit(actor, version.syllabus.programId, "syllabus.subject.confirm", version.id, null, {
        subjectId,
      });
    });
    return this.view(actor, versionId);
  },

  async updateVersion(actor: Actor, versionId: string, input: UpdateVersionInput) {
    const version = await loadVersion(actor, versionId, Action.SYLLABUS_MANAGE);
    editable(version);
    const scope = scopeOf(actor);
    await transaction(scope, async () => {
      await repo.updateVersion(scope, version.id, {
        ...(input.credits !== undefined ? { credits: input.credits } : {}),
        ...(input.references !== undefined ? { references: input.references } : {}),
        ...(input.effectiveFrom !== undefined
          ? { effectiveFrom: fromDateOnly(input.effectiveFrom) ?? null }
          : {}),
      });
      await audit(
        actor,
        version.syllabus.programId,
        "syllabus.draft.update",
        version.id,
        null,
        input,
      );
    });
    return this.view(actor, versionId);
  },

  async addTopic(actor: Actor, versionId: string, input: AddTopicInput) {
    const version = await loadVersion(actor, versionId, Action.SYLLABUS_MANAGE);
    editable(version);
    const scope = scopeOf(actor);
    await transaction(scope, async () => {
      const row = await addTopic(scope, version.id, version.topics, input);
      await audit(actor, version.syllabus.programId, "syllabus.topic.add", version.id, null, {
        topicId: row.id,
        title: row.title,
      });
    });
    return this.view(actor, versionId);
  },

  async updateTopic(actor: Actor, versionId: string, topicId: string, input: UpdateTopicInput) {
    const version = await loadVersion(actor, versionId, Action.SYLLABUS_MANAGE);
    editable(version);
    const scope = scopeOf(actor);
    const before = version.topics.find((t) => t.id === topicId);
    await transaction(scope, async () => {
      await updateTopic(scope, version.topics, topicId, input);
      await audit(
        actor,
        version.syllabus.programId,
        "syllabus.topic.update",
        version.id,
        before ? { title: before.title } : null,
        { topicId, ...input },
      );
    });
    return this.view(actor, versionId);
  },

  async deleteTopic(actor: Actor, versionId: string, topicId: string) {
    const version = await loadVersion(actor, versionId, Action.SYLLABUS_MANAGE);
    editable(version);
    const scope = scopeOf(actor);
    const before = version.topics.find((t) => t.id === topicId);
    await transaction(scope, async () => {
      await deleteTopic(scope, version.topics, topicId);
      await audit(
        actor,
        version.syllabus.programId,
        "syllabus.topic.delete",
        version.id,
        before ? { title: before.title } : null,
        null,
      );
    });
    return this.view(actor, versionId);
  },

  /**
   * A plain-language request becomes a list of proposed operations, shown as before/after. The
   * tree does not change until the admin accepts operations.
   */
  async requestChanges(actor: Actor, versionId: string, text: string): Promise<ChangeRequestView> {
    const version = await loadVersion(actor, versionId, Action.SYLLABUS_MANAGE);
    editable(version);
    const scope = scopeOf(actor);
    const { text: outline, aliasToId } = outlineForAi(version.topics);
    const proposal = await aiService.proposeSyllabusChanges(
      { tenantId: scope.tenantId, userId: actor.userId },
      outline,
      text,
    );
    const rows = version.topics;
    const resolve = (alias: string | null) => (alias ? (aliasToId.get(alias) ?? null) : null);
    const skipped: string[] = [];
    const ops: StoredOp[] = [];
    for (const op of proposal.ops) {
      const targetId = resolve(op.targetKey);
      const parentId = resolve(op.parentKey);
      const target = targetId ? rows.find((r) => r.id === targetId) : undefined;
      const id = `op${ops.length + 1}`;
      const base = {
        id,
        op: op.op,
        reason: op.reason,
        decision: "PENDING" as const,
        position: op.position,
      };
      if (op.op === "add") {
        const parent = parentId ? rows.find((r) => r.id === parentId) : null;
        const kind = op.kind ?? childKind(parent?.kind ?? null);
        if (
          !op.title ||
          !kind ||
          childKind(parent?.kind ?? null) !== kind ||
          (op.parentKey && !parent)
        ) {
          skipped.push(`an addition (${op.title ?? "untitled"})`);
          continue;
        }
        ops.push({
          ...base,
          targetId: null,
          parentId: parent?.id ?? null,
          kind,
          title: op.title,
          before: null,
          after: parent ? `${pathOf(rows, parent.id)} > ${op.title}` : op.title,
        });
      } else if (!target) {
        skipped.push(`a ${op.op} of an unknown item`);
      } else if (op.op === "rename") {
        if (!op.title) {
          skipped.push(`a rename of ${target.title}`);
          continue;
        }
        ops.push({
          ...base,
          targetId: target.id,
          parentId: null,
          kind: target.kind,
          title: op.title,
          before: pathOf(rows, target.id),
          after: op.title,
        });
      } else if (op.op === "move") {
        const parent = parentId ? rows.find((r) => r.id === parentId) : null;
        if (childKind(parent?.kind ?? null) !== target.kind) {
          skipped.push(`a move of ${target.title}`);
          continue;
        }
        ops.push({
          ...base,
          targetId: target.id,
          parentId: parent?.id ?? null,
          kind: target.kind,
          title: target.title,
          before: pathOf(rows, target.id),
          after: parent ? `${pathOf(rows, parent.id)} > ${target.title}` : target.title,
        });
      } else {
        ops.push({
          ...base,
          targetId: target.id,
          parentId: null,
          kind: target.kind,
          title: target.title,
          before: pathOf(rows, target.id),
          after: null,
        });
      }
    }
    const note = [
      proposal.note,
      skipped.length ? `Left out (could not be mapped safely): ${skipped.join(", ")}.` : null,
    ]
      .filter(Boolean)
      .join(" ");
    const created = await transaction(scope, async () => {
      const row = await repo.createChangeRequest(scope, {
        versionId: version.id,
        requestText: text,
        proposedOps: ops as unknown as object,
        note: note || null,
        createdById: actor.userId,
      });
      await audit(actor, version.syllabus.programId, "syllabus.changes.request", version.id, null, {
        changeRequestId: row.id,
        requestText: text,
        proposed: ops.length,
      });
      return row;
    });
    return toChangeView(created);
  },

  async listChangeRequests(actor: Actor, versionId: string): Promise<ChangeRequestView[]> {
    const version = await loadVersion(actor, versionId, Action.SYLLABUS_READ_DRAFT);
    return (await repo.listChangeRequests(scopeOf(actor), version.id)).map(toChangeView);
  },

  /** Applies the accepted operations in order; rejected ones are kept for the record. */
  async decideChanges(
    actor: Actor,
    changeRequestId: string,
    input: DecideChangesInput,
  ): Promise<ChangeRequestView> {
    const scope = scopeOf(actor);
    const request = await repo.findChangeRequest(scope, changeRequestId);
    if (!request) throw AppError.notFound("Change request not found");
    const version = await loadVersion(actor, request.versionId, Action.SYLLABUS_MANAGE);
    editable(version);
    if (request.status !== "PROPOSED")
      throw AppError.invalidState("These changes were already decided");
    const ops = request.proposedOps as unknown as StoredOp[];
    const decisions = new Map(input.decisions.map((d) => [d.opId, d.accept]));
    for (const op of ops) {
      if (!decisions.has(op.id)) throw AppError.invalid(`Decide every change (missing ${op.id})`);
    }
    const updated = await transaction(scope, async () => {
      for (const op of ops) {
        if (!decisions.get(op.id)) {
          op.decision = "REJECTED";
          continue;
        }
        // Each step sees the tree as the previous accepted steps left it.
        const rows = await repo.listTopics(scope, version.id);
        try {
          if (op.op === "add") {
            await addTopic(scope, version.id, rows, {
              parentId: op.parentId,
              kind: op.kind!,
              title: op.title!,
              position: op.position ?? undefined,
            });
          } else if (op.op === "rename") {
            await updateTopic(scope, rows, op.targetId!, { title: op.title! });
          } else if (op.op === "move") {
            await updateTopic(scope, rows, op.targetId!, {
              parentId: op.parentId,
              ...(op.position !== null ? { position: op.position } : {}),
            });
          } else {
            await deleteTopic(scope, rows, op.targetId!);
          }
          op.decision = "ACCEPTED";
        } catch (err) {
          if (!(err instanceof AppError)) throw err;
          // An earlier accepted step made this one impossible (its item was deleted, say).
          op.decision = "REJECTED";
          op.reason = `${op.reason} (no longer applies: ${err.message})`;
        }
      }
      const accepted = ops.filter((o) => o.decision === "ACCEPTED").length;
      const status = accepted === 0 ? "REJECTED" : accepted === ops.length ? "ACCEPTED" : "PARTIAL";
      const row = await repo.decideChangeRequest(scope, request.id, {
        status,
        proposedOps: ops as unknown as object,
        decidedById: actor.userId,
        decidedAt: new Date(),
      });
      await audit(actor, version.syllabus.programId, "syllabus.changes.decide", version.id, null, {
        changeRequestId: request.id,
        accepted,
        rejected: ops.length - accepted,
      });
      return row;
    });
    return toChangeView(updated);
  },

  // ---------- Publishing ----------

  /**
   * Starts publishing: the new version is indexed first, then becomes live, then the old
   * version's vectors are deleted (in the index job). Until then the previous version stays live.
   */
  async publish(actor: Actor, versionId: string, effectiveFrom: string | undefined) {
    const version = await loadVersion(actor, versionId, Action.SYLLABUS_MANAGE);
    editable(version);
    if (!version.syllabus.subjectId) throw AppError.invalidState("Confirm the subject first");
    if (!version.topics.some((t) => t.kind === "UNIT"))
      throw AppError.invalidState("Add at least one unit");
    if (!isAiConfigured()) throw AppError.notConfigured("AI");
    const scope = scopeOf(actor);
    const day =
      effectiveFrom ?? toDateOnly(version.effectiveFrom) ?? new Date().toISOString().slice(0, 10);
    await transaction(scope, async () => {
      await repo.updateVersion(scope, version.id, {
        status: "PUBLISHING",
        effectiveFrom: fromDateOnly(day) ?? null,
        publishedById: actor.userId,
      });
      await audit(
        actor,
        version.syllabus.programId,
        "syllabus.publish.request",
        version.id,
        { status: "DRAFT" },
        {
          status: "PUBLISHING",
          effectiveFrom: day,
        },
      );
    });
    await enqueue(
      QueueName.index,
      PUBLISH_JOB,
      { tenantId: scope.tenantId, versionId: version.id, actorId: actor.userId },
      {
        jobId: `syllabus-publish-${version.id}`,
      },
    );
    return this.view(actor, versionId);
  },

  /** The index job: embed, switch the live pointer, delete the old vectors, tell listeners. */
  async runPublish(data: { tenantId: string; versionId: string; actorId: string }, job: Job) {
    const scope = { tenantId: data.tenantId };
    const version = await repo.findVersion(scope, data.versionId);
    if (!version || version.status !== "PUBLISHING") return { skipped: true };
    const subjectId = version.syllabus.subjectId!;
    const subject = await structureService.findSubject(scope, subjectId);
    try {
      // A retry may find vectors from an earlier attempt; start clean.
      await knowledgeService.removeVersions(scope, "SYLLABUS_TOPIC", [version.id]);
      const chunks = chunksFor(version.topics, { name: subject!.name, code: subject!.code });
      await knowledgeService.indexVersion(
        scope,
        { tenantId: data.tenantId, userId: null },
        "SYLLABUS_INDEX",
        "SYLLABUS_TOPIC",
        version.id,
        chunks.map((c) => ({
          sourceId: c.sourceId,
          text: c.text,
          payload: {
            programId: version.syllabus.programId,
            batchId: version.syllabus.batchId,
            semesterId: version.syllabus.semesterId,
            sectionId: null,
            subjectId,
            classId: null,
            ownerId: null,
            visibility: "SHARED",
            contentKind: "OFFICIAL_SYLLABUS",
            meta: {
              stableKey: c.stableKey,
              unitNo: c.unitNo,
              unitTitle: c.unitTitle,
              topicTitle: c.topicTitle,
              versionNo: version.versionNo,
            },
          },
        })),
      );
    } catch (err) {
      const final = job.attemptsMade + 1 >= (job.opts?.attempts ?? 1);
      if (final) {
        await repo.updateVersion(scope, version.id, {
          status: "DRAFT",
          extractionError: `Publishing failed: ${err instanceof Error ? err.message.slice(0, 250) : "unknown error"}`,
        });
      }
      throw err;
    }
    const previousVersionId = version.syllabus.currentVersionId;
    await transaction(scope, async () => {
      if (previousVersionId && previousVersionId !== version.id) {
        await repo.updateVersion(scope, previousVersionId, { status: "SUPERSEDED" });
      }
      await repo.updateVersion(scope, version.id, {
        status: "PUBLISHED",
        publishedAt: new Date(),
        extractionError: null,
      });
      await repo.setCurrent(scope, version.syllabus.id, version.id);
      await audit(
        { tenantId: data.tenantId, userId: data.actorId },
        version.syllabus.programId,
        "syllabus.publish",
        version.id,
        previousVersionId ? { liveVersionId: previousVersionId } : null,
        { liveVersionId: version.id, versionNo: version.versionNo },
      );
    });
    if (previousVersionId && previousVersionId !== version.id) {
      await knowledgeService.removeVersions(scope, "SYLLABUS_TOPIC", [previousVersionId]);
    }
    for (const listener of publishedListeners) {
      await listener({
        tenantId: data.tenantId,
        subjectId,
        versionId: version.id,
        previousVersionId,
      });
    }
    return { chunks: version.topics.length };
  },

  /** Throws away a draft (never a published version). */
  async discard(actor: Actor, versionId: string) {
    const version = await loadVersion(actor, versionId, Action.SYLLABUS_MANAGE);
    if (version.status !== "DRAFT") throw AppError.invalidState("Only a draft can be discarded");
    const scope = scopeOf(actor);
    await transaction(scope, async () => {
      await repo.deleteVersion(scope, version.id);
      const remaining = await repo.listVersions(scope, version.syllabusId);
      if (remaining.length === 0) await repo.deleteSyllabus(scope, version.syllabusId);
      await audit(
        actor,
        version.syllabus.programId,
        "syllabus.draft.discard",
        version.id,
        { versionNo: version.versionNo },
        null,
      );
    });
  },

  // ---------- Dashboard ----------

  /** Which subjects of a semester have no syllabus, a draft, or a published one. */
  async statusForSemester(actor: Actor, semesterId: string): Promise<SyllabusStatusRow[]> {
    const scope = scopeOf(actor);
    const semester = await structureService.findSemester(scope, semesterId);
    if (!semester) throw AppError.notFound("Semester not found");
    const resource = syllabusResource({ ...semester, semesterId: semester.id, subjectId: null });
    if (!can(actor, Action.SYLLABUS_READ_DRAFT, resource))
      throw AppError.notFound("Semester not found");
    const [subjects, syllabi] = await Promise.all([
      structureService.listSubjectsRaw(scope, semesterId),
      repo.listForSemesters(scope, [semesterId]),
    ]);
    const bySubject = new Map(syllabi.filter((s) => s.subjectId).map((s) => [s.subjectId!, s]));
    const row = (
      subject: { id: string; name: string; code: string } | null,
      syllabus: (typeof syllabi)[number] | undefined,
    ): SyllabusStatusRow => {
      const open = syllabus?.versions.find(
        (v) => v.status === "DRAFT" || v.status === "PUBLISHING",
      );
      const processing = open && (open.status === "PUBLISHING" || open.extraction !== "DONE");
      const state = syllabus?.currentVersionId
        ? "PUBLISHED"
        : processing
          ? "PROCESSING"
          : open
            ? "DRAFT"
            : "NONE";
      return {
        subjectId: subject?.id ?? null,
        subjectName: subject?.name ?? null,
        subjectCode: subject?.code ?? null,
        state,
        hasOpenDraft: Boolean(open && syllabus?.currentVersionId),
        liveVersionNo: syllabus?.currentVersion?.versionNo ?? null,
        openVersionId: open?.id ?? null,
      };
    };
    return [
      ...subjects.map((s) => row(s, bySubject.get(s.id))),
      // Uploads still waiting for their subject to be confirmed.
      ...syllabi.filter((s) => !s.subjectId).map((s) => row(null, s)),
    ];
  },

  // ---------- For other modules ----------

  /** The classes gate: a class needs its subject's syllabus to be published. */
  async hasPublished(scope: TenantScope, subjectId: string): Promise<boolean> {
    const syllabus = await repo.findSyllabusBySubject(scope, subjectId);
    return Boolean(syllabus?.currentVersionId);
  },

  /** The live version id and its topics, for mapping class entries (feature 6). */
  async liveTopics(scope: TenantScope, subjectId: string) {
    const syllabus = await repo.findSyllabusBySubject(scope, subjectId);
    if (!syllabus?.currentVersionId) return null;
    return {
      versionId: syllabus.currentVersionId,
      topics: await repo.listTopics(scope, syllabus.currentVersionId),
    };
  },
};
