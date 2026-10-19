import { createApp } from "./app.js";
import { assertSafeDatabaseRole } from "./common/db/role-check.js";
import { env } from "./config/env.js";
import { logger } from "./lib/logger.js";
import { prisma } from "./lib/prisma.js";
import { closeQueues } from "./lib/queue.js";
import { closeRedis, getRedis } from "./lib/redis.js";

const SHUTDOWN_TIMEOUT_MS = 10_000;

// Redis is required: fail fast with a clear message instead of serving requests that cannot queue.
try {
  await getRedis().ping();
} catch (err) {
  logger.fatal({ err }, "Redis is not reachable (REDIS_URL); the API cannot start without it");
  process.exit(1);
}

// Row-level security must apply to this process: refuse a superuser or BYPASSRLS role.
try {
  await assertSafeDatabaseRole();
} catch (err) {
  logger.fatal({ err }, "Unsafe database role; the API will not start");
  process.exit(1);
}

const server = createApp().listen(env.PORT, () => {
  logger.info(`API listening on http://localhost:${env.PORT} (${env.NODE_ENV})`);
});

// Coolify sends SIGTERM on redeploy: finish in-flight requests, then exit.
function shutdown(signal: NodeJS.Signals): void {
  logger.info(`${signal} received, shutting down`);
  server.close(() => {
    void Promise.allSettled([prisma.$disconnect(), closeQueues(), closeRedis()]).finally(() =>
      process.exit(0),
    );
  });
  setTimeout(() => {
    logger.error("Forced shutdown after timeout");
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS).unref();
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

process.on("unhandledRejection", (reason) => {
  logger.fatal({ err: reason }, "Unhandled promise rejection");
  process.exit(1);
});
