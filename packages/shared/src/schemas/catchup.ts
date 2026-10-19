import { z } from "zod";
import { dateOnlySchema, idSchema } from "./common.js";

/** Longest range one catch-up or date question covers (days, inclusive). */
export const MAX_CATCHUP_DAYS = 31;

/** `?from=YYYY-MM-DD&to=YYYY-MM-DD`; both default to today in the college's timezone. */
export const catchupQuerySchema = z
  .object({
    from: dateOnlySchema.optional(),
    to: dateOnlySchema.optional(),
    subjectId: idSchema.optional(),
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, {
    message: "from must not be after to",
    path: ["from"],
  });
export type CatchupQuery = z.infer<typeof catchupQuerySchema>;

export interface CatchupEntry {
  entryId: string;
  /** The live version shown (answers citing it are marked outdated once it is replaced). */
  versionId: string;
  taughtOn: string;
  versionNo: number;
  summary: string | null;
  topics: { title: string; subtopics: string[]; inSyllabus: boolean }[];
}

/** The stored summaries of one range, grouped by subject (no AI call). */
export interface CatchupView {
  from: string;
  to: string;
  subjects: {
    subject: { id: string; name: string; code: string };
    entries: CatchupEntry[];
  }[];
}
