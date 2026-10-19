/**
 * A manual end-to-end check against the real OpenAI API (a few cents per run):
 *   pnpm --filter @semwise/api smoke:ai
 *
 * It builds a throwaway "Smoke test" college in the development database, uploads a small
 * syllabus PDF through the real syllabus flow (signed upload to local storage, extraction job,
 * publish job with embeddings), creates and publishes one class entry, and prints the outline,
 * how the entry was organized and mapped, and the cost written to the usage ledger. It also sends
 * a one-page PDF with almost no text layer, which takes the scanned path (the PDF itself goes to
 * the model), has the CR transcribe a short spoken clip and read a whiteboard photo, and asks
 * two chat questions as a student.
 * Without OPENAI_API_KEY it does nothing. Never run by `pnpm test`.
 *
 * Jobs run in-process under their own queue prefix, so a running dev worker does not take them.
 */
import type { TopicNode } from "@semwise/shared";

if (!process.env.OPENAI_API_KEY) {
  console.log("OPENAI_API_KEY is not set: the AI smoke test was skipped.");
  process.exit(0);
}
process.env.QUEUE_PREFIX = "semwise-smoke";
process.env.LOG_LEVEL = "warn";

const [
  { default: request },
  { createApp },
  { withSystem },
  { hashPassword },
  { loadJobHandlers, runJobNow },
  { getQueue, closeQueues },
  { makePdf },
  { knowledgeService },
  { prisma },
  { speech, whiteboardPng },
] = await Promise.all([
  import("supertest"),
  import("../app.js"),
  import("../common/db/scope.js"),
  import("../modules/auth/index.js"),
  import("../jobs/index.js"),
  import("../lib/queue.js"),
  import("../test/fakes.js"),
  import("../modules/knowledge/index.js"),
  import("../lib/prisma.js"),
  import("./smoke-fixtures.js"),
]);

type QueueName = Parameters<typeof getQueue>[0];
type Agent = ReturnType<typeof request.agent>;

const PASSWORD = "smoke test password 1234";
const stamp = Date.now().toString(36);

const SYLLABUS = makePdf([
  [
    "Tribhuvan University - Bachelor in Information Technology, Second Semester",
    "Course Title: Data Structures and Algorithms    Course No: BIT 201    Credit Hours: 3",
    "Course Description: This course covers linear and non-linear data structures and the",
    "analysis of basic algorithms that operate on them.",
    "Unit 1: Introduction (4 hours)",
    "Abstract data types; Time and space complexity; Big-O, Omega and Theta notation.",
    "Unit 2: Stacks and Queues (8 hours)",
    "Stack operations; Infix to postfix conversion; Evaluation of postfix expressions;",
    "Linear queue; Circular queue; Priority queue.",
  ],
  [
    "Unit 3: Linked Lists (8 hours)",
    "Singly linked list: insertion, deletion and traversal; Doubly linked list;",
    "Circular linked list; Linked implementation of stacks and queues.",
    "Unit 4: Trees (10 hours)",
    "Binary trees; Binary search trees; Tree traversals (preorder, inorder, postorder);",
    "AVL trees and rotations; Heaps and heap sort.",
    "Reference Books:",
    "1. Data Structures Using C and C++, Langsam, Augenstein and Tanenbaum",
    "2. Introduction to Algorithms, Cormen, Leiserson, Rivest and Stein",
  ],
]);

/** Under 200 characters of text per page, so it takes the scanned path. */
const SCANNED = makePdf([
  [
    "Course: Discrete Structures (BIT 102)",
    "Unit 1: Logic (6 hours). Propositions, truth tables, quantifiers.",
    "Unit 2: Sets (5 hours). Set operations, relations.",
  ],
]);

const LESSON = `Today sir finished stacks. We did infix to postfix conversion with the operator stack
method, worked two examples on the board (a+b*c and (a+b)*(c-d)), then evaluated a postfix
expression step by step. Last 10 minutes he started circular queue - why linear queue wastes
space, front and rear pointers, and the (rear+1) % size check for full. Also mentioned that
we will use stacks for recursion later, and gave homework: convert 5 infix expressions.`;

async function drain(queue: QueueName): Promise<void> {
  for (let round = 0; round < 10; round++) {
    const jobs = await getQueue(queue).getJobs(["waiting", "prioritized", "delayed"]);
    if (jobs.length === 0) return;
    for (const job of jobs) {
      const started = Date.now();
      await runJobNow(queue, job.name, job.data);
      await job.remove();
      console.log(
        `  job ${queue}/${job.name} done in ${((Date.now() - started) / 1000).toFixed(1)}s`,
      );
    }
  }
}

function ok(res: { status: number; body: unknown }, expected: number, step: string) {
  if (res.status !== expected) {
    throw new Error(`${step}: expected ${expected}, got ${res.status} ${JSON.stringify(res.body)}`);
  }
  return (res.body as { data: Record<string, unknown> }).data;
}

async function login(app: ReturnType<typeof createApp>, email: string): Promise<Agent> {
  const agent = request.agent(app);
  ok(await agent.post("/v1/auth/login").send({ email, password: PASSWORD }), 200, "login");
  return agent;
}

/** The browser's part of an upload: ticket, PUT to the signed URL, complete. */
async function upload(
  agent: Agent,
  target: { subjectId: string } | { classId: string },
  bytes: Uint8Array,
  kind: "SYLLABUS_PDF" | "AUDIO" | "PHOTO" = "SYLLABUS_PDF",
  mime = "application/pdf",
): Promise<string> {
  const ticket = ok(
    await agent.post("/v1/files/uploads").send({ kind, mime, size: bytes.length, ...target }),
    201,
    "upload ticket",
  ) as { fileId: string; uploadUrl: string };
  const put = await fetch(ticket.uploadUrl, {
    method: "PUT",
    body: Buffer.from(bytes),
    headers: { "Content-Type": mime },
  });
  if (!put.ok) throw new Error(`PUT to storage failed: ${put.status} (is \`pnpm db:up\` running?)`);
  ok(await agent.post(`/v1/files/${ticket.fileId}/complete`), 200, "upload complete");
  return ticket.fileId;
}

function printTree(nodes: TopicNode[], depth = 0) {
  for (const n of nodes) {
    const flag = n.confidence < 60 ? "  <- low confidence" : "";
    const hours = n.hours !== null ? ` (${n.hours} h)` : "";
    console.log(
      `${"  ".repeat(depth + 1)}${n.kind.padEnd(8)} ${n.title}${hours}  [p${n.sourcePage ?? "?"}, ${n.confidence}%]${flag}`,
    );
    printTree(n.children, depth + 1);
  }
}

function flatten(nodes: TopicNode[]): TopicNode[] {
  return nodes.flatMap((n) => [n, ...flatten(n.children)]);
}

async function main() {
  await loadJobHandlers();
  const app = createApp();

  // ---------- A throwaway college ----------
  const passwordHash = await hashPassword(PASSWORD);
  const ids = await withSystem(async (db) => {
    const tenant = await db.tenant.create({
      data: {
        name: `Smoke test ${stamp}`,
        slug: `smoke-${stamp}`,
        timezone: "Asia/Kathmandu",
        status: "ACTIVE",
      },
    });
    const tenantId = tenant.id;
    const mkUser = (label: string) =>
      db.user.create({
        data: {
          email: `smoke-${label}-${stamp}@example.com`,
          displayName: `Smoke ${label}`,
          status: "ACTIVE",
          passwordHash,
        },
      });
    const [admin, teacher, cr] = [
      await mkUser("admin"),
      await mkUser("teacher"),
      await mkUser("cr"),
    ];
    const program = await db.program.create({ data: { tenantId, name: "BIT", code: "BIT" } });
    const batch = await db.batch.create({
      data: { tenantId, programId: program.id, name: "BIT 2026", intakeYear: 2026 },
    });
    const path = { tenantId, programId: program.id, batchId: batch.id };
    const semester = await db.semester.create({ data: { ...path, number: 2, status: "ACTIVE" } });
    const sem = { ...path, semesterId: semester.id };
    const section = await db.section.create({ data: { ...sem, name: "A" } });
    const dsa = await db.subject.create({
      data: { ...sem, name: "Data Structures and Algorithms", code: "BIT201" },
    });
    const discrete = await db.subject.create({
      data: { ...sem, name: "Discrete Structures", code: "BIT102" },
    });
    await db.membership.create({
      data: { userId: admin.id, tenantId, role: "PROGRAM_ADMIN", programId: program.id },
    });
    await db.membership.create({ data: { userId: teacher.id, tenantId, role: "TEACHER" } });
    const record = await db.studentRecord.create({
      data: { ...path, userId: cr.id, email: cr.email, rollNo: "SMOKE-1", status: "ACTIVE" },
    });
    await db.enrollment.create({
      data: { ...sem, sectionId: section.id, studentRecordId: record.id },
    });
    await db.membership.create({ data: { userId: cr.id, tenantId, role: "STUDENT" } });
    await db.membership.create({
      data: { userId: cr.id, tenantId, role: "CR", sectionId: section.id },
    });
    return {
      tenantId,
      admin: admin.email,
      teacher: { id: teacher.id, email: teacher.email },
      cr: cr.email,
      section: section.id,
      dsa: dsa.id,
      discrete: discrete.id,
    };
  });
  console.log(`College: Smoke test ${stamp} (tenant ${ids.tenantId})\n`);
  const admin = await login(app, ids.admin);
  const teacher = await login(app, ids.teacher.email);

  // ---------- Syllabus: upload, extract, publish ----------
  console.log("1. Syllabus with a text layer (Data Structures and Algorithms)");
  const fileId = await upload(admin, { subjectId: ids.dsa }, SYLLABUS);
  const draft = ok(
    await admin.post(`/v1/subjects/${ids.dsa}/syllabus/drafts`).send({ fileId }),
    202,
    "start draft",
  ) as { id: string };
  await drain("ai");
  const read = ok(await admin.get(`/v1/syllabus/versions/${draft.id}`), 200, "view draft") as {
    extraction: string;
    extractionError: string | null;
    usedOcr: boolean;
    suggestedName: string | null;
    suggestedCode: string | null;
    credits: number | null;
    references: { title: string; author: string | null }[];
    topics: TopicNode[];
  };
  if (read.extraction !== "DONE")
    throw new Error(`Extraction ${read.extraction}: ${read.extractionError}`);
  console.log(
    `  Read as: ${read.suggestedName} (${read.suggestedCode}), ${read.credits} credits, scanned path: ${read.usedOcr}`,
  );
  printTree(read.topics);
  for (const r of read.references)
    console.log(`  REF      ${r.title}${r.author ? ` - ${r.author}` : ""}`);

  ok(await admin.post(`/v1/syllabus/versions/${draft.id}/publish`).send({}), 202, "publish");
  await drain("index");
  const live = ok(await admin.get(`/v1/subjects/${ids.dsa}/syllabus`), 200, "live syllabus") as {
    id: string;
    topics: TopicNode[];
  };
  console.log(
    `  Published: live version ${live.id === draft.id ? "is the new draft" : "MISMATCH"}\n`,
  );

  // ---------- Scanned path: the PDF itself goes to the model ----------
  console.log("2. Syllabus without a usable text layer (Discrete Structures, sent as a PDF)");
  const scannedFile = await upload(admin, { subjectId: ids.discrete }, SCANNED);
  const scannedDraft = ok(
    await admin.post(`/v1/subjects/${ids.discrete}/syllabus/drafts`).send({ fileId: scannedFile }),
    202,
    "start scanned draft",
  ) as { id: string };
  await drain("ai");
  const scanned = ok(await admin.get(`/v1/syllabus/versions/${scannedDraft.id}`), 200, "view") as {
    extraction: string;
    extractionError: string | null;
    usedOcr: boolean;
    topics: TopicNode[];
  };
  console.log(`  Extraction: ${scanned.extraction}, scanned path: ${scanned.usedOcr}`);
  if (scanned.extractionError) console.log(`  Error: ${scanned.extractionError}`);
  printTree(scanned.topics);
  console.log();

  // ---------- A class entry, organized and mapped ----------
  console.log("3. One class entry by the subject teacher");
  const klass = ok(
    await admin
      .post("/v1/classes")
      .send({ subjectId: ids.dsa, sectionId: ids.section, teacherUserIds: [ids.teacher.id] }),
    201,
    "create class",
  ) as { id: string };
  const entry = ok(
    await teacher.post(`/v1/classes/${klass.id}/entries`).send({ text: LESSON }),
    201,
    "create entry",
  ) as { id: string };
  await drain("ai");
  const organized = ok(await teacher.get(`/v1/entries/${entry.id}`), 200, "view entry") as {
    latest: {
      organize: string;
      organizeError: string | null;
      summary: string | null;
      topics: {
        title: string;
        subtopics: string[];
        stableKey: string | null;
        confidence: number;
      }[];
    };
  };
  const v = organized.latest;
  if (v.organize !== "DONE") throw new Error(`Organizing ${v.organize}: ${v.organizeError}`);
  const byKey = new Map(flatten(live.topics).map((t) => [t.stableKey, t]));
  for (const t of v.topics) {
    const target = t.stableKey ? byKey.get(t.stableKey) : undefined;
    console.log(
      `  TOPIC  ${t.title}  ->  ${target ? `${target.kind} "${target.title}"` : "outside the syllabus"} (${t.confidence}%)`,
    );
    for (const s of t.subtopics) console.log(`         - ${s}`);
  }
  console.log(`  Summary: ${v.summary}`);
  ok(await teacher.post(`/v1/entries/${entry.id}/submit`).send({}), 200, "submit entry");
  await drain("index");
  const published = ok(await teacher.get(`/v1/entries/${entry.id}`), 200, "entry") as {
    live: { id: string } | null;
  };
  console.log(`  Published by the teacher: ${published.live ? "yes" : "NO"}\n`);

  // ---------- Voice and photo (CR) ----------
  const crAgent = await login(app, ids.cr);
  const readMedia = async (kind: "AUDIO" | "PHOTO", bytes: Uint8Array, mime: string) => {
    const mediaId = await upload(crAgent, { classId: klass.id }, bytes, kind, mime);
    const path = kind === "AUDIO" ? "transcriptions" : "photo-readings";
    const started = ok(
      await crAgent.post(`/v1/classes/${klass.id}/${path}`).send({ fileId: mediaId }),
      202,
      path,
    ) as { id: string };
    await drain("ai");
    return ok(await crAgent.get(`/v1/media-readings/${started.id}`), 200, "reading") as {
      status: string;
      text: string | null;
      error: string | null;
      seconds: number | null;
    };
  };
  console.log("4. A CR's voice note (a spoken clip made with text-to-speech)");
  const clip = await speech(
    "Today we finished stacks. Infix to postfix conversion using the operator stack, then evaluation of postfix expressions. In the last ten minutes we started circular queues.",
  );
  const voice = await readMedia("AUDIO", clip, "audio/mpeg");
  console.log(`  ${voice.status}, ${voice.seconds} s: ${voice.text ?? voice.error}\n`);
  if (voice.status !== "DONE") throw new Error(`Transcription ${voice.status}: ${voice.error}`);

  console.log("5. A CR's whiteboard photo (a drawn PNG)");
  const board = whiteboardPng(["STACK - PUSH POP", "INFIX TO POSTFIX", "CIRCULAR QUEUE"]);
  const photo = await readMedia("PHOTO", board, "image/png");
  console.log(`  ${photo.status}:`);
  for (const line of (photo.text ?? photo.error ?? "").split("\n")) console.log(`    ${line}`);
  if (photo.status !== "DONE") throw new Error(`Photo reading ${photo.status}: ${photo.error}`);
  console.log();

  // ---------- Student Q&A ----------
  console.log("6. Student questions (the CR is also a student of the section)");
  const chat = ok(await crAgent.post("/v1/chat/conversations").send({}), 201, "new chat") as {
    id: string;
  };
  for (const q of [
    "How do I convert an infix expression to postfix? Did we do examples in class?",
    "Write me a poem about the monsoon.",
  ]) {
    const res = ok(
      await crAgent.post(`/v1/chat/conversations/${chat.id}/messages`).send({ text: q }),
      200,
      "ask",
    ) as {
      answer: {
        content: string;
        scope: string;
        labels: string[];
        citations: {
          kind: string;
          unitNo: number | null;
          unitTitle: string | null;
          topicTitle: string | null;
          taughtOn: string | null;
        }[];
      };
      quota: { used: number; limit: number | null };
    };
    const a = res.answer;
    console.log(`  Q: ${q}`);
    console.log(`  ${a.scope}; labels: ${a.labels.join(", ") || "none"}`);
    for (const c of a.citations) {
      console.log(
        c.kind === "SYLLABUS"
          ? `    cites syllabus unit ${c.unitNo}: ${c.unitTitle} > ${c.topicTitle ?? ""}`
          : `    cites class of ${c.taughtOn}`,
      );
    }
    console.log(`  A: ${a.content.replace(/\n+/g, "\n     ")}`);
    console.log(`  Questions used this month: ${res.quota.used} of ${res.quota.limit}\n`);
  }

  // ---------- The ledger ----------
  console.log("7. Usage ledger for this college (text-to-speech for the clip is not in it)");
  const rows = await withSystem((db) =>
    db.aiUsage.findMany({ where: { tenantId: ids.tenantId }, orderBy: { createdAt: "asc" } }),
  );
  let total = 0;
  for (const r of rows) {
    total += r.costMicros;
    console.log(
      `  ${r.feature.padEnd(16)} ${r.task.padEnd(10)} ${r.model.padEnd(24)} in ${String(r.inputTokens).padStart(6)}  out ${String(r.outputTokens).padStart(5)}  cached ${String(r.cachedTokens).padStart(5)}${r.audioSeconds ? `  audio ${r.audioSeconds}s` : ""}  $${(r.costMicros / 1e6).toFixed(5)}${r.priceId ? "" : "  (no price row)"}`,
    );
  }
  console.log(`  Total: $${(total / 1e6).toFixed(4)} over ${rows.length} calls`);

  // Vectors of the throwaway college are removed; its rows stay in the dev database.
  const scope = { tenantId: ids.tenantId };
  await knowledgeService.removeVersions(scope, "SYLLABUS_TOPIC", [draft.id]);
  if (published.live)
    await knowledgeService.removeVersions(scope, "ENTRY_VERSION", [published.live.id]);
}

try {
  await main();
  console.log("\nSmoke test passed.");
} catch (err) {
  console.error(`\nSmoke test failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
} finally {
  await closeQueues();
  await prisma.$disconnect();
  process.exit();
}
