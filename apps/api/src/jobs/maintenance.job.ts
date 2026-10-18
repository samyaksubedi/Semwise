import { logger } from "../lib/logger.js";
import { QueueName } from "../lib/queue.js";
import { authService } from "../modules/auth/index.js";
import { registerHandler } from "./registry.js";

export const SESSION_CLEANUP_JOB = "session-cleanup";

/** Removes sessions that can never be used again (expired or revoked). */
registerHandler(QueueName.maintenance, SESSION_CLEANUP_JOB, async () => {
  const removed = await authService.cleanupSessions();
  if (removed > 0) logger.info({ removed }, "Removed dead sessions");
  return { removed };
});
