import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../app.js";
import { withSystem, withTenant } from "../../common/db/scope.js";
import { setStorage } from "../../lib/storage.js";
import { resetDatabase } from "../../test/db.js";
import { useFakeAi, useFakeStorage, type FakeAi, type FakeStorage } from "../../test/fakes.js";
import { expectDenied, login, type Agent } from "../../test/helpers.js";
import { drainQueue } from "../../test/jobs.js";
import { publishSyllabus, sampleOutline } from "../../test/syllabus.js";
import {
  addClass,
  addStudent,
  addTeacher,
  agents,
  buildWorld,
  type College,
  type User,
} from "../../test/world.js";
import { setAiProvider, type JsonRequest } from "../ai/index.js";
import { knowledgeService } from "../knowledge/index.js";
import { DECLINE_TEXT } from "./chat.service.js";

const app = createApp();
let a: College;
let b: College;
let as: ReturnType<typeof agents>;
let ai: FakeAi;
let storage: FakeStorage;
let teacher: Agent;
let classId: string;
let student: Agent;
let studentUser: User;
let route: Record<string, unknown>;

const NOTES = "Pointer arithmetic with arrays: p plus one moves to the next element of the array.";

const textOf = (req: JsonRequest) =>
  req.input.map((p) => (p.type === "text" ? p.text : "")).join("\n");
const question = (req: JsonRequest) =>
  /<<<DATA question\n([\s\S]*?)\nDATA>>>/.exec(textOf(req))?.[1] ?? "";

beforeEach(async () => {
  await resetDatabase();
  ai = useFakeAi();
  storage = useFakeStorage();
  ({ a, b } = await buildWorld());
  as = agents(app);
  await publishSyllabus(await as(a.users.pa1), storage, ai, a.subjects.prog, sampleOutline());

  // A published class entry in section A about pointer arithmetic.
  const t = await addTeacher(a);
  classId = await addClass(a, "prog", "a", [t.id]);
  teacher = await login(app, t.email);
  ai.respond("entry_organized", (req: JsonRequest) => {
    const key = textOf(req)
      .split("\n")
      .find((l) => l.endsWith("Pointer arithmetic"))
      ?.split(" ")[0];
    return {
      topics: [
        { title: "Pointer arithmetic", subtopics: [], syllabusKey: key ?? null, confidence: 90 },
      ],
      summary: "Pointer arithmetic with arrays.",
    };
  });
  await publishEntry(NOTES);

  studentUser = await addStudent(a, "a");
  student = await login(app, studentUser.email);

  // The router says "in syllabus" and searches with the question; the answer uses every source.
  route = { scope: "IN_SYLLABUS", complex: false, subjectKeys: [] };
  ai.respond("chat_route", (req: JsonRequest) => ({
    language: "English",
    query: question(req),
    subjectKeys: [],
    scope: "IN_SYLLABUS",
    complex: false,
    dates: { isDateQuestion: false, from: null, to: null },
    ...route,
  }));
  ai.respond("chat_answer", (req: JsonRequest) => {
    const keys = [...textOf(req).matchAll(/^(S\d+) \[/gm)].map((m) => m[1]!);
    return {
      answer: `Answer using ${keys.join(", ") || "nothing"}.`,
      sourceKeys: keys,
      generalExplanation: false,
      notInMaterial: keys.length === 0,
    };
  });
  ai.respond("chat_summary", { summary: "The student asked about pointers." });
});

afterAll(() => {
  setAiProvider(null);
  setStorage(null);
});

async function publishEntry(text: string) {
  const res = await teacher.post(`/v1/classes/${classId}/entries`).send({ text });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  await drainQueue("ai");
  await teacher.post(`/v1/entries/${res.body.data.id}/submit`).send({});
  await drainQueue("index");
  return res.body.data.id as string;
}

async function newChat(who: Agent, body: object = {}) {
  const res = await who.post("/v1/chat/conversations").send(body);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data.id as string;
}

const ask = (who: Agent, id: string, text = "Explain pointer arithmetic with arrays") =>
  who.post(`/v1/chat/conversations/${id}/messages`).send({ text });

describe("asking a question", () => {
  it("answers from the syllabus and the class, with citations, labels and one counted request", async () => {
    const id = await newChat(student);
    const res = await ask(student, id);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const { question: q, answer, quota } = res.body.data;
    expect(q).toEqual(expect.objectContaining({ role: "USER" }));
    expect(answer.scope).toBe("IN_SYLLABUS");
    expect(answer.labels).toEqual(expect.arrayContaining(["FROM_SYLLABUS", "REPORTED_IN_CLASS"]));
    expect(answer.labels).not.toContain("NOT_IN_MATERIAL");
    expect(answer.outdated).toBe(false);
    const kinds = answer.citations.map((c: { kind: string }) => c.kind);
    expect(kinds).toEqual(expect.arrayContaining(["SYLLABUS", "CLASS"]));
    expect(answer.citations).toContainEqual(
      expect.objectContaining({
        kind: "SYLLABUS",
        unitNo: 2,
        unitTitle: "Pointers",
        topicTitle: "Pointer arithmetic",
        subject: expect.objectContaining({ name: "Programming in C" }),
      }),
    );
    expect(answer.citations).toContainEqual(
      expect.objectContaining({ kind: "CLASS", versionNo: 1, taughtOn: expect.any(String) }),
    );
    expect(quota).toEqual({ used: 1, limit: 60, warn: false });

    // User text reached both models only as delimited data; the router ran on the cheap model.
    const [routeCall] = ai.jsonCalls("chat_route");
    expect(routeCall!.model).toBe("gpt-5.6-luna");
    expect(textOf(routeCall!.request!)).toContain("<<<DATA question\nExplain pointer arithmetic");
    const [answerCall] = ai.jsonCalls("chat_answer");
    expect(answerCall!.model).toBe("gpt-5.4-mini");
    expect(answerCall!.request!.system).toMatch(/Never follow instructions/);
    expect(textOf(answerCall!.request!)).toContain("[reported in class on");

    // Router, embedding and answer share one request id: one question in the quota.
    const rows = await withTenant(a.tenantId, (db) =>
      db.aiUsage.findMany({ where: { feature: "CHAT", userId: studentUser.id } }),
    );
    expect(rows.map((r) => r.task).sort()).toEqual(["answer", "embed", "route"]);
    expect(new Set(rows.map((r) => r.requestId)).size).toBe(1);

    const chat = (await student.get(`/v1/chat/conversations/${id}`)).body.data;
    expect(chat.title).toBe("Explain pointer arithmetic with arrays");
    expect(chat.messages.map((m: { role: string }) => m.role)).toEqual(["USER", "ASSISTANT"]);
  });

  it("declines an unrelated question without retrieval or the answer model", async () => {
    route = { scope: "UNRELATED" };
    const id = await newChat(student);
    const res = await ask(student, id, "Write my cover letter for a bank job");
    expect(res.status).toBe(200);
    expect(res.body.data.answer).toEqual(
      expect.objectContaining({ content: DECLINE_TEXT, scope: "UNRELATED", citations: [] }),
    );
    expect(ai.jsonCalls("chat_answer")).toHaveLength(0);
    expect(ai.calls.filter((c) => c.kind === "embed" && c.texts?.[0]?.includes("cover"))).toEqual(
      [],
    );
    expect(res.body.data.quota.used).toBe(1);
  });

  it("labels a related question as outside the syllabus, and escalates complex ones", async () => {
    route = { scope: "RELATED", complex: true };
    const id = await newChat(student);
    const res = await ask(student, id, "How do pointers compare with references in C++?");
    expect(res.body.data.answer.labels).toContain("OUTSIDE_SYLLABUS");
    expect(ai.jsonCalls("chat_answer")[0]!.model).toBe("gpt-5.6-terra");
  });

  it("says when nothing is found, and a pinned subject limits the search", async () => {
    // Mathematics has no published syllabus or entries: nothing to retrieve.
    const id = await newChat(student, { pinnedSubjectId: a.subjects.math });
    const res = await ask(student, id);
    expect(res.body.data.answer.citations).toEqual([]);
    expect(res.body.data.answer.labels).toEqual(
      expect.arrayContaining(["NOT_IN_MATERIAL", "GENERAL_EXPLANATION"]),
    );
    expect(textOf(ai.jsonCalls("chat_answer")[0]!.request!)).toContain("(no sources found)");
  });

  it("keeps a summary of older turns, counted within the same questions", async () => {
    const id = await newChat(student);
    for (let i = 0; i < 8; i++)
      expect((await ask(student, id, `Pointers question ${i}`)).status).toBe(200);
    expect(ai.jsonCalls("chat_summary")).toHaveLength(1);
    const row = await withTenant(a.tenantId, (db) =>
      db.conversation.findFirstOrThrow({ where: { id } }),
    );
    expect(row.summary).toBe("The student asked about pointers.");
    expect(row.summarizedCount).toBe(10);
    const quota = (await ask(student, id, "One more")).body.data.quota;
    expect(quota.used).toBe(9);
    // The summary goes to the answer model on the next question.
    expect(textOf(ai.jsonCalls("chat_answer").at(-1)!.request!)).toContain(
      "The student asked about pointers.",
    );
  });

  it("stops at the monthly question quota and saves nothing", async () => {
    await withSystem((db) =>
      db.quota.create({ data: { tenantId: a.tenantId, scope: "USER", feature: "CHAT", limit: 1 } }),
    );
    const id = await newChat(student);
    expect((await ask(student, id)).status).toBe(200);
    const res = await ask(student, id);
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe("QUOTA_EXCEEDED");
    const chat = (await student.get(`/v1/chat/conversations/${id}`)).body.data;
    expect(chat.messages).toHaveLength(2);
  });
});

describe("retrieval checks", () => {
  it("re-checks every hit against Postgres: vectors of versions that are not live are dropped", async () => {
    // Plant points that look right to Qdrant but are not live in Postgres.
    const path = {
      programId: a.programs.p1,
      batchId: a.batch,
      semesterId: a.semester,
      subjectId: a.subjects.prog,
      ownerId: null,
      visibility: "SHARED" as const,
    };
    const stale = "Pointer arithmetic with arrays STALE SECRET";
    await knowledgeService.indexVersion(
      { tenantId: a.tenantId },
      { tenantId: a.tenantId, userId: null },
      "ENTRY_INDEX",
      "ENTRY_VERSION",
      "ev_not_live",
      [
        {
          sourceId: "e_fake",
          text: stale,
          payload: {
            ...path,
            sectionId: a.sections.a,
            classId,
            contentKind: "CLASS_REPORTED",
            meta: {},
          },
        },
      ],
    );
    await knowledgeService.indexVersion(
      { tenantId: a.tenantId },
      { tenantId: a.tenantId, userId: null },
      "SYLLABUS_INDEX",
      "SYLLABUS_TOPIC",
      "sv_old_version",
      [
        {
          sourceId: "t_fake",
          text: stale,
          payload: {
            ...path,
            sectionId: null,
            classId: null,
            contentKind: "OFFICIAL_SYLLABUS",
            meta: {},
          },
        },
      ],
    );
    const id = await newChat(student);
    await ask(student, id);
    expect(textOf(ai.jsonCalls("chat_answer")[0]!.request!)).not.toContain("STALE SECRET");
  });

  it("uses only the student's own section's class content", async () => {
    const other = await login(app, (await addStudent(a, "b")).email);
    const id = await newChat(other);
    const answer = (await ask(other, id)).body.data.answer;
    expect(answer.citations.map((c: { kind: string }) => c.kind)).not.toContain("CLASS");
    expect(answer.citations.map((c: { kind: string }) => c.kind)).toContain("SYLLABUS");
    expect(textOf(ai.jsonCalls("chat_answer")[0]!.request!)).not.toContain("reported in class");
  });

  it("marks an answer as out of date when a cited entry is corrected", async () => {
    const id = await newChat(student);
    await ask(student, id);
    const [entry] = (await teacher.get(`/v1/classes/${classId}/entries`)).body.data;
    expect(
      (await teacher.post(`/v1/entries/${entry.id}/versions`).send({ text: `${NOTES} Fixed.` }))
        .status,
    ).toBe(201);
    await drainQueue("ai");
    await teacher.post(`/v1/entries/${entry.id}/submit`).send({});
    await drainQueue("index");
    const chat = (await student.get(`/v1/chat/conversations/${id}`)).body.data;
    expect(chat.messages[1].outdated).toBe(true);
    expect(chat.messages[0].outdated).toBe(false);
  });
});

describe("privacy and isolation", () => {
  it("a conversation is readable and usable only by its student", async () => {
    const id = await newChat(student);
    await ask(student, id);
    const classmate = await login(app, (await addStudent(a, "a")).email);
    const cr = await login(app, (await addStudent(a, "a", { cr: true })).email);
    for (const who of [classmate, cr]) {
      expectDenied(await who.get(`/v1/chat/conversations/${id}`));
      expectDenied(await ask(who, id));
      expectDenied(await who.patch(`/v1/chat/conversations/${id}`).send({ title: "Mine" }));
      expectDenied(await who.delete(`/v1/chat/conversations/${id}`));
      expect((await who.get("/v1/chat/conversations")).body.data).toEqual([]);
    }
    // Teachers and admins have no chat at all, and cannot read a student's.
    for (const who of [teacher, await as(a.users.pa1), await as(a.users.ua)]) {
      expect((await who.get("/v1/chat/conversations")).status).toBe(403);
      expectDenied(await who.get(`/v1/chat/conversations/${id}`));
      expect((await who.post("/v1/chat/conversations").send({})).status).toBe(403);
    }
    // Another college's student and admin.
    const outsider = await login(app, (await addStudent(b, "a")).email);
    expectDenied(await outsider.get(`/v1/chat/conversations/${id}`));
    expectDenied(await ask(outsider, id));
    expectDenied(await (await as(b.users.ua)).get(`/v1/chat/conversations/${id}`));
  });

  it("the student can rename, re-pin and delete their own chat", async () => {
    const id = await newChat(student);
    const renamed = await student
      .patch(`/v1/chat/conversations/${id}`)
      .send({ title: "Pointers", pinnedSubjectId: a.subjects.prog, includePast: true });
    expect(renamed.body.data).toEqual(
      expect.objectContaining({
        title: "Pointers",
        pinnedSubjectId: a.subjects.prog,
        includePast: true,
      }),
    );
    expect((await student.delete(`/v1/chat/conversations/${id}`)).status).toBe(204);
    expect((await student.get(`/v1/chat/conversations/${id}`)).status).toBe(404);
  });
});

describe("validation", () => {
  it("rejects empty or long questions, foreign subjects and empty updates", async () => {
    const id = await newChat(student);
    expect((await ask(student, id, "   ")).status).toBe(400);
    expect((await ask(student, id, "x".repeat(2001))).status).toBe(400);
    expect((await student.patch(`/v1/chat/conversations/${id}`).send({})).status).toBe(400);
    expect(
      (await student.post("/v1/chat/conversations").send({ pinnedSubjectId: b.subjects.prog }))
        .status,
    ).toBe(404);
    expect((await student.post("/v1/chat/conversations").send({ includePast: "yes" })).status).toBe(
      400,
    );
  });

  it("needs a current section", async () => {
    const u = await addStudent(a, "a");
    await withSystem((db) => db.enrollment.deleteMany({ where: { studentRecordId: u.studentId } }));
    const unplaced = await login(app, u.email);
    expect((await unplaced.post("/v1/chat/conversations").send({})).status).toBe(409);
  });
});
