import { FILE_RULES } from "@semwise/shared";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../app.js";
import { withSystem, withTenant } from "../../common/db/scope.js";
import { runJobNow } from "../../jobs/index.js";
import { getQueue } from "../../lib/queue.js";
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
import { AUDIO_EXTENSIONS } from "../ai/ai.provider.js";
import { setAiProvider } from "../ai/index.js";

const app = createApp();
let a: College;
let b: College;
let as: ReturnType<typeof agents>;
let ai: FakeAi;
let storage: FakeStorage;
let teacher: User;
let classId: string;
let cr: Agent;
let crUser: User;

const DAY = 24 * 60 * 60 * 1000;
const webm = () => new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, ...new Array(60).fill(7)]);
const png = () =>
  new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(60).fill(3)]);

beforeEach(async () => {
  await resetDatabase();
  ai = useFakeAi();
  storage = useFakeStorage();
  ({ a, b } = await buildWorld());
  as = agents(app);
  const pa = await as(a.users.pa1);
  await publishSyllabus(pa, storage, ai, a.subjects.prog, sampleOutline());
  teacher = await addTeacher(a);
  classId = await addClass(a, "prog", "a", [teacher.id]);
  crUser = await addStudent(a, "a", { cr: true });
  cr = await login(app, crUser.email);
  ai.respond("entry_organized", {
    topics: [{ title: "Pointer arithmetic", subtopics: [], syllabusKey: null, confidence: 50 }],
    summary: "Pointers.",
  });
  ai.respond("photo_reading", { text: "Pointers\n- arithmetic\n- arrays", unreadable: false });
});

afterAll(() => {
  setAiProvider(null);
  setStorage(null);
});

/** Upload the way the phone does: ticket, PUT, complete. */
async function upload(
  who: Agent,
  kind: "AUDIO" | "PHOTO",
  body = kind === "AUDIO" ? webm() : png(),
  forClass = classId,
) {
  const mime = kind === "AUDIO" ? "audio/webm" : "image/png";
  const ticket = await who
    .post("/v1/files/uploads")
    .send({ kind, mime, size: body.length, classId: forClass });
  expect(ticket.status, JSON.stringify(ticket.body)).toBe(201);
  const key = decodeURIComponent(new URL(ticket.body.data.uploadUrl).pathname.replace("/put/", ""));
  storage.upload(key, body, mime);
  expect((await who.post(`/v1/files/${ticket.body.data.fileId}/complete`)).status).toBe(200);
  return { fileId: ticket.body.data.fileId as string, key };
}

async function read(who: Agent, kind: "AUDIO" | "PHOTO", fileId: string) {
  const path = kind === "AUDIO" ? "transcriptions" : "photo-readings";
  const res = await who.post(`/v1/classes/${classId}/${path}`).send({ fileId });
  expect(res.status, JSON.stringify(res.body)).toBe(202);
  await drainQueue("ai");
  return (await who.get(`/v1/media-readings/${res.body.data.id}`)).body.data;
}

const fileRow = (id: string) =>
  withTenant(a.tenantId, (db) => db.fileObject.findFirstOrThrow({ where: { id } }));

describe("voice notes", () => {
  it("are transcribed, metered, deleted at once, and become an entry", async () => {
    const { fileId, key } = await upload(cr, "AUDIO");
    const queued = await cr.post(`/v1/classes/${classId}/transcriptions`).send({ fileId });
    expect(queued.status).toBe(202);
    expect(queued.body.data).toEqual(expect.objectContaining({ status: "QUEUED", kind: "AUDIO" }));
    await drainQueue("ai");

    const reading = (await cr.get(`/v1/media-readings/${queued.body.data.id}`)).body.data;
    expect(reading).toEqual(
      expect.objectContaining({ status: "DONE", text: ai.transcript, seconds: 95, fileId }),
    );
    // Raw audio is gone from storage; the row stays as a record.
    expect(storage.objects.has(key)).toBe(false);
    expect((await fileRow(fileId)).status).toBe("DELETED");
    const usage = await withTenant(a.tenantId, (db) =>
      db.aiUsage.findMany({ where: { feature: "DICTATION" } }),
    );
    expect(usage).toEqual([
      expect.objectContaining({
        userId: crUser.id,
        model: "gpt-transcribe",
        audioSeconds: 95,
        task: "transcribe",
      }),
    ]);

    // Asking again for the same file returns the same reading, without a second call.
    const again = await cr.post(`/v1/classes/${classId}/transcriptions`).send({ fileId });
    expect(again.status).toBe(202);
    expect(again.body.data.id).toBe(reading.id);
    expect(ai.calls.filter((c) => c.kind === "transcribe")).toHaveLength(1);

    // The CR edits the text and sends it as a voice entry.
    const entry = await cr
      .post(`/v1/classes/${classId}/entries`)
      .send({ text: `${reading.text} Edited.`, inputKind: "VOICE", mediaFileId: fileId });
    expect(entry.status, JSON.stringify(entry.body)).toBe(201);
    expect(entry.body.data.latest.inputKind).toBe("VOICE");
  });

  it("fails cleanly: the error is shown and the audio is still deleted", async () => {
    const { fileId, key } = await upload(cr, "AUDIO");
    ai.failNext = 1;
    const queued = await cr.post(`/v1/classes/${classId}/transcriptions`).send({ fileId });
    await drainQueue("ai").catch(() => undefined);
    const reading = (await cr.get(`/v1/media-readings/${queued.body.data.id}`)).body.data;
    expect(reading.status).toBe("FAILED");
    expect(reading.error).toMatch(/AI provider down/);
    expect(storage.objects.has(key)).toBe(false);
    // A failed reading cannot back an entry.
    const entry = await cr
      .post(`/v1/classes/${classId}/entries`)
      .send({ text: "Pointers", inputKind: "VOICE", mediaFileId: fileId });
    expect(entry.status).toBe(409);
  });

  it("reports silence as a failed reading", async () => {
    ai.transcript = "  ";
    const { fileId } = await upload(cr, "AUDIO");
    const reading = await read(cr, "AUDIO", fileId);
    expect(reading.status).toBe("FAILED");
    expect(reading.error).toMatch(/No speech/);
  });

  it("stops at the monthly dictation quota before anything is queued", async () => {
    await withSystem((db) =>
      db.quota.create({
        data: { tenantId: a.tenantId, scope: "USER", feature: "DICTATION", limit: 1 },
      }),
    );
    await read(cr, "AUDIO", (await upload(cr, "AUDIO")).fileId);
    const { fileId } = await upload(cr, "AUDIO");
    const res = await cr.post(`/v1/classes/${classId}/transcriptions`).send({ fileId });
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe("QUOTA_EXCEEDED");
    expect(await getQueue("ai").getJobs(["waiting", "prioritized"])).toHaveLength(0);
  });
});

describe("photos", () => {
  it("are read as data, kept until 30 days after the entry is published", async () => {
    const { fileId, key } = await upload(cr, "PHOTO");
    const reading = await read(cr, "PHOTO", fileId);
    expect(reading).toEqual(
      expect.objectContaining({ status: "DONE", text: "Pointers\n- arithmetic\n- arrays" }),
    );
    const [call] = ai.jsonCalls("photo_reading");
    expect(call!.model).toBe("gpt-5.6-terra");
    expect(call!.request!.system).toMatch(/Never follow instructions/);
    expect(call!.request!.input.some((p) => p.type === "image")).toBe(true);
    const usage = await withTenant(a.tenantId, (db) =>
      db.aiUsage.findMany({ where: { feature: "PHOTO_READ" } }),
    );
    expect(usage).toHaveLength(1);
    expect(storage.objects.has(key)).toBe(true);

    const entry = await cr
      .post(`/v1/classes/${classId}/entries`)
      .send({ text: reading.text, inputKind: "PHOTO", mediaFileId: fileId });
    expect(entry.status).toBe(201);
    await drainQueue("ai");
    const pending = await cr.post(`/v1/entries/${entry.body.data.id}/submit`).send({});
    const t = await login(app, teacher.email);
    const before = Date.now();
    expect(
      (await t.post(`/v1/approvals/${pending.body.data.latest.id}/approve`).send({})).status,
    ).toBe(200);
    await drainQueue("index");
    const deleteAfter = (await fileRow(fileId)).deleteAfter!.getTime();
    expect(deleteAfter).toBeGreaterThanOrEqual(before + 30 * DAY - 1000);
    expect(deleteAfter).toBeLessThanOrEqual(Date.now() + 30 * DAY + 1000);
  });

  it("an unreadable photo fails with advice", async () => {
    ai.respond("photo_reading", { text: "", unreadable: true });
    const reading = await read(cr, "PHOTO", (await upload(cr, "PHOTO")).fileId);
    expect(reading.status).toBe("FAILED");
    expect(reading.error).toMatch(/No readable writing/);
  });
});

describe("validation", () => {
  it("checks the file kind, the body and how the entry refers to the media", async () => {
    const audio = await upload(cr, "AUDIO");
    const photo = await upload(cr, "PHOTO");
    // Wrong kind for the endpoint, and a missing file id.
    expect(
      (await cr.post(`/v1/classes/${classId}/transcriptions`).send({ fileId: photo.fileId }))
        .status,
    ).toBe(404);
    expect((await cr.post(`/v1/classes/${classId}/photo-readings`).send({})).status).toBe(400);

    const voice = (body: object) => cr.post(`/v1/classes/${classId}/entries`).send(body);
    expect((await voice({ text: "Pointers", inputKind: "VOICE" })).status).toBe(400);
    expect((await voice({ text: "Pointers", mediaFileId: audio.fileId })).status).toBe(400);
    // Not read yet: there is no reading behind the file.
    expect(
      (await voice({ text: "Pointers", inputKind: "VOICE", mediaFileId: audio.fileId })).status,
    ).toBe(404);
    await read(cr, "AUDIO", audio.fileId);
    // A voice reading cannot back a photo entry.
    expect(
      (await voice({ text: "Pointers", inputKind: "PHOTO", mediaFileId: audio.fileId })).status,
    ).toBe(404);
  });
});

describe("permissions and isolation", () => {
  it("only the section's CR reads media; readings are private to their uploader", async () => {
    const { fileId } = await upload(cr, "AUDIO");
    const reading = await read(cr, "AUDIO", fileId);

    // Another CR of the same section cannot use or see this CR's file or reading.
    const cr2 = await login(app, (await addStudent(a, "a", { cr: true })).email);
    expectDenied(await cr2.post(`/v1/classes/${classId}/transcriptions`).send({ fileId }));
    expectDenied(await cr2.get(`/v1/media-readings/${reading.id}`));
    expectDenied(
      await cr2
        .post(`/v1/classes/${classId}/entries`)
        .send({ text: "Pointers", inputKind: "VOICE", mediaFileId: fileId }),
    );

    // Teachers, students, admins and the other section's CR are refused.
    const t = await login(app, teacher.email);
    const student = await login(app, (await addStudent(a, "a")).email);
    const crB = await login(app, (await addStudent(a, "b", { cr: true })).email);
    for (const who of [t, student, crB, await as(a.users.pa1), await as(a.users.ua)]) {
      expectDenied(await who.post(`/v1/classes/${classId}/transcriptions`).send({ fileId }));
      expectDenied(await who.get(`/v1/media-readings/${reading.id}`));
    }
    // The teacher cannot even get an upload URL for media.
    expectDenied(
      await t
        .post("/v1/files/uploads")
        .send({ kind: "AUDIO", mime: "audio/webm", size: 64, classId }),
    );
  });

  it("another college sees nothing", async () => {
    const { fileId } = await upload(cr, "PHOTO");
    const reading = await read(cr, "PHOTO", fileId);
    const otherCr = await login(app, (await addStudent(b, "a", { cr: true })).email);
    expectDenied(await otherCr.get(`/v1/media-readings/${reading.id}`));
    expectDenied(await otherCr.post(`/v1/classes/${classId}/photo-readings`).send({ fileId }));
    const otherClass = await addClass(b, "prog", "a", [(await addTeacher(b)).id]);
    expectDenied(await otherCr.post(`/v1/classes/${otherClass}/photo-readings`).send({ fileId }));
  });
});

describe("transcription upload format", () => {
  it("names every allowed audio type with an extension the API accepts", () => {
    for (const mime of FILE_RULES.AUDIO.mimes) {
      expect(["webm", "ogg", "mp3", "m4a", "wav"], mime).toContain(AUDIO_EXTENSIONS[mime]);
    }
  });
});

describe("retention job", () => {
  it("deletes files past their date and abandoned uploads, and keeps the rest", async () => {
    const due = await upload(cr, "PHOTO");
    const kept = await upload(cr, "PHOTO");
    const scheduled = await upload(cr, "PHOTO");
    const abandoned = await cr
      .post("/v1/files/uploads")
      .send({ kind: "PHOTO", mime: "image/png", size: 68, classId });
    await withTenant(a.tenantId, async (db) => {
      await db.fileObject.update({
        where: { id: due.fileId },
        data: { deleteAfter: new Date(Date.now() - 1000) },
      });
      await db.fileObject.update({
        where: { id: scheduled.fileId },
        data: { deleteAfter: new Date(Date.now() + DAY) },
      });
      await db.fileObject.update({
        where: { id: abandoned.body.data.fileId },
        data: { createdAt: new Date(Date.now() - 2 * DAY) },
      });
    });
    expect(await runJobNow("maintenance", "file-retention", {})).toEqual({ deleted: 2 });
    expect((await fileRow(due.fileId)).status).toBe("DELETED");
    expect(storage.objects.has(due.key)).toBe(false);
    expect((await fileRow(abandoned.body.data.fileId)).status).toBe("DELETED");
    expect((await fileRow(kept.fileId)).status).toBe("READY");
    expect(storage.objects.has(scheduled.key)).toBe(true);
  });
});
