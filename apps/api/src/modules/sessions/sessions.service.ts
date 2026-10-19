import {
  ErrorCode,
  type ApprovalItem,
  type ApproveEntryInput,
  type CreateEntryInput,
  type EntryTopicInput,
  type EntryTopicView,
  type EntryVersionView,
  type EntryView,
  type NewEntryVersionInput,
  type SubmitEntryInput,
  type UpdateDraftInput,
} from "@semwise/shared";
import type { Job } from "bullmq";
import { transaction, type TenantScope } from "../../common/db/scope.js";
import { AppError } from "../../common/errors/app-error.js";
import { todayIn } from "../../common/time.js";
import { logger } from "../../lib/logger.js";
import { QueueName, enqueue } from "../../lib/queue.js";
import { aiService, isAiConfigured } from "../ai/index.js";
import { approvalsService } from "../approvals/index.js";
import { auditService } from "../audit/index.js";
import {
  Action,
  adminProgramIds,
  can,
  hasRole,
  type Actor,
  type Resource,
} from "../authz/index.js";
import { classResource, classesService } from "../classes/index.js";
import { RETENTION, filesService } from "../files/index.js";
import { knowledgeService } from "../knowledge/index.js";
import { mediaService } from "../media/index.js";
import { membershipsService } from "../memberships/index.js";
import { notificationsService } from "../notifications/index.js";
import { fromDateOnly, structureService, toDateOnly } from "../structure/index.js";
import { syllabusService, type PublishedEvent } from "../syllabus/index.js";
import { tenantsService } from "../tenants/index.js";
import { usersService } from "../users/index.js";
import {
  sessionsRepository as repo,
  type EntryRow,
  type VersionRow,
} from "./sessions.repository.js";

export const ORGANIZE_JOB = "entry-organize";
export const ENTRY_PUBLISH_JOB = "entry-publish";
export const ENTRY_REINDEX_JOB = "entry-reindex";

type Klass = NonNullable<Awaited<ReturnType<typeof classesService.find>>>;

interface StoredTopic {
  title: string;
  subtopics: string[];
  stableKey: string | null;
  confidence: number;
}

const scopeOf = (actor: Actor): TenantScope => ({ tenantId: actor.tenantId! });
const OPEN_STATUSES = new Set(["DRAFT", "PENDING", "APPROVED"]);

interface EntryPath {
  tenantId: string;
  programId: string;
  batchId: string;
  semesterId: string;
  sectionId: string;
  subjectId: string;
  classId: string;
}

/** The authorization resource of an entry; `ownerId` is the author of the version in question. */
function entryResource(e: EntryPath, ownerId?: string | null): Resource {
  return {
    tenantId: e.tenantId,
    programId: e.programId,
    batchId: e.batchId,
    semesterId: e.semesterId,
    sectionId: e.sectionId,
    subjectId: e.subjectId,
    classId: e.classId,
    ownerId: ownerId ?? null,
  };
}

function topicsOf(v: { structured: unknown }): StoredTopic[] {
  return ((v.structured as { topics?: StoredTopic[] } | null)?.topics ?? []).map((t) => ({
    title: t.title,
    subtopics: t.subtopics ?? [],
    stableKey: t.stableKey ?? null,
    confidence: t.confidence ?? 100,
  }));
}

function toVersionView(v: VersionRow): EntryVersionView {
  return {
    id: v.id,
    versionNo: v.versionNo,
    status: v.status,
    inputKind: v.inputKind,
    rawText: v.rawText,
    topics: topicsOf(v).map((t): EntryTopicView => ({
      ...t,
      inSyllabus: t.stableKey !== null && !v.mappingStale,
    })),
    summary: v.summary,
    organize: v.organize,
    organizeError: v.organizeError,
    mappingStale: v.mappingStale,
    authorId: v.authorId,
    submittedAt: v.submittedAt?.toISOString() ?? null,
    decidedAt: v.decidedAt?.toISOString() ?? null,
    rejectionReason: v.rejectionReason,
    unreviewed: v.unreviewed,
    minorEdit: v.minorEdit,
    createdAt: v.createdAt.toISOString(),
  };
}

/** The topic keys of a version, for the "minor fix" check. */
function topicSignature(v: { structured: unknown }): string {
  return topicsOf(v)
    .map(
      (t) =>
        `${t.stableKey ?? "-"}:${t.title
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, " ")
          .trim()}`,
    )
    .sort()
    .join("|");
}

function audit(
  actor: { userId: string | null; tenantId: string | null },
  entry: { programId: string; id: string },
  action: string,
  before: object | null,
  after: object | null,
) {
  return auditService.record({
    tenantId: actor.tenantId,
    programId: entry.programId,
    actorId: actor.userId,
    action,
    entityType: "Entry",
    entityId: entry.id,
    before,
    after,
  });
}

async function loadClass(actor: Actor, classId: string): Promise<Klass> {
  const klass = await classesService.find(scopeOf(actor), classId);
  if (!klass || !can(actor, Action.STRUCTURE_READ, classResource(klass))) {
    throw AppError.notFound("Class not found");
  }
  return klass;
}

async function loadEntry(actor: Actor, entryId: string): Promise<EntryRow> {
  const entry = await repo.findEntry(scopeOf(actor), entryId);
  if (!entry) throw AppError.notFound("Entry not found");
  const visible =
    can(actor, Action.ENTRY_READ_PUBLISHED, entryResource(entry)) ||
    entry.versions.some((v) =>
      can(actor, Action.ENTRY_READ_PENDING, entryResource(entry, v.authorId)),
    );
  if (!visible) throw AppError.notFound("Entry not found");
  return entry;
}

/** The newest version that is not the live one, if the actor may see it. */
function latestVisible(actor: Actor, entry: EntryRow): VersionRow | null {
  const latest = entry.versions.find(
    (v) => v.id !== entry.currentVersionId && v.status !== "SUPERSEDED",
  );
  if (!latest) return null;
  return can(actor, Action.ENTRY_READ_PENDING, entryResource(entry, latest.authorId))
    ? latest
    : null;
}

/** Lesson notes and the subject's live syllabus topics, with short keys for the model. */
async function syllabusContext(scope: TenantScope, subjectId: string) {
  const live = await syllabusService.liveTopics(scope, subjectId);
  const keyToStable = new Map<string, string>();
  const lines: string[] = [];
  if (live) {
    const byId = new Map(live.topics.map((t) => [t.id, t]));
    for (const t of live.topics) {
      const key = `K${keyToStable.size + 1}`;
      keyToStable.set(key, t.stableKey);
      const parent = t.parentId ? byId.get(t.parentId) : undefined;
      lines.push(`${key} [${t.kind}] ${parent ? `${parent.title} > ` : ""}${t.title}`);
    }
  }
  return {
    versionId: live?.versionId ?? null,
    validKeys: new Set(live?.topics.map((t) => t.stableKey) ?? []),
    keyToStable,
    text: lines.join("\n") || "(no published syllabus)",
  };
}

function cleanTopics(topics: EntryTopicInput[], validKeys: Set<string>): StoredTopic[] {
  return topics.map((t) => ({
    title: t.title,
    subtopics: t.subtopics,
    stableKey: t.stableKey && validKeys.has(t.stableKey) ? t.stableKey : null,
    confidence: 100,
  }));
}

async function storeTopics(scope: TenantScope, versionId: string, topics: StoredTopic[]) {
  const best = new Map<string, number>();
  for (const t of topics) {
    if (t.stableKey) best.set(t.stableKey, Math.max(best.get(t.stableKey) ?? 0, t.confidence));
  }
  await repo.setTopics(
    scope,
    versionId,
    [...best].map(([topicStableKey, confidence]) => ({ topicStableKey, confidence })),
  );
}

/**
 * Voice and photo input (CR only): the text must come from the author's own finished reading of
 * a file uploaded for this class. TEXT input may not carry a file.
 */
async function checkMedia(
  actor: Actor,
  classId: string,
  input: { inputKind: "TEXT" | "VOICE" | "PHOTO"; mediaFileId?: string | undefined },
): Promise<void> {
  if (input.inputKind === "TEXT") {
    if (input.mediaFileId) throw AppError.invalid("Text entries do not take a file");
    return;
  }
  const klass = await classesService.find(scopeOf(actor), classId);
  if (!klass || !can(actor, Action.ENTRY_USE_MEDIA, classResource(klass)))
    throw AppError.forbidden();
  if (!input.mediaFileId) throw AppError.invalid("Attach the voice or photo file");
  await mediaService.requireUsable(scopeOf(actor), {
    fileId: input.mediaFileId,
    inputKind: input.inputKind,
    classId,
    userId: actor.userId,
  });
}

async function emailsOf(userIds: string[]): Promise<string[]> {
  return (await usersService.findManyByIds(userIds))
    .filter((u) => u.status === "ACTIVE")
    .map((u) => u.email);
}

export const sessionsService = {
  // ---------- Writing an entry (CR or subject teacher) ----------

  async create(
    actor: Actor,
    timezone: string,
    classId: string,
    input: CreateEntryInput,
  ): Promise<EntryView> {
    const scope = scopeOf(actor);
    const klass = await loadClass(actor, classId);
    const resource = classResource(klass);
    if (!can(actor, Action.ENTRY_CREATE, resource)) throw AppError.forbidden();
    if (klass.status !== "ACTIVE") throw AppError.invalidState("This class is archived");
    const semester = await structureService.findSemester(scope, klass.semesterId);
    if (semester?.status !== "ACTIVE")
      throw AppError.invalidState("Entries can be added only in the active semester");
    await checkMedia(actor, klass.id, input);
    if (!isAiConfigured()) throw AppError.notConfigured("AI");
    const today = todayIn(timezone);
    const taughtOn = input.taughtOn ?? today;
    if (taughtOn > today)
      throw AppError.invalid("The date cannot be in the future", [
        { path: "taughtOn", message: "In the future" },
      ]);
    const startDate = toDateOnly(semester.startDate);
    if (startDate && taughtOn < startDate) {
      throw AppError.invalid("The date is before the semester started", [
        { path: "taughtOn", message: "Before the semester" },
      ]);
    }

    const entry = await transaction(scope, async () => {
      const day = fromDateOnly(taughtOn)!;
      const session = await repo.findOrCreateSession(scope, klass.id, day, actor.userId);
      const created = await repo.createEntry(scope, {
        sessionId: session.id,
        classId: klass.id,
        programId: klass.programId,
        batchId: klass.batchId,
        semesterId: klass.semesterId,
        sectionId: klass.sectionId,
        subjectId: klass.subjectId,
        taughtOn: day,
        authorId: actor.userId,
      });
      const version = await repo.createVersion(scope, {
        entryId: created.id,
        versionNo: 1,
        inputKind: input.inputKind,
        mediaFileId: input.mediaFileId ?? null,
        rawText: input.text,
        authorId: actor.userId,
        organize: "QUEUED",
      });
      await audit(actor, created, "entry.create", null, {
        classId: klass.id,
        taughtOn,
        versionId: version.id,
      });
      return { entry: created, versionId: version.id };
    });
    await this.enqueueOrganize(scope, entry.versionId, actor.userId);
    return this.get(actor, entry.entry.id);
  },

  async enqueueOrganize(scope: TenantScope, versionId: string, userId: string, attempt = "") {
    await enqueue(
      QueueName.ai,
      ORGANIZE_JOB,
      { tenantId: scope.tenantId, versionId, userId },
      {
        jobId: `entry-organize-${versionId}${attempt}`,
      },
    );
  },

  /** The worker: lesson notes to topics mapped onto the syllabus, plus a stored summary. */
  async runOrganize(data: { tenantId: string; versionId: string; userId: string }, job: Job) {
    const scope = { tenantId: data.tenantId };
    const version = await repo.findVersion(scope, data.versionId);
    if (!version || version.status !== "DRAFT" || version.organize === "DONE")
      return { skipped: true };
    await repo.updateVersion(scope, version.id, { organize: "RUNNING", organizeError: null });
    try {
      const context = await syllabusContext(scope, version.entry.subjectId);
      const result = await aiService.organizeEntry(
        { tenantId: data.tenantId, userId: data.userId },
        context.text,
        version.rawText,
      );
      const topics: StoredTopic[] = result.topics.map((t) => ({
        title: t.title,
        subtopics: t.subtopics,
        stableKey: t.syllabusKey ? (context.keyToStable.get(t.syllabusKey) ?? null) : null,
        confidence: t.confidence,
      }));
      await transaction(scope, async () => {
        await repo.updateVersion(scope, version.id, {
          structured: { topics } as object,
          summary: result.summary,
          syllabusVersionId: context.versionId,
          organize: "DONE",
        });
        await storeTopics(scope, version.id, topics);
      });
      return { topics: topics.length };
    } catch (err) {
      const final = job.attemptsMade + 1 >= (job.opts?.attempts ?? 1);
      await repo.updateVersion(scope, version.id, {
        organize: final ? "FAILED" : "QUEUED",
        organizeError: final
          ? err instanceof Error
            ? err.message.slice(0, 300)
            : "Organizing failed"
          : null,
      });
      logger.warn({ versionId: version.id, final }, "Organizing an entry failed");
      throw err;
    }
  },

  /** The author corrects the organized draft before submitting. */
  async updateDraft(
    actor: Actor,
    timezone: string,
    entryId: string,
    input: UpdateDraftInput,
  ): Promise<EntryView> {
    const scope = scopeOf(actor);
    const entry = await loadEntry(actor, entryId);
    const draft = entry.versions.find((v) => v.status === "DRAFT");
    if (!draft) throw AppError.invalidState("There is no draft to change");
    if (!can(actor, Action.ENTRY_EDIT_OWN, entryResource(entry, draft.authorId)))
      throw AppError.forbidden();
    let reorganize = false;
    await transaction(scope, async () => {
      if (input.taughtOn !== undefined && input.taughtOn !== toDateOnly(entry.taughtOn)) {
        if (entry.currentVersionId)
          throw AppError.invalidState("The date of a published entry cannot change");
        if (input.taughtOn > todayIn(timezone))
          throw AppError.invalid("The date cannot be in the future");
        const day = fromDateOnly(input.taughtOn)!;
        const session = await repo.findOrCreateSession(scope, entry.classId, day, actor.userId);
        await repo.updateEntry(scope, entry.id, { sessionId: session.id, taughtOn: day });
      }
      if (input.text !== undefined && input.text !== draft.rawText) {
        await repo.updateVersion(scope, draft.id, {
          rawText: input.text,
          organize: "QUEUED",
          organizeError: null,
        });
        reorganize = true;
      }
      if (input.topics !== undefined) {
        const { validKeys } = await syllabusContext(scope, entry.subjectId);
        const topics = cleanTopics(input.topics, validKeys);
        await repo.updateVersion(scope, draft.id, { structured: { topics } as object });
        await storeTopics(scope, draft.id, topics);
      }
      if (input.summary !== undefined)
        await repo.updateVersion(scope, draft.id, { summary: input.summary });
    });
    if (reorganize) await this.enqueueOrganize(scope, draft.id, actor.userId, `-${Date.now()}`);
    return this.get(actor, entryId);
  },

  /**
   * Submits the draft. A second entry for the same class and day needs a choice: replace the
   * existing one (this becomes its new version) or add it alongside.
   */
  async submit(actor: Actor, entryId: string, input: SubmitEntryInput): Promise<EntryView> {
    const scope = scopeOf(actor);
    const entry = await loadEntry(actor, entryId);
    const draft = entry.versions.find((v) => v.status === "DRAFT");
    if (!draft) throw AppError.invalidState("There is no draft to submit");
    if (!can(actor, Action.ENTRY_EDIT_OWN, entryResource(entry, draft.authorId)))
      throw AppError.forbidden();
    if (draft.organize !== "DONE")
      throw AppError.invalidState("Wait until the entry has been organized");

    let target = entry;
    let version: VersionRow = draft;
    if (!entry.currentVersionId && draft.versionNo === 1) {
      const others = await repo.findOthersOnDay(scope, entry.sessionId, entry.id);
      if (others.length && !input.onDuplicate) {
        throw new AppError(
          409,
          ErrorCode.DUPLICATE_ENTRY,
          "There is already an entry for this class on this day. Replace it or add yours?",
          others.map((o) => ({ path: "entryId", message: o.id })),
        );
      }
      if (others.length && input.onDuplicate === "replace") {
        const existing = others[0]!;
        if (
          existing.versions.some(
            (v) => v.status === "PENDING" || v.status === "APPROVED" || v.status === "DRAFT",
          )
        ) {
          throw AppError.invalidState(
            "The existing entry already has a change waiting; try again later",
          );
        }
        // The draft moves over as the next version of the existing entry.
        ({ target, version } = await transaction(scope, async () => {
          const moved = await repo.createVersion(scope, {
            entryId: existing.id,
            versionNo: await repo.nextVersionNo(scope, existing.id),
            inputKind: draft.inputKind,
            mediaFileId: draft.mediaFileId,
            rawText: draft.rawText,
            authorId: draft.authorId ?? actor.userId,
            organize: "DONE",
            structured: draft.structured as object,
            summary: draft.summary,
            syllabusVersionId: draft.syllabusVersionId,
          });
          await storeTopics(scope, moved.id, topicsOf(draft));
          await repo.deleteEntry(scope, entry.id);
          await audit(
            actor,
            existing,
            "entry.replace",
            { replacedBy: entry.id },
            { versionId: moved.id },
          );
          const reloaded = (await repo.findEntry(scope, existing.id))!;
          return { target: reloaded, version: reloaded.versions.find((v) => v.id === moved.id)! };
        }));
      }
    }
    await this.decideOnSubmit(actor, target, version);
    return this.get(actor, target.id);
  },

  /** Publish now (teacher, auto-approval, minor fix) or wait for the teacher with reminders. */
  async decideOnSubmit(actor: Actor, entry: EntryRow, version: VersionRow) {
    const scope = scopeOf(actor);
    const resource = entryResource(entry);
    const trusted = hasRole(actor, "TEACHER") && can(actor, Action.ENTRY_REVIEW, resource);
    const resolved = await approvalsService.resolve(scope, entry.programId, entry.classId);
    const live = entry.versions.find((v) => v.id === entry.currentVersionId);
    const minor = Boolean(live && topicSignature(live) === topicSignature(version));
    const now = new Date();
    if (trusted || resolved.autoApprove || minor) {
      await transaction(scope, async () => {
        await repo.updateVersion(scope, version.id, { submittedAt: now, minorEdit: minor });
        await audit(
          actor,
          entry,
          trusted ? "entry.publish.teacher" : minor ? "entry.publish.minor" : "entry.publish.auto",
          null,
          { versionId: version.id },
        );
      });
      await this.approveVersion(scope, version.id, trusted ? actor.userId : null);
      // An edit that went live without review: the teacher is told.
      if (live && !trusted && !minor)
        await this.notifyTeachers(scope, entry, "entry_published_notice");
      return;
    }
    await transaction(scope, async () => {
      await repo.updateVersion(scope, version.id, { status: "PENDING", submittedAt: now });
      await audit(actor, entry, "entry.submit", null, { versionId: version.id });
    });
    await approvalsService.schedule(scope, version.id, resolved);
  },

  /** Marks a version approved and queues indexing; the live pointer moves when that is done. */
  async approveVersion(
    scope: TenantScope,
    versionId: string,
    approvedById: string | null,
    unreviewed = false,
  ) {
    await repo.updateVersion(scope, versionId, {
      status: "APPROVED",
      approvedById,
      decidedAt: new Date(),
      unreviewed,
    });
    await approvalsService.cancel(versionId);
    await enqueue(
      QueueName.index,
      ENTRY_PUBLISH_JOB,
      { tenantId: scope.tenantId, versionId },
      {
        jobId: `entry-publish-${versionId}`,
      },
    );
  },

  /** The index job: embed the version, switch the live pointer, delete the old vectors. */
  async runPublish(data: { tenantId: string; versionId: string }) {
    const scope = { tenantId: data.tenantId };
    const version = await repo.findVersion(scope, data.versionId);
    if (!version || version.status !== "APPROVED") return { skipped: true };
    const entry = (await repo.findEntry(scope, version.entryId))!;
    await knowledgeService.removeVersions(scope, "ENTRY_VERSION", [version.id]);
    if (!entry.takenDownAt) await this.index(scope, entry, version);
    const previous = entry.currentVersionId;
    await transaction(scope, async () => {
      if (previous && previous !== version.id)
        await repo.updateVersion(scope, previous, { status: "SUPERSEDED" });
      await repo.updateVersion(scope, version.id, { status: "PUBLISHED" });
      await repo.updateEntry(scope, entry.id, { currentVersionId: version.id });
      await audit(
        { tenantId: data.tenantId, userId: version.approvedById },
        entry,
        "entry.publish",
        previous ? { liveVersionId: previous } : null,
        { liveVersionId: version.id, unreviewed: version.unreviewed },
      );
    });
    if (previous && previous !== version.id) {
      await knowledgeService.removeVersions(scope, "ENTRY_VERSION", [previous]);
    }
    // Retention: the whiteboard photo is kept for a while after the entry goes live.
    if (version.inputKind === "PHOTO" && version.mediaFileId) {
      const days = RETENTION.photoDaysAfterPublish;
      await filesService.deleteAfter(
        scope,
        version.mediaFileId,
        new Date(Date.now() + days * 24 * 60 * 60 * 1000),
      );
    }
    return { published: version.id };
  },

  async index(
    scope: TenantScope,
    entry: {
      id: string;
      programId: string;
      batchId: string;
      semesterId: string;
      sectionId: string;
      subjectId: string;
      classId: string;
      taughtOn: Date;
    },
    version: {
      id: string;
      versionNo: number;
      structured: unknown;
      summary: string | null;
      rawText: string;
    },
  ) {
    const subject = await structureService.findSubject(scope, entry.subjectId);
    const section = await structureService.findSection(scope, entry.sectionId);
    const day = toDateOnly(entry.taughtOn)!;
    const topics = topicsOf(version);
    const text = [
      `Subject: ${subject?.name} (${subject?.code}), section ${section?.name}, taught on ${day}`,
      topics.length
        ? `Topics: ${topics.map((t) => (t.subtopics.length ? `${t.title} (${t.subtopics.join(", ")})` : t.title)).join("; ")}`
        : null,
      version.summary ? `Summary: ${version.summary}` : null,
      `Notes: ${version.rawText.slice(0, 2000)}`,
    ]
      .filter(Boolean)
      .join("\n");
    await knowledgeService.indexVersion(
      scope,
      { tenantId: scope.tenantId, userId: null },
      "ENTRY_INDEX",
      "ENTRY_VERSION",
      version.id,
      [
        {
          sourceId: entry.id,
          text,
          payload: {
            programId: entry.programId,
            batchId: entry.batchId,
            semesterId: entry.semesterId,
            sectionId: entry.sectionId,
            subjectId: entry.subjectId,
            classId: entry.classId,
            ownerId: null,
            visibility: "SHARED",
            contentKind: "CLASS_REPORTED",
            meta: { taughtOn: day, versionNo: version.versionNo, entryId: entry.id },
          },
        },
      ],
    );
  },

  // ---------- Editing a published entry ----------

  async newVersion(actor: Actor, entryId: string, input: NewEntryVersionInput): Promise<EntryView> {
    const scope = scopeOf(actor);
    const entry = await loadEntry(actor, entryId);
    if (!entry.currentVersionId) throw AppError.invalidState("Submit the entry first");
    if (!can(actor, Action.ENTRY_EDIT_OWN, entryResource(entry, entry.authorId)))
      throw AppError.forbidden();
    await checkMedia(actor, entry.classId, input);
    if (entry.versions.some((v) => OPEN_STATUSES.has(v.status))) {
      throw AppError.conflict(ErrorCode.CONFLICT, "A change to this entry is already in progress");
    }
    if (!isAiConfigured()) throw AppError.notConfigured("AI");
    const version = await transaction(scope, async () => {
      const created = await repo.createVersion(scope, {
        entryId: entry.id,
        versionNo: await repo.nextVersionNo(scope, entry.id),
        inputKind: input.inputKind,
        mediaFileId: input.mediaFileId ?? null,
        rawText: input.text,
        authorId: actor.userId,
        organize: "QUEUED",
      });
      await audit(actor, entry, "entry.edit", null, { versionId: created.id });
      return created;
    });
    await this.enqueueOrganize(scope, version.id, actor.userId);
    return this.get(actor, entryId);
  },

  /** The author takes back a version that is waiting for approval (or an unsent draft). */
  async withdraw(actor: Actor, entryId: string): Promise<EntryView | null> {
    const scope = scopeOf(actor);
    const entry = await loadEntry(actor, entryId);
    const open = entry.versions.find((v) => v.status === "PENDING" || v.status === "DRAFT");
    if (!open) throw AppError.invalidState("Nothing to withdraw");
    if (!can(actor, Action.ENTRY_EDIT_OWN, entryResource(entry, open.authorId)))
      throw AppError.forbidden();
    await transaction(scope, async () => {
      if (!entry.currentVersionId && entry.versions.length === 1) {
        await repo.deleteEntry(scope, entry.id);
      } else {
        await repo.updateVersion(scope, open.id, { status: "WITHDRAWN" });
      }
      await audit(
        actor,
        entry,
        "entry.withdraw",
        { versionId: open.id, status: open.status },
        null,
      );
    });
    await approvalsService.cancel(open.id);
    return entry.currentVersionId || entry.versions.length > 1 ? this.get(actor, entryId) : null;
  },

  // ---------- Teacher review ----------

  /** Entries waiting for this person: their classes (teacher) or programs (Program Admin). */
  async queue(actor: Actor): Promise<ApprovalItem[]> {
    const scope = scopeOf(actor);
    const rows = await repo.listPending(scope, {
      classIds: actor.teaching.map((c) => c.classId),
      programIds: adminProgramIds(actor),
    });
    const visible = rows.filter((e) => can(actor, Action.ENTRY_REVIEW, entryResource(e)));
    const [subjects, sections] = await Promise.all([
      structureService.findSubjects(scope, [...new Set(visible.map((e) => e.subjectId))]),
      structureService.findSections(scope, [...new Set(visible.map((e) => e.sectionId))]),
    ]);
    return visible.flatMap((e) =>
      e.versions
        .filter((v) => v.status === "PENDING")
        .map((v) => {
          const subject = subjects.find((s) => s.id === e.subjectId)!;
          const section = sections.find((s) => s.id === e.sectionId)!;
          return {
            entryId: e.id,
            versionId: v.id,
            classId: e.classId,
            subject: { id: subject.id, name: subject.name, code: subject.code },
            section: { id: section.id, name: section.name },
            taughtOn: toDateOnly(e.taughtOn)!,
            authorId: v.authorId,
            topics: toVersionView(v).topics,
            summary: v.summary,
            submittedAt: v.submittedAt?.toISOString() ?? null,
            isEdit: Boolean(e.currentVersionId),
          };
        }),
    );
  },

  async loadPending(actor: Actor, versionId: string) {
    const version = await repo.findVersion(scopeOf(actor), versionId);
    if (!version) throw AppError.notFound("Entry not found");
    const resource = entryResource(version.entry);
    if (!can(actor, Action.ENTRY_REVIEW, resource)) {
      throw can(actor, Action.ENTRY_READ_PUBLISHED, resource)
        ? AppError.forbidden()
        : AppError.notFound("Entry not found");
    }
    if (version.status !== "PENDING")
      throw AppError.invalidState("This entry is not waiting for approval");
    return version;
  },

  /** Approves (optionally with corrections to topics or summary); it goes live once indexed. */
  async approve(
    actor: Actor,
    versionId: string,
    input: ApproveEntryInput = {},
  ): Promise<EntryView> {
    const scope = scopeOf(actor);
    const version = await this.loadPending(actor, versionId);
    await transaction(scope, async () => {
      if (input.topics) {
        const { validKeys } = await syllabusContext(scope, version.entry.subjectId);
        const topics = cleanTopics(input.topics, validKeys);
        await repo.updateVersion(scope, version.id, { structured: { topics } as object });
        await storeTopics(scope, version.id, topics);
      }
      if (input.summary !== undefined)
        await repo.updateVersion(scope, version.id, { summary: input.summary });
      await audit(
        actor,
        version.entry,
        "entry.approve",
        { status: "PENDING" },
        { versionId, edited: Boolean(input.topics || input.summary) },
      );
    });
    await this.approveVersion(scope, version.id, actor.userId);
    return this.get(actor, version.entryId);
  },

  async reject(actor: Actor, versionId: string, reason: string): Promise<EntryView> {
    const scope = scopeOf(actor);
    const version = await this.loadPending(actor, versionId);
    await transaction(scope, async () => {
      await repo.updateVersion(scope, version.id, {
        status: "REJECTED",
        rejectionReason: reason,
        approvedById: actor.userId,
        decidedAt: new Date(),
      });
      await audit(
        actor,
        version.entry,
        "entry.reject",
        { status: "PENDING" },
        { versionId, reason },
      );
    });
    await approvalsService.cancel(version.id);
    return this.get(actor, version.entryId);
  },

  /** Approves several at once; nothing is approved unless every one is allowed. */
  async bulkApprove(actor: Actor, versionIds: string[]) {
    const versions = [];
    for (const id of [...new Set(versionIds)]) versions.push(await this.loadPending(actor, id));
    for (const v of versions) {
      await audit(
        actor,
        v.entry,
        "entry.approve",
        { status: "PENDING" },
        { versionId: v.id, bulk: true },
      );
      await this.approveVersion(scopeOf(actor), v.id, actor.userId);
    }
    return { approved: versions.length };
  },

  // ---------- Takedown ----------

  async takedown(actor: Actor, entryId: string): Promise<EntryView> {
    const scope = scopeOf(actor);
    const entry = await loadEntry(actor, entryId);
    if (!can(actor, Action.ENTRY_TAKEDOWN, entryResource(entry))) throw AppError.forbidden();
    if (entry.takenDownAt) return this.get(actor, entryId);
    await transaction(scope, async () => {
      await repo.updateEntry(scope, entry.id, {
        takenDownAt: new Date(),
        takenDownById: actor.userId,
      });
      await audit(actor, entry, "entry.takedown", null, { liveVersionId: entry.currentVersionId });
    });
    if (entry.currentVersionId)
      await knowledgeService.removeVersions(scope, "ENTRY_VERSION", [entry.currentVersionId]);
    return this.get(actor, entryId);
  },

  async restore(actor: Actor, entryId: string): Promise<EntryView> {
    const scope = scopeOf(actor);
    const entry = await loadEntry(actor, entryId);
    if (!can(actor, Action.ENTRY_TAKEDOWN, entryResource(entry))) throw AppError.forbidden();
    if (!entry.takenDownAt) return this.get(actor, entryId);
    await transaction(scope, async () => {
      await repo.updateEntry(scope, entry.id, { takenDownAt: null, takenDownById: null });
      await audit(actor, entry, "entry.restore", null, { liveVersionId: entry.currentVersionId });
    });
    if (entry.currentVersionId) {
      await enqueue(
        QueueName.index,
        ENTRY_REINDEX_JOB,
        { tenantId: scope.tenantId, versionId: entry.currentVersionId },
        {
          jobId: `entry-reindex-${entry.currentVersionId}-${Date.now()}`,
        },
      );
    }
    return this.get(actor, entryId);
  },

  async runReindex(data: { tenantId: string; versionId: string }) {
    const scope = { tenantId: data.tenantId };
    const version = await repo.findVersion(scope, data.versionId);
    if (!version || version.status !== "PUBLISHED" || version.entry.takenDownAt)
      return { skipped: true };
    await knowledgeService.removeVersions(scope, "ENTRY_VERSION", [version.id]);
    await this.index(scope, version.entry, version);
    return { reindexed: version.id };
  },

  // ---------- Reading ----------

  toView(
    actor: Actor,
    entry: EntryRow,
    subject: { id: string; name: string; code: string },
    section: { id: string; name: string },
  ): EntryView | null {
    const live = entry.currentVersionId
      ? entry.versions.find((v) => v.id === entry.currentVersionId)
      : undefined;
    const seesLive =
      live &&
      (!entry.takenDownAt || can(actor, Action.ENTRY_TAKEDOWN, entryResource(entry))) &&
      can(actor, Action.ENTRY_READ_PUBLISHED, entryResource(entry));
    const latest = latestVisible(actor, entry);
    if (!seesLive && !latest) return null;
    return {
      id: entry.id,
      classId: entry.classId,
      subject,
      section,
      taughtOn: toDateOnly(entry.taughtOn)!,
      authorId: entry.authorId,
      takenDown: Boolean(entry.takenDownAt),
      live: seesLive ? toVersionView(live) : null,
      latest: latest ? toVersionView(latest) : null,
    };
  },

  async views(actor: Actor, entries: EntryRow[]): Promise<EntryView[]> {
    const scope = scopeOf(actor);
    const [subjects, sections] = await Promise.all([
      structureService.findSubjects(scope, [...new Set(entries.map((e) => e.subjectId))]),
      structureService.findSections(scope, [...new Set(entries.map((e) => e.sectionId))]),
    ]);
    return entries.flatMap((e) => {
      const subject = subjects.find((s) => s.id === e.subjectId)!;
      const section = sections.find((s) => s.id === e.sectionId)!;
      const view = this.toView(
        actor,
        e,
        { id: subject.id, name: subject.name, code: subject.code },
        { id: section.id, name: section.name },
      );
      return view ? [view] : [];
    });
  },

  async get(actor: Actor, entryId: string): Promise<EntryView> {
    const entry = await loadEntry(actor, entryId);
    const [view] = await this.views(actor, [entry]);
    if (!view) throw AppError.notFound("Entry not found");
    return view;
  },

  async listForClass(
    actor: Actor,
    classId: string,
    range: { from?: string; to?: string },
  ): Promise<EntryView[]> {
    const klass = await loadClass(actor, classId);
    const rows = await repo.listForClasses(
      scopeOf(actor),
      [klass.id],
      fromDateOnly(range.from) ?? undefined,
      fromDateOnly(range.to) ?? undefined,
    );
    return this.views(actor, rows);
  },

  async mine(actor: Actor): Promise<EntryView[]> {
    return this.views(actor, await repo.listByAuthor(scopeOf(actor), actor.userId));
  },

  // ---------- Reminders, escalation, unreviewed publishing (worker) ----------

  async notifyTeachers(
    scope: TenantScope,
    entry: { classId: string; subjectId: string; taughtOn: Date },
    template: "approval_reminder" | "entry_published_notice",
  ) {
    const klass = await classesService.find(scope, entry.classId);
    if (!klass) return;
    const tenant = await tenantsService.findOwn(scope.tenantId);
    const pending = await repo.countPendingInClass(scope, entry.classId);
    for (const to of await emailsOf(klass.teachers.map((t) => t.userId))) {
      await notificationsService.queueEmail(
        template === "approval_reminder"
          ? {
              tenantId: scope.tenantId,
              to,
              template,
              params: {
                collegeName: tenant!.name,
                subjectName: klass.subject.name,
                pendingCount: Math.max(pending, 1),
              },
            }
          : {
              tenantId: scope.tenantId,
              to,
              template,
              params: {
                collegeName: tenant!.name,
                subjectName: klass.subject.name,
                taughtOn: toDateOnly(entry.taughtOn)!,
              },
            },
      );
    }
  },

  async remind(data: { tenantId: string; versionId: string; n: number }) {
    const scope = { tenantId: data.tenantId };
    const version = await repo.findVersion(scope, data.versionId);
    if (!version || version.status !== "PENDING") return { skipped: true };
    await this.notifyTeachers(scope, version.entry, "approval_reminder");
    await repo.updateVersion(scope, version.id, {
      reminderCount: data.n,
      lastReminderAt: new Date(),
    });
    return { reminded: data.n };
  },

  async escalate(data: { tenantId: string; versionId: string }, hours: number) {
    const scope = { tenantId: data.tenantId };
    const version = await repo.findVersion(scope, data.versionId);
    if (!version || version.status !== "PENDING") return { skipped: true };
    const [admins, klass, tenant] = await Promise.all([
      membershipsService.holders(scope, "PROGRAM_ADMIN", { programId: version.entry.programId }),
      classesService.find(scope, version.entry.classId),
      tenantsService.findOwn(scope.tenantId),
    ]);
    for (const to of await emailsOf(admins)) {
      await notificationsService.queueEmail({
        tenantId: scope.tenantId,
        to,
        template: "approval_escalation",
        params: {
          collegeName: tenant!.name,
          subjectName: klass!.subject.name,
          sectionName: klass!.section.name,
          hours,
        },
      });
    }
    await transaction(scope, async () => {
      await repo.updateVersion(scope, version.id, { escalatedAt: new Date() });
      await audit(
        { tenantId: data.tenantId, userId: null },
        version.entry,
        "entry.escalate",
        null,
        { versionId: version.id, hours },
      );
    });
    return { escalated: admins.length };
  },

  async publishUnreviewed(data: { tenantId: string; versionId: string }) {
    const scope = { tenantId: data.tenantId };
    const version = await repo.findVersion(scope, data.versionId);
    if (!version || version.status !== "PENDING") return { skipped: true };
    const resolved = await approvalsService.resolve(
      scope,
      version.entry.programId,
      version.entry.classId,
    );
    // The setting may have been switched off since the entry was submitted.
    if (!resolved.unreviewedPublishAfterDays) return { skipped: true };
    await audit(
      { tenantId: data.tenantId, userId: null },
      version.entry,
      "entry.publish.unreviewed",
      { status: "PENDING" },
      { versionId: version.id },
    );
    await this.approveVersion(scope, version.id, null, true);
    return { published: version.id };
  },

  /** A new syllabus version: entries mapped to topics that no longer exist are flagged. */
  async onSyllabusPublished(event: PublishedEvent) {
    const scope = { tenantId: event.tenantId };
    const live = await syllabusService.liveTopics(scope, event.subjectId);
    if (!live) return;
    const flagged = await repo.markStaleMappings(
      scope,
      event.subjectId,
      live.topics.map((t) => t.stableKey),
    );
    if (flagged)
      logger.info(
        { subjectId: event.subjectId, flagged },
        "Entry topic mappings flagged after a syllabus change",
      );
  },

  /**
   * Chat (feature 8): the entries for which one of these versions is still the live, visible
   * version. Retrieval hits that are not in the result are dropped, and old answers citing them
   * are marked as out of date.
   */
  liveByVersions: (scope: TenantScope, versionIds: string[]) =>
    versionIds.length ? repo.listByLiveVersions(scope, versionIds) : Promise.resolve([]),
  entryResource,

  /** For catch-up and date questions (feature 9): live entries of sections in a date range. */
  liveForSections: (scope: TenantScope, sectionIds: string[], from: string, to: string) =>
    repo.listLiveForSections(scope, sectionIds, fromDateOnly(from)!, fromDateOnly(to)!),
  topicsOf,
};
