import { QueueName } from "../lib/queue.js";
import { MEDIA_READ_JOB, mediaService } from "../modules/media/index.js";
import { registerHandler } from "./registry.js";

/** A CR's voice note to text, or the writing on a class photo (AI queue: rate-limited). */
registerHandler<{ tenantId: string; readingId: string }>(
  QueueName.ai,
  MEDIA_READ_JOB,
  (data, job) => mediaService.runRead(data, job),
);
