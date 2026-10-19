import type { SyllabusExtraction } from "../modules/ai/index.js";
import type { FakeAi, FakeStorage } from "./fakes.js";
import { makePdf } from "./fakes.js";
import type { Agent } from "./helpers.js";
import { drainQueue } from "./jobs.js";

/** The outline the fake AI "reads" from a syllabus PDF. */
export function sampleOutline(overrides: Partial<SyllabusExtraction> = {}): SyllabusExtraction {
  return {
    subjectName: "Programming in C",
    subjectCode: "CSC 102",
    credits: 3,
    units: [
      {
        title: "Introduction",
        description: null,
        hours: 5,
        sourcePage: 1,
        confidence: 95,
        topics: [
          {
            title: "History of C",
            description: null,
            sourcePage: 1,
            confidence: 90,
            subtopics: [{ title: "ANSI C", sourcePage: 1, confidence: 40 }],
          },
        ],
      },
      {
        title: "Pointers",
        description: "Memory addresses and indirection",
        hours: 8,
        sourcePage: 2,
        confidence: 92,
        topics: [
          {
            title: "Pointer arithmetic",
            description: null,
            sourcePage: 2,
            confidence: 88,
            subtopics: [],
          },
          {
            title: "Arrays and pointers",
            description: null,
            sourcePage: 2,
            confidence: 85,
            subtopics: [],
          },
        ],
      },
    ],
    references: [{ title: "Let Us C", author: "Yashavant Kanetkar", sourcePage: 2 }],
    ...overrides,
  };
}

export const samplePdf = () =>
  makePdf([
    [
      "Course: Programming in C (CSC 102), 3 credits",
      "Unit 1: Introduction (5 hours). History of C, ANSI C, the structure of a C program and compilation.",
      "Students learn how C evolved, why it matters for systems programming and how programs are built.",
    ],
    [
      "Unit 2: Pointers (8 hours). Pointer arithmetic, arrays and pointers, memory addresses and indirection.",
      "Reference: Let Us C, Yashavant Kanetkar. Additional reading on memory layout and dynamic allocation.",
    ],
  ]);

/** Uploads a PDF the way the browser does: ticket, PUT to the signed URL, complete. */
export async function uploadPdf(
  agent: Agent,
  storage: FakeStorage,
  target: { semesterId?: string; subjectId?: string },
  pdf = samplePdf(),
): Promise<string> {
  const ticket = await agent
    .post("/v1/files/uploads")
    .send({ kind: "SYLLABUS_PDF", mime: "application/pdf", size: pdf.length, ...target });
  if (ticket.status !== 201) throw new Error(JSON.stringify(ticket.body));
  const key = decodeURIComponent(new URL(ticket.body.data.uploadUrl).pathname.replace("/put/", ""));
  storage.upload(key, pdf, "application/pdf");
  const done = await agent.post(`/v1/files/${ticket.body.data.fileId}/complete`);
  if (done.status !== 200) throw new Error(JSON.stringify(done.body));
  return ticket.body.data.fileId;
}

/** Upload, draft, extract and publish a subject's syllabus; returns the live version id. */
export async function publishSyllabus(
  admin: Agent,
  storage: FakeStorage,
  ai: FakeAi,
  subjectId: string,
  outline = sampleOutline(),
): Promise<string> {
  ai.respond("syllabus_outline", outline);
  const fileId = await uploadPdf(admin, storage, { subjectId });
  const draft = await admin.post(`/v1/subjects/${subjectId}/syllabus/drafts`).send({ fileId });
  if (draft.status !== 202) throw new Error(JSON.stringify(draft.body));
  await drainQueue("ai");
  const published = await admin
    .post(`/v1/syllabus/versions/${draft.body.data.id}/publish`)
    .send({});
  if (published.status !== 202) throw new Error(JSON.stringify(published.body));
  await drainQueue("index");
  return draft.body.data.id;
}
