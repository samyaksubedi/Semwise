import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../app.js";
import { withSystem } from "../../common/db/scope.js";
import { addDays, todayIn } from "../../common/time.js";
import { setStorage } from "../../lib/storage.js";
import { resetDatabase } from "../../test/db.js";
import { useFakeAi, useFakeStorage, type FakeAi, type FakeStorage } from "../../test/fakes.js";
import { login, type Agent } from "../../test/helpers.js";
import { drainQueue } from "../../test/jobs.js";
import { publishSyllabus, sampleOutline } from "../../test/syllabus.js";
import {
  addClass,
  addStudent,
  addTeacher,
  agents,
  buildWorld,
  type College,
} from "../../test/world.js";
import { setAiProvider, type JsonRequest } from "../ai/index.js";
import { cleanRange } from "./catchup.service.js";

const app = createApp();
let a: College;
let b: College;
let as: ReturnType<typeof agents>;
let ai: FakeAi;
let storage: FakeStorage;
let teacher: Agent;
let progClass: string;
let mathClass: string;
let student: Agent;
let dates: { isDateQuestion: boolean; from: string | null; to: string | null };
const today = () => todayIn("Asia/Kathmandu");

const textOf = (req: JsonRequest) =>
  req.input.map((p) => (p.type === "text" ? p.text : "")).join("\n");

beforeEach(async () => {
  await resetDatabase();
  ai = useFakeAi();
  storage = useFakeStorage();
  ({ a, b } = await buildWorld());
  as = agents(app);
  await publishSyllabus(await as(a.users.pa1), storage, ai, a.subjects.prog, sampleOutline());
  const t = await addTeacher(a);
  progClass = await addClass(a, "prog", "a", [t.id]);
  mathClass = await addClass(a, "math", "a", [t.id]);
  teacher = await login(app, t.email);
  ai.respond("entry_organized", (req: JsonRequest) => {
    const notes = /<<<DATA lesson notes\n([\s\S]*?)\nDATA>>>/.exec(textOf(req))?.[1] ?? "";
    return {
      topics: [{ title: notes.split(".")[0]!, subtopics: [], syllabusKey: null, confidence: 80 }],
      summary: `Summary: ${notes}`,
    };
  });
  student = await login(app, (await addStudent(a, "a")).email);

  dates = { isDateQuestion: true, from: today(), to: today() };
  ai.respond("chat_route", () => ({
    language: "English",
    query: "what was taught",
    subjectKeys: [],
    scope: "IN_SYLLABUS",
    complex: false,
    dates,
  }));
  ai.respond("date_answer", (req: JsonRequest) => ({
    answer: `Here is the day: ${[...textOf(req).matchAll(/^(S\d+) /gm)].map((m) => m[1]).join(", ")}`,
  }));
  ai.respond("chat_answer", {
    answer: "Normal answer",
    sourceKeys: [],
    generalExplanation: true,
    notInMaterial: true,
  });
});

afterAll(() => {
  setAiProvider(null);
  setStorage(null);
});

/** A teacher's entry, published at once. */
async function entry(classId: string, text: string, taughtOn = today()) {
  const res = await teacher.post(`/v1/classes/${classId}/entries`).send({ text, taughtOn });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  await drainQueue("ai");
  const submitted = await teacher.post(`/v1/entries/${res.body.data.id}/submit`).send({});
  expect(submitted.status, JSON.stringify(submitted.body)).toBe(200);
  await drainQueue("index");
  return res.body.data.id as string;
}

describe("catch-up screen", () => {
  it("groups the period's live entries by subject from stored summaries, with no AI call", async () => {
    await entry(progClass, "Pointer arithmetic.", addDays(today(), -2));
    await entry(mathClass, "Limits.", addDays(today(), -1));
    await entry(progClass, "Arrays and pointers.");
    const calls = ai.calls.length;

    const res = await student.get(`/v1/catchup?from=${addDays(today(), -2)}&to=${today()}`);
    expect(res.status).toBe(200);
    expect(ai.calls.length).toBe(calls);
    const view = res.body.data;
    expect(view.subjects.map((s: { subject: { name: string } }) => s.subject.name)).toEqual([
      "Programming in C",
      "Mathematics I",
    ]);
    expect(view.subjects[0].entries.map((e: { taughtOn: string }) => e.taughtOn)).toEqual([
      addDays(today(), -2),
      today(),
    ]);
    expect(view.subjects[0].entries[0]).toEqual(
      expect.objectContaining({
        summary: "Summary: Pointer arithmetic.",
        versionNo: 1,
        topics: [expect.objectContaining({ title: "Pointer arithmetic" })],
      }),
    );

    // Without dates it is today; a subject filter narrows it.
    const todayOnly = (await student.get("/v1/catchup")).body.data;
    expect(todayOnly.from).toBe(today());
    expect(todayOnly.subjects).toHaveLength(1);
    const math = await student.get(
      `/v1/catchup?from=${addDays(today(), -2)}&to=${today()}&subjectId=${a.subjects.math}`,
    );
    expect(math.body.data.subjects.map((s: { subject: { id: string } }) => s.subject.id)).toEqual([
      a.subjects.math,
    ]);
  });

  it("shows neither pending nor taken-down entries, nor another section's", async () => {
    const takenDown = await entry(progClass, "Pointer arithmetic.");
    await teacher.post(`/v1/entries/${takenDown}/takedown`);
    const cr = await login(app, (await addStudent(a, "a", { cr: true })).email);
    // A CR's entry waits for the teacher (no approval setting), so it is not live yet.
    expect(
      (await cr.post(`/v1/classes/${progClass}/entries`).send({ text: "Pending topic." })).status,
    ).toBe(201);
    await drainQueue("ai");
    const pendingId = (await cr.get("/v1/entries/mine")).body.data[0].id;
    await cr.post(`/v1/entries/${pendingId}/submit`).send({});
    expect((await student.get("/v1/catchup")).body.data.subjects).toEqual([]);

    await entry(mathClass, "Limits.");
    const otherSection = await login(app, (await addStudent(a, "b")).email);
    expect((await otherSection.get("/v1/catchup")).body.data.subjects).toEqual([]);
    expect((await student.get("/v1/catchup")).body.data.subjects).toHaveLength(1);
  });

  it("validates the range and the subject", async () => {
    const day = today();
    expect((await student.get(`/v1/catchup?from=${day}&to=${addDays(day, -1)}`)).status).toBe(400);
    expect((await student.get(`/v1/catchup?from=${addDays(day, -31)}&to=${day}`)).status).toBe(400);
    expect((await student.get("/v1/catchup?from=yesterday")).status).toBe(400);
    expect((await student.get(`/v1/catchup?subjectId=${b.subjects.prog}`)).status).toBe(404);
  });

  it("is for students only, and needs a current section", async () => {
    for (const who of [teacher, await as(a.users.pa1), await as(a.users.ua)]) {
      expect((await who.get("/v1/catchup")).status).toBe(403);
    }
    const outsider = await login(app, (await addStudent(b, "a")).email);
    await entry(progClass, "Pointer arithmetic.");
    expect((await outsider.get("/v1/catchup")).body.data.subjects).toEqual([]);
    const u = await addStudent(a, "a");
    await withSystem((db) => db.enrollment.deleteMany({ where: { studentRecordId: u.studentId } }));
    expect((await (await login(app, u.email)).get("/v1/catchup")).status).toBe(409);
  });
});

describe("date questions in chat", () => {
  async function askDate(text = "What was taught today?") {
    const chat = await student.post("/v1/chat/conversations").send({});
    return student.post(`/v1/chat/conversations/${chat.body.data.id}/messages`).send({ text });
  }

  it("summarizes the period's entries with one cheap call, citing each entry", async () => {
    await entry(progClass, "Pointer arithmetic.");
    await entry(mathClass, "Limits.");
    const embeds = ai.calls.filter((c) => c.kind === "embed").length;
    const res = await askDate();
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const answer = res.body.data.answer;
    expect(answer).toEqual(
      expect.objectContaining({
        scope: "DATE",
        labels: ["REPORTED_IN_CLASS"],
        content: "Here is the day: S1, S2",
      }),
    );
    expect(answer.citations).toHaveLength(2);
    expect(answer.citations[0]).toEqual(
      expect.objectContaining({
        kind: "CLASS",
        taughtOn: today(),
        entryVersionId: expect.any(String),
      }),
    );
    // Postgres, not a vector search; the summary call is the cheap model.
    expect(ai.calls.filter((c) => c.kind === "embed").length).toBe(embeds);
    expect(ai.jsonCalls("chat_answer")).toHaveLength(0);
    const [call] = ai.jsonCalls("date_answer");
    expect(call!.model).toBe("gpt-5.6-luna");
    expect(textOf(call!.request!)).toContain("<<<DATA class entries");
    expect(textOf(call!.request!)).toContain("Summary: Pointer arithmetic.");
    expect(res.body.data.quota.used).toBe(1);
  });

  it("says so when nothing was recorded, without a summary call", async () => {
    dates = { isDateQuestion: true, from: addDays(today(), -3), to: addDays(today(), -3) };
    const res = await askDate("What was taught on Friday?");
    expect(res.body.data.answer.content).toMatch(/^Nothing was recorded as taught for/);
    expect(res.body.data.answer.labels).toEqual(["NOT_IN_MATERIAL"]);
    expect(ai.jsonCalls("date_answer")).toHaveLength(0);
  });

  it("only the student's own section, and an unusable range falls back to a normal answer", async () => {
    await entry(progClass, "Pointer arithmetic.");
    const otherSection = await login(app, (await addStudent(a, "b")).email);
    const chat = await otherSection.post("/v1/chat/conversations").send({});
    const res = await otherSection
      .post(`/v1/chat/conversations/${chat.body.data.id}/messages`)
      .send({ text: "What was taught today?" });
    expect(res.body.data.answer.content).toMatch(/^Nothing was recorded/);

    dates = { isDateQuestion: true, from: addDays(today(), 2), to: addDays(today(), 3) };
    const future = await askDate("What will be taught next week?");
    expect(future.body.data.answer.content).toBe("Normal answer");
  });
});

describe("cleanRange", () => {
  const day = "2026-10-19";
  it("orders, clamps to today and to the longest range, and drops bad dates", () => {
    expect(cleanRange({ from: "2026-10-15", to: "2026-10-13" }, day)).toEqual({
      from: "2026-10-13",
      to: "2026-10-15",
    });
    expect(cleanRange({ from: "2026-10-18", to: "2026-10-25" }, day)).toEqual({
      from: "2026-10-18",
      to: day,
    });
    expect(cleanRange({ from: "2026-01-01", to: day }, day)).toEqual({
      from: "2026-09-19",
      to: day,
    });
    expect(cleanRange({ from: "2026-10-12", to: null }, day)).toEqual({
      from: "2026-10-12",
      to: "2026-10-12",
    });
    expect(cleanRange({ from: "Monday", to: null }, day)).toBeNull();
    expect(cleanRange({ from: "2026-10-20", to: "2026-10-21" }, day)).toBeNull();
  });
});
