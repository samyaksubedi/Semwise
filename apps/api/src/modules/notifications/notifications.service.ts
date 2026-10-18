import { createHash } from "node:crypto";
import { DelayedError, type Job } from "bullmq";
import { env } from "../../config/env.js";
import { logger } from "../../lib/logger.js";
import { getMailer, isMailConfigured } from "../../lib/mailer.js";
import { QueueName, enqueue } from "../../lib/queue.js";
import { getRedis } from "../../lib/redis.js";
import { render, type EmailTemplate } from "./email.templates.js";
import { notificationsRepository } from "./notifications.repository.js";

export const EMAIL_JOB = "send";

export type EmailJobData = {
  emailLogId: string;
  tenantId: string | null;
  to: string;
} & EmailTemplate;

/** Only a hash of the address is stored, so logs never hold plain addresses. */
export function hashAddress(address: string): string {
  return createHash("sha256").update(address.trim().toLowerCase()).digest("hex");
}

/** Rejects anything that could inject a header (line breaks, control characters). */
function assertSafeAddress(address: string): void {
  if (/[\p{Cc}\s,;<>]/u.test(address) || !address.includes("@") || address.length > 254) {
    throw new Error("Unsafe email address");
  }
}

function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function nextUtcMidnight(now: Date): number {
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 5);
}

const dailyKey = (now: Date) => `${env.QUEUE_PREFIX}:mail:sent:${utcDay(now)}`;

/** Takes one slot of today's sending cap; false when the cap is reached. */
export async function reserveDailySlot(now = new Date()): Promise<boolean> {
  const redis = getRedis();
  const key = dailyKey(now);
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, 3 * 24 * 3600);
  if (count > env.MAIL_DAILY_CAP) {
    await redis.decr(key);
    return false;
  }
  return true;
}

async function releaseDailySlot(now = new Date()): Promise<void> {
  await getRedis().decr(dailyKey(now));
}

/** How many emails went out today (UTC), for progress screens ("120 of 400 sent today"). */
export async function sentToday(now = new Date()): Promise<{ sent: number; cap: number }> {
  const raw = await getRedis().get(dailyKey(now));
  return { sent: Number(raw ?? 0), cap: env.MAIL_DAILY_CAP };
}

export const notificationsService = {
  /**
   * Queues one email through the throttled queue and returns its log id. Call it after the
   * surrounding transaction has committed, so the worker can always find the log row.
   */
  async queueEmail(
    input: { tenantId: string | null; to: string } & EmailTemplate,
  ): Promise<string> {
    assertSafeAddress(input.to);
    const log = await notificationsRepository.create(input.tenantId, {
      template: input.template,
      toHash: hashAddress(input.to),
    });
    const data = { ...input, emailLogId: log.id } as EmailJobData;
    await enqueue(QueueName.email, EMAIL_JOB, data, { jobId: `email-${log.id}` });
    return log.id;
  },

  /** The worker's handler: daily cap, send, record the outcome. Never logs the address or body. */
  async sendQueued(data: EmailJobData, job: Job, token?: string, now = new Date()) {
    const log = await notificationsRepository.find(data.tenantId, data.emailLogId);
    // Not visible yet (the creating transaction may still be open): retry later.
    if (!log) throw new Error("Email log not found yet");
    if (log.status === "SENT") return { skipped: true };

    if (!isMailConfigured()) {
      await notificationsRepository.update(data.tenantId, log.id, {
        status: "FAILED",
        error: "Email is not configured on the server",
      });
      logger.warn({ emailLogId: log.id }, "Email not configured; marked failed");
      return { skipped: true };
    }

    if (!(await reserveDailySlot(now))) {
      // Today's cap is used up: wait until shortly after midnight UTC, without using an attempt.
      await job.moveToDelayed(nextUtcMidnight(now), token);
      throw new DelayedError();
    }

    const attempts = log.attempts + 1;
    try {
      const { messageId } = await getMailer().send({ to: data.to, ...render(data) });
      await notificationsRepository.update(data.tenantId, log.id, {
        status: "SENT",
        messageId,
        attempts,
        error: null,
        sentAt: new Date(),
      });
      logger.info({ emailLogId: log.id, template: data.template }, "Email sent");
      return { messageId };
    } catch (err) {
      await releaseDailySlot(now);
      const final = attempts >= (job.opts?.attempts ?? 1);
      await notificationsRepository.update(data.tenantId, log.id, {
        attempts,
        error: err instanceof Error ? err.message.slice(0, 300) : "Send failed",
        ...(final ? { status: "FAILED" as const } : {}),
      });
      logger.warn({ emailLogId: log.id, attempts, final }, "Email send failed");
      throw err;
    }
  },

  /** Send status of several emails at once (invite lists and progress). */
  async statuses(tenantId: string | null, ids: string[]) {
    if (ids.length === 0) return new Map<string, "QUEUED" | "SENT" | "FAILED">();
    const logs = await notificationsRepository.findMany(tenantId, ids);
    return new Map(logs.map((l) => [l.id, l.status]));
  },

  async status(tenantId: string | null, emailLogId: string) {
    const log = await notificationsRepository.find(tenantId, emailLogId);
    return log ? { status: log.status, attempts: log.attempts, sentAt: log.sentAt } : null;
  },
};
