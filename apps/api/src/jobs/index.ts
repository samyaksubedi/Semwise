import { env } from "../config/env.js";
import { QueueName } from "../lib/queue.js";
import type { QueueSettings, ScheduledJob } from "./registry.js";

export { handlers, registerHandler, runJobNow } from "./registry.js";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export const queueSettings: Record<QueueName, QueueSettings> = {
  [QueueName.email]: { concurrency: 1, limiter: { max: env.MAIL_PER_MINUTE, duration: 60_000 } },
  [QueueName.ai]: { concurrency: 4, limiter: { max: 60, duration: 60_000 } },
  [QueueName.index]: { concurrency: 2 },
  [QueueName.workflow]: { concurrency: 4 },
  [QueueName.maintenance]: { concurrency: 1 },
};

export const scheduledJobs: ScheduledJob[] = [
  { queue: QueueName.maintenance, name: "session-cleanup", everyMs: DAY },
  { queue: QueueName.maintenance, name: "file-retention", everyMs: HOUR },
];

/** Loads every job handler file so it registers itself. The worker (and tests) call this once. */
export async function loadJobHandlers(): Promise<void> {
  await import("./email.job.js");
  await import("./maintenance.job.js");
  await import("./syllabus.job.js");
  await import("./entries.job.js");
  await import("./media.job.js");
}
