import type {
  AnswerLabel,
  AskResult,
  ChatScope,
  Citation,
  ConversationSummaryView,
  ConversationView,
  CreateConversationInput,
  MessageView,
  UpdateConversationInput,
} from "@semwise/shared";
import { transaction, type TenantScope } from "../../common/db/scope.js";
import { AppError } from "../../common/errors/app-error.js";
import { currentRequest } from "../../common/http/request-context.js";
import { todayIn, weekday } from "../../common/time.js";
import { logger } from "../../lib/logger.js";
import { aiService, isAiConfigured, models, type AiContext } from "../ai/index.js";
import { Action, can, type Actor, type Resource } from "../authz/index.js";
import { knowledgeService } from "../knowledge/index.js";
import { sessionsService } from "../sessions/index.js";
import { structureService } from "../structure/index.js";
import { syllabusService } from "../syllabus/index.js";
import { usageService } from "../usage/index.js";
import { chatRepository as repo } from "./chat.repository.js";

/** Messages sent to the models word for word; older ones live in the running summary. */
const RECENT_MESSAGES = 6;
/** Older messages not yet in the summary before they are folded in. */
const SUMMARIZE_AFTER = 10;
/** Hits below this similarity are not worth showing the model. */
const MIN_SCORE = 0.2;
const SEARCH_LIMIT = 8;
const MAX_SOURCES = 6;
const NEW_TITLE = "New chat";
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export const DECLINE_TEXT =
  "I can help only with your subjects and what was taught in your classes. Try asking about a topic from your syllabus.";

type Conversation = NonNullable<Awaited<ReturnType<typeof repo.findConversation>>>;
type Message = Awaited<ReturnType<typeof repo.listMessages>>[number];
type Outline = Awaited<ReturnType<typeof syllabusService.liveOutlines>>[number];
type Subject = { id: string; name: string; code: string };

interface Source {
  key: string;
  score: number;
  text: string;
  citation: Citation;
}

const scopeOf = (actor: Actor): TenantScope => ({ tenantId: actor.tenantId! });
const own = (actor: Actor): Resource => ({ tenantId: actor.tenantId!, ownerId: actor.userId });
const unique = <T>(values: T[]) => [...new Set(values)];

/** Chat is the student's own: only a student (or CR) of this college, for themselves. */
function requireStudent(actor: Actor): void {
  if (!can(actor, Action.CHAT_USE, own(actor))) throw AppError.forbidden();
}

async function loadOwn(actor: Actor, id: string): Promise<Conversation> {
  requireStudent(actor);
  const conversation = await repo.findConversation(scopeOf(actor), actor.userId, id);
  if (
    !conversation ||
    !can(actor, Action.PRIVATE_DATA_READ, {
      tenantId: conversation.tenantId,
      ownerId: conversation.userId,
    })
  ) {
    throw AppError.notFound("Conversation not found");
  }
  return conversation;
}

/** The semesters and sections a question may draw on: the current one, plus past if opted in. */
function reach(actor: Actor, includePast: boolean) {
  const current = actor.enrollments.filter((e) => e.current);
  if (current.length === 0)
    throw AppError.invalidState("You are not placed in a section this semester yet");
  const used = includePast ? actor.enrollments : current;
  return {
    programId: current[0]!.programId,
    batchId: current[0]!.batchId,
    semesterIds: unique(used.map((e) => e.semesterId)),
    sectionIds: unique(used.map((e) => e.sectionId)),
  };
}

/** A pinned subject must be one the student studies (now or, for past chats, before). */
async function checkPinned(actor: Actor, subjectId: string | null | undefined) {
  if (!subjectId) return;
  const subject = await structureService.findSubject(scopeOf(actor), subjectId);
  const semesters = new Set(actor.enrollments.map((e) => e.semesterId));
  if (!subject || !semesters.has(subject.semesterId)) throw AppError.notFound("Subject not found");
}

/** The language the model reports, kept to a plain name before it goes into a prompt. */
function cleanLanguage(language: string): string {
  return /^[A-Za-z][A-Za-z ()-]{0,39}$/.test(language.trim()) ? language.trim() : "English";
}

function turns(messages: Message[]): string {
  return messages
    .map((m) => `${m.role === "USER" ? "Student" : "Assistant"}: ${m.content}`)
    .join("\n");
}

function citationsOf(m: Message): Citation[] {
  return Array.isArray(m.citations) ? (m.citations as unknown as Citation[]) : [];
}

function toMessageView(m: Message, live: { syllabus: Set<string>; entries: Set<string> }) {
  const citations = citationsOf(m);
  const outdated = citations.some(
    (c) =>
      (c.syllabusVersionId !== null && !live.syllabus.has(c.syllabusVersionId)) ||
      (c.entryVersionId !== null && !live.entries.has(c.entryVersionId)),
  );
  return {
    id: m.id,
    role: m.role,
    content: m.content,
    scope: (m.scope as ChatScope | null) ?? null,
    labels: (Array.isArray(m.labels) ? m.labels : []) as AnswerLabel[],
    citations,
    outdated,
    createdAt: m.createdAt.toISOString(),
  } satisfies MessageView;
}

/** Which cited versions are still live, for the "based on content later corrected" mark. */
async function liveSets(scope: TenantScope, messages: Message[]) {
  const citations = messages.flatMap(citationsOf);
  const syllabusIds = unique(citations.flatMap((c) => c.syllabusVersionId ?? []));
  const entryIds = unique(citations.flatMap((c) => c.entryVersionId ?? []));
  const [syllabus, entries] = await Promise.all([
    syllabusService.stillLive(scope, syllabusIds),
    sessionsService.liveByVersions(scope, entryIds),
  ]);
  return { syllabus, entries: new Set(entries.map((e) => e.currentVersionId!)) };
}

function toSummaryView(c: Conversation): ConversationSummaryView {
  return {
    id: c.id,
    title: c.title,
    pinnedSubjectId: c.pinnedSubjectId,
    includePast: c.includePast,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

/**
 * Retrieval with the second check: every hit is matched against Postgres before the model sees
 * it (live syllabus version of a subject the student studies; live, visible entry of one of the
 * student's sections). Anything that fails is dropped silently.
 */
async function retrieve(
  actor: Actor,
  ctx: AiContext,
  query: string,
  area: ReturnType<typeof reach>,
  outlines: Outline[],
  subjects: Map<string, Subject>,
  subjectIds: string[],
): Promise<Source[]> {
  const scope = scopeOf(actor);
  const [syllabusHits, entryHits] = await knowledgeService.searchEach(
    scope,
    { ...ctx, countsAsNewRequest: false },
    "CHAT",
    query,
    [
      {
        sourceTypes: ["SYLLABUS_TOPIC"],
        batchId: area.batchId,
        semesterIds: area.semesterIds,
        subjectIds,
      },
      {
        sourceTypes: ["ENTRY_VERSION"],
        batchId: area.batchId,
        semesterIds: area.semesterIds,
        sectionIds: area.sectionIds,
        subjectIds,
      },
    ],
    SEARCH_LIMIT,
  );
  const outlineOf = new Map(outlines.map((o) => [o.subjectId, o]));
  const sources: Omit<Source, "key">[] = [];
  for (const hit of syllabusHits!) {
    const p = hit.payload;
    const outline = p.subjectId ? outlineOf.get(p.subjectId) : undefined;
    const subject = p.subjectId ? subjects.get(p.subjectId) : undefined;
    if (hit.score < MIN_SCORE || !outline || !subject || outline.versionId !== p.sourceVersionId)
      continue;
    const resource = {
      tenantId: scope.tenantId,
      programId: outline.programId,
      batchId: outline.batchId,
      semesterId: outline.semesterId,
      subjectId: outline.subjectId,
    };
    if (!can(actor, Action.SYLLABUS_READ_PUBLISHED, resource)) continue;
    sources.push({
      score: hit.score,
      text: p.text,
      citation: {
        key: "",
        kind: "SYLLABUS",
        subject,
        unitNo: Number(p.meta.unitNo ?? 0) || null,
        unitTitle: (p.meta.unitTitle as string | null) ?? null,
        topicTitle: (p.meta.topicTitle as string | null) ?? null,
        syllabusVersionId: p.sourceVersionId,
        entryId: null,
        entryVersionId: null,
        taughtOn: null,
        versionNo: Number(p.meta.versionNo ?? 1),
      },
    });
  }
  const strongEntries = entryHits!.filter((h) => h.score >= MIN_SCORE);
  const live = new Map(
    (
      await sessionsService.liveByVersions(
        scope,
        strongEntries.map((h) => h.payload.sourceVersionId),
      )
    ).map((e) => [e.currentVersionId!, e]),
  );
  for (const hit of strongEntries) {
    const entry = live.get(hit.payload.sourceVersionId);
    const subject = entry ? subjects.get(entry.subjectId) : undefined;
    if (
      !entry ||
      !subject ||
      !area.sectionIds.includes(entry.sectionId) ||
      !can(actor, Action.ENTRY_READ_PUBLISHED, sessionsService.entryResource(entry))
    ) {
      continue;
    }
    sources.push({
      score: hit.score,
      text: hit.payload.text,
      citation: {
        key: "",
        kind: "CLASS",
        subject,
        unitNo: null,
        unitTitle: null,
        topicTitle: null,
        syllabusVersionId: null,
        entryId: entry.id,
        entryVersionId: entry.currentVersionId,
        taughtOn: entry.taughtOn.toISOString().slice(0, 10),
        versionNo: entry.currentVersion?.versionNo ?? 1,
      },
    });
  }
  return sources
    .sort((x, y) => y.score - x.score)
    .slice(0, MAX_SOURCES)
    .map((s, i) => ({ ...s, key: `S${i + 1}`, citation: { ...s.citation, key: `S${i + 1}` } }));
}

function sourceBlock(sources: Source[]): string {
  return sources
    .map((s) => {
      const c = s.citation;
      const head =
        c.kind === "SYLLABUS"
          ? `${s.key} [official syllabus] ${c.subject.name}, unit ${c.unitNo ?? "?"}: ${c.unitTitle ?? ""}`
          : `${s.key} [reported in class on ${c.taughtOn}, version ${c.versionNo}] ${c.subject.name}`;
      return `${head}\n${s.text}`;
    })
    .join("\n\n");
}

export const chatService = {
  async create(actor: Actor, input: CreateConversationInput): Promise<ConversationView> {
    requireStudent(actor);
    reach(actor, false);
    await checkPinned(actor, input.pinnedSubjectId);
    const conversation = await repo.createConversation(scopeOf(actor), {
      userId: actor.userId,
      title: NEW_TITLE,
      pinnedSubjectId: input.pinnedSubjectId ?? null,
      includePast: input.includePast ?? false,
    });
    return { ...toSummaryView(conversation), messages: [] };
  },

  async list(actor: Actor): Promise<ConversationSummaryView[]> {
    requireStudent(actor);
    return (await repo.listConversations(scopeOf(actor), actor.userId)).map(toSummaryView);
  },

  async get(actor: Actor, id: string): Promise<ConversationView> {
    const conversation = await loadOwn(actor, id);
    const scope = scopeOf(actor);
    const messages = await repo.listMessages(scope, conversation.id);
    const live = await liveSets(scope, messages);
    return {
      ...toSummaryView(conversation),
      messages: messages.map((m) => toMessageView(m, live)),
    };
  },

  async update(actor: Actor, id: string, input: UpdateConversationInput) {
    const conversation = await loadOwn(actor, id);
    await checkPinned(actor, input.pinnedSubjectId);
    const updated = await repo.updateConversation(scopeOf(actor), conversation.id, {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.pinnedSubjectId !== undefined ? { pinnedSubjectId: input.pinnedSubjectId } : {}),
      ...(input.includePast !== undefined ? { includePast: input.includePast } : {}),
    });
    return toSummaryView(updated);
  },

  /** The student deletes their own chat; nobody else can. */
  async remove(actor: Actor, id: string): Promise<void> {
    const conversation = await loadOwn(actor, id);
    await repo.deleteConversation(scopeOf(actor), actor.userId, conversation.id);
  },

  /**
   * One question: route (cheap), decline if unrelated, retrieve and re-check, answer (Mini, or
   * Terra when complex), save the turn, fold old turns into the summary. Counts once against the
   * student's monthly question quota.
   */
  async ask(actor: Actor, timezone: string, id: string, text: string): Promise<AskResult> {
    const conversation = await loadOwn(actor, id);
    const scope = scopeOf(actor);
    const area = reach(actor, conversation.includePast);
    if (!isAiConfigured()) throw AppError.notConfigured("AI");
    const ctx: AiContext = { tenantId: scope.tenantId, userId: actor.userId };

    let outlines = await syllabusService.liveOutlines(scope, area.semesterIds);
    if (conversation.pinnedSubjectId)
      outlines = outlines.filter((o) => o.subjectId === conversation.pinnedSubjectId);
    const subjects = new Map(
      (await structureService.findSubjects(scope, unique(outlines.map((o) => o.subjectId)))).map(
        (s) => [s.id, { id: s.id, name: s.name, code: s.code }],
      ),
    );
    const keyed = outlines.flatMap((o, i) => {
      const s = subjects.get(o.subjectId);
      return s ? [{ key: `S${i + 1}`, outline: o, subject: s }] : [];
    });
    const messages = await repo.listMessages(scope, conversation.id);
    const recent = turns(messages.slice(-RECENT_MESSAGES));
    const today = todayIn(timezone);

    const route = await aiService.routeQuestion(ctx, {
      subjects:
        keyed
          .map(
            (k) =>
              `${k.key} ${k.subject.name} (${k.subject.code}). Units: ${k.outline.units.join("; ")}`,
          )
          .join("\n") || "(no subjects with a published syllabus)",
      history: recent,
      question: text,
      today,
      weekday: WEEKDAYS[weekday(today)]!,
    });
    const language = cleanLanguage(route.language);
    const later = { ...ctx, countsAsNewRequest: false };

    let reply: {
      content: string;
      scope: ChatScope;
      labels: AnswerLabel[];
      citations: Citation[];
      model: string | null;
    };
    if (route.scope === "UNRELATED") {
      // A polite decline: no retrieval and no expensive call.
      reply = { content: DECLINE_TEXT, scope: "UNRELATED", labels: [], citations: [], model: null };
    } else {
      const chosen = conversation.pinnedSubjectId
        ? [conversation.pinnedSubjectId]
        : route.subjectKeys.flatMap((k) => keyed.find((x) => x.key === k)?.subject.id ?? []);
      const subjectIds = chosen.length ? chosen : keyed.map((k) => k.subject.id);
      const sources = await retrieve(
        actor,
        later,
        route.query.trim() || text,
        area,
        outlines,
        subjects,
        subjectIds,
      );
      const model = route.complex ? models.deep() : models.answer();
      const answer = await aiService.answerQuestion(later, model, {
        sources: sourceBlock(sources),
        summary: conversation.summary ?? "",
        history: recent,
        question: text,
        language,
      });
      const used = sources.filter((s) => answer.sourceKeys.includes(s.key));
      const labels = new Set<AnswerLabel>();
      if (used.some((s) => s.citation.kind === "SYLLABUS")) labels.add("FROM_SYLLABUS");
      if (used.some((s) => s.citation.kind === "CLASS")) labels.add("REPORTED_IN_CLASS");
      if (answer.generalExplanation || used.length === 0) labels.add("GENERAL_EXPLANATION");
      if (route.scope === "RELATED") labels.add("OUTSIDE_SYLLABUS");
      if (answer.notInMaterial || sources.length === 0) labels.add("NOT_IN_MATERIAL");
      reply = {
        content: answer.answer,
        scope: route.scope,
        labels: [...labels],
        citations: used.map((s) => s.citation),
        model,
      };
    }

    const requestId = currentRequest().requestId;
    const saved = await transaction(scope, async () => {
      const question = await repo.createMessage(scope, {
        conversationId: conversation.id,
        role: "USER",
        content: text,
        language,
        requestId,
      });
      const answer = await repo.createMessage(scope, {
        conversationId: conversation.id,
        role: "ASSISTANT",
        content: reply.content,
        scope: reply.scope,
        language,
        citations: reply.citations as unknown as object,
        labels: reply.labels,
        model: reply.model,
        requestId,
      });
      if (messages.length === 0 && conversation.title === NEW_TITLE) {
        await repo.updateConversation(scope, conversation.id, {
          title: text.length > 60 ? `${text.slice(0, 57)}...` : text,
        });
      } else {
        await repo.touch(scope, conversation.id);
      }
      return { question, answer };
    });

    await this.foldOldTurns(later, conversation, [...messages, saved.question, saved.answer]);
    const live = await liveSets(scope, [saved.answer]);
    const quota = await usageService.userQuota(scope.tenantId, actor.userId, "CHAT");
    return {
      question: toMessageView(saved.question, live),
      answer: toMessageView(saved.answer, live),
      quota,
    };
  },

  /** Keeps prompts short: older turns are summarized once enough of them pile up. */
  async foldOldTurns(ctx: AiContext, conversation: Conversation, messages: Message[]) {
    const older = messages.slice(0, -RECENT_MESSAGES);
    if (older.length - conversation.summarizedCount < SUMMARIZE_AFTER) return;
    try {
      const summary = await aiService.summarizeChat(
        ctx,
        conversation.summary ?? "",
        turns(older.slice(conversation.summarizedCount)),
      );
      await repo.updateConversation({ tenantId: conversation.tenantId }, conversation.id, {
        summary,
        summarizedCount: older.length,
      });
    } catch (err) {
      // The answer is already saved; the summary is tried again after the next question.
      logger.warn(
        { conversationId: conversation.id, err: (err as Error).message },
        "Summarizing a chat failed",
      );
    }
  },
};
