import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../app.js";
import { withSystem } from "../../common/db/scope.js";
import { setMailer } from "../../lib/mailer.js";
import { resetDatabase } from "../../test/db.js";
import {
  agent,
  expectDenied,
  useFakeMailer,
  type Agent,
  type FakeMailer,
} from "../../test/helpers.js";
import { drainQueue } from "../../test/jobs.js";
import { agents, buildWorld, type College } from "../../test/world.js";

const app = createApp();
let a: College;
let b: College;
let as: ReturnType<typeof agents>;
let mailer: FakeMailer;

beforeEach(async () => {
  await resetDatabase();
  mailer = useFakeMailer();
  ({ a, b } = await buildWorld());
  as = agents(app);
});

afterAll(() => setMailer(null));

async function addStudent(admin: Agent, email: string, rollNo: string, sectionId = a.sections.a) {
  const res = await admin
    .post(`/v1/semesters/${a.semester}/students`)
    .send({ email, rollNo, displayName: `Student ${rollNo}`, sectionId });
  if (res.status !== 201) throw new Error(JSON.stringify(res.body));
  return res.body.data as { id: string };
}

async function join(email: string): Promise<Agent> {
  await drainQueue("email");
  const s = agent(app);
  const res = await s
    .post("/v1/auth/invitations/accept")
    .send({ token: mailer.tokenFor(email), password: "student password 123" });
  if (res.status !== 200) throw new Error(JSON.stringify(res.body));
  return s;
}

describe("adding a student and joining", () => {
  it("invites by email, and joining places the student in their college, batch and section", async () => {
    const pa = await as(a.users.pa1);
    const added = await addStudent(pa, "ram@x.np", "BIT-001");
    const pending = await pa.get(`/v1/students/${added.id}`);
    expect(pending.body.data).toEqual(
      expect.objectContaining({ status: "INVITED", rollNo: "BIT-001" }),
    );

    const student = await join("ram@x.np");
    const me = await student.get("/v1/auth/me");
    expect(me.body.data.activeTenantId).toBe(a.tenantId);
    expect(me.body.data.roles).toEqual([{ role: "STUDENT", programId: null, sectionId: null }]);

    // The student now sees their own batch, and nothing of the other program.
    const programs = await student.get("/v1/programs");
    expect(programs.body.data.map((p: { id: string }) => p.id)).toEqual([a.programs.p1]);
    expect((await student.get(`/v1/batches/${a.batch}/tree`)).status).toBe(200);
    expect((await student.get(`/v1/programs/${a.programs.p2}`)).status).toBe(404);

    const joined = await pa.get(`/v1/students/${added.id}`);
    expect(joined.body.data.status).toBe("ACTIVE");
    expect(joined.body.data.enrollments).toEqual([
      expect.objectContaining({ semesterId: a.semester, sectionId: a.sections.a, current: true }),
    ]);
  });

  it("refuses a section from another semester and a taken roll number", async () => {
    const pa = await as(a.users.pa1);
    await addStudent(pa, "ram@x.np", "BIT-001");
    const otherSection = await pa
      .post(`/v1/semesters/${a.semester}/students`)
      .send({ email: "sita@x.np", rollNo: "BIT-002", sectionId: b.sections.a });
    expect(otherSection.status).toBe(400);
    const taken = await pa
      .post(`/v1/semesters/${a.semester}/students`)
      .send({ email: "sita@x.np", rollNo: "bit-001", sectionId: a.sections.a });
    expect(taken.status).toBe(409);
  });
});

describe("CSV import", () => {
  const csv = [
    "Email,Roll No,Name,Section",
    "ram@x.np,BIT-001,Ram Shrestha,A",
    'sita@x.np,BIT-002,"Thapa, Sita",b',
    "not-an-email,BIT-003,Bad,A",
    "hari@x.np,BIT-004,Hari,Z",
    "ram@x.np,BIT-005,Dup Email,A",
  ].join("\n");

  it("previews per-row problems without writing anything", async () => {
    const pa = await as(a.users.pa1);
    const res = await pa.post(`/v1/semesters/${a.semester}/students/import/preview`).send({ csv });
    expect(res.status).toBe(200);
    expect(res.body.data.committed).toBe(false);
    expect(res.body.data.counts).toEqual({ ok: 2, error: 3, skipped: 0 });
    const byLine = Object.fromEntries(
      res.body.data.rows.map((r: { line: number; messages: string[] }) => [
        r.line,
        r.messages.join("; "),
      ]),
    );
    expect(byLine[4]).toMatch(/email/);
    expect(byLine[5]).toMatch(/Unknown section "Z"/);
    expect(byLine[6]).toMatch(/Same email as line 2/);
    expect(await withSystem((db) => db.studentRecord.count())).toBe(0);
  });

  it("imports the valid rows, queues throttled emails and reports progress", async () => {
    const pa = await as(a.users.pa1);
    const res = await pa.post(`/v1/semesters/${a.semester}/students/import`).send({ csv });
    expect(res.status).toBe(201);
    expect(res.body.data.counts.ok).toBe(2);

    const before = await pa.get(`/v1/semesters/${a.semester}/students/invite-progress`);
    expect(before.body.data).toEqual(
      expect.objectContaining({ total: 2, queued: 2, sent: 0, failed: 0, accepted: 0 }),
    );
    await drainQueue("email");
    const after = await pa.get(`/v1/semesters/${a.semester}/students/invite-progress`);
    expect(after.body.data).toEqual(expect.objectContaining({ queued: 0, sent: 2 }));
    expect(after.body.data.today).toEqual({ sent: 2, cap: 400 });

    const list = await pa.get(`/v1/semesters/${a.semester}/students`);
    expect(
      list.body.data.map((s: { rollNo: string; sectionId: string }) => [s.rollNo, s.sectionId]),
    ).toEqual([
      ["BIT-001", a.sections.a],
      ["BIT-002", a.sections.b],
    ]);
    // Importing the same file again adds nobody twice.
    const again = await pa.post(`/v1/semesters/${a.semester}/students/import`).send({ csv });
    expect(again.body.data.counts).toEqual({ ok: 0, error: 3, skipped: 2 });
  });

  it("needs the email, roll number and section columns", async () => {
    const pa = await as(a.users.pa1);
    const res = await pa
      .post(`/v1/semesters/${a.semester}/students/import/preview`)
      .send({ csv: "name,email\nRam,ram@x.np" });
    expect(res.status).toBe(400);
  });
});

describe("corrections: resend, fix email, revoke, deactivate", () => {
  it("resends with a fresh link after the cooldown; the old link stops working", async () => {
    const pa = await as(a.users.pa1);
    const s = await addStudent(pa, "ram@x.np", "BIT-001");
    await drainQueue("email");
    const first = mailer.tokenFor("ram@x.np");

    const tooSoon = await pa.post(`/v1/students/${s.id}/resend-invite`);
    expect(tooSoon.status).toBe(429);

    await withSystem((db) =>
      db.invitation.updateMany({ data: { lastSentAt: new Date(Date.now() - 11 * 60_000) } }),
    );
    expect((await pa.post(`/v1/students/${s.id}/resend-invite`)).status).toBe(200);
    await drainQueue("email");
    const second = mailer.tokenFor("ram@x.np");
    expect(second).not.toBe(first);
    const old = await agent(app)
      .post("/v1/auth/invitations/accept")
      .send({ token: first, password: "student password 123" });
    expect(old.status).toBe(400);
  });

  it("fixes a wrong address before the student joins, not after", async () => {
    const pa = await as(a.users.pa1);
    const s = await addStudent(pa, "rma@x.np", "BIT-001");
    await drainQueue("email");
    const wrongToken = mailer.tokenFor("rma@x.np");
    const fixed = await pa.patch(`/v1/students/${s.id}`).send({ email: "ram@x.np" });
    expect(fixed.body.data.email).toBe("ram@x.np");
    const wrong = await agent(app)
      .post("/v1/auth/invitations/accept")
      .send({ token: wrongToken, password: "student password 123" });
    expect(wrong.status).toBe(400);
    await join("ram@x.np");
    const afterJoin = await pa.patch(`/v1/students/${s.id}`).send({ email: "other@x.np" });
    expect(afterJoin.status).toBe(409);
    expect((await pa.patch(`/v1/students/${s.id}`).send({ rollNo: "BIT-101" })).status).toBe(200);
  });

  it("revoking an invite kills its link", async () => {
    const pa = await as(a.users.pa1);
    const s = await addStudent(pa, "ram@x.np", "BIT-001");
    await drainQueue("email");
    const token = mailer.tokenFor("ram@x.np");
    expect((await pa.post(`/v1/students/${s.id}/revoke-invite`)).body.data.status).toBe(
      "DEACTIVATED",
    );
    const res = await agent(app)
      .post("/v1/auth/invitations/accept")
      .send({ token, password: "student password 123" });
    expect(res.status).toBe(400);
  });

  it("a deactivated student loses access but keeps their history and account", async () => {
    const pa = await as(a.users.pa1);
    const s = await addStudent(pa, "ram@x.np", "BIT-001");
    const student = await join("ram@x.np");
    const res = await pa.post(`/v1/students/${s.id}/deactivate`);
    expect(res.body.data.status).toBe("DEACTIVATED");
    expect(res.body.data.enrollments[0].status).toBe("REMOVED");
    expect((await student.get("/v1/programs")).status).toBe(403);
    expect((await student.get("/v1/auth/me")).status).toBe(200);
  });
});

describe("sections over semesters", () => {
  it("moves a student within a semester and places them in the next one, keeping history", async () => {
    const pa = await as(a.users.pa1);
    const s = await addStudent(pa, "ram@x.np", "BIT-001");
    const student = await join("ram@x.np");

    const moved = await pa
      .put(`/v1/students/${s.id}/enrollments/${a.semester}`)
      .send({ sectionId: a.sections.b });
    expect(moved.body.data.enrollments).toEqual([
      expect.objectContaining({ semesterId: a.semester, sectionId: a.sections.b }),
    ]);

    const sem2 = await pa.post(`/v1/batches/${a.batch}/semesters`).send({ number: 2 });
    const secA2 = await pa.post(`/v1/semesters/${sem2.body.data.id}/sections`).send({ name: "A" });
    const bulk = await pa
      .post(`/v1/semesters/${sem2.body.data.id}/enrollments`)
      .send({ assignments: [{ studentId: s.id, sectionId: secA2.body.data.id }] });
    expect(bulk.body.data).toEqual({ placed: 1 });
    await pa.patch(`/v1/semesters/${sem2.body.data.id}`).send({ status: "ACTIVE" });

    const detail = await pa.get(`/v1/students/${s.id}`);
    expect(
      detail.body.data.enrollments.map((e: { semesterNumber: number; current: boolean }) => [
        e.semesterNumber,
        e.current,
      ]),
    ).toEqual([
      [1, false],
      [2, true],
    ]);
    // The student still reads the batch (both semesters belong to it).
    expect((await student.get(`/v1/semesters/${a.semester}/sections`)).status).toBe(200);
    const trail = await (await as(a.users.ua)).get(`/v1/audit?entityId=${s.id}`);
    expect(trail.body.data.map((e: { action: string }) => e.action)).toEqual(
      expect.arrayContaining(["student.invite", "enrollment.move", "enrollment.create"]),
    );
  });

  it("refuses a section of another batch's semester", async () => {
    const pa = await as(a.users.pa1);
    const s = await addStudent(pa, "ram@x.np", "BIT-001");
    const other = await pa
      .post(`/v1/programs/${a.programs.p1}/batches`)
      .send({ name: "BIT 2027", intakeYear: 2027 });
    const sem = await pa.post(`/v1/batches/${other.body.data.id}/semesters`).send({ number: 1 });
    const sec = await pa.post(`/v1/semesters/${sem.body.data.id}/sections`).send({ name: "A" });
    const res = await pa
      .put(`/v1/students/${s.id}/enrollments/${sem.body.data.id}`)
      .send({ sectionId: sec.body.data.id });
    expect(res.status).toBe(400);
  });
});

describe("Class Representatives", () => {
  it("one joined student of the section; replacing needs to be explicit; moving away ends it", async () => {
    const pa = await as(a.users.pa1);
    const ram = await addStudent(pa, "ram@x.np", "BIT-001");
    const sita = await addStudent(pa, "sita@x.np", "BIT-002");
    const outsider = await addStudent(pa, "hari@x.np", "BIT-003", a.sections.b);

    const notJoined = await pa.post(`/v1/sections/${a.sections.a}/cr`).send({ studentId: ram.id });
    expect(notJoined.status).toBe(409);

    const ramAgent = await join("ram@x.np");
    await join("sita@x.np");
    await join("hari@x.np");
    expect(
      (await pa.post(`/v1/sections/${a.sections.a}/cr`).send({ studentId: outsider.id })).status,
    ).toBe(409);
    expect(
      (await pa.post(`/v1/sections/${a.sections.a}/cr`).send({ studentId: ram.id })).status,
    ).toBe(200);
    const roles = (await ramAgent.get("/v1/auth/me")).body.data.roles;
    expect(roles).toContainEqual({ role: "CR", programId: null, sectionId: a.sections.a });

    const second = await pa.post(`/v1/sections/${a.sections.a}/cr`).send({ studentId: sita.id });
    expect(second.status).toBe(409);
    const replaced = await pa
      .post(`/v1/sections/${a.sections.a}/cr`)
      .send({ studentId: sita.id, replace: true });
    expect(replaced.status).toBe(200);
    expect((await ramAgent.get("/v1/auth/me")).body.data.roles).not.toContainEqual(
      expect.objectContaining({ role: "CR" }),
    );

    // Sita moves to section B: she is no longer A's CR.
    await pa
      .put(`/v1/students/${sita.id}/enrollments/${a.semester}`)
      .send({ sectionId: a.sections.b });
    const list = await pa.get(`/v1/semesters/${a.semester}/students`);
    expect(list.body.data.filter((s: { isCr: boolean }) => s.isCr)).toEqual([]);
    expect((await pa.delete(`/v1/sections/${a.sections.a}/cr`)).status).toBe(404);
  });
});

describe("teachers", () => {
  it("are invited by an admin of a program, join with the TEACHER role and are listed", async () => {
    const pa = await as(a.users.pa1);
    expect(
      (await pa.post("/v1/teachers/invite").send({ email: "t@x.np", programId: a.programs.p1 }))
        .status,
    ).toBe(202);
    expectDenied(
      await pa.post("/v1/teachers/invite").send({ email: "u@x.np", programId: a.programs.p2 }),
    );
    let list = await pa.get("/v1/teachers");
    expect(list.body.data).toEqual([
      expect.objectContaining({ email: "t@x.np", status: "INVITED" }),
    ]);
    const teacher = await join("t@x.np");
    expect((await teacher.get("/v1/auth/me")).body.data.roles).toEqual([
      { role: "TEACHER", programId: null, sectionId: null },
    ]);
    list = await pa.get("/v1/teachers");
    expect(list.body.data).toEqual([
      expect.objectContaining({ email: "t@x.np", status: "ACTIVE" }),
    ]);
    expectDenied(await teacher.get("/v1/teachers"));
  });
});

describe("permissions and isolation", () => {
  it("only admins of the program manage its students", async () => {
    const pa1 = await as(a.users.pa1);
    const s = await addStudent(pa1, "ram@x.np", "BIT-001");
    const student = await join("ram@x.np");
    const pa2 = await as(a.users.pa2);
    for (const who of [pa2, student]) {
      expectDenied(await who.get(`/v1/semesters/${a.semester}/students`));
      expectDenied(await who.get(`/v1/students/${s.id}`));
      expectDenied(await who.post(`/v1/students/${s.id}/deactivate`));
      expectDenied(await who.post(`/v1/sections/${a.sections.a}/cr`).send({ studentId: s.id }));
      expectDenied(
        await who
          .post(`/v1/semesters/${a.semester}/students`)
          .send({ email: "z@x.np", rollNo: "Z1", sectionId: a.sections.a }),
      );
    }
    expect((await (await as(a.users.ua)).get(`/v1/students/${s.id}`)).status).toBe(200);
  });

  it("another college's admin gets 404 for every student route", async () => {
    const pa1 = await as(a.users.pa1);
    const s = await addStudent(pa1, "ram@x.np", "BIT-001");
    const uaB = await as(b.users.ua);
    const attempts = await Promise.all([
      uaB.get(`/v1/semesters/${a.semester}/students`),
      uaB
        .post(`/v1/semesters/${a.semester}/students`)
        .send({ email: "z@x.np", rollNo: "Z1", sectionId: a.sections.a }),
      uaB
        .post(`/v1/semesters/${a.semester}/students/import/preview`)
        .send({ csv: "email,roll,section\nz@x.np,Z1,A" }),
      uaB.get(`/v1/semesters/${a.semester}/students/invite-progress`),
      uaB.get(`/v1/students/${s.id}`),
      uaB.patch(`/v1/students/${s.id}`).send({ displayName: "X" }),
      uaB.post(`/v1/students/${s.id}/resend-invite`),
      uaB.post(`/v1/students/${s.id}/revoke-invite`),
      uaB.post(`/v1/students/${s.id}/deactivate`),
      uaB.put(`/v1/students/${s.id}/enrollments/${a.semester}`).send({ sectionId: a.sections.b }),
      uaB.post(`/v1/sections/${a.sections.a}/cr`).send({ studentId: s.id }),
    ]);
    for (const res of attempts) expect(res.status, JSON.stringify(res.body)).toBe(404);
    // ... and cannot place their own student into this college's section.
    const own = await (
      await as(b.users.pa1)
    )
      .post(`/v1/semesters/${b.semester}/students`)
      .send({ email: "b@x.np", rollNo: "B1", sectionId: a.sections.a });
    expect(own.status).toBe(400);
  });

  it("a student of one section cannot read another student's record", async () => {
    const pa1 = await as(a.users.pa1);
    await addStudent(pa1, "ram@x.np", "BIT-001");
    const sita = await addStudent(pa1, "sita@x.np", "BIT-002");
    const ram = await join("ram@x.np");
    expect((await ram.get(`/v1/students/${sita.id}`)).status).toBe(404);
  });
});
