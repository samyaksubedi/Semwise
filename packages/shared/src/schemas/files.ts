import { z } from "zod";
import { idSchema } from "./common.js";

export type FileKind = "SYLLABUS_PDF" | "AUDIO" | "PHOTO";

const MB = 1024 * 1024;

/** What may be uploaded, per kind: allowed types and the size limit. */
export const FILE_RULES: Record<FileKind, { mimes: readonly string[]; maxBytes: number }> = {
  SYLLABUS_PDF: { mimes: ["application/pdf"], maxBytes: 25 * MB },
  AUDIO: {
    mimes: [
      "audio/webm",
      "audio/ogg",
      "audio/mpeg",
      "audio/mp4",
      "audio/x-m4a",
      "audio/wav",
      "audio/x-wav",
    ],
    maxBytes: 15 * MB,
  },
  PHOTO: { mimes: ["image/jpeg", "image/png", "image/webp"], maxBytes: 10 * MB },
};

export const requestUploadSchema = z
  .object({
    kind: z.enum(["SYLLABUS_PDF", "AUDIO", "PHOTO"]),
    mime: z.string().min(3).max(100),
    size: z.coerce.number().int().positive(),
    /** Syllabus PDFs: the semester, and the subject if it exists already. */
    semesterId: idSchema.optional(),
    subjectId: idSchema.optional(),
    /** Voice and photo input: the class the entry is for. */
    classId: idSchema.optional(),
  })
  .superRefine((value, ctx) => {
    const rule = FILE_RULES[value.kind];
    if (!rule.mimes.includes(value.mime)) {
      ctx.addIssue({
        code: "custom",
        path: ["mime"],
        message: `Allowed: ${rule.mimes.join(", ")}`,
      });
    }
    if (value.size > rule.maxBytes) {
      ctx.addIssue({
        code: "custom",
        path: ["size"],
        message: `At most ${Math.round(rule.maxBytes / MB)} MB`,
      });
    }
    if (value.kind === "SYLLABUS_PDF" && !value.semesterId && !value.subjectId) {
      ctx.addIssue({ code: "custom", path: ["semesterId"], message: "Required for a syllabus" });
    }
    if (value.kind !== "SYLLABUS_PDF" && !value.classId) {
      ctx.addIssue({ code: "custom", path: ["classId"], message: "Required for voice and photo" });
    }
  });
export type RequestUploadInput = z.infer<typeof requestUploadSchema>;

export interface UploadTicket {
  fileId: string;
  /** PUT the bytes here with the same Content-Type; it expires in a few minutes. */
  uploadUrl: string;
  headers: { "Content-Type": string };
  expiresAt: string;
}

export interface FileView {
  id: string;
  kind: FileKind;
  mime: string;
  size: number;
  status: "PENDING" | "READY" | "DELETED";
  createdAt: string;
}
