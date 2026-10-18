import { QueueName } from "../lib/queue.js";
import type { QueueSettings, ScheduledJob } from "./registry.js";

export { handlers, registerHandler, runJobNow } from "./registry.js";

export const queueSettings: Record<QueueName, QueueSettings> = {
  [QueueName.email]: { concurrency: 1 },
  [QueueName.ai]: { concurrency: 4, limiter: { max: 60, duration: 60_000 } },
  [QueueName.index]: { concurrency: 2 },
  [QueueName.workflow]: { concurrency: 4 },
  [QueueName.maintenance]: { concurrency: 1 },
};

export const scheduledJobs: ScheduledJob[] = [];

/** Loads every job handler file so it registers itself. The worker calls this once at start. */
export async function loadJobHandlers(): Promise<void> {
  // Feature modules add their handler files here as they are built.
}
