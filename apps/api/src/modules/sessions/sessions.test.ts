import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../app.js";
import { withSystem, withTenant } from "../../common/db/scope.js";
import { todayIn, addDays } from "../../common/time.js";
import { runJobNow } from "../../jobs/index.js";
import { setMailer } from "../../lib/mailer.js";
import { getQueue } from "../../lib/queue.js";
import { setStorage } from "../../lib/storage.js";
import { resetDatabase } from "../../test/db.js";
import { useFakeAi, useFakeStorage, type FakeAi, type FakeStorage } from "../../test/fakes.js";
import {
  expectDenied,
  login,
  useFakeMailer,
  type Agent,
  type FakeMailer,
} from "../../test/helpers.js";
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

const app = createApp();
let a: College;
let b: College;
let as: ReturnType<typeof agents>;
let ai: FakeAi;
let storage: FakeStorage;
let mailer: FakeMailer;
let teacher: User;
let classId: string;
let cr: Agent;
let student: Agent;
let otherSectionStudent: Agent;
let pa: Agent;
const today = () => todayIn("Asia/Kathmandu");

/** The fake organizer maps each title onto the syllabus key whose line mentions it. */
function organizeAs(titles: string[], summary = "We covered pointers.") {
  ai.respond("entry_organized", (req: JsonRequest) => {
    const block = req.input.map((p) => (p.type === "text" ? p.text : "")).join("\n");
    const lines = block.split("\n");
    return {
      topics: titles.map((title) => {
        const line = lines.find(
          (l) => /^K\d+ /.test(l) && l.toLowerCase().endsWith(title.toLowerCase()),
        );
        return {
          title,
          subtopics: [],
          syllabusKey: line ? line.split(" ")[0]! : null,
          confidence: line ? 90 : 30,
        };
      }),
      summary,
    };
  });
}

beforeEach(async () => {
  await resetDatabase();
  ai = useFakeAi();
  storage = useFakeStorage();
  mailer = useFakeMailer();
  ({ a, b } = await buildWorld());
  as = agents(app);
  pa = await as(a.users.pa1);
  await publishSyllabus(pa, storage, ai, a.subjects.prog, sampleOutline());
  teacher = await addTeacher(a);
  classId = await addClass(a, "prog", "a", [teacher.id]);
  cr = await login(app, (await addStudent(a, "a", { cr: true })).email);
  student = await login(app, (await addStudent(a, "a")).email);
  otherSectionStudent = await login(app, (await addStudent(a, "b")).email);
  organizeAs(["Pointer arithmetic", "Arrays and pointers"]);
});

afterAll(() => {
  setAiProvider(null);
  setStorage(null);
  setMailer(null);
});

async function write(
  who: Agent,
  body: object = { text: "Pointer arithmetic, then arrays and pointers." },
) {
  const res = await who.post(`/v1/classes/${classId}/entries`).send(body);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  await drainQueue("ai");
  return res.body.data.id as string;
}

async function submit(who: Agent, entryId: string, body: object = {}) {
  const res = await who.post(`/v1/entries/${entryId}/submit`).send(body);
  await drainQueue("index");
  return res;
}

const delayedIds = async () => (await getQueue("workflow").getJobs(["delayed"])).map((j) => j.id);

describe("writing and approving an entry", () => {
  it("CR writes, the AI organizes it onto the syllabus, the teacher approves, students see it", async () => {
    const entryId = await write(cr);
    const draft = await cr.get(`/v1/entries/${entryId}`);
    expect(draft.body.data).toEqual(expect.objectContaining({ taughtOn: today(), live: null }));
    expect(draft.body.data.latest).toEqual(
      expect.objectContaining({
        status: "DRAFT",
        organize: "DONE",
        summary: "We covered pointers.",
      }),
    );
    expect(
      draft.body.data.latest.topics.map((t: { title: string; inSyllabus: boolean }) => [
        t.title,
        t.inSyllabus,
      ]),
    ).toEqual([
      ["Pointer arithmetic", true],
      ["Arrays and pointers", true],
    ]);
    // The notes reached the model only as delimited data.
    expect(JSON.stringify(ai.jsonCalls("entry_organized")[0]!.request!.input)).toContain(
      "<<<DATA lesson notes",
    );

    const submitted = await submit(cr, entryId);
    expect(submitted.body.data.latest.status).toBe("PENDING");
    expect((await student.get(`/v1/entries/${entryId}`)).status).toBe(404);
    expect(await delayedIds()).toHaveLength(3);

    const t = await login(app, teacher.email);
    const queue = await t.get("/v1/approvals");
    expect(queue.body.data).toEqual([
      expect.objectContaining({
        entryId,
        isEdit: false,
        section: expect.objectContaining({ name: "A" }),
      }),
    ]);
    const approved = await t.post(`/v1/approvals/${queue.body.data[0].versionId}/approve`).send({});
    expect(approved.body.data.latest.status).toBe("APPROVED");
    expect(await delayedIds()).toEqual([]);
    await drainQueue("index");

    const seen = await student.get(`/v1/entries/${entryId}`);
    expect(seen.body.data.live).toEqual(
      expect.objectContaining({ status: "PUBLISHED", versionNo: 1 }),
    );
    expect(seen.body.data.latest).toBeNull();
    // Another section's students do not see this section's classes' entries.
    expect((await otherSectionStudent.get(`/v1/entries/${entryId}`)).status).toBe(404);

    const versionId = seen.body.data.live.id;
    const points = await knowledgeService.pointsOfVersion({ tenantId: a.tenantId }, versionId);
    expect(points[0]!.payload).toEqual(
      expect.objectContaining({ sectionId: a.sections.a, contentKind: "CLASS_REPORTED", classId }),
    );
    const trail = await (await as(a.users.ua)).get(`/v1/audit?entityId=${entryId}`);
    expect(trail.body.data.map((e: { action: string }) => e.action)).toEqual(
      expect.arrayContaining(["entry.create", "entry.submit", "entry.approve", "entry.publish"]),
    );
  });

  it("publishes at once with auto-approval, and for the subject teacher", async () => {
    await pa.put(`/v1/programs/${a.programs.p1}/approval-settings`).send({ autoApprove: true });
    const id = await write(cr);
    const res = await submit(cr, id);
    expect(res.body.data.latest?.status ?? res.body.data.live?.status).toMatch(
      /APPROVED|PUBLISHED/,
    );
    expect((await student.get(`/v1/entries/${id}`)).body.data.live.status).toBe("PUBLISHED");

    await pa.put(`/v1/programs/${a.programs.p1}/approval-settings`).send({ autoApprove: false });
    const t = await login(app, teacher.email);
    const own = await write(t, {
      text: "Pointer arithmetic recap.",
      taughtOn: addDays(today(), -1),
    });
    await submit(t, own);
    expect((await student.get(`/v1/entries/${own}`)).body.data.live.status).toBe("PUBLISHED");
  });

  it("rejects with a reason; the CR sees it, students never do", async () => {
    const id = await write(cr);
    const pending = (await submit(cr, id)).body.data.latest;
    const t = await login(app, teacher.email);
    expect((await t.post(`/v1/approvals/${pending.id}/reject`).send({ reason: "x" })).status).toBe(
      400,
    );
    const res = await t
      .post(`/v1/approvals/${pending.id}/reject`)
      .send({ reason: "Wrong subject" });
    expect(res.body.data.latest).toEqual(
      expect.objectContaining({ status: "REJECTED", rejectionReason: "Wrong subject" }),
    );
    expect((await cr.get(`/v1/entries/${id}`)).body.data.latest.status).toBe("REJECTED");
    expect((await student.get(`/v1/entries/${id}`)).status).toBe(404);
  });

  it("the teacher can correct topics while approving, and approve in bulk", async () => {
    const first = await write(cr);
    const v1 = (await submit(cr, first)).body.data.latest.id;
    const second = await write(cr, {
      text: "Arrays and pointers again.",
      taughtOn: addDays(today(), -2),
    });
    const v2 = (await submit(cr, second)).body.data.latest.id;
    const t = await login(app, teacher.email);
    const corrected = await t.post(`/v1/approvals/${v1}/approve`).send({
      topics: [
        { title: "Pointer arithmetic", subtopics: ["Increment"], stableKey: "not-a-real-key" },
      ],
      summary: "Pointer arithmetic with increments.",
    });
    expect(corrected.body.data.latest.topics[0]).toEqual(
      expect.objectContaining({ subtopics: ["Increment"], stableKey: null }),
    );
    expect(
      (await t.post("/v1/approvals/bulk-approve").send({ versionIds: [v2] })).body.data,
    ).toEqual({ approved: 1 });
    await drainQueue("index");
    expect((await t.get("/v1/approvals")).body.data).toEqual([]);
  });
});

describe("dates and duplicates", () => {
  it("defaults to today, allows backdating, refuses the future", async () => {
    const future = await cr
      .post(`/v1/classes/${classId}/entries`)
      .send({ text: "Pointer arithmetic.", taughtOn: addDays(today(), 2) });
    expect(future.status).toBe(400);
    const back = await write(cr, { text: "Pointer arithmetic.", taughtOn: addDays(today(), -3) });
    expect((await cr.get(`/v1/entries/${back}`)).body.data.taughtOn).toBe(addDays(today(), -3));
  });

  it("asks replace or add for a second entry on the same day", async () => {
    await pa.put(`/v1/programs/${a.programs.p1}/approval-settings`).send({ autoApprove: true });
    const firstId = await write(cr);
    await submit(cr, firstId);

    const secondId = await write(cr, { text: "Arrays and pointers." });
    const asked = await submit(cr, secondId);
    expect(asked.status).toBe(409);
    expect(asked.body.error.code).toBe("DUPLICATE_ENTRY");
    expect(asked.body.error.details).toEqual([{ path: "entryId", message: firstId }]);

    const replaced = await submit(cr, secondId, { onDuplicate: "replace" });
    expect(replaced.body.data.id).toBe(firstId);
    expect((await student.get(`/v1/entries/${firstId}`)).body.data.live.versionNo).toBe(2);
    expect((await cr.get(`/v1/entries/${secondId}`)).status).toBe(404);

    const thirdId = await write(cr, { text: "Lab: pointer arithmetic." });
    const added = await submit(cr, thirdId, { onDuplicate: "add" });
    expect(added.status).toBe(200);
    const list = await student.get(`/v1/classes/${classId}/entries?from=${today()}&to=${today()}`);
    expect(list.body.data).toHaveLength(2);
  });
});

describe("editing a published entry", () => {
  async function published() {
    const id = await write(cr);
    const pending = (await submit(cr, id)).body.data.latest.id;
    await (await login(app, teacher.email)).post(`/v1/approvals/${pending}/approve`).send({});
    await drainQueue("index");
    return id;
  }

  it("needs approval again; the old version stays live until then, then its vectors go", async () => {
    const id = await published();
    const v1 = (await student.get(`/v1/entries/${id}`)).body.data.live.id;
    organizeAs(["Pointer arithmetic", "Function pointers"], "Pointers and function pointers.");
    const edit = await cr
      .post(`/v1/entries/${id}/versions`)
      .send({ text: "Also function pointers." });
    expect(edit.status).toBe(201);
    await drainQueue("ai");
    expect(
      (await cr.post(`/v1/entries/${id}/versions`).send({ text: "Another edit" })).status,
    ).toBe(409);
    const pending = (await submit(cr, id)).body.data.latest;
    expect(pending.status).toBe("PENDING");
    expect((await student.get(`/v1/entries/${id}`)).body.data.live.id).toBe(v1);

    const t = await login(app, teacher.email);
    expect((await t.get("/v1/approvals")).body.data[0].isEdit).toBe(true);
    await t.post(`/v1/approvals/${pending.id}/approve`).send({});
    await drainQueue("index");
    const live = (await student.get(`/v1/entries/${id}`)).body.data.live;
    expect(live).toEqual(
      expect.objectContaining({ versionNo: 2, summary: "Pointers and function pointers." }),
    );
    expect(await knowledgeService.pointsOfVersion({ tenantId: a.tenantId }, v1)).toEqual([]);
  });

  it("a minor fix that keeps the same topics goes live without approval", async () => {
    const id = await published();
    const edit = await cr
      .post(`/v1/entries/${id}/versions`)
      .send({ text: "Pointer arithmetic, then arrays and pointers (typo fixed)." });
    expect(edit.status).toBe(201);
    await drainQueue("ai");
    await submit(cr, id);
    const live = (await student.get(`/v1/entries/${id}`)).body.data.live;
    expect(live).toEqual(expect.objectContaining({ versionNo: 2, minorEdit: true }));
  });

  it("the author can withdraw a pending change", async () => {
    const id = await published();
    organizeAs(["Function pointers"]);
    await cr.post(`/v1/entries/${id}/versions`).send({ text: "Function pointers." });
    await drainQueue("ai");
    const pending = (await submit(cr, id)).body.data.latest;
    expect(pending.status).toBe("PENDING");
    const res = await cr.post(`/v1/entries/${id}/withdraw`);
    expect(res.body.data.latest.status).toBe("WITHDRAWN");
    expect(res.body.data.live.versionNo).toBe(1);
  });
});

describe("approval settings", () => {
  it("a teacher overrides the program default for their class unless it is locked", async () => {
    const t = await login(app, teacher.email);
    const on = await t.put(`/v1/classes/${classId}/approval-settings`).send({ autoApprove: true });
    expect(on.body.data).toEqual({ classId, autoApprove: true, override: true, locked: false });
    const id = await write(cr);
    await submit(cr, id);
    expect((await student.get(`/v1/entries/${id}`)).body.data.live.status).toBe("PUBLISHED");

    await pa
      .put(`/v1/programs/${a.programs.p1}/approval-settings`)
      .send({ autoApprove: false, locked: true });
    expect((await t.get(`/v1/classes/${classId}/approval-settings`)).body.data.autoApprove).toBe(
      false,
    );
    expect(
      (await t.put(`/v1/classes/${classId}/approval-settings`).send({ autoApprove: true })).status,
    ).toBe(409);
    expectDenied(
      await t.put(`/v1/programs/${a.programs.p1}/approval-settings`).send({ autoApprove: true }),
    );
    expectDenied(
      await cr.put(`/v1/classes/${classId}/approval-settings`).send({ autoApprove: true }),
    );
  });
});

describe("reminders, escalation and unreviewed publishing", () => {
  it("reminds the teacher, escalates to the Program Admin, and can publish as not reviewed", async () => {
    await pa
      .put(`/v1/programs/${a.programs.p1}/approval-settings`)
      .send({ autoApprove: false, unreviewedPublishAfterDays: 7 });
    const id = await write(cr);
    const pending = (await submit(cr, id)).body.data.latest;
    expect(await delayedIds()).toHaveLength(4);
    const data = { tenantId: a.tenantId, versionId: pending.id };

    await runJobNow("workflow", "entry-reminder", { ...data, n: 1 });
    await runJobNow("workflow", "entry-escalate", data);
    await drainQueue("email");
    expect(mailer.sent.map((m) => [m.to, m.subject]).sort()).toEqual(
      [
        [teacher.email, "Entries waiting for approval: Programming in C"],
        [a.users.pa1.email, "Escalated: entry waiting in Programming in C"],
      ].sort(),
    );

    await runJobNow("workflow", "entry-unreviewed-publish", data);
    await drainQueue("index");
    expect((await student.get(`/v1/entries/${id}`)).body.data.live).toEqual(
      expect.objectContaining({ status: "PUBLISHED", unreviewed: true }),
    );
    // A reminder that fires after the teacher acted does nothing.
    expect(await runJobNow("workflow", "entry-reminder", { ...data, n: 2 })).toEqual({
      skipped: true,
    });
  });
});

describe("takedown", () => {
  it("hides a published entry from students and the index, and restores it", async () => {
    await pa.put(`/v1/programs/${a.programs.p1}/approval-settings`).send({ autoApprove: true });
    const id = await write(cr);
    await submit(cr, id);
    const versionId = (await student.get(`/v1/entries/${id}`)).body.data.live.id;
    const t = await login(app, teacher.email);
    expect((await t.post(`/v1/entries/${id}/takedown`)).body.data.takenDown).toBe(true);
    expect((await student.get(`/v1/entries/${id}`)).status).toBe(404);
    expect(await knowledgeService.pointsOfVersion({ tenantId: a.tenantId }, versionId)).toEqual([]);
    expectDenied(await cr.post(`/v1/entries/${id}/restore`));
    await (await as(a.users.ua)).post(`/v1/entries/${id}/restore`);
    await drainQueue("index");
    expect((await student.get(`/v1/entries/${id}`)).status).toBe(200);
    expect(
      await knowledgeService.pointsOfVersion({ tenantId: a.tenantId }, versionId),
    ).toHaveLength(1);
  });
});

describe("a new syllabus version", () => {
  it("flags entries mapped to topics that no longer exist", async () => {
    await pa.put(`/v1/programs/${a.programs.p1}/approval-settings`).send({ autoApprove: true });
    const id = await write(cr);
    await submit(cr, id);
    const outline = sampleOutline();
    outline.units[1]!.topics = [
      {
        title: "Memory management",
        description: null,
        sourcePage: 2,
        confidence: 90,
        subtopics: [],
      },
    ];
    await publishSyllabus(pa, storage, ai, a.subjects.prog, outline);
    const live = (await student.get(`/v1/entries/${id}`)).body.data.live;
    expect(live.mappingStale).toBe(true);
  });
});

describe("permissions and isolation", () => {
  it("only the section's CR and the class teacher write entries; voice is CR-only", async () => {
    expectDenied(await student.post(`/v1/classes/${classId}/entries`).send({ text: "Pointers" }));
    expectDenied(
      await otherSectionStudent.post(`/v1/classes/${classId}/entries`).send({ text: "Pointers" }),
    );
    const otherTeacher = await login(app, (await addTeacher(a)).email);
    expectDenied(
      await otherTeacher.post(`/v1/classes/${classId}/entries`).send({ text: "Pointers" }),
    );
    expectDenied(await pa.post(`/v1/classes/${classId}/entries`).send({ text: "Pointers" }));
    const t = await login(app, teacher.email);
    expectDenied(
      await t
        .post(`/v1/classes/${classId}/entries`)
        .send({ text: "Pointers", inputKind: "VOICE", mediaFileId: "f1" }),
    );
  });

  it("only the class teacher and the program's admin review; the UA reads published only", async () => {
    const id = await write(cr);
    const pending = (await submit(cr, id)).body.data.latest.id;
    const pa2 = await as(a.users.pa2);
    const ua = await as(a.users.ua);
    const otherTeacher = await login(app, (await addTeacher(a)).email);
    for (const who of [pa2, ua, otherTeacher, cr, student]) {
      expectDenied(await who.post(`/v1/approvals/${pending}/approve`).send({}));
      expectDenied(await who.post(`/v1/approvals/${pending}/reject`).send({ reason: "nope nope" }));
    }
    expect((await ua.get(`/v1/entries/${id}`)).status).toBe(404);
    expect((await pa.get("/v1/approvals")).body.data).toHaveLength(1);
    expect((await pa2.get("/v1/approvals")).body.data).toHaveLength(0);
    expect((await pa.post(`/v1/approvals/${pending}/approve`).send({})).status).toBe(200);
    await drainQueue("index");
    expect((await ua.get(`/v1/entries/${id}`)).status).toBe(200);
  });

  it("another CR cannot edit, submit or withdraw someone else's entry", async () => {
    const id = await write(cr);
    const otherCr = await login(app, (await addStudent(a, "a", { cr: true })).email);
    expectDenied(await otherCr.post(`/v1/entries/${id}/submit`).send({}));
    expectDenied(await otherCr.patch(`/v1/entries/${id}/draft`).send({ summary: "mine now" }));
    expectDenied(await otherCr.post(`/v1/entries/${id}/withdraw`));
  });

  it("another college gets 404 on every entry route", async () => {
    const id = await write(cr);
    const pending = (await submit(cr, id)).body.data.latest.id;
    const uaB = await as(b.users.ua);
    const paB = await as(b.users.pa1);
    for (const who of [uaB, paB]) {
      const attempts = await Promise.all([
        who.get(`/v1/classes/${classId}/entries`),
        who.post(`/v1/classes/${classId}/entries`).send({ text: "Pointers" }),
        who.get(`/v1/entries/${id}`),
        who.patch(`/v1/entries/${id}/draft`).send({ summary: "x" }),
        who.post(`/v1/entries/${id}/submit`).send({}),
        who.post(`/v1/entries/${id}/takedown`),
        who.post(`/v1/approvals/${pending}/approve`).send({}),
        who.post(`/v1/approvals/${pending}/reject`).send({ reason: "nope nope" }),
        who.get(`/v1/classes/${classId}/approval-settings`),
        who.put(`/v1/programs/${a.programs.p1}/approval-settings`).send({ autoApprove: true }),
      ]);
      for (const res of attempts) expect(res.status, JSON.stringify(res.body)).toBe(404);
      expect((await who.get("/v1/approvals")).body.data).toEqual([]);
    }
    const rows = await withSystem((db) => db.entryVersion.findMany({ where: { id: pending } }));
    expect(rows[0]!.status).toBe("PENDING");
    expect(await withTenant(b.tenantId, (db) => db.entry.count())).toBe(0);
  });
});
