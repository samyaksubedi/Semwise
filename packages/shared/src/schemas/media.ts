import { z } from "zod";
import { idSchema } from "./common.js";

/** Starts reading an uploaded voice note or photo (the file must be READY). */
export const startReadingSchema = z.object({ fileId: idSchema });
export type StartReadingInput = z.infer<typeof startReadingSchema>;

/**
 * A voice note transcribed or a photo read. Only its uploader sees it; the text is edited and
 * then sent as a new entry with `inputKind` VOICE or PHOTO and `mediaFileId` = `fileId`.
 */
export interface MediaReadingView {
  id: string;
  classId: string;
  fileId: string;
  kind: "AUDIO" | "PHOTO";
  status: "QUEUED" | "RUNNING" | "DONE" | "FAILED";
  text: string | null;
  error: string | null;
  seconds: number | null;
  createdAt: string;
}
