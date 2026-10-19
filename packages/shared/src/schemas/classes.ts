import { z } from "zod";
import { idSchema } from "./common.js";

const teachers = z
  .array(idSchema)
  .min(1, "Assign the subject teacher")
  .max(5)
  .refine((ids) => new Set(ids).size === ids.length, "Each teacher once");

/** The first teacher listed is the primary subject teacher. */
export const createClassSchema = z.object({
  subjectId: idSchema,
  sectionId: idSchema,
  teacherUserIds: teachers,
});
export type CreateClassInput = z.infer<typeof createClassSchema>;

export const setClassTeachersSchema = z.object({ teacherUserIds: teachers });
export type SetClassTeachersInput = z.infer<typeof setClassTeachersSchema>;

export const updateClassSchema = z.object({ status: z.enum(["ACTIVE", "ARCHIVED"]) });
export type UpdateClassInput = z.infer<typeof updateClassSchema>;

export interface ClassView {
  id: string;
  programId: string;
  batchId: string;
  semesterId: string;
  subject: { id: string; name: string; code: string };
  section: { id: string; name: string };
  teachers: { userId: string; displayName: string; isPrimary: boolean }[];
  status: "ACTIVE" | "ARCHIVED";
}
