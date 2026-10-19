import { z } from "zod";
import { idSchema } from "./common.js";

/** Longest question a student can send (characters). */
export const MAX_QUESTION_LENGTH = 2000;

export const createConversationSchema = z.object({
  pinnedSubjectId: idSchema.nullable().optional(),
  includePast: z.boolean().optional(),
});
export type CreateConversationInput = z.infer<typeof createConversationSchema>;

export const updateConversationSchema = z
  .object({
    title: z.string().trim().min(1).max(120).optional(),
    pinnedSubjectId: idSchema.nullable().optional(),
    includePast: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to change" });
export type UpdateConversationInput = z.infer<typeof updateConversationSchema>;

export const askSchema = z.object({
  text: z.string().trim().min(1).max(MAX_QUESTION_LENGTH),
});
export type AskInput = z.infer<typeof askSchema>;

/** How a question was classified before answering. DATE questions are feature 9. */
export type ChatScope = "IN_SYLLABUS" | "RELATED" | "UNRELATED" | "DATE";

/**
 * What an answer rests on, shown as chips: the official syllabus, what was reported as taught,
 * a general explanation, a topic outside the syllabus, or nothing found in the material.
 */
export type AnswerLabel =
  | "FROM_SYLLABUS"
  | "REPORTED_IN_CLASS"
  | "GENERAL_EXPLANATION"
  | "OUTSIDE_SYLLABUS"
  | "NOT_IN_MATERIAL";

export interface Citation {
  /** The key the answer uses for the source, such as "S2". */
  key: string;
  kind: "SYLLABUS" | "CLASS";
  subject: { id: string; name: string; code: string };
  /** Syllabus sources: unit number and title, the topic, and the syllabus version. */
  unitNo: number | null;
  unitTitle: string | null;
  topicTitle: string | null;
  syllabusVersionId: string | null;
  /** Class sources: the entry, the date it was taught and the version. */
  entryId: string | null;
  entryVersionId: string | null;
  taughtOn: string | null;
  versionNo: number;
}

export interface MessageView {
  id: string;
  role: "USER" | "ASSISTANT";
  content: string;
  scope: ChatScope | null;
  labels: AnswerLabel[];
  citations: Citation[];
  /** A cited version has since been corrected or taken down: the answer may be out of date. */
  outdated: boolean;
  createdAt: string;
}

export interface ConversationSummaryView {
  id: string;
  title: string;
  pinnedSubjectId: string | null;
  includePast: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationView extends ConversationSummaryView {
  messages: MessageView[];
}

export interface AskResult {
  question: MessageView;
  answer: MessageView;
  /** The student's monthly question allowance after this question. */
  quota: { used: number; limit: number | null; warn: boolean };
}
