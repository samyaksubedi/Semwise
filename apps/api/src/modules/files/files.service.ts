import { randomUUID } from "node:crypto";
import {
  FILE_RULES,
  type FileKind,
  type FileView,
  type RequestUploadInput,
  type UploadTicket,
} from "@semwise/shared";
import type { TenantScope } from "../../common/db/scope.js";
import { AppError } from "../../common/errors/app-error.js";
import { getStorage, isStorageConfigured } from "../../lib/storage.js";
import { logger } from "../../lib/logger.js";
import { Action, can, type Actor, type Resource } from "../authz/index.js";
import { classResource, classesService } from "../classes/index.js";
import { structureService } from "../structure/index.js";
import { filesRepository as repo } from "./files.repository.js";

export const UPLOAD_URL_SECONDS = 5 * 60;
export const DOWNLOAD_URL_SECONDS = 5 * 60;

type FileRow = NonNullable<Awaited<ReturnType<typeof repo.find>>>;

const AREA: Record<FileKind, string> = {
  SYLLABUS_PDF: "syllabus",
  AUDIO: "audio",
  PHOTO: "photos",
};

const scopeOf = (actor: Actor): TenantScope => ({ tenantId: actor.tenantId! });

function startsWith(data: Uint8Array, signature: number[], offset = 0): boolean {
  return signature.every((byte, i) => data[offset + i] === byte);
}
const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0));

/** The first bytes must match the declared type; a renamed file is rejected and deleted. */
export function matchesMagicBytes(mime: string, head: Uint8Array): boolean {
  switch (mime) {
    case "application/pdf":
      return startsWith(head, ascii("%PDF-"));
    case "image/jpeg":
      return startsWith(head, [0xff, 0xd8, 0xff]);
    case "image/png":
      return startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case "image/webp":
      return startsWith(head, ascii("RIFF")) && startsWith(head, ascii("WEBP"), 8);
    case "audio/webm":
      return startsWith(head, [0x1a, 0x45, 0xdf, 0xa3]);
    case "audio/ogg":
      return startsWith(head, ascii("OggS"));
    case "audio/mpeg":
      return (
        startsWith(head, ascii("ID3")) || (head[0] === 0xff && ((head[1] ?? 0) & 0xe0) === 0xe0)
      );
    case "audio/mp4":
    case "audio/x-m4a":
      return startsWith(head, ascii("ftyp"), 4);
    case "audio/wav":
    case "audio/x-wav":
      return startsWith(head, ascii("RIFF")) && startsWith(head, ascii("WAVE"), 8);
    default:
      return false;
  }
}

function toView(f: FileRow): FileView {
  return {
    id: f.id,
    kind: f.kind,
    mime: f.mime,
    size: f.size,
    status: f.status,
    createdAt: f.createdAt.toISOString(),
  };
}

function requireStorage(): void {
  if (!isStorageConfigured()) throw AppError.notConfigured("File storage");
}

/** The record a file belongs to, and what lets someone upload or download it. */
async function contextFor(actor: Actor, input: RequestUploadInput) {
  const scope = scopeOf(actor);
  if (input.kind === "SYLLABUS_PDF") {
    const subject = input.subjectId
      ? await structureService.findSubject(scope, input.subjectId)
      : null;
    if (input.subjectId && !subject) throw AppError.notFound("Subject not found");
    const semesterId = subject?.semesterId ?? input.semesterId!;
    const semester = await structureService.findSemester(scope, semesterId);
    if (!semester) throw AppError.notFound("Semester not found");
    const resource: Resource = {
      tenantId: scope.tenantId,
      programId: semester.programId,
      batchId: semester.batchId,
      semesterId: semester.id,
    };
    return {
      resource,
      action: Action.FILE_UPLOAD_SYLLABUS,
      fields: {
        programId: semester.programId,
        batchId: semester.batchId,
        semesterId: semester.id,
        subjectId: subject?.id ?? null,
        sectionId: null,
        classId: null,
      },
    };
  }
  const klass = await classesService.find(scope, input.classId!);
  if (!klass) throw AppError.notFound("Class not found");
  return {
    resource: classResource(klass),
    action: Action.FILE_UPLOAD_MEDIA,
    fields: {
      programId: klass.programId,
      batchId: klass.batchId,
      semesterId: klass.semesterId,
      subjectId: klass.subjectId,
      sectionId: klass.sectionId,
      classId: klass.id,
    },
  };
}

function fileResource(f: FileRow): Resource {
  return {
    tenantId: f.tenantId,
    programId: f.programId,
    batchId: f.batchId,
    semesterId: f.semesterId,
    sectionId: f.sectionId,
    subjectId: f.subjectId,
    classId: f.classId,
    ownerId: f.uploadedById,
  };
}

/** Who may download: those who may read the record the file belongs to. */
function mayDownload(actor: Actor, f: FileRow): boolean {
  const resource = fileResource(f);
  if (f.kind === "SYLLABUS_PDF") return can(actor, Action.SYLLABUS_READ_DRAFT, resource);
  return can(actor, Action.ENTRY_READ_PENDING, resource);
}

export const filesService = {
  /** Checks permission, records a pending file and returns a short-lived signed upload URL. */
  async requestUpload(
    actor: Actor,
    input: RequestUploadInput,
    now = new Date(),
  ): Promise<UploadTicket> {
    requireStorage();
    const ctx = await contextFor(actor, input);
    if (!can(actor, ctx.action, ctx.resource)) {
      throw can(actor, Action.STRUCTURE_READ, ctx.resource)
        ? AppError.forbidden()
        : AppError.notFound("Not found");
    }
    const scope = scopeOf(actor);
    const id = `f${randomUUID().replace(/-/g, "")}`;
    const storageKey = `tenants/${scope.tenantId}/${AREA[input.kind]}/${id}`;
    await repo.create(scope, {
      id,
      storageKey,
      mime: input.mime,
      size: input.size,
      kind: input.kind,
      uploadedById: actor.userId,
      ...ctx.fields,
    });
    const uploadUrl = await getStorage().presignPut(
      storageKey,
      input.mime,
      input.size,
      UPLOAD_URL_SECONDS,
    );
    return {
      fileId: id,
      uploadUrl,
      headers: { "Content-Type": input.mime },
      expiresAt: new Date(now.getTime() + UPLOAD_URL_SECONDS * 1000).toISOString(),
    };
  },

  /** After the browser uploaded: checks size and magic bytes; anything wrong is deleted. */
  async completeUpload(actor: Actor, fileId: string): Promise<FileView> {
    requireStorage();
    const scope = scopeOf(actor);
    const file = await repo.find(scope, fileId);
    if (!file || file.uploadedById !== actor.userId) throw AppError.notFound("File not found");
    if (file.status === "READY") return toView(file);
    if (file.status === "DELETED") throw AppError.invalidState("This upload was rejected");
    const storage = getStorage();
    const head = await storage.head(file.storageKey);
    if (!head) throw AppError.invalidState("The file has not been uploaded yet");
    const rule = FILE_RULES[file.kind];
    const start = await storage.readStart(file.storageKey, 16);
    if (
      head.size > rule.maxBytes ||
      head.size !== file.size ||
      !matchesMagicBytes(file.mime, start)
    ) {
      await storage.delete(file.storageKey).catch(() => undefined);
      await repo.update(scope, file.id, { status: "DELETED" });
      logger.warn({ fileId: file.id, kind: file.kind }, "Upload rejected: size or type mismatch");
      throw AppError.invalid("The file does not match its declared type or size");
    }
    return toView(await repo.update(scope, file.id, { status: "READY" }));
  },

  async downloadUrl(actor: Actor, fileId: string): Promise<{ url: string; expiresAt: string }> {
    requireStorage();
    const file = await repo.find(scopeOf(actor), fileId);
    if (!file || file.status !== "READY" || !mayDownload(actor, file)) {
      throw AppError.notFound("File not found");
    }
    const url = await getStorage().presignGet(file.storageKey, DOWNLOAD_URL_SECONDS);
    return { url, expiresAt: new Date(Date.now() + DOWNLOAD_URL_SECONDS * 1000).toISOString() };
  },

  // ---------- For other modules (they check their own action first) ----------

  /** A ready file of the expected kind, uploaded in this college. */
  async requireReady(scope: TenantScope, fileId: string, kind: FileKind): Promise<FileRow> {
    const file = await repo.find(scope, fileId);
    if (!file || file.kind !== kind) throw AppError.notFound("File not found");
    if (file.status !== "READY") throw AppError.invalidState("Finish the upload first");
    return file;
  },

  async readBytes(
    scope: TenantScope,
    fileId: string,
  ): Promise<{ bytes: Uint8Array; mime: string }> {
    const file = await repo.find(scope, fileId);
    if (!file || file.status !== "READY") throw new Error("File not available");
    return { bytes: await getStorage().read(file.storageKey), mime: file.mime };
  },

  /** Removes the bytes now (raw audio after transcription); the row stays as a record. */
  async deleteNow(scope: TenantScope, fileId: string): Promise<void> {
    const file = await repo.find(scope, fileId);
    if (!file || file.status === "DELETED") return;
    await getStorage().delete(file.storageKey);
    await repo.update(scope, file.id, { status: "DELETED", deleteAfter: null });
  },

  /** Schedules deletion by the retention job (photos 30 days after publishing). */
  async deleteAfter(scope: TenantScope, fileId: string, at: Date): Promise<void> {
    await repo.update(scope, fileId, { deleteAfter: at });
  },

  toView,
};
