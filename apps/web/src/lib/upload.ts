import { FILE_RULES, type FileKind, type UploadTicket } from "@semwise/shared";
import { ApiError, api, putToStorage } from "./api";
import { t } from "./strings";

/** What a file is for: syllabus PDFs name a subject or semester, voice and photos a class. */
export type UploadTarget = { subjectId: string } | { semesterId: string } | { classId: string };

/** The file's type as the API knows it (some browsers leave `type` empty for .m4a and the like). */
export function mimeOf(file: Blob & { name?: string }, kind: FileKind): string {
  if (file.type && FILE_RULES[kind].mimes.includes(file.type)) return file.type;
  const ext = file.name?.split(".").pop()?.toLowerCase();
  const byExt: Record<string, string> = {
    pdf: "application/pdf",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    webm: "audio/webm",
    ogg: "audio/ogg",
    mp3: "audio/mpeg",
    m4a: "audio/mp4",
    mp4: "audio/mp4",
    wav: "audio/wav",
  };
  // Recorders report "audio/webm;codecs=opus"; the API checks the base type.
  const base = file.type.split(";")[0] ?? "";
  if (FILE_RULES[kind].mimes.includes(base)) return base;
  return (ext && byExt[ext]) || file.type;
}

/**
 * The browser's part of an upload: ask for a ticket (permission checked there), PUT the bytes
 * straight to storage, then let the API check size and type. Returns the file id.
 */
export async function uploadFile(
  kind: FileKind,
  file: Blob & { name?: string },
  target: UploadTarget,
) {
  const mime = mimeOf(file, kind);
  const rule = FILE_RULES[kind];
  if (!rule.mimes.includes(mime)) {
    throw new ApiError(400, "VALIDATION_FAILED", t.upload.notAccepted);
  }
  if (file.size > rule.maxBytes) {
    const mb = Math.round(rule.maxBytes / 1024 / 1024);
    throw new ApiError(400, "VALIDATION_FAILED", t.upload.tooLarge(mb));
  }
  const ticket = await api<UploadTicket>("/files/uploads", {
    body: { kind, mime, size: file.size, ...target },
  });
  await putToStorage(ticket.uploadUrl, file, mime);
  await api(`/files/${ticket.fileId}/complete`, { method: "POST" });
  return ticket.fileId;
}
