import { loadJobHandlers, runJobNow } from "../jobs/index.js";
import { getQueue, type QueueName } from "../lib/queue.js";

let loaded: Promise<void> | undefined;

/**
 * Runs every waiting job of a queue in-process, the way the worker would, and removes it.
 * Tests use this instead of a running worker, so each step is deterministic.
 */
export async function drainQueue(queue: QueueName): Promise<number> {
  loaded ??= loadJobHandlers();
  await loaded;
  let ran = 0;
  for (let round = 0; round < 10; round++) {
    const jobs = await getQueue(queue).getJobs(["waiting", "prioritized"]);
    if (jobs.length === 0) break;
    for (const job of jobs) {
      await runJobNow(queue, job.name, job.data);
      await job.remove();
      ran += 1;
    }
  }
  return ran;
}
