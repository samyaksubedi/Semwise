import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../app.js";
import { withSystem } from "../../common/db/scope.js";
import { setMailer } from "../../lib/mailer.js";
import { resetDatabase } from "../../test/db.js";
import {
  PASSWORD,
  addMembership,
  agent,
  createTenant,
  createUser,
  useFakeMailer,
  type FakeMailer,
} from "../../test/helpers.js";
import { drainQueue } from "../../test/jobs.js";
import { invitationsService } from "./invitations.service.js";

const app = createApp();
let mailer: FakeMailer;
let tenantId: string;

beforeEach(async () => {
  await resetDatabase();
  mailer = useFakeMailer();
  tenantId = (await createTenant({ name: "Everest College" })).id;
});

afterAll(() => setMailer(null));

async function invite(
  email: string,
  role: "UNIVERSITY_ADMIN" | "PROGRAM_ADMIN" = "UNIVERSITY_ADMIN",
) {
  const scope = { tenantId };
  const inv = await invitationsService.createOrRefresh(scope, { email, role }, null);
  await invitationsService.send(scope, inv.id, inv.token);
  await drainQueue("email");
  return inv;
}

const accept = (body: object) => agent(app).post("/v1/auth/invitations/accept").send(body);

describe("invitations", () => {
  it("emails a link whose token works exactly once", async () => {
    await invite("new@x.np");
    const token = mailer.tokenFor("new@x.np");
    expect((await accept({ token, password: "first password here" })).status).toBe(200);
    const again = await accept({ token, password: "first password here" });
    expect(again.status).toBe(400);
    expect(again.body.error.code).toBe("INVALID_TOKEN");
  });

  it("stores only a hash of the token", async () => {
    const { token } = await invite("new@x.np");
    const rows = await withSystem((db) => db.invitation.findMany());
    expect(rows[0]!.tokenHash).not.toBe(token);
    expect(JSON.stringify(rows)).not.toContain(token);
  });

  it("requires a password from someone new", async () => {
    await invite("new@x.np");
    const res = await accept({ token: mailer.tokenFor("new@x.np") });
    expect(res.status).toBe(400);
    expect(res.body.error.details[0].path).toBe("password");
    expect((await accept({ token: mailer.tokenFor("new@x.np"), password: "short" })).status).toBe(
      400,
    );
  });

  it("lets someone with an account in another college join with the account they have", async () => {
    const other = await createTenant();
    const person = await createUser({ email: "known@x.np" });
    await addMembership(person.id, other.id, "TEACHER");
    await invite("known@x.np");

    const preview = await agent(app)
      .post("/v1/auth/invitations/preview")
      .send({ token: mailer.tokenFor("known@x.np") });
    expect(preview.body.data.needsPassword).toBe(false);

    const res = await accept({
      token: mailer.tokenFor("known@x.np"),
      password: "ignored password!!",
    });
    expect(res.body.data.loggedIn).toBe(false);
    // The old password still works and the person now has two colleges.
    const login = await agent(app)
      .post("/v1/auth/login")
      .send({ email: "known@x.np", password: PASSWORD });
    expect(login.body.data.tenants).toHaveLength(2);
  });

  it("re-inviting refreshes the same invite and kills the old link", async () => {
    await invite("new@x.np");
    const first = mailer.tokenFor("new@x.np");
    await invite("new@x.np");
    const second = mailer.tokenFor("new@x.np");
    expect(second).not.toBe(first);
    expect(await withSystem((db) => db.invitation.count())).toBe(1);
    expect((await accept({ token: first, password: "first password here" })).status).toBe(400);
    expect((await accept({ token: second, password: "first password here" })).status).toBe(200);
  });

  it("refuses an expired link, a suspended college and a deactivated account", async () => {
    await invite("late@x.np");
    await withSystem((db) =>
      db.invitation.updateMany({ data: { expiresAt: new Date(Date.now() - 1) } }),
    );
    expect(
      (await accept({ token: mailer.tokenFor("late@x.np"), password: "first password here" }))
        .status,
    ).toBe(400);

    await invite("suspended@x.np");
    await withSystem((db) =>
      db.tenant.update({ where: { id: tenantId }, data: { status: "SUSPENDED" } }),
    );
    expect(
      (await accept({ token: mailer.tokenFor("suspended@x.np"), password: "first password here" }))
        .status,
    ).toBe(400);
    await withSystem((db) =>
      db.tenant.update({ where: { id: tenantId }, data: { status: "ACTIVE" } }),
    );

    await createUser({ email: "gone@x.np", status: "DEACTIVATED" });
    await invite("gone@x.np");
    const gone = await accept({
      token: mailer.tokenFor("gone@x.np"),
      password: "first password here",
    });
    expect(gone.status).toBe(403);
  });

  it("answers the same for a made-up token on preview and accept", async () => {
    const token = "z".repeat(43);
    const p = await agent(app).post("/v1/auth/invitations/preview").send({ token });
    const a = await accept({ token, password: "first password here" });
    expect([p.status, a.status]).toEqual([400, 400]);
    expect(p.body.error.code).toBe("INVALID_TOKEN");
  });
});
