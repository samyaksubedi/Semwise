import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../app.js";
import { withSystem } from "../../common/db/scope.js";
import { loadJobHandlers, runJobNow } from "../../jobs/index.js";
import { setMailer } from "../../lib/mailer.js";
import { getQueue } from "../../lib/queue.js";
import { resetDatabase } from "../../test/db.js";
import {
  PASSWORD,
  WEB_ORIGIN,
  addMembership,
  agent,
  createTenant,
  createUser,
  login,
  useFakeMailer,
  type FakeMailer,
} from "../../test/helpers.js";

const app = createApp();
await loadJobHandlers();

let mailer: FakeMailer;

beforeEach(async () => {
  await resetDatabase();
  mailer = useFakeMailer();
});

afterAll(() => setMailer(null));

/** Runs every queued email job, the way the worker would. */
async function deliverEmails() {
  const jobs = await getQueue("email").getJobs(["waiting", "delayed", "prioritized"]);
  for (const job of jobs) {
    await runJobNow("email", job.name, job.data);
    await job.remove();
  }
}

describe("login", () => {
  it("logs in, sets an HttpOnly cookie and picks the only college", async () => {
    const tenant = await createTenant({ name: "Everest College" });
    const user = await createUser();
    await addMembership(user.id, tenant.id, "UNIVERSITY_ADMIN");

    const res = await agent(app)
      .post("/v1/auth/login")
      .send({ email: user.email, password: PASSWORD });
    expect(res.status).toBe(200);
    const cookie = String(res.headers["set-cookie"]);
    expect(cookie).toMatch(/semwise_sid=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(res.body.data.activeTenantId).toBe(tenant.id);
    expect(res.body.data.tenants).toEqual([
      expect.objectContaining({
        id: tenant.id,
        name: "Everest College",
        roles: ["UNIVERSITY_ADMIN"],
      }),
    ]);
    expect(res.body.data.user).toEqual(
      expect.objectContaining({ email: user.email, isSuperAdmin: false }),
    );
    expect(JSON.stringify(res.body)).not.toContain("passwordHash");
  });

  it("stores only a hash of the session token", async () => {
    const user = await createUser();
    const res = await agent(app)
      .post("/v1/auth/login")
      .send({ email: user.email, password: PASSWORD });
    const token = String(res.headers["set-cookie"]).match(/semwise_sid=([^;]+)/)![1]!;
    const sessions = await withSystem((db) => db.session.findMany());
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.tokenHash).not.toBe(token);
  });

  it("answers the same 401 for a wrong password and an unknown email", async () => {
    const user = await createUser();
    const wrong = await agent(app)
      .post("/v1/auth/login")
      .send({ email: user.email, password: "wrong password!!" });
    const unknown = await agent(app)
      .post("/v1/auth/login")
      .send({ email: "nobody@example.com", password: "wrong password!!" });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.error.message).toBe(unknown.body.error.message);
  });

  it("locks the account after 5 failures, even for the right password", async () => {
    const user = await createUser();
    for (let i = 0; i < 5; i++) {
      await agent(app)
        .post("/v1/auth/login")
        .send({ email: user.email, password: "wrong password!!" });
    }
    const res = await agent(app)
      .post("/v1/auth/login")
      .send({ email: user.email, password: PASSWORD });
    expect(res.status).toBe(423);
    expect(res.body.error.code).toBe("ACCOUNT_LOCKED");
  });

  it("refuses invited (no password yet) and deactivated accounts", async () => {
    const invited = await createUser({ status: "INVITED" });
    const off = await createUser({ status: "DEACTIVATED" });
    const a = await agent(app)
      .post("/v1/auth/login")
      .send({ email: invited.email, password: PASSWORD });
    const b = await agent(app)
      .post("/v1/auth/login")
      .send({ email: off.email, password: PASSWORD });
    expect(a.status).toBe(401);
    expect(b.status).toBe(403);
    expect(b.body.error.code).toBe("ACCOUNT_INACTIVE");
  });

  it("validates the body", async () => {
    const res = await agent(app).post("/v1/auth/login").send({ email: "not-an-email" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_FAILED");
    expect(res.body.error.details.map((d: { path: string }) => d.path)).toEqual(
      expect.arrayContaining(["email", "password"]),
    );
  });

  it("rejects a login posted from a foreign origin", async () => {
    const user = await createUser();
    const res = await request(app)
      .post("/v1/auth/login")
      .set("Origin", "https://evil.example")
      .send({ email: user.email, password: PASSWORD });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN_ORIGIN");
  });
});

describe("sessions and the active college", () => {
  it("returns the session view and logs out", async () => {
    const user = await createUser();
    const a = await login(app, user.email);
    expect((await a.get("/v1/auth/me")).status).toBe(200);
    expect((await a.post("/v1/auth/logout")).status).toBe(204);
    expect((await a.get("/v1/auth/me")).status).toBe(401);
  });

  it("makes a user in two colleges choose, and only among their own", async () => {
    const [one, two, foreign] = await Promise.all([createTenant(), createTenant(), createTenant()]);
    const user = await createUser();
    await addMembership(user.id, one.id, "STUDENT");
    await addMembership(user.id, two.id, "TEACHER");
    const a = await login(app, user.email);

    const me = await a.get("/v1/auth/me");
    expect(me.body.data.activeTenantId).toBeNull();
    expect(me.body.data.tenants).toHaveLength(2);
    // Tenant routes need an active college.
    expect((await a.get("/v1/audit")).body.error.code).toBe("NO_ACTIVE_TENANT");

    const chosen = await a.post("/v1/auth/active-tenant").send({ tenantId: two.id });
    expect(chosen.status).toBe(200);
    expect(chosen.body.data.activeTenantId).toBe(two.id);
    expect(chosen.body.data.roles).toEqual([{ role: "TEACHER", programId: null, sectionId: null }]);

    const notMine = await a.post("/v1/auth/active-tenant").send({ tenantId: foreign.id });
    expect(notMine.status).toBe(404);
  });

  it("hides a suspended college and refuses it as the active one", async () => {
    const tenant = await createTenant({ status: "SUSPENDED" });
    const user = await createUser();
    await addMembership(user.id, tenant.id, "UNIVERSITY_ADMIN");
    const a = await login(app, user.email);
    const me = await a.get("/v1/auth/me");
    expect(me.body.data.tenants).toEqual([]);
    expect((await a.post("/v1/auth/active-tenant").send({ tenantId: tenant.id })).status).toBe(404);
    expect((await a.get("/v1/audit")).status).toBe(403);
  });

  it("ends every session when an account is deactivated", async () => {
    const user = await createUser();
    const a = await login(app, user.email);
    await withSystem((db) =>
      db.user.update({ where: { id: user.id }, data: { status: "DEACTIVATED" } }),
    );
    expect((await a.get("/v1/auth/me")).status).toBe(401);
  });

  it("changes the password and logs out the other sessions", async () => {
    const user = await createUser();
    const first = await login(app, user.email);
    const second = await login(app, user.email);
    const res = await first
      .post("/v1/auth/password/change")
      .send({ currentPassword: PASSWORD, newPassword: "a brand new long password" });
    expect(res.status).toBe(204);
    expect((await first.get("/v1/auth/me")).status).toBe(200);
    expect((await second.get("/v1/auth/me")).status).toBe(401);
    const wrong = await first
      .post("/v1/auth/password/change")
      .send({ currentPassword: "not it at all", newPassword: "another long password!" });
    expect(wrong.status).toBe(400);
  });
});

describe("forgot and reset password", () => {
  it("answers the same whether or not the account exists, and mails only real accounts", async () => {
    const user = await createUser();
    const known = await agent(app).post("/v1/auth/password/forgot").send({ email: user.email });
    const unknown = await agent(app)
      .post("/v1/auth/password/forgot")
      .send({ email: "ghost@example.com" });
    expect(known.status).toBe(202);
    expect(unknown.status).toBe(202);
    expect(known.body).toEqual(unknown.body);

    await deliverEmails();
    expect(mailer.sent.map((m) => m.to)).toEqual([user.email]);
    // The email log keeps no plain address.
    const logs = await withSystem((db) => db.emailLog.findMany());
    expect(logs).toHaveLength(1);
    expect(logs[0]!.status).toBe("SENT");
    expect(JSON.stringify(logs)).not.toContain(user.email);
  });

  it("resets with the mailed link once, and logs out every session", async () => {
    const user = await createUser();
    const session = await login(app, user.email);
    await agent(app).post("/v1/auth/password/forgot").send({ email: user.email });
    await deliverEmails();
    const token = mailer.tokenFor(user.email);
    expect(mailer.sent[0]!.text).toContain(`${WEB_ORIGIN}/reset-password#token=`);

    const newPassword = "my new and much longer password";
    const reset = await agent(app).post("/v1/auth/password/reset").send({ token, newPassword });
    expect(reset.status).toBe(204);
    expect((await session.get("/v1/auth/me")).status).toBe(401);
    expect(
      (await agent(app).post("/v1/auth/login").send({ email: user.email, password: newPassword }))
        .status,
    ).toBe(200);

    const again = await agent(app).post("/v1/auth/password/reset").send({ token, newPassword });
    expect(again.status).toBe(400);
    expect(again.body.error.code).toBe("INVALID_TOKEN");
  });

  it("rejects an expired or made-up token", async () => {
    const user = await createUser();
    await agent(app).post("/v1/auth/password/forgot").send({ email: user.email });
    await deliverEmails();
    const token = mailer.tokenFor(user.email);
    await withSystem((db) =>
      db.passwordReset.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } }),
    );
    const expired = await agent(app)
      .post("/v1/auth/password/reset")
      .send({ token, newPassword: "a long enough password" });
    expect(expired.body.error.code).toBe("INVALID_TOKEN");
    const madeUp = await agent(app)
      .post("/v1/auth/password/reset")
      .send({ token: "x".repeat(43), newPassword: "a long enough password" });
    expect(madeUp.body.error.code).toBe("INVALID_TOKEN");
  });

  it("enforces the password length on reset", async () => {
    const res = await agent(app)
      .post("/v1/auth/password/reset")
      .send({ token: "x".repeat(43), newPassword: "short" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_FAILED");
  });
});
