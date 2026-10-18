import { Worker } from "bullmq";
import { runWithRequestId } from "./common/http/request-context.js";
import { env } from "./config/env.js";
import { handlers, loadJobHandlers, queueSettings, scheduledJobs } from "./jobs/index.js";
import { logger } from "./lib/logger.js";
import { prisma } from "./lib/prisma.js";
import { QueueName, closeQueues, getQueue } from "./lib/queue.js";
import { closeRedis, createRedisConnection } from "./lib/redis.js";

/**
 * The worker process: same image as the API, started with `node dist/worker.js`.
 * It runs every BullMQ job, so slow AI work never blocks web requests.
 */
await loadJobHandlers();

const workers = Object.values(QueueName).map((queue) => {
  const settings = queueSettings[queue];
  const worker = new Worker(
    queue,
    async (job, token) => {
      const handler = handlers.get(queue)?.get(job.name);
      if (!handler) throw new Error(`No handler for ${queue}/${job.name}`);
      // Audit and usage rows written by the job carry the job id as their request id.
      return runWithRequestId(`job-${job.id}`, () => handler(job.data as never, job, token));
    },
    {
      connection: createRedisConnection(),
      prefix: env.QUEUE_PREFIX,
      concurrency: settings.concurrency,
      ...(settings.limiter ? { limiter: settings.limiter } : {}),
    },
  );
  worker.on("failed", (job, err) => {
    logger.warn(
      { queue, job: job?.name, id: job?.id, attempts: job?.attemptsMade, err: err.message },
      "Job failed",
    );
  });
  worker.on("error", (err) => logger.error({ queue, err: err.message }, "Worker error"));
  return worker;
});

for (const scheduled of scheduledJobs) {
  await getQueue(scheduled.queue).upsertJobScheduler(
    scheduled.name,
    { every: scheduled.everyMs },
    { name: scheduled.name, data: {} },
  );
}

logger.info({ queues: Object.values(QueueName) }, "Worker started");

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  logger.info(`${signal} received, stopping the worker`);
  // close() waits for running jobs to finish.
  await Promise.allSettled(workers.map((worker) => worker.close()));
  await Promise.allSettled([closeQueues(), prisma.$disconnect(), closeRedis()]);
  process.exit(0);
}

process.on("SIGTERM", (signal) => void shutdown(signal));
process.on("SIGINT", (signal) => void shutdown(signal));
