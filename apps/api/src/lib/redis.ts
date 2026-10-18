import { Redis } from "ioredis";
import { env } from "../config/env.js";
import { logger } from "./logger.js";

let client: Redis | null = null;

/**
 * Redis options BullMQ needs: workers block on Redis, so commands must wait instead of failing.
 * Every connection made here uses them.
 */
export function redisOptions() {
  return { maxRetriesPerRequest: null, enableReadyCheck: true } as const;
}

/** A new connection (BullMQ workers each need their own). */
export function createRedisConnection(): Redis {
  const connection = new Redis(env.REDIS_URL, redisOptions());
  connection.on("error", (err: Error) => logger.warn({ err: err.message }, "Redis error"));
  return connection;
}

/** The shared connection for rate limits, caches and queues that only add jobs. */
export function getRedis(): Redis {
  client ??= createRedisConnection();
  return client;
}

export async function closeRedis(): Promise<void> {
  if (!client) return;
  const c = client;
  client = null;
  await c.quit().catch(() => c.disconnect());
}
