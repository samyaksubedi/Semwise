import type { Role } from "@semwise/shared";
import type { Express } from "express";
import request from "supertest";
import { expect } from "vitest";
import { withSystem } from "../common/db/scope.js";
import { setMailer, type Mailer, type OutgoingEmail } from "../lib/mailer.js";
import { hashPassword } from "../modules/auth/index.js";

/** Matches CORS_ORIGINS in vitest.config.ts. */
export const WEB_ORIGIN = "https://app.semwise.test";
export const PASSWORD = "correct horse battery staple";

let counter = 0;
export function unique(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter}`;
}

/** One hash for every test user: Argon2 is slow on purpose, tests should not be. */
let passwordHash: Promise<string> | undefined;
function testPasswordHash(): Promise<string> {
  passwordHash ??= hashPassword(PASSWORD);
  return passwordHash;
}

export async function createUser(
  fields: { email?: string; name?: string; status?: "INVITED" | "ACTIVE" | "DEACTIVATED" } = {},
) {
  const status = fields.status ?? "ACTIVE";
  const email = fields.email ?? `${unique("user")}@example.com`;
  return withSystem(async (db) =>
    db.user.create({
      data: {
        email,
        displayName: fields.name ?? email.split("@")[0]!,
        status,
        passwordHash: status === "INVITED" ? null : await testPasswordHash(),
      },
    }),
  );
}

export function createTenant(
  fields: { name?: string; timezone?: string; status?: "ACTIVE" | "SUSPENDED" } = {},
) {
  const slug = unique("college");
  return withSystem((db) =>
    db.tenant.create({
      data: {
        name: fields.name ?? `College ${slug}`,
        slug,
        timezone: fields.timezone ?? "Asia/Kathmandu",
        status: fields.status ?? "ACTIVE",
      },
    }),
  );
}

export function addMembership(
  userId: string,
  tenantId: string | null,
  role: Role,
  scope: { programId?: string; sectionId?: string } = {},
) {
  return withSystem((db) =>
    db.membership.create({
      data: { userId, tenantId, role, ...scope } as Parameters<
        typeof db.membership.create
      >[0]["data"],
    }),
  );
}

export type Agent = ReturnType<typeof request.agent>;

/** A supertest agent that keeps cookies and always sends the web app's Origin. */
export function agent(app: Express): Agent {
  return request.agent(app).set("Origin", WEB_ORIGIN);
}

export async function login(app: Express, email: string, password = PASSWORD): Promise<Agent> {
  const a = agent(app);
  const res = await a.post("/v1/auth/login").send({ email, password });
  if (res.status !== 200)
    throw new Error(`Login failed in test setup: ${JSON.stringify(res.body)}`);
  return a;
}

/** Captures email instead of sending it. */
export class FakeMailer implements Mailer {
  sent: OutgoingEmail[] = [];
  fail = false;

  async send(email: OutgoingEmail) {
    if (this.fail) throw new Error("SMTP down");
    this.sent.push(email);
    return { messageId: `fake-${this.sent.length}` };
  }

  /** The token from the last link sent to `to`. */
  tokenFor(to: string): string {
    const mail = [...this.sent].reverse().find((m) => m.to === to);
    const match = mail?.text.match(/#token=([A-Za-z0-9_-]+)/);
    if (!match) throw new Error(`No token mailed to ${to}`);
    return match[1]!;
  }
}

export function useFakeMailer(): FakeMailer {
  const fake = new FakeMailer();
  setMailer(fake);
  return fake;
}

/** A crossed boundary must fail as 403 (visible but not allowed) or 404 (not visible at all). */
export function expectDenied(res: { status: number; body: unknown }): void {
  expect([403, 404], JSON.stringify(res.body)).toContain(res.status);
}
