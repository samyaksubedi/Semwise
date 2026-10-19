import { logger } from "../lib/logger.js";
import { QueueName } from "../lib/queue.js";
import { authService } from "../modules/auth/index.js";
import { filesService } from "../modules/files/index.js";
import { registerHandler } from "./registry.js";

export const SESSION_CLEANUP_JOB = "session-cleanup";

/** Removes sessions that can never be used again (expired or revoked). */
registerHandler(QueueName.maintenance, SESSION_CLEANUP_JOB, async () => {
  const removed = await authService.cleanupSessions();
  if (removed > 0) logger.info({ removed }, "Removed dead sessions");
  return { removed };
});

export const FILE_RETENTION_JOB = "file-retention";

/** Deletes stored files past their retention date, and uploads that were never completed. */
registerHandler(QueueName.maintenance, FILE_RETENTION_JOB, async () => {
  const deleted = await filesService.purgeExpired();
  if (deleted > 0) logger.info({ deleted }, "Deleted files past retention");
  return { deleted };
});
