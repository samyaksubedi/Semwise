import { z } from "zod";
import { dateOnlySchema, idSchema } from "./common.js";

export const ENTRY_TEXT_MAX = 8000;

const entryText = z.string().trim().min(3, "Write what was taught").max(ENTRY_TEXT_MAX);

export const inputKindSchema = z.enum(["TEXT", "VOICE", "PHOTO"]);
export type InputKind = z.infer<typeof inputKindSchema>;

/** A new entry for a lesson. `taughtOn` defaults to today in the college timezone. */
export const createEntrySchema = z.object({
  taughtOn: dateOnlySchema.optional(),
  text: entryText,
  inputKind: inputKindSchema.default("TEXT"),
  /** The voice or photo file the text came from (voice and photo are CR-only). */
  mediaFileId: idSchema.optional(),
});
export type CreateEntryInput = z.infer<typeof createEntrySchema>;

export const entryTopicSchema = z.object({
  title: z.string().trim().min(1).max(300),
  subtopics: z.array(z.string().trim().min(1).max(300)).max(30),
  /** The syllabus topic it maps to, or null for something outside the syllabus. */
  stableKey: z.string().max(40).nullable(),
});
export type EntryTopicInput = z.infer<typeof entryTopicSchema>;

/** The author reviews the organized draft before submitting it. */
export const updateDraftSchema = z
  .object({
    text: entryText,
    taughtOn: dateOnlySchema,
    topics: z.array(entryTopicSchema).max(40),
    summary: z.string().trim().max(1500),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Nothing to update");
export type UpdateDraftInput = z.infer<typeof updateDraftSchema>;

/** When another entry exists for the same class and date: replace it, or add a second one. */
export const submitEntrySchema = z.object({
  onDuplicate: z.enum(["replace", "add"]).optional(),
});
export type SubmitEntryInput = z.infer<typeof submitEntrySchema>;

/** Editing a published entry starts a new version (the old one stays live until approved). */
export const newEntryVersionSchema = z.object({
  text: entryText,
  inputKind: inputKindSchema.default("TEXT"),
  mediaFileId: idSchema.optional(),
});
export type NewEntryVersionInput = z.infer<typeof newEntryVersionSchema>;

/** The teacher may correct topics or the summary while approving. */
export const approveEntrySchema = z.object({
  topics: z.array(entryTopicSchema).max(40).optional(),
  summary: z.string().trim().max(1500).optional(),
});
export type ApproveEntryInput = z.infer<typeof approveEntrySchema>;

export const rejectEntrySchema = z.object({ reason: z.string().trim().min(3).max(500) });

export const bulkApproveSchema = z.object({
  versionIds: z.array(idSchema).min(1).max(100),
});

export const entryListQuerySchema = z.object({
  from: dateOnlySchema.optional(),
  to: dateOnlySchema.optional(),
});

export const programApprovalSchema = z.object({
  autoApprove: z.boolean(),
  locked: z.boolean().default(false),
  unreviewedPublishAfterDays: z.coerce.number().int().min(1).max(60).nullable().default(null),
});
export type ProgramApprovalInput = z.infer<typeof programApprovalSchema>;

/** A teacher override for one class; null clears it (the program default applies). */
export const classApprovalSchema = z.object({ autoApprove: z.boolean().nullable() });

export interface EntryTopicView {
  title: string;
  subtopics: string[];
  stableKey: string | null;
  confidence: number;
  /** False when the topic is not (or no longer) in the live syllabus. */
  inSyllabus: boolean;
}

export type EntryVersionStatus =
  "DRAFT" | "PENDING" | "APPROVED" | "PUBLISHED" | "REJECTED" | "WITHDRAWN" | "SUPERSEDED";

export interface EntryVersionView {
  id: string;
  versionNo: number;
  status: EntryVersionStatus;
  inputKind: InputKind;
  rawText: string;
  topics: EntryTopicView[];
  summary: string | null;
  organize: "QUEUED" | "RUNNING" | "DONE" | "FAILED";
  organizeError: string | null;
  mappingStale: boolean;
  authorId: string | null;
  submittedAt: string | null;
  decidedAt: string | null;
  rejectionReason: string | null;
  /** Published after the waiting period without the teacher reviewing it. */
  unreviewed: boolean;
  minorEdit: boolean;
  createdAt: string;
}

export interface EntryView {
  id: string;
  classId: string;
  subject: { id: string; name: string; code: string };
  section: { id: string; name: string };
  taughtOn: string;
  authorId: string | null;
  takenDown: boolean;
  /** What students see. */
  live: EntryVersionView | null;
  /** A newer draft, pending or rejected version, shown to those who may see it. */
  latest: EntryVersionView | null;
}

export interface ApprovalItem {
  entryId: string;
  versionId: string;
  classId: string;
  subject: { id: string; name: string; code: string };
  section: { id: string; name: string };
  taughtOn: string;
  authorId: string | null;
  topics: EntryTopicView[];
  summary: string | null;
  submittedAt: string | null;
  /** An edit of an entry that is already live. */
  isEdit: boolean;
}

export interface ApprovalSettingsView {
  programId: string;
  autoApprove: boolean;
  locked: boolean;
  unreviewedPublishAfterDays: number | null;
}

export interface ClassApprovalView {
  classId: string;
  /** The rule in force for this class. */
  autoApprove: boolean;
  /** The teacher's override, if any. */
  override: boolean | null;
  locked: boolean;
}
