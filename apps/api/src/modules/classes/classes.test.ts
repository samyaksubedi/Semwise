import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../app.js";
import { resetDatabase } from "../../test/db.js";
import { expectDenied, login } from "../../test/helpers.js";
import {
  addClass,
  addStudent,
  addTeacher,
  agents,
  buildWorld,
  type College,
  type User,
} from "../../test/world.js";
import { registerSyllabusGate } from "./classes.service.js";

const app = createApp();
let a: College;
let b: College;
let as: ReturnType<typeof agents>;
let teacher: User;

beforeEach(async () => {
  await resetDatabase();
  ({ a, b } = await buildWorld());
  as = agents(app);
  teacher = await addTeacher(a);
  // The real gate arrives with the syllabus module; here every subject counts as published.
  registerSyllabusGate(async () => true);
});

const create = async (who: User, body: object) => (await as(who)).post("/v1/classes").send(body);

describe("creating classes", () => {
  it("needs a published syllabus", async () => {
    registerSyllabusGate(async () => false);
    const res = await create(a.users.pa1, {
      subjectId: a.subjects.math,
      sectionId: a.sections.a,
      teacherUserIds: [teacher.id],
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("INVALID_STATE");
  });

  it("the Program Admin creates subject x section with its teacher, once", async () => {
    const res = await create(a.users.pa1, {
      subjectId: a.subjects.math,
      sectionId: a.sections.a,
      teacherUserIds: [teacher.id],
    });
    expect(res.status).toBe(201);
    expect(res.body.data).toEqual(
      expect.objectContaining({
        subject: expect.objectContaining({ code: "MTH101" }),
        section: { id: a.sections.a, name: "A" },
        teachers: [expect.objectContaining({ userId: teacher.id, isPrimary: true })],
      }),
    );
    const dup = await create(a.users.pa1, {
      subjectId: a.subjects.math,
      sectionId: a.sections.a,
      teacherUserIds: [teacher.id],
    });
    expect(dup.status).toBe(409);
    const trail = await (await as(a.users.ua)).get("/v1/audit?entityType=Class");
    expect(trail.body.data[0].action).toBe("class.create");
  });

  it("only assigns teachers of this college", async () => {
    const foreign = await addTeacher(b);
    const res = await create(a.users.pa1, {
      subjectId: a.subjects.math,
      sectionId: a.sections.a,
      teacherUserIds: [foreign.id],
    });
    expect(res.status).toBe(400);
    const student = await addStudent(a);
    const notTeacher = await create(a.users.pa1, {
      subjectId: a.subjects.math,
      sectionId: a.sections.a,
      teacherUserIds: [student.id],
    });
    expect(notTeacher.status).toBe(400);
  });

  it("validates the request", async () => {
    expect(
      (
        await create(a.users.pa1, {
          subjectId: a.subjects.math,
          sectionId: a.sections.a,
          teacherUserIds: [],
        })
      ).status,
    ).toBe(400);
    const sem2 = await (
      await as(a.users.pa1)
    )
      .post(`/v1/batches/${a.batch}/semesters`)
      .send({ number: 2 });
    const sec2 = await (
      await as(a.users.pa1)
    )
      .post(`/v1/semesters/${sem2.body.data.id}/sections`)
      .send({ name: "A" });
    const mixed = await create(a.users.pa1, {
      subjectId: a.subjects.math,
      sectionId: sec2.body.data.id,
      teacherUserIds: [teacher.id],
    });
    expect(mixed.status).toBe(400);
  });

  it("only UA and the program's PA create classes", async () => {
    const body = {
      subjectId: a.subjects.math,
      sectionId: a.sections.a,
      teacherUserIds: [teacher.id],
    };
    expectDenied(await create(a.users.pa2, body));
    expectDenied(await create(teacher, body));
    const cr = await addStudent(a, "a", { cr: true });
    expectDenied(await create(cr, body));
    expect((await create(a.users.ua, body)).status).toBe(201);
  });
});

describe("who sees which classes", () => {
  it("teacher: classes taught and the structure above them; CR and student: their section", async () => {
    const mathA = await addClass(a, "math", "a", [teacher.id]);
    const progB = await addClass(a, "prog", "b", [(await addTeacher(a)).id]);
    const cr = await addStudent(a, "a", { cr: true });
    const student = await addStudent(a, "a");

    const t = await login(app, teacher.email);
    expect((await t.get("/v1/classes/mine")).body.data.map((c: { id: string }) => c.id)).toEqual([
      mathA,
    ]);
    expect((await t.get(`/v1/classes/${mathA}`)).status).toBe(200);
    expect((await t.get(`/v1/classes/${progB}`)).status).toBe(404);
    // The structure above the class is visible to its teacher; other sections are not.
    expect((await t.get("/v1/programs")).body.data.map((p: { id: string }) => p.id)).toEqual([
      a.programs.p1,
    ]);
    const sections = await t.get(`/v1/semesters/${a.semester}/sections`);
    expect(sections.body.data.map((s: { id: string }) => s.id)).toEqual([a.sections.a]);
    const classes = await t.get(`/v1/semesters/${a.semester}/classes`);
    expect(classes.body.data.map((c: { id: string }) => c.id)).toEqual([mathA]);

    for (const who of [cr, student]) {
      const ag = await login(app, who.email);
      expect((await ag.get("/v1/classes/mine")).body.data.map((c: { id: string }) => c.id)).toEqual(
        [mathA],
      );
    }
    const admin = await (await as(a.users.pa1)).get(`/v1/semesters/${a.semester}/classes`);
    expect(admin.body.data).toHaveLength(2);
  });
});

describe("changing classes", () => {
  it("reassigning the teacher moves access with it", async () => {
    const mathA = await addClass(a, "math", "a", [teacher.id]);
    const next = await addTeacher(a);
    const pa = await as(a.users.pa1);
    const res = await pa
      .put(`/v1/classes/${mathA}/teachers`)
      .send({ teacherUserIds: [next.id, teacher.id] });
    expect(
      res.body.data.teachers.map((t: { userId: string; isPrimary: boolean }) => [
        t.userId,
        t.isPrimary,
      ]),
    ).toEqual([
      [next.id, true],
      [teacher.id, false],
    ]);
    await pa.put(`/v1/classes/${mathA}/teachers`).send({ teacherUserIds: [next.id] });
    expect((await (await login(app, teacher.email)).get(`/v1/classes/${mathA}`)).status).toBe(404);
    expect((await (await login(app, next.email)).get(`/v1/classes/${mathA}`)).status).toBe(200);
    expectDenied(
      await (
        await login(app, next.email)
      )
        .put(`/v1/classes/${mathA}/teachers`)
        .send({ teacherUserIds: [next.id] }),
    );
  });

  it("archives a class: it leaves the teacher's list", async () => {
    const mathA = await addClass(a, "math", "a", [teacher.id]);
    const res = await (
      await as(a.users.pa1)
    )
      .patch(`/v1/classes/${mathA}`)
      .send({ status: "ARCHIVED" });
    expect(res.body.data.status).toBe("ARCHIVED");
    expect((await (await login(app, teacher.email)).get("/v1/classes/mine")).body.data).toEqual([]);
  });
});

describe("isolation between colleges", () => {
  it("another college's admin gets 404 on every class route", async () => {
    const mathA = await addClass(a, "math", "a", [teacher.id]);
    const uaB = await as(b.users.ua);
    const teacherB = await addTeacher(b);
    const attempts = await Promise.all([
      uaB.get(`/v1/classes/${mathA}`),
      uaB.patch(`/v1/classes/${mathA}`).send({ status: "ARCHIVED" }),
      uaB.put(`/v1/classes/${mathA}/teachers`).send({ teacherUserIds: [teacherB.id] }),
      uaB.get(`/v1/semesters/${a.semester}/classes`),
      uaB.post("/v1/classes").send({
        subjectId: a.subjects.prog,
        sectionId: a.sections.a,
        teacherUserIds: [teacherB.id],
      }),
    ]);
    for (const res of attempts) expect(res.status, JSON.stringify(res.body)).toBe(404);
    // Mixing one college's subject with another's section fails too.
    const mixed = await (
      await as(b.users.ua)
    )
      .post("/v1/classes")
      .send({ subjectId: b.subjects.prog, sectionId: a.sections.a, teacherUserIds: [teacherB.id] });
    expect(mixed.status).toBe(404);
  });
});
