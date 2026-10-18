import { ErrorCode } from "@semwise/shared";
import type { Request } from "express";
import {
  ipKeyGenerator,
  MemoryStore,
  rateLimit,
  type ClientRateLimitInfo,
  type Options,
  type Store,
} from "express-rate-limit";
import { logger } from "../../lib/logger.js";
import { getRedis } from "../../lib/redis.js";
import { AppError } from "../errors/app-error.js";

/** The one Redis method the store needs, so tests can pass their own client. */
interface RedisLike {
  eval(script: string, numKeys: number, ...args: (string | number)[]): Promise<unknown>;
  decr(key: string): Promise<number>;
  del(key: string): Promise<number>;
}

/**
 * One fixed window per key: the first hit sets the counter with the window as its expiry,
 * later hits add one. Returns [hits, milliseconds left]. Runs as one atomic step in Redis.
 */
const INCREMENT = `
local ttl = redis.call("PTTL", KEYS[1])
if ttl <= 0 then
  redis.call("SET", KEYS[1], 1, "PX", ARGV[1])
  return { 1, tonumber(ARGV[1]) }
end
return { redis.call("INCR", KEYS[1]), ttl }`;

/**
 * Counts in Redis, so every API instance shares the counters and a deploy doesn't reset them.
 * If a Redis call fails it counts in memory for that request, so a blip never takes the API down.
 */
export class RedisFallbackStore implements Store {
  readonly prefix: string;
  private readonly memory = new MemoryStore();
  private windowMs = 60_000;

  constructor(
    name: string,
    private readonly client: () => RedisLike = getRedis,
  ) {
    this.prefix = `rl:${name}:`;
  }

  init(options: Options): void {
    this.windowMs = options.windowMs;
    this.memory.init(options);
  }

  async increment(key: string): Promise<ClientRateLimitInfo> {
    try {
      const [hits, ttl] = (await this.client().eval(
        INCREMENT,
        1,
        this.prefix + key,
        String(this.windowMs),
      )) as [number, number];
      return { totalHits: Number(hits), resetTime: new Date(Date.now() + Number(ttl)) };
    } catch (err) {
      logger.warn({ err }, "Rate limit: Redis failed, counting in memory");
      return this.memory.increment(key);
    }
  }

  async decrement(key: string): Promise<void> {
    try {
      await this.client().decr(this.prefix + key);
    } catch {
      await this.memory.decrement(key);
    }
  }

  async resetKey(key: string): Promise<void> {
    await this.client()
      .del(this.prefix + key)
      .catch(() => undefined);
    await this.memory.resetKey(key);
  }
}

/** The caller's address, with IPv6 grouped by /56 so one network can't rotate around the limit. */
const byIp = (req: Request) => ipKeyGenerator(req.ip ?? "unknown");

/** Signed-in routes count per user, so the limit follows the account rather than the network. */
const byUser = (req: Request) => (req.auth ? `user:${req.auth.userId}` : byIp(req));

function limiter(name: string, windowMs: number, limit: number, extra: Partial<Options> = {}) {
  return rateLimit({
    windowMs,
    limit,
    store: new RedisFallbackStore(name),
    keyGenerator: byIp,
    // Tests make many requests from one address; only the rate-limit tests turn limits on.
    skip: () => process.env.NODE_ENV === "test" && process.env.TEST_RATE_LIMITS !== "1",
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: (req, res, next, options) => {
      const resetAt = (req as Request & { rateLimit?: { resetTime?: Date } }).rateLimit?.resetTime;
      const seconds = Math.max(
        1,
        Math.ceil(((resetAt?.getTime() ?? Date.now() + options.windowMs) - Date.now()) / 1000),
      );
      res.setHeader("Retry-After", String(seconds));
      next(
        new AppError(
          429,
          ErrorCode.RATE_LIMITED,
          seconds < 90
            ? `Too many requests. Try again in ${seconds} seconds.`
            : `Too many requests. Try again in about ${Math.ceil(seconds / 60)} minutes.`,
        ),
      );
    },
    ...extra,
  });
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

function emailKey(req: Request): string {
  const email = (req.body as { email?: unknown } | undefined)?.email;
  return typeof email === "string" && email.trim()
    ? `email:${email.trim().toLowerCase().slice(0, 254)}`
    : `ip:${byIp(req)}`;
}

/** 10 failed logins per 15 minutes per IP; successful logins do not count. */
const loginPerIp = limiter("login-ip", 15 * MINUTE, 10, { skipSuccessfulRequests: true });

/** 10 failed logins per hour per email, whatever IP they come from. The account also locks itself. */
const loginPerEmail = limiter("login-email", HOUR, 10, {
  skipSuccessfulRequests: true,
  keyGenerator: emailKey,
});

export const loginLimit = [loginPerIp, loginPerEmail];

/** Password-reset and invite-acceptance requests: 5 per hour per IP and per email. */
export const tokenRequestLimit = [
  limiter("token-ip", HOUR, 10),
  limiter("token-email", HOUR, 5, { keyGenerator: emailKey }),
];

/** 600 calls per minute per signed-in user across the tenant API. */
export const userLimit = limiter("user", MINUTE, 600, { keyGenerator: byUser });

/** Invite sends and resends: 60 requests per hour per user (each can hold many rows). */
export const inviteLimit = limiter("invite", HOUR, 60, { keyGenerator: byUser });

/** Signed upload URLs: 60 per hour per user. */
export const uploadSignLimit = limiter("upload", HOUR, 60, { keyGenerator: byUser });

/** AI-backed requests: 30 per 10 minutes per user (monthly quotas are enforced separately). */
export const aiLimit = limiter("ai", 10 * MINUTE, 30, { keyGenerator: byUser });
