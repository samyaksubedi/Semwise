import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../app.js";
import { withSystem } from "../../common/db/scope.js";
import { setMailer } from "../../lib/mailer.js";
import { resetDatabase } from "../../test/db.js";
import {
  addMembership,
  agent,
  createUser,
  expectDenied,
  login,
  useFakeMailer,
  type FakeMailer,
} from "../../test/helpers.js";
import { drainQueue } from "../../test/jobs.js";

const app = createApp();
let mailer: FakeMailer;
let superAdmin: { id: string; email: string };

beforeEach(async () => {
  await resetDatabase();
  mailer = useFakeMailer();
  superAdmin = await createUser();
  await addMembership(superAdmin.id, null, "SUPER_ADMIN");
});

afterAll(() => setMailer(null));

async function acceptInvite(email: string, password = "a strong first password") {
  await drainQueue("email");
  const token = mailer.tokenFor(email);
  const a = agent(app);
  const res = await a.post("/v1/auth/invitations/accept").send({ token, password });
  return { a, res, token };
}

describe("provisioning a college, end to end", () => {
  it("Super Admin creates a college; its admins set up programs, batches, semesters and sections", async () => {
    const sa = await login(app, superAdmin.email);
    const created = await sa.post("/v1/platform/tenants").send({
      name: "St. Xavier's College",
      timezone: "Asia/Kathmandu",
      adminEmail: "Head@Xavier.edu.np",
      adminName: "Head Admin",
    });
    expect(created.status).toBe(201);
    expect(created.body.data).toEqual(
      expect.objectContaining({
        slug: "st-xaviers-college",
        status: "ACTIVE",
        pendingAdminInvites: 1,
      }),
    );
    const tenantId = created.body.data.id;

    // The University Admin accepts the emailed invite and is signed in straight away.
    const preview = await agent(app)
      .post("/v1/auth/invitations/preview")
      .send({ token: (await drainQueue("email"), mailer.tokenFor("head@xavier.edu.np")) });
    expect(preview.body.data).toEqual(
      expect.objectContaining({
        collegeName: "St. Xavier's College",
        role: "UNIVERSITY_ADMIN",
        needsPassword: true,
      }),
    );
    const { a: ua, res: accepted } = await acceptInvite("head@xavier.edu.np");
    expect(accepted.status).toBe(200);
    expect(accepted.body.data).toEqual({ loggedIn: true, tenantId });
    const me = await ua.get("/v1/auth/me");
    expect(me.body.data.activeTenantId).toBe(tenantId);
    expect(me.body.data.roles).toEqual([
      { role: "UNIVERSITY_ADMIN", programId: null, sectionId: null },
    ]);

    // University Admin: a program and its Program Admin.
    const program = await ua.post("/v1/programs").send({ name: "Bachelor of IT", code: "bit" });
    expect(program.status).toBe(201);
    expect(program.body.data.code).toBe("BIT");
    const invited = await ua
      .post(`/v1/programs/${program.body.data.id}/admins`)
      .send({ email: "pa@xavier.edu.np", displayName: "Program Head" });
    expect(invited.status).toBe(202);
    const { a: pa } = await acceptInvite("pa@xavier.edu.np");

    // Program Admin: batch, semester, sections, subject.
    const batch = await pa
      .post(`/v1/programs/${program.body.data.id}/batches`)
      .send({ name: "BIT 2026", intakeYear: 2026 });
    expect(batch.status).toBe(201);
    const semester = await pa
      .post(`/v1/batches/${batch.body.data.id}/semesters`)
      .send({ number: 1, startDate: "2026-01-05", endDate: "2026-06-20", status: "ACTIVE" });
    expect(semester.status).toBe(201);
    const semesterId = semester.body.data.id;
    for (const name of ["A", "B"]) {
      expect((await pa.post(`/v1/semesters/${semesterId}/sections`).send({ name })).status).toBe(
        201,
      );
    }
    const subject = await pa
      .post(`/v1/semesters/${semesterId}/subjects`)
      .send({ name: "Programming in C", code: "csc 101", credits: 3 });
    expect(subject.status).toBe(201);

    const tree = await pa.get(`/v1/batches/${batch.body.data.id}/tree`);
    expect(tree.body.data.semesters).toHaveLength(1);
    expect(tree.body.data.semesters[0].sections.map((s: { name: string }) => s.name)).toEqual([
      "A",
      "B",
    ]);
    expect(tree.body.data.semesters[0].subjects[0]).toEqual(
      expect.objectContaining({ code: "CSC 101", credits: 3 }),
    );

    // Everything is audit-logged in the college's trail.
    const trail = await ua.get("/v1/audit?limit=100");
    expect(trail.body.data.map((e: { action: string }) => e.action)).toEqual(
      expect.arrayContaining([
        "invitation.accept",
        "program.create",
        "programAdmin.invite",
        "batch.create",
        "semester.create",
        "section.create",
        "subject.create",
      ]),
    );
    // The college creation itself is a platform action.
    const platformTrail = await sa.get("/v1/platform/audit");
    expect(platformTrail.body.data.map((e: { action: string }) => e.action)).toContain(
      "tenant.create",
    );
  });
});

describe("platform", () => {
  it("validates the timezone and refuses a duplicate slug", async () => {
    const sa = await login(app, superAdmin.email);
    const bad = await sa
      .post("/v1/platform/tenants")
      .send({ name: "X", timezone: "Mars/Olympus", adminEmail: "a@x.np" });
    expect(bad.status).toBe(400);
    const body = { name: "Everest College", timezone: "Asia/Kathmandu", adminEmail: "a@x.np" };
    expect((await sa.post("/v1/platform/tenants").send(body)).status).toBe(201);
    const again = await sa.post("/v1/platform/tenants").send(body);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("ALREADY_EXISTS");
  });

  it("lists colleges with their admins but no college content", async () => {
    const sa = await login(app, superAdmin.email);
    await sa
      .post("/v1/platform/tenants")
      .send({ name: "Everest College", timezone: "Asia/Kathmandu", adminEmail: "a@x.np" });
    await acceptInvite("a@x.np");
    const list = await sa.get("/v1/platform/tenants");
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].universityAdmins).toEqual([
      expect.objectContaining({ email: "a@x.np", status: "ACTIVE" }),
    ]);
    expect(list.body.data[0].pendingAdminInvites).toBe(0);
    expect(Object.keys(list.body.data[0]).sort()).toEqual(
      [
        "createdAt",
        "id",
        "name",
        "pendingAdminInvites",
        "slug",
        "status",
        "timezone",
        "universityAdmins",
      ].sort(),
    );
  });

  it("suspending a college locks its users out; reactivating lets them back", async () => {
    const sa = await login(app, superAdmin.email);
    const created = await sa
      .post("/v1/platform/tenants")
      .send({ name: "Everest College", timezone: "Asia/Kathmandu", adminEmail: "a@x.np" });
    const { a: ua } = await acceptInvite("a@x.np");
    expect((await ua.get("/v1/college")).status).toBe(200);

    const suspended = await sa
      .patch(`/v1/platform/tenants/${created.body.data.id}`)
      .send({ status: "SUSPENDED" });
    expect(suspended.body.data.status).toBe("SUSPENDED");
    expect((await ua.get("/v1/college")).status).toBe(403);

    await sa.patch(`/v1/platform/tenants/${created.body.data.id}`).send({ status: "ACTIVE" });
    expect((await ua.get("/v1/college")).status).toBe(200);
    const trail = await sa.get("/v1/platform/audit");
    expect(trail.body.data.map((e: { action: string }) => e.action)).toEqual(
      expect.arrayContaining(["tenant.suspend", "tenant.reactivate"]),
    );
  });

  it("only the Super Admin reaches platform routes", async () => {
    const sa = await login(app, superAdmin.email);
    await sa
      .post("/v1/platform/tenants")
      .send({ name: "Everest College", timezone: "Asia/Kathmandu", adminEmail: "a@x.np" });
    const { a: ua } = await acceptInvite("a@x.np");
    expectDenied(await ua.get("/v1/platform/tenants"));
    expectDenied(
      await ua
        .post("/v1/platform/tenants")
        .send({ name: "Other", timezone: "Asia/Kathmandu", adminEmail: "b@x.np" }),
    );
    expect((await agent(app).get("/v1/platform/tenants")).status).toBe(401);
  });

  it("invites a replacement University Admin", async () => {
    const sa = await login(app, superAdmin.email);
    const created = await sa
      .post("/v1/platform/tenants")
      .send({ name: "Everest College", timezone: "Asia/Kathmandu", adminEmail: "a@x.np" });
    const res = await sa
      .post(`/v1/platform/tenants/${created.body.data.id}/university-admins`)
      .send({ email: "second@x.np" });
    expect(res.status).toBe(201);
    expect(res.body.data.pendingAdminInvites).toBe(2);
  });
});

describe("college settings", () => {
  it("the University Admin renames the college and changes its timezone; others cannot", async () => {
    const sa = await login(app, superAdmin.email);
    const created = await sa
      .post("/v1/platform/tenants")
      .send({ name: "Everest College", timezone: "Asia/Kathmandu", adminEmail: "a@x.np" });
    const tenantId = created.body.data.id;
    const { a: ua } = await acceptInvite("a@x.np");

    const res = await ua
      .patch("/v1/college")
      .send({ name: "Everest Engineering College", timezone: "Asia/Kolkata" });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(
      expect.objectContaining({ name: "Everest Engineering College", timezone: "Asia/Kolkata" }),
    );
    expect((await ua.patch("/v1/college").send({})).status).toBe(400);

    const teacher = await createUser();
    await addMembership(teacher.id, tenantId, "TEACHER");
    const t = await login(app, teacher.email);
    expect((await t.get("/v1/college")).body.data.timezone).toBe("Asia/Kolkata");
    expectDenied(await t.patch("/v1/college").send({ name: "Mine now" }));
    const stored = await withSystem((db) => db.tenant.findUnique({ where: { id: tenantId } }));
    expect(stored?.name).toBe("Everest Engineering College");
  });
});
