import { QueueName } from "../lib/queue.js";
import { EXTRACT_JOB, PUBLISH_JOB, syllabusService } from "../modules/syllabus/index.js";
import { registerHandler } from "./registry.js";

/** Reads an uploaded syllabus PDF into a draft outline (AI queue: rate-limited). */
registerHandler<{ tenantId: string; versionId: string; userId: string }>(
  QueueName.ai,
  EXTRACT_JOB,
  (data, job) => syllabusService.runExtraction(data, job),
);

/** Indexes a version, makes it live, then removes the previous version's vectors. */
registerHandler<{ tenantId: string; versionId: string; actorId: string }>(
  QueueName.index,
  PUBLISH_JOB,
  (data, job) => syllabusService.runPublish(data, job),
);
