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
