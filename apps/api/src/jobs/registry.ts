import type { Job } from "bullmq";
import type { QueueName } from "../lib/queue.js";

export type JobHandler = (data: never, job: Job, token?: string) => Promise<unknown>;

/** Concurrency and rate limit per queue; OpenAI and email sending are throttled. */
export interface QueueSettings {
  concurrency: number;
  limiter?: { max: number; duration: number };
}

/** A recurring job, started by the worker (BullMQ job schedulers survive restarts). */
export interface ScheduledJob {
  queue: QueueName;
  name: string;
  everyMs: number;
}

/** Handlers per queue and job name. Each job file in src/jobs registers itself here. */
export const handlers = new Map<QueueName, Map<string, JobHandler>>();

export function registerHandler<T>(
  queue: QueueName,
  name: string,
  handler: (data: T, job: Job, token?: string) => Promise<unknown>,
): void {
  let byName = handlers.get(queue);
  if (!byName) {
    byName = new Map();
    handlers.set(queue, byName);
  }
  byName.set(name, handler as JobHandler);
}

/** Runs a job's handler directly, without Redis. Tests use it to drive jobs step by step. */
export async function runJobNow<T>(queue: QueueName, name: string, data: T): Promise<unknown> {
  const handler = handlers.get(queue)?.get(name);
  if (!handler) throw new Error(`No handler for ${queue}/${name}`);
  const fakeJob = { id: "test", name, data, attemptsMade: 0, opts: {} } as unknown as Job;
  return (handler as (data: T, job: Job) => Promise<unknown>)(data, fakeJob);
}
