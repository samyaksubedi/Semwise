import { Queue, type JobsOptions } from "bullmq";
import { env } from "../config/env.js";
import { getRedis } from "./redis.js";

/**
 * One queue per job family, each with its own concurrency and rate limit in the worker.
 * - email: throttled sending (per minute and per day caps)
 * - ai: OpenAI-backed work (extraction, organizing entries, summaries, transcription, vision)
 * - index: embeddings and Qdrant sync
 * - workflow: delayed approval reminders, escalations, unreviewed publishing
 * - maintenance: recurring cleanup
 */
export const QueueName = {
  email: "email",
  ai: "ai",
  index: "index",
  workflow: "workflow",
  maintenance: "maintenance",
} as const;
export type QueueName = (typeof QueueName)[keyof typeof QueueName];

const queues = new Map<QueueName, Queue>();

/** Retries with exponential backoff; failed jobs are kept so they can be inspected and retried. */
export const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 4,
  backoff: { type: "exponential", delay: 5_000 },
  removeOnComplete: { age: 7 * 24 * 3600, count: 5_000 },
  removeOnFail: false,
};

export function getQueue(name: QueueName): Queue {
  let queue = queues.get(name);
  if (!queue) {
    queue = new Queue(name, {
      connection: getRedis(),
      prefix: env.QUEUE_PREFIX,
      // Email jobs carry the address, so they are removed as soon as they finish.
      defaultJobOptions:
        name === QueueName.email
          ? { ...DEFAULT_JOB_OPTIONS, removeOnComplete: true }
          : DEFAULT_JOB_OPTIONS,
    });
    queues.set(name, queue);
  }
  return queue;
}

/**
 * Adds a job. `jobId` is the idempotency key: adding the same id twice keeps one job, so a retried
 * request or a double click never duplicates work.
 */
export async function enqueue<T extends object>(
  name: QueueName,
  jobName: string,
  data: T,
  options: { jobId: string; delayMs?: number; attempts?: number },
): Promise<void> {
  await getQueue(name).add(jobName, data, {
    jobId: options.jobId.replace(/:/g, "-"),
    ...(options.delayMs ? { delay: options.delayMs } : {}),
    ...(options.attempts ? { attempts: options.attempts } : {}),
  });
}

/** Removes a delayed job that is no longer needed (for example a reminder after the teacher acted). */
export async function cancelJob(name: QueueName, jobId: string): Promise<void> {
  const job = await getQueue(name).getJob(jobId.replace(/:/g, "-"));
  if (job && (await job.isDelayed())) await job.remove();
}

export async function closeQueues(): Promise<void> {
  await Promise.allSettled([...queues.values()].map((queue) => queue.close()));
  queues.clear();
}
