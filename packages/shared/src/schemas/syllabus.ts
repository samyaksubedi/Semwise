import { z } from "zod";
import { dateOnlySchema, idSchema, nameSchema } from "./common.js";

export const topicKindSchema = z.enum(["UNIT", "TOPIC", "SUBTOPIC"]);
export type TopicKind = z.infer<typeof topicKindSchema>;

/** Start a draft from an uploaded PDF, or from the live version (to edit it into version N+1). */
export const startDraftSchema = z.union([
  z.object({ fileId: idSchema }),
  z.object({ fromCurrent: z.literal(true) }),
]);
export type StartDraftInput = z.infer<typeof startDraftSchema>;

/** Upload for a semester before the subject exists; the AI suggests its name and code. */
export const importSyllabusSchema = z.object({ fileId: idSchema });

/** Confirm the subject for an imported syllabus: create it, or link an existing one. */
export const confirmSubjectSchema = z.union([
  z.object({
    name: nameSchema(160),
    code: z
      .string()
      .trim()
      .min(1)
      .max(32)
      .transform((v) => v.toUpperCase()),
    credits: z.coerce.number().int().min(0).max(30).nullable().optional(),
  }),
  z.object({ subjectId: idSchema }),
]);
export type ConfirmSubjectInput = z.infer<typeof confirmSubjectSchema>;

const titleSchema = z.string().trim().min(1).max(300);

export const addTopicSchema = z.object({
  parentId: idSchema.nullable(),
  kind: topicKindSchema,
  title: titleSchema,
  description: z.string().trim().max(2000).nullable().optional(),
  hours: z.coerce.number().int().min(0).max(500).nullable().optional(),
  /** 0-based place among its siblings; omitted = last. */
  position: z.coerce.number().int().min(0).max(1000).optional(),
});
export type AddTopicInput = z.infer<typeof addTopicSchema>;

export const updateTopicSchema = z
  .object({
    title: titleSchema,
    description: z.string().trim().max(2000).nullable(),
    hours: z.coerce.number().int().min(0).max(500).nullable(),
    parentId: idSchema.nullable(),
    position: z.coerce.number().int().min(0).max(1000),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Nothing to update");
export type UpdateTopicInput = z.infer<typeof updateTopicSchema>;

export const referenceSchema = z.object({
  title: z.string().trim().min(1).max(400),
  author: z.string().trim().max(300).nullable(),
  sourcePage: z.number().int().min(1).nullable(),
});

export const updateVersionSchema = z
  .object({
    effectiveFrom: dateOnlySchema.nullable(),
    credits: z.coerce.number().int().min(0).max(30).nullable(),
    references: z.array(referenceSchema).max(50),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Nothing to update");
export type UpdateVersionInput = z.infer<typeof updateVersionSchema>;

export const changeRequestSchema = z.object({ text: z.string().trim().min(3).max(1000) });

export const decideChangesSchema = z.object({
  decisions: z.array(z.object({ opId: z.string().min(1).max(20), accept: z.boolean() })).min(1),
});
export type DecideChangesInput = z.infer<typeof decideChangesSchema>;

export const publishSyllabusSchema = z.object({ effectiveFrom: dateOnlySchema.optional() });

export const copySyllabusSchema = z.object({ fromSubjectId: idSchema });

export interface TopicNode {
  id: string;
  stableKey: string;
  kind: TopicKind;
  title: string;
  description: string | null;
  hours: number | null;
  sourcePage: number | null;
  confidence: number;
  children: TopicNode[];
}

/** Below this, an item is highlighted for review. */
export const LOW_CONFIDENCE = 60;

export type VersionStatus = "DRAFT" | "PUBLISHING" | "PUBLISHED" | "SUPERSEDED";
export type JobState = "QUEUED" | "RUNNING" | "DONE" | "FAILED";

export interface SyllabusVersionView {
  id: string;
  syllabusId: string;
  subjectId: string | null;
  semesterId: string;
  versionNo: number;
  status: VersionStatus;
  extraction: JobState;
  extractionError: string | null;
  usedOcr: boolean;
  suggestedName: string | null;
  suggestedCode: string | null;
  credits: number | null;
  references: z.infer<typeof referenceSchema>[];
  effectiveFrom: string | null;
  publishedAt: string | null;
  sourceFileId: string | null;
  copiedFromVersionId: string | null;
  pageCount: number;
  lowConfidenceCount: number;
  topics: TopicNode[];
}

export type ChangeOpKind = "add" | "rename" | "move" | "delete";

export interface ProposedOp {
  id: string;
  op: ChangeOpKind;
  /** Human-readable "before" and "after" for the diff view. */
  before: string | null;
  after: string | null;
  reason: string;
  decision: "PENDING" | "ACCEPTED" | "REJECTED";
}

export interface ChangeRequestView {
  id: string;
  versionId: string;
  requestText: string;
  status: "PROPOSED" | "ACCEPTED" | "PARTIAL" | "REJECTED";
  note: string | null;
  ops: ProposedOp[];
  createdAt: string;
}

export type SubjectSyllabusState = "NONE" | "PROCESSING" | "DRAFT" | "PUBLISHED";

export interface SyllabusStatusRow {
  subjectId: string | null;
  subjectName: string | null;
  subjectCode: string | null;
  state: SubjectSyllabusState;
  /** True when a published syllabus also has a newer draft or one being processed. */
  hasOpenDraft: boolean;
  liveVersionNo: number | null;
  openVersionId: string | null;
}
