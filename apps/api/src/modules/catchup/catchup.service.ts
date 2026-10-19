import { MAX_CATCHUP_DAYS, type CatchupQuery, type CatchupView } from "@semwise/shared";
import type { TenantScope } from "../../common/db/scope.js";
import { AppError } from "../../common/errors/app-error.js";
import { addDays, todayIn } from "../../common/time.js";
import { Action, can, type Actor } from "../authz/index.js";
import { sessionsService } from "../sessions/index.js";
import { structureService } from "../structure/index.js";

const DAY = 24 * 60 * 60 * 1000;
const scopeOf = (actor: Actor): TenantScope => ({ tenantId: actor.tenantId! });

/** Inclusive length of a range of "YYYY-MM-DD" days. */
export const daysIn = (from: string, to: string) =>
  Math.round((Date.parse(to) - Date.parse(from)) / DAY) + 1;

/**
 * A range the router read from a question, made safe: real dates, in order, not past today,
 * at most MAX_CATCHUP_DAYS long (the most recent days are kept). Null when unusable.
 */
export function cleanRange(
  dates: { from: string | null; to: string | null },
  today: string,
): { from: string; to: string } | null {
  const valid = (d: string | null) =>
    d !== null && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d)) ? d : null;
  let from = valid(dates.from);
  let to = valid(dates.to) ?? from;
  from ??= to;
  if (!from || !to) return null;
  if (from > to) [from, to] = [to, from];
  if (from > today) return null;
  if (to > today) to = today;
  if (daysIn(from, to) > MAX_CATCHUP_DAYS) from = addDays(to, -(MAX_CATCHUP_DAYS - 1));
  return { from, to };
}

export const catchupService = {
  /** The catch-up screen: the student's current section, stored summaries only (no AI call). */
  async view(actor: Actor, timezone: string, query: CatchupQuery): Promise<CatchupView> {
    if (!can(actor, Action.CATCHUP_USE, { tenantId: actor.tenantId!, ownerId: actor.userId }))
      throw AppError.forbidden();
    const current = actor.enrollments.filter((e) => e.current);
    if (current.length === 0)
      throw AppError.invalidState("You are not placed in a section this semester yet");
    const today = todayIn(timezone);
    const from = query.from ?? query.to ?? today;
    const to = query.to ?? (query.from ? query.from : today);
    if (daysIn(from, to) > MAX_CATCHUP_DAYS) {
      throw AppError.invalid(`Pick at most ${MAX_CATCHUP_DAYS} days`, [
        { path: "from", message: "Range too long" },
      ]);
    }
    if (query.subjectId) {
      const subject = await structureService.findSubject(scopeOf(actor), query.subjectId);
      if (!subject || !current.some((e) => e.semesterId === subject.semesterId))
        throw AppError.notFound("Subject not found");
    }
    return this.collect(
      actor,
      current.map((e) => e.sectionId),
      from,
      to,
      query.subjectId,
    );
  },

  /** Live, visible entries of these sections in the range, grouped by subject in date order. */
  async collect(
    actor: Actor,
    sectionIds: string[],
    from: string,
    to: string,
    subjectId?: string | null,
  ): Promise<CatchupView> {
    const scope = scopeOf(actor);
    const rows = (await sessionsService.liveForSections(scope, sectionIds, from, to)).filter(
      (e) =>
        (!subjectId || e.subjectId === subjectId) &&
        can(actor, Action.ENTRY_READ_PUBLISHED, sessionsService.entryResource(e)),
    );
    const subjects = await structureService.findSubjects(scope, [
      ...new Set(rows.map((e) => e.subjectId)),
    ]);
    const groups = new Map<string, CatchupView["subjects"][number]>();
    for (const e of rows) {
      const version = e.currentVersion!;
      let group = groups.get(e.subjectId);
      if (!group) {
        const s = subjects.find((x) => x.id === e.subjectId)!;
        group = { subject: { id: s.id, name: s.name, code: s.code }, entries: [] };
        groups.set(e.subjectId, group);
      }
      group.entries.push({
        entryId: e.id,
        versionId: version.id,
        taughtOn: e.taughtOn.toISOString().slice(0, 10),
        versionNo: version.versionNo,
        summary: version.summary,
        topics: sessionsService.topicsOf(version).map((t) => ({
          title: t.title,
          subtopics: t.subtopics,
          inSyllabus: t.stableKey !== null && !version.mappingStale,
        })),
      });
    }
    return { from, to, subjects: [...groups.values()] };
  },
};
