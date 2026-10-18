import { z } from "zod";
import { dateOnlySchema, nameSchema } from "./common.js";

const codeSchema = z
  .string()
  .trim()
  .min(1)
  .max(32)
  .regex(/^[A-Za-z0-9][A-Za-z0-9 ._-]*$/, "Use letters, numbers, spaces, dots, dashes")
  .transform((value) => value.toUpperCase());

const statusSchema = z.enum(["ACTIVE", "ARCHIVED"]);

function partial<T extends z.ZodRawShape>(shape: T) {
  return z
    .object(shape)
    .partial()
    .refine((value) => Object.keys(value).length > 0, "Nothing to update");
}

// ---------- Programs ----------

export const createProgramSchema = z.object({ name: nameSchema(120), code: codeSchema });
export type CreateProgramInput = z.infer<typeof createProgramSchema>;
export const updateProgramSchema = partial({
  name: nameSchema(120),
  code: codeSchema,
  status: statusSchema,
});
export type UpdateProgramInput = z.infer<typeof updateProgramSchema>;

export interface ProgramView {
  id: string;
  name: string;
  code: string;
  status: "ACTIVE" | "ARCHIVED";
  createdAt: string;
}

export interface ProgramAdminView {
  userId: string;
  email: string;
  displayName: string;
}

// ---------- Batches ----------

const year = z.coerce.number().int().min(1990).max(2100);

export const createBatchSchema = z.object({ name: nameSchema(80), intakeYear: year });
export type CreateBatchInput = z.infer<typeof createBatchSchema>;
export const updateBatchSchema = partial({
  name: nameSchema(80),
  intakeYear: year,
  status: statusSchema,
});
export type UpdateBatchInput = z.infer<typeof updateBatchSchema>;

export interface BatchView {
  id: string;
  programId: string;
  name: string;
  intakeYear: number;
  status: "ACTIVE" | "ARCHIVED";
}

// ---------- Semesters ----------

const semesterStatus = z.enum(["UPCOMING", "ACTIVE", "COMPLETED"]);

const semesterFields = {
  number: z.coerce.number().int().min(1).max(16),
  startDate: dateOnlySchema.nullable(),
  endDate: dateOnlySchema.nullable(),
  status: semesterStatus,
};

function datesInOrder(value: { startDate?: string | null; endDate?: string | null }) {
  return !value.startDate || !value.endDate || value.startDate <= value.endDate;
}

export const createSemesterSchema = z
  .object({
    number: semesterFields.number,
    startDate: semesterFields.startDate.optional(),
    endDate: semesterFields.endDate.optional(),
    status: semesterStatus.default("UPCOMING"),
  })
  .refine(datesInOrder, { message: "The end date is before the start date", path: ["endDate"] });
export type CreateSemesterInput = z.infer<typeof createSemesterSchema>;
export const updateSemesterSchema = z
  .object(semesterFields)
  .partial()
  .refine((value) => Object.keys(value).length > 0, "Nothing to update")
  .refine(datesInOrder, { message: "The end date is before the start date", path: ["endDate"] });
export type UpdateSemesterInput = z.infer<typeof updateSemesterSchema>;

export interface SemesterView {
  id: string;
  programId: string;
  batchId: string;
  number: number;
  startDate: string | null;
  endDate: string | null;
  status: "UPCOMING" | "ACTIVE" | "COMPLETED";
}

// ---------- Sections ----------

export const createSectionSchema = z.object({ name: nameSchema(40) });
export type CreateSectionInput = z.infer<typeof createSectionSchema>;
export const updateSectionSchema = createSectionSchema;
export type UpdateSectionInput = z.infer<typeof updateSectionSchema>;

export interface SectionView {
  id: string;
  programId: string;
  batchId: string;
  semesterId: string;
  name: string;
}

// ---------- Subjects ----------

const credits = z.coerce.number().int().min(0).max(30);

export const createSubjectSchema = z.object({
  name: nameSchema(160),
  code: codeSchema,
  credits: credits.nullable().optional(),
});
export type CreateSubjectInput = z.infer<typeof createSubjectSchema>;
export const updateSubjectSchema = partial({
  name: nameSchema(160),
  code: codeSchema,
  credits: credits.nullable(),
  status: statusSchema,
});
export type UpdateSubjectInput = z.infer<typeof updateSubjectSchema>;

export interface SubjectView {
  id: string;
  programId: string;
  batchId: string;
  semesterId: string;
  name: string;
  code: string;
  credits: number | null;
  status: "ACTIVE" | "ARCHIVED";
}

/** A batch with everything below it, for the admin structure screen. */
export interface BatchTreeView extends BatchView {
  semesters: (SemesterView & { sections: SectionView[]; subjects: SubjectView[] })[];
}
