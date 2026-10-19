import type { Express } from "express";
import { withSystem } from "../common/db/scope.js";
import { addMembership, createTenant, createUser, login, type Agent } from "./helpers.js";

/**
 * The isolation test kit's fixture: two colleges with the same shape, so every test can try the
 * same request across a boundary (another college, program, section or student) and expect it
 * to fail. Later features extend a college with classes, entries and so on.
 */
export interface College {
  tenantId: string;
  name: string;
  programs: { p1: string; p2: string };
  batch: string;
  semester: string;
  sections: { a: string; b: string };
  subjects: { math: string; prog: string };
  users: {
    ua: User;
    pa1: User;
    pa2: User;
  };
}

export interface User {
  id: string;
  email: string;
}

async function user(): Promise<User> {
  const u = await createUser();
  return { id: u.id, email: u.email };
}

export async function buildCollege(label: string): Promise<College> {
  const tenant = await createTenant({ name: `College ${label}` });
  const tenantId = tenant.id;
  const [ua, pa1, pa2] = await Promise.all([user(), user(), user()]);

  const ids = await withSystem(async (db) => {
    const p1 = await db.program.create({ data: { tenantId, name: "BIT", code: "BIT" } });
    const p2 = await db.program.create({ data: { tenantId, name: "BCA", code: "BCA" } });
    const batch = await db.batch.create({
      data: { tenantId, programId: p1.id, name: "BIT 2026", intakeYear: 2026 },
    });
    const path = { tenantId, programId: p1.id, batchId: batch.id };
    const semester = await db.semester.create({ data: { ...path, number: 1, status: "ACTIVE" } });
    const sem = { ...path, semesterId: semester.id };
    const a = await db.section.create({ data: { ...sem, name: "A" } });
    const b = await db.section.create({ data: { ...sem, name: "B" } });
    const math = await db.subject.create({
      data: { ...sem, name: "Mathematics I", code: "MTH101" },
    });
    const prog = await db.subject.create({
      data: { ...sem, name: "Programming in C", code: "CSC102" },
    });
    return {
      p1: p1.id,
      p2: p2.id,
      batch: batch.id,
      semester: semester.id,
      a: a.id,
      b: b.id,
      math: math.id,
      prog: prog.id,
    };
  });

  await addMembership(ua.id, tenantId, "UNIVERSITY_ADMIN");
  await addMembership(pa1.id, tenantId, "PROGRAM_ADMIN", { programId: ids.p1 });
  await addMembership(pa2.id, tenantId, "PROGRAM_ADMIN", { programId: ids.p2 });

  return {
    tenantId,
    name: tenant.name,
    programs: { p1: ids.p1, p2: ids.p2 },
    batch: ids.batch,
    semester: ids.semester,
    sections: { a: ids.a, b: ids.b },
    subjects: { math: ids.math, prog: ids.prog },
    users: { ua, pa1, pa2 },
  };
}

/** Two colleges, A and B, built the same way. */
export async function buildWorld() {
  const [a, b] = [await buildCollege("A"), await buildCollege("B")];
  return { a, b };
}

/** Logged-in agents, cached per user for the duration of one test. */
export function agents(app: Express) {
  const cache = new Map<string, Promise<Agent>>();
  return (u: User) => {
    let agent = cache.get(u.id);
    if (!agent) {
      agent = login(app, u.email);
      cache.set(u.id, agent);
    }
    return agent;
  };
}

/** A teacher of the college (TEACHER role, no classes yet). */
export async function addTeacher(college: College): Promise<User> {
  const u = await user();
  await addMembership(u.id, college.tenantId, "TEACHER");
  return u;
}

/** A joined student placed in a section of the college's active semester. */
export async function addStudent(
  college: College,
  section: keyof College["sections"] = "a",
  options: { cr?: boolean } = {},
): Promise<User & { studentId: string }> {
  const u = await user();
  const tenantId = college.tenantId;
  const sectionId = college.sections[section];
  const record = await withSystem(async (db) => {
    const r = await db.studentRecord.create({
      data: {
        tenantId,
        programId: college.programs.p1,
        batchId: college.batch,
        userId: u.id,
        email: u.email,
        rollNo: `R-${u.id.slice(-8).toUpperCase()}`,
        status: "ACTIVE",
      },
    });
    await db.enrollment.create({
      data: {
        tenantId,
        programId: college.programs.p1,
        batchId: college.batch,
        semesterId: college.semester,
        sectionId,
        studentRecordId: r.id,
      },
    });
    return r;
  });
  await addMembership(u.id, tenantId, "STUDENT");
  if (options.cr) await addMembership(u.id, tenantId, "CR", { sectionId });
  return { ...u, studentId: record.id };
}

/** A class of the college (bypassing the syllabus gate, which tests of later features own). */
export async function addClass(
  college: College,
  subject: keyof College["subjects"],
  section: keyof College["sections"],
  teacherIds: string[],
): Promise<string> {
  const c = await withSystem((db) =>
    db.class.create({
      data: {
        tenantId: college.tenantId,
        programId: college.programs.p1,
        batchId: college.batch,
        semesterId: college.semester,
        subjectId: college.subjects[subject],
        sectionId: college.sections[section],
        teachers: {
          create: teacherIds.map((userId, i) => ({ userId, isPrimary: i === 0 })),
        },
      },
    }),
  );
  return c.id;
}
