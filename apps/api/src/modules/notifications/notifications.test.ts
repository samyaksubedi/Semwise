import { DelayedError, type Job } from "bullmq";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { withSystem } from "../../common/db/scope.js";
import { env } from "../../config/env.js";
import { setMailer } from "../../lib/mailer.js";
import { getQueue } from "../../lib/queue.js";
import { getRedis } from "../../lib/redis.js";
import { resetDatabase } from "../../test/db.js";
import { createTenant, useFakeMailer, type FakeMailer } from "../../test/helpers.js";
import { escapeHtml, render } from "./email.templates.js";
import {
  notificationsService,
  reserveDailySlot,
  type EmailJobData,
} from "./notifications.service.js";

let mailer: FakeMailer;

beforeEach(async () => {
  await resetDatabase();
  mailer = useFakeMailer();
});

afterAll(() => setMailer(null));

function fakeJob(attempts = 4) {
  return {
    id: "j1",
    opts: { attempts },
    moveToDelayed: vi.fn(async () => undefined),
  } as unknown as Job & {
    moveToDelayed: ReturnType<typeof vi.fn>;
  };
}

async function queued(): Promise<EmailJobData> {
  const [job] = await getQueue("email").getJobs(["waiting"]);
  return job!.data as EmailJobData;
}

describe("email queue", () => {
  it("queues with an idempotent job id and sends through the mailer", async () => {
    const tenant = await createTenant({ name: "Everest College" });
    const id = await notificationsService.queueEmail({
      tenantId: tenant.id,
      to: "student@example.com",
      template: "invitation",
      params: { token: "t".repeat(43), collegeName: "Everest College", roleLabel: "Student" },
    });
    const job = (await getQueue("email").getJobs(["waiting"]))[0]!;
    expect(job.id).toBe(`email-${id}`);

    await notificationsService.sendQueued(job.data as EmailJobData, fakeJob());
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]!.subject).toBe("Your invitation to Everest College on Semwise");
    const status = await notificationsService.status(tenant.id, id);
    expect(status?.status).toBe("SENT");

    // Running it again (a retry after a crash) does not send twice.
    await notificationsService.sendQueued(job.data as EmailJobData, fakeJob());
    expect(mailer.sent).toHaveLength(1);
  });

  it("refuses addresses that could inject headers", async () => {
    await expect(
      notificationsService.queueEmail({
        tenantId: null,
        to: "a@example.com\r\nBcc: everyone@example.com",
        template: "password_reset",
        params: { token: "t".repeat(43) },
      }),
    ).rejects.toThrow();
  });

  it("waits for tomorrow once the daily cap is reached, without sending", async () => {
    const day = new Date().toISOString().slice(0, 10);
    await getRedis().set(`${env.QUEUE_PREFIX}:mail:sent:${day}`, String(env.MAIL_DAILY_CAP));
    expect(await reserveDailySlot()).toBe(false);

    await notificationsService.queueEmail({
      tenantId: null,
      to: "a@example.com",
      template: "password_reset",
      params: { token: "t".repeat(43) },
    });
    const job = fakeJob();
    await expect(
      notificationsService.sendQueued(await queued(), job, "tok"),
    ).rejects.toBeInstanceOf(DelayedError);
    expect(job.moveToDelayed).toHaveBeenCalledOnce();
    expect(mailer.sent).toHaveLength(0);
  });

  it("marks the email failed after the last attempt", async () => {
    mailer.fail = true;
    const id = await notificationsService.queueEmail({
      tenantId: null,
      to: "a@example.com",
      template: "password_reset",
      params: { token: "t".repeat(43) },
    });
    const data = await queued();
    await expect(notificationsService.sendQueued(data, fakeJob(2))).rejects.toThrow("SMTP down");
    expect((await notificationsService.status(null, id))?.status).toBe("QUEUED");
    await expect(notificationsService.sendQueued(data, fakeJob(2))).rejects.toThrow("SMTP down");
    const log = await withSystem((db) => db.emailLog.findUnique({ where: { id } }));
    expect(log).toEqual(expect.objectContaining({ status: "FAILED", attempts: 2 }));
    expect(log?.error).not.toContain("a@example.com");
  });
});

describe("templates", () => {
  it("escape user text and keep subjects on one line", () => {
    const email = render({
      template: "invitation",
      params: { token: "abc", collegeName: "<script>x</script>\nCollege", roleLabel: "Student" },
    });
    expect(email.html).not.toContain("<script>");
    expect(email.html).toContain(escapeHtml("<script>x</script>"));
    expect(email.subject).not.toMatch(/[\r\n]/);
  });

  it("put tokens in the link fragment, on the web origin", () => {
    const email = render({ template: "password_reset", params: { token: "secret-token-value" } });
    expect(email.text).toContain(`${env.WEB_ORIGIN}/reset-password#token=secret-token-value`);
  });
});
