import { ErrorCode, type MediaReadingView } from "@semwise/shared";
import type { Job } from "bullmq";
import { transaction, type TenantScope } from "../../common/db/scope.js";
import { AppError } from "../../common/errors/app-error.js";
import { logger } from "../../lib/logger.js";
import { QueueName, enqueue } from "../../lib/queue.js";
import { aiService, isAiConfigured } from "../ai/index.js";
import { Action, can, type Actor } from "../authz/index.js";
import { classResource, classesService } from "../classes/index.js";
import { RETENTION, filesService } from "../files/index.js";
import { mediaRepository as repo } from "./media.repository.js";

export const MEDIA_READ_JOB = "media-read";

type Kind = "AUDIO" | "PHOTO";
type Reading = NonNullable<Awaited<ReturnType<typeof repo.find>>>;

const HOUR = 60 * 60 * 1000;
const FEATURE = { AUDIO: "DICTATION", PHOTO: "PHOTO_READ" } as const;

const scopeOf = (actor: Actor): TenantScope => ({ tenantId: actor.tenantId! });

function toView(r: Reading): MediaReadingView {
  return {
    id: r.id,
    classId: r.classId,
    fileId: r.fileId,
    kind: r.kind as Kind,
    status: r.status,
    text: r.text,
    error: r.error,
    seconds: r.seconds,
    createdAt: r.createdAt.toISOString(),
  };
}

/** Readings are the uploader's working copy: nobody else can see them. */
async function loadOwn(actor: Actor, id: string): Promise<Reading> {
  const reading = await repo.find(scopeOf(actor), id);
  if (!reading || reading.createdById !== actor.userId) throw AppError.notFound("Not found");
  return reading;
}

export const mediaService = {
  /**
   * Queues a transcription (AUDIO) or photo reading (PHOTO) of a file the CR uploaded for the
   * class. Asking again for the same file returns the reading already made.
   */
  async start(actor: Actor, classId: string, fileId: string, kind: Kind) {
    const scope = scopeOf(actor);
    const klass = await classesService.find(scope, classId);
    if (!klass || !can(actor, Action.STRUCTURE_READ, classResource(klass))) {
      throw AppError.notFound("Class not found");
    }
    if (!can(actor, Action.ENTRY_USE_MEDIA, classResource(klass))) throw AppError.forbidden();
    if (klass.status !== "ACTIVE") throw AppError.invalidState("This class is archived");
    const existing = await repo.findByFile(scope, fileId);
    if (existing) {
      if (existing.createdById !== actor.userId || existing.classId !== klass.id)
        throw AppError.notFound("File not found");
      return toView(existing);
    }
    const file = await filesService.requireReady(scope, fileId, kind);
    if (file.classId !== klass.id || file.uploadedById !== actor.userId)
      throw AppError.notFound("File not found");
    if (!isAiConfigured()) throw AppError.notConfigured("AI");
    await aiService.assertAvailable(
      { tenantId: scope.tenantId, userId: actor.userId },
      FEATURE[kind],
    );
    const now = Date.now();
    const reading = await transaction(scope, async () => {
      const created = await repo.create(scope, {
        classId: klass.id,
        fileId,
        kind,
        createdById: actor.userId,
      });
      // A safety net: raw audio goes right after transcription, an unused photo after the wait.
      const keep =
        kind === "AUDIO" ? RETENTION.audioMaxHours : RETENTION.photoDaysAfterPublish * 24;
      await filesService.deleteAfter(scope, fileId, new Date(now + keep * HOUR));
      return created;
    });
    await enqueue(
      QueueName.ai,
      MEDIA_READ_JOB,
      { tenantId: scope.tenantId, readingId: reading.id },
      { jobId: `media-read-${reading.id}` },
    );
    return toView(reading);
  },

  async get(actor: Actor, id: string): Promise<MediaReadingView> {
    return toView(await loadOwn(actor, id));
  },

  /** The worker: speech to text, or the writing on a photo. Raw audio is deleted afterwards. */
  async runRead(data: { tenantId: string; readingId: string }, job: Job) {
    const scope = { tenantId: data.tenantId };
    const reading = await repo.find(scope, data.readingId);
    if (!reading || reading.status === "DONE" || reading.status === "FAILED")
      return { skipped: true };
    await repo.update(scope, reading.id, { status: "RUNNING", error: null });
    const ctx = { tenantId: data.tenantId, userId: reading.createdById };
    try {
      const { bytes, mime } = await filesService.readBytes(scope, reading.fileId);
      if (reading.kind === "AUDIO") {
        const result = await aiService.transcribe(ctx, bytes, mime);
        await repo.update(
          scope,
          reading.id,
          result.text
            ? { status: "DONE", text: result.text, seconds: result.seconds }
            : {
                status: "FAILED",
                seconds: result.seconds,
                error: "No speech was heard in the recording. Record again closer to the speaker.",
              },
        );
        await filesService.deleteNow(scope, reading.fileId);
        return { seconds: result.seconds };
      }
      const result = await aiService.readPhoto(ctx, bytes, mime);
      const text = result.text.trim();
      await repo.update(
        scope,
        reading.id,
        result.unreadable || !text
          ? {
              status: "FAILED",
              error: "No readable writing was found. Take the photo closer, with less glare.",
            }
          : { status: "DONE", text },
      );
      return { characters: text.length };
    } catch (err) {
      // An exhausted quota will not recover on a retry.
      const quota = err instanceof AppError && err.code === ErrorCode.QUOTA_EXCEEDED;
      const final = quota || job.attemptsMade + 1 >= (job.opts?.attempts ?? 1);
      await repo.update(scope, reading.id, {
        status: final ? "FAILED" : "QUEUED",
        error: final ? (err instanceof Error ? err.message.slice(0, 300) : "Reading failed") : null,
      });
      if (final && reading.kind === "AUDIO")
        await filesService.deleteNow(scope, reading.fileId).catch(() => undefined);
      logger.warn({ readingId: reading.id, kind: reading.kind, final }, "Media reading failed");
      if (quota) return { failed: "quota" };
      throw err;
    }
  },

  /**
   * For entries: the media an entry claims to come from must be a finished reading by the same
   * person, for the same class, of the matching kind.
   */
  async requireUsable(
    scope: TenantScope,
    input: { fileId: string; inputKind: "VOICE" | "PHOTO"; classId: string; userId: string },
  ): Promise<void> {
    const reading = await repo.findByFile(scope, input.fileId);
    const kind: Kind = input.inputKind === "VOICE" ? "AUDIO" : "PHOTO";
    if (
      !reading ||
      reading.kind !== kind ||
      reading.classId !== input.classId ||
      reading.createdById !== input.userId
    ) {
      throw AppError.notFound("File not found");
    }
    if (reading.status !== "DONE")
      throw AppError.invalidState("Wait until the recording or photo has been read");
  },
};
