import { z } from "zod";
import { emailSchema } from "./auth.js";
import { idSchema, nameSchema } from "./common.js";

/** Roll number or student ID: the second identifier, unique in a college (stored uppercase). */
export const rollNoSchema = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .regex(/^[A-Za-z0-9][A-Za-z0-9/._-]*$/, "Use letters, numbers and / . _ -")
  .transform((value) => value.toUpperCase());

export const addStudentSchema = z.object({
  email: emailSchema,
  rollNo: rollNoSchema,
  displayName: nameSchema(120).optional(),
  sectionId: idSchema,
});
export type AddStudentInput = z.infer<typeof addStudentSchema>;

/** Most rows one import may hold; bigger lists are split by the admin. */
export const MAX_IMPORT_ROWS = 2000;

export const importStudentsSchema = z.object({
  csv: z.string().min(1).max(1_000_000),
});
export type ImportStudentsInput = z.infer<typeof importStudentsSchema>;

export type ImportRowStatus = "ok" | "error" | "skipped";

export interface ImportRowResult {
  /** 1-based line in the file (the header is line 1). */
  line: number;
  email: string;
  rollNo: string;
  section: string;
  status: ImportRowStatus;
  /** Why a row is an error or was skipped. */
  messages: string[];
}

export interface ImportResult {
  rows: ImportRowResult[];
  counts: { ok: number; error: number; skipped: number };
  /** False for a preview: nothing was written. */
  committed: boolean;
}

/** Only while the student has not joined: their address belongs to their account after that. */
export const updateStudentSchema = z
  .object({ email: emailSchema, rollNo: rollNoSchema, displayName: nameSchema(120) })
  .partial()
  .refine((value) => Object.keys(value).length > 0, "Nothing to update");
export type UpdateStudentInput = z.infer<typeof updateStudentSchema>;

export const assignSectionSchema = z.object({ sectionId: idSchema });
export type AssignSectionInput = z.infer<typeof assignSectionSchema>;

/** Places many students in one semester's sections (the start of a new semester). */
export const bulkAssignSchema = z.object({
  assignments: z
    .array(z.object({ studentId: idSchema, sectionId: idSchema }))
    .min(1)
    .max(2000),
});
export type BulkAssignInput = z.infer<typeof bulkAssignSchema>;

/** Most Class Representatives one section can have at a time. */
export const MAX_CRS_PER_SECTION = 3;

export const grantCrSchema = z.object({
  studentId: idSchema,
  /** A current CR of the section to replace; needed once the section has MAX_CRS_PER_SECTION. */
  replaceStudentId: idSchema.optional(),
});
export type GrantCrInput = z.infer<typeof grantCrSchema>;

export const studentListQuerySchema = z.object({
  sectionId: idSchema.optional(),
  status: z.enum(["INVITED", "ACTIVE", "DEACTIVATED"]).optional(),
});

export const inviteTeacherSchema = z.object({
  email: emailSchema,
  displayName: nameSchema(120).optional(),
  programId: idSchema,
});
export type InviteTeacherInput = z.infer<typeof inviteTeacherSchema>;

export type InviteSendStatus = "QUEUED" | "SENT" | "FAILED" | "NONE";

export interface StudentView {
  id: string;
  email: string;
  displayName: string | null;
  rollNo: string;
  status: "INVITED" | "ACTIVE" | "DEACTIVATED";
  /** Section in the semester being listed (null if not placed there). */
  sectionId: string | null;
  isCr: boolean;
  invite: { status: InviteSendStatus; lastSentAt: string | null; sendCount: number } | null;
}

export interface EnrollmentView {
  semesterId: string;
  semesterNumber: number;
  sectionId: string;
  sectionName: string;
  status: "ACTIVE" | "REMOVED";
  current: boolean;
}

export interface StudentDetailView extends Omit<StudentView, "sectionId" | "isCr"> {
  programId: string;
  batchId: string;
  enrollments: EnrollmentView[];
  crOfSectionIds: string[];
}

export interface InviteProgress {
  total: number;
  queued: number;
  sent: number;
  failed: number;
  accepted: number;
  /** Today's sending against the daily cap, for "120 of 400 sent today". */
  today: { sent: number; cap: number };
}

export interface TeacherView {
  userId: string | null;
  email: string;
  displayName: string | null;
  status: "ACTIVE" | "INVITED";
}

/**
 * A small RFC 4180 CSV parser (quoted fields, doubled quotes, CRLF or LF). Shared, so the web app
 * previews exactly what the API will read.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;
    if (quoted) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && input[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

/** Header names accepted for each column (lowercase, spaces and dashes ignored). */
export const IMPORT_COLUMNS = {
  email: ["email", "emailaddress", "mail"],
  rollNo: ["rollno", "roll", "rollnumber", "studentid", "id"],
  name: ["name", "fullname", "displayname", "studentname"],
  section: ["section", "sectionname"],
} as const;
