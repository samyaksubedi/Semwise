import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../app.js";
import { withSystem } from "../../common/db/scope.js";
import { resetDatabase } from "../../test/db.js";
import { addMembership, createUser, expectDenied, login } from "../../test/helpers.js";
import { agents, buildWorld, type College } from "../../test/world.js";

const app = createApp();
let a: College;
let b: College;
let as: ReturnType<typeof agents>;

beforeEach(async () => {
  await resetDatabase();
  ({ a, b } = await buildWorld());
  as = agents(app);
});

describe("academic structure: who may change it", () => {
  it("only the University Admin creates programs", async () => {
    const ok = await (await as(a.users.ua)).post("/v1/programs").send({ name: "BBA", code: "BBA" });
    expect(ok.status).toBe(201);
    expectDenied(
      await (await as(a.users.pa1)).post("/v1/programs").send({ name: "BBS", code: "BBS" }),
    );
  });

  it("a Program Admin manages their own program only", async () => {
    const pa1 = await as(a.users.pa1);
    expect(
      (
        await pa1
          .post(`/v1/programs/${a.programs.p1}/batches`)
          .send({ name: "BIT 2027", intakeYear: 2027 })
      ).status,
    ).toBe(201);
    expectDenied(
      await pa1
        .post(`/v1/programs/${a.programs.p2}/batches`)
        .send({ name: "BCA 2027", intakeYear: 2027 }),
    );
    const pa2 = await as(a.users.pa2);
    expectDenied(await pa2.post(`/v1/semesters/${a.semester}/sections`).send({ name: "C" }));
    expectDenied(await pa2.patch(`/v1/subjects/${a.subjects.math}`).send({ name: "Renamed" }));
    expectDenied(await pa2.get(`/v1/batches/${a.batch}/tree`));
  });

  it("only the University Admin assigns Program Admins", async () => {
    const pa1 = await as(a.users.pa1);
    expectDenied(await pa1.post(`/v1/programs/${a.programs.p1}/admins`).send({ email: "x@y.np" }));
    const ua = await as(a.users.ua);
    const admins = await ua.get(`/v1/programs/${a.programs.p1}/admins`);
    expect(admins.body.data.map((x: { userId: string }) => x.userId)).toEqual([a.users.pa1.id]);
    expect((await ua.delete(`/v1/programs/${a.programs.p1}/admins/${a.users.pa1.id}`)).status).toBe(
      204,
    );
    // The removed admin loses access at once.
    expectDenied(await pa1.post(`/v1/semesters/${a.semester}/sections`).send({ name: "C" }));
  });

  it("teachers and students cannot change the structure", async () => {
    const teacher = await createUser();
    const student = await createUser();
    await addMembership(teacher.id, a.tenantId, "TEACHER");
    await addMembership(student.id, a.tenantId, "STUDENT");
    for (const u of [teacher, student]) {
      const ag = await login(app, u.email);
      expectDenied(await ag.post("/v1/programs").send({ name: "X", code: "X" }));
      expectDenied(
        await ag.post(`/v1/semesters/${a.semester}/subjects`).send({ name: "X", code: "X" }),
      );
    }
  });
});

describe("academic structure: who may see it", () => {
  it("lists only the programs a person may see", async () => {
    const ua = await (await as(a.users.ua)).get("/v1/programs");
    expect(ua.body.data.map((p: { code: string }) => p.code)).toEqual(["BCA", "BIT"]);
    const pa1 = await (await as(a.users.pa1)).get("/v1/programs");
    expect(pa1.body.data.map((p: { code: string }) => p.code)).toEqual(["BIT"]);
    // No classes or enrollment yet: a teacher sees nothing.
    const teacher = await createUser();
    await addMembership(teacher.id, a.tenantId, "TEACHER");
    const t = await (await login(app, teacher.email)).get("/v1/programs");
    expect(t.body.data).toEqual([]);
  });

  it("returns 404, not 403, for a program the person cannot see at all", async () => {
    const pa2 = await as(a.users.pa2);
    const res = await pa2.get(`/v1/programs/${a.programs.p1}`);
    expect(res.status).toBe(404);
  });
});

describe("academic structure: isolation between colleges", () => {
  it("another college's admin cannot read or change anything here", async () => {
    const uaB = await as(b.users.ua);
    const attempts = [
      uaB.get(`/v1/programs/${a.programs.p1}`),
      uaB.patch(`/v1/programs/${a.programs.p1}`).send({ name: "Taken" }),
      uaB.get(`/v1/programs/${a.programs.p1}/batches`),
      uaB.post(`/v1/programs/${a.programs.p1}/batches`).send({ name: "Mine", intakeYear: 2026 }),
      uaB.post(`/v1/programs/${a.programs.p1}/admins`).send({ email: "x@y.np" }),
      uaB.get(`/v1/batches/${a.batch}/tree`),
      uaB.patch(`/v1/batches/${a.batch}`).send({ name: "Mine" }),
      uaB.post(`/v1/batches/${a.batch}/semesters`).send({ number: 2 }),
      uaB.patch(`/v1/semesters/${a.semester}`).send({ status: "COMPLETED" }),
      uaB.get(`/v1/semesters/${a.semester}/sections`),
      uaB.post(`/v1/semesters/${a.semester}/subjects`).send({ name: "X", code: "X" }),
      uaB.patch(`/v1/sections/${a.sections.a}`).send({ name: "Z" }),
      uaB.get(`/v1/subjects/${a.subjects.math}`),
      uaB.patch(`/v1/subjects/${a.subjects.math}`).send({ name: "X" }),
    ];
    for (const res of await Promise.all(attempts)) expect(res.status).toBe(404);
    const programs = await uaB.get("/v1/programs");
    expect(programs.body.data.every((p: { id: string }) => p.id !== a.programs.p1)).toBe(true);
  });

  it("the database refuses a child row that points into another college", async () => {
    await expect(
      withSystem((db) =>
        db.batch.create({
          data: {
            tenantId: b.tenantId,
            programId: a.programs.p1,
            name: "Smuggled",
            intakeYear: 2026,
          },
        }),
      ),
    ).rejects.toThrow();
    // ... or whose denormalised path disagrees with its parent.
    await expect(
      withSystem((db) =>
        db.section.create({
          data: {
            tenantId: a.tenantId,
            programId: a.programs.p2,
            batchId: a.batch,
            semesterId: a.semester,
            name: "Z",
          },
        }),
      ),
    ).rejects.toThrow();
  });
});

describe("academic structure: rules and validation", () => {
  it("refuses duplicate codes and names with 409", async () => {
    const ua = await as(a.users.ua);
    const dup = await ua.post("/v1/programs").send({ name: "Again", code: "bit" });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe("ALREADY_EXISTS");
    expect((await ua.post(`/v1/semesters/${a.semester}/sections`).send({ name: "A" })).status).toBe(
      409,
    );
    expect(
      (await ua.post(`/v1/semesters/${a.semester}/subjects`).send({ name: "X", code: "mth101" }))
        .status,
    ).toBe(409);
    // The same section name is fine in another college.
    expect(
      (
        await (
          await as(b.users.ua)
        )
          .post(`/v1/semesters/${b.semester}/sections`)
          .send({ name: "C" })
      ).status,
    ).toBe(201);
  });

  it("validates input", async () => {
    const ua = await as(a.users.ua);
    expect((await ua.post("/v1/programs").send({ name: "", code: "!" })).status).toBe(400);
    const dates = await ua
      .post(`/v1/batches/${a.batch}/semesters`)
      .send({ number: 2, startDate: "2026-08-01", endDate: "2026-07-01" });
    expect(dates.status).toBe(400);
    expect(dates.body.error.details[0].path).toBe("endDate");
    expect((await ua.patch(`/v1/subjects/${a.subjects.math}`).send({})).status).toBe(400);
    expect(
      (await ua.post(`/v1/programs/${a.programs.p1}/batches`).send({ name: "B", intakeYear: 1800 }))
        .status,
    ).toBe(400);
  });

  it("activating the next semester completes the current one", async () => {
    const pa1 = await as(a.users.pa1);
    const next = await pa1.post(`/v1/batches/${a.batch}/semesters`).send({ number: 2 });
    expect(next.body.data.status).toBe("UPCOMING");
    const activated = await pa1
      .patch(`/v1/semesters/${next.body.data.id}`)
      .send({ status: "ACTIVE" });
    expect(activated.body.data.status).toBe("ACTIVE");
    const all = await pa1.get(`/v1/batches/${a.batch}/semesters`);
    expect(
      all.body.data.map((s: { number: number; status: string }) => [s.number, s.status]),
    ).toEqual([
      [1, "COMPLETED"],
      [2, "ACTIVE"],
    ]);
  });

  it("records before and after in the audit log", async () => {
    const pa1 = await as(a.users.pa1);
    await pa1.patch(`/v1/subjects/${a.subjects.math}`).send({ name: "Engineering Mathematics" });
    const trail = await (await as(a.users.ua)).get("/v1/audit?entityType=Subject");
    expect(trail.body.data[0]).toEqual(
      expect.objectContaining({
        action: "subject.update",
        programId: a.programs.p1,
        actorId: a.users.pa1.id,
        before: expect.objectContaining({ name: "Mathematics I" }),
        after: { name: "Engineering Mathematics" },
      }),
    );
    // A Program Admin reads their own program's trail, not another program's.
    const pa2Trail = await (await as(a.users.pa2)).get(`/v1/audit?programId=${a.programs.p1}`);
    expect(pa2Trail.status).toBe(403);
    const pa1Trail = await pa1.get("/v1/audit");
    expect(pa1Trail.body.data.length).toBeGreaterThan(0);
  });
});
