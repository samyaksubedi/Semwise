/**
 * A demo college for local development and screenshots:
 *   pnpm --filter @semwise/api seed:demo
 *
 * Creates (or recreates) "Demo College" with one account per role, a program with a batch,
 * semester, sections and subjects, published syllabi, classes, a week of class entries and one
 * entry waiting for the teacher, plus a Super Admin (platform@...). With OPENAI_API_KEY set it also indexes the content (a fraction
 * of a cent) so chat can answer. Every account uses the password printed at the end.
 * Development only: it refuses to run with NODE_ENV=production.
 */
import { randomUUID } from "node:crypto";
import { withSystem, withTenant } from "../common/db/scope.js";
import { todayIn, addDays } from "../common/time.js";
import { env } from "../config/env.js";
import { prisma } from "../lib/prisma.js";
import { closeQueues } from "../lib/queue.js";
import { closeRedis } from "../lib/redis.js";
import { isAiConfigured } from "../modules/ai/index.js";
import { hashPassword } from "../modules/auth/index.js";
import { knowledgeService } from "../modules/knowledge/index.js";
import { membershipsService } from "../modules/memberships/index.js";
import { sessionsService } from "../modules/sessions/index.js";
import { chunksFor } from "../modules/syllabus/syllabus.tree.js";

const PASSWORD = "semwise demo 2026";
const SLUG = "demo-college";
/** Slug prefix of colleges created by the browser tests (apps/web/e2e). */
const E2E_SLUG = "e2e-";
const TZ = "Asia/Kathmandu";
const mail = (name: string) => `${name}@demo.semwise.local`;

type Outline = { title: string; hours: number; topics: (string | [string, string[]])[] }[];

const PROG: Outline = [
  {
    title: "Introduction to C",
    hours: 4,
    topics: ["History of C", "Structure of a C program", "Compilation and linking"],
  },
  {
    title: "Operators and expressions",
    hours: 6,
    topics: ["Arithmetic and relational operators", "Type conversion", "Operator precedence"],
  },
  {
    title: "Control flow",
    hours: 8,
    topics: [["Decision making", ["if and else", "switch"]], "Loops", "break and continue"],
  },
  {
    title: "Pointers",
    hours: 8,
    topics: ["Pointer arithmetic", "Arrays and pointers", "Pointers to functions"],
  },
  { title: "Structures and files", hours: 6, topics: ["Structures and unions", "File handling"] },
];
const MATH: Outline = [
  {
    title: "Limits and continuity",
    hours: 8,
    topics: ["Limits of functions", "Continuity", "Indeterminate forms"],
  },
  {
    title: "Derivatives",
    hours: 10,
    topics: ["Rules of differentiation", "Chain rule", "Applications of derivatives"],
  },
  {
    title: "Integration",
    hours: 10,
    topics: ["Indefinite integrals", "Definite integrals", "Area under a curve"],
  },
];

/** Entries of the past days: [days ago, subject, topics, summary]. */
const ENTRIES: [number, "prog" | "math", string[], string][] = [
  [
    6,
    "prog",
    ["History of C", "Structure of a C program"],
    "We saw how C grew out of B at Bell Labs and walked through the parts of a C program: headers, main, statements and return.",
  ],
  [
    5,
    "math",
    ["Limits of functions"],
    "Limits were introduced with tables of values and graphs; left and right limits must agree for a limit to exist.",
  ],
  [
    4,
    "prog",
    ["Arithmetic and relational operators", "Operator precedence"],
    "Operators in C, with a precedence table on the board. Homework: evaluate ten expressions by hand.",
  ],
  [
    3,
    "math",
    ["Continuity", "Indeterminate forms"],
    "A function is continuous where its limit equals its value. We practised 0/0 forms by factoring.",
  ],
  [
    1,
    "prog",
    ["Decision making", "Loops"],
    "if, else and switch, then for and while loops with examples counting and summing numbers.",
  ],
  [
    0,
    "prog",
    ["Pointer arithmetic", "Arrays and pointers"],
    "Pointers hold addresses; adding one moves to the next element. An array name behaves like a pointer to its first element.",
  ],
];

async function main() {
  if (env.NODE_ENV === "production") throw new Error("seed:demo is for development only");
  const passwordHash = await hashPassword(PASSWORD);
  const today = todayIn(TZ);
  const day = (n: number) => new Date(`${addDays(today, -n)}T00:00:00.000Z`);

  // Start over: the demo college and everything in it.
  const old = await withSystem((db) => db.tenant.findUnique({ where: { slug: SLUG } }));
  if (old) {
    const versions = await withTenant(old.id, (db) =>
      db.indexedChunk.findMany({
        where: { tenantId: old.id, status: "LIVE" },
        select: { sourceType: true, sourceVersionId: true },
      }),
    );
    for (const type of ["SYLLABUS_TOPIC", "ENTRY_VERSION"] as const) {
      const ids = [
        ...new Set(versions.filter((v) => v.sourceType === type).map((v) => v.sourceVersionId)),
      ];
      await knowledgeService.removeVersions({ tenantId: old.id }, type, ids).catch(() => undefined);
    }
    await withSystem((db) => db.tenant.delete({ where: { id: old.id } }));
  }
  // Colleges the browser tests created as the demo Super Admin (they hold no content).
  await withSystem((db) => db.tenant.deleteMany({ where: { slug: { startsWith: E2E_SLUG } } }));

  const ids = await withSystem(async (db) => {
    const user = (name: string, displayName: string) =>
      db.user.upsert({
        where: { email: mail(name) },
        create: { email: mail(name), displayName, status: "ACTIVE", passwordHash },
        update: {
          displayName,
          status: "ACTIVE",
          passwordHash,
          failedLoginCount: 0,
          lockedUntil: null,
        },
      });
    const people = {
      ua: await user("admin", "Anita Shrestha"),
      pa: await user("program", "Bikash Thapa"),
      teacher: await user("teacher", "Sita Karki"),
      teacher2: await user("teacher2", "Ramesh Adhikari"),
      cr: await user("cr", "Aarav Gurung"),
      student: await user("student", "Priya Maharjan"),
      student2: await user("student2", "Nabin Rai"),
      // More joined classmates in section A, so a section can fill up with CRs.
      student3: await user("student3", "Asha Bhandari"),
      student4: await user("student4", "Dipesh KC"),
      student5: await user("student5", "Manisha Rana"),
      platform: await user("platform", "Platform Operator"),
    };
    await membershipsService.grantSuperAdmin(people.platform.id);
    const tenant = await db.tenant.create({
      data: { name: "Demo College", slug: SLUG, timezone: TZ, status: "ACTIVE" },
    });
    const tenantId = tenant.id;
    const bit = await db.program.create({
      data: { tenantId, name: "Bachelor in Information Technology", code: "BIT" },
    });
    await db.program.create({
      data: { tenantId, name: "Bachelor in Computer Applications", code: "BCA" },
    });
    const batch = await db.batch.create({
      data: { tenantId, programId: bit.id, name: "BIT 2026", intakeYear: 2026 },
    });
    const path = { tenantId, programId: bit.id, batchId: batch.id };
    const semester = await db.semester.create({
      data: {
        ...path,
        number: 1,
        status: "ACTIVE",
        startDate: day(40),
        endDate: new Date(`${addDays(today, 80)}T00:00:00.000Z`),
      },
    });
    const sem = { ...path, semesterId: semester.id };
    const sectionA = await db.section.create({ data: { ...sem, name: "A" } });
    const sectionB = await db.section.create({ data: { ...sem, name: "B" } });
    const prog = await db.subject.create({
      data: { ...sem, name: "Programming in C", code: "CSC102", credits: 3 },
    });
    const math = await db.subject.create({
      data: { ...sem, name: "Mathematics I", code: "MTH101", credits: 3 },
    });
    await db.subject.create({
      data: { ...sem, name: "Digital Logic", code: "CSC103", credits: 3 },
    });

    const member = (
      userId: string,
      role: "UNIVERSITY_ADMIN" | "PROGRAM_ADMIN" | "TEACHER" | "STUDENT" | "CR",
      scope: { programId?: string; sectionId?: string } = {},
    ) => db.membership.create({ data: { userId, tenantId, role, ...scope } });
    await member(people.ua.id, "UNIVERSITY_ADMIN");
    await member(people.pa.id, "PROGRAM_ADMIN", { programId: bit.id });
    await member(people.teacher.id, "TEACHER");
    await member(people.teacher2.id, "TEACHER");

    const enrol = async (
      u: { id: string; email: string; displayName: string },
      rollNo: string,
      sectionId: string,
    ) => {
      const record = await db.studentRecord.create({
        data: {
          ...path,
          userId: u.id,
          email: u.email,
          displayName: u.displayName,
          rollNo,
          status: "ACTIVE",
        },
      });
      await db.enrollment.create({ data: { ...sem, sectionId, studentRecordId: record.id } });
      await member(u.id, "STUDENT");
      return record;
    };
    await enrol(people.cr, "BIT-001", sectionA.id);
    await member(people.cr.id, "CR", { sectionId: sectionA.id });
    await enrol(people.student, "BIT-002", sectionA.id);
    await enrol(people.student2, "BIT-031", sectionB.id);
    await enrol(people.student3, "BIT-003", sectionA.id);
    await enrol(people.student4, "BIT-004", sectionA.id);
    await enrol(people.student5, "BIT-005", sectionA.id);
    // Students invited but not joined yet.
    for (const [i, name] of ["Kiran Lama", "Sabina Tamang", "Rohan Joshi"].entries()) {
      const email = mail(`invited${i + 1}`);
      const invitation = await db.invitation.create({
        data: {
          tenantId,
          email,
          displayName: name,
          rollNo: `BIT-0${10 + i}`,
          role: "STUDENT",
          programId: bit.id,
          batchId: batch.id,
          semesterId: semester.id,
          sectionId: sectionA.id,
          tokenHash: randomUUID(),
          expiresAt: new Date(Date.now() + 7 * 86_400_000),
          invitedById: people.pa.id,
          sendCount: 1,
          lastSentAt: new Date(),
        },
      });
      const record = await db.studentRecord.create({
        data: {
          ...path,
          email,
          displayName: name,
          rollNo: `BIT-0${10 + i}`,
          status: "INVITED",
          invitationId: invitation.id,
        },
      });
      await db.enrollment.create({
        data: { ...sem, sectionId: sectionA.id, studentRecordId: record.id },
      });
    }

    // Published syllabi.
    const publish = async (subjectId: string, outline: Outline) => {
      const syllabus = await db.syllabus.create({ data: { ...sem, subjectId } });
      const version = await db.syllabusVersion.create({
        data: {
          tenantId,
          syllabusId: syllabus.id,
          versionNo: 1,
          status: "PUBLISHED",
          extraction: "DONE",
          credits: 3,
          effectiveFrom: day(40),
          publishedAt: new Date(),
          publishedById: people.pa.id,
          createdById: people.pa.id,
          references: [
            {
              title: subjectId === prog.id ? "Let Us C" : "Calculus",
              author: subjectId === prog.id ? "Yashavant Kanetkar" : "Thomas and Finney",
              sourcePage: 2,
            },
          ],
        },
      });
      const keyOf = new Map<string, string>();
      let order = 0;
      for (const [u, unit] of outline.entries()) {
        const unitRow = await db.syllabusTopic.create({
          data: {
            tenantId,
            versionId: version.id,
            stableKey: `tk_${randomUUID().slice(0, 16)}`,
            kind: "UNIT",
            title: unit.title,
            hours: unit.hours,
            orderIndex: u,
            sourcePage: 1 + Math.floor(u / 2),
          },
        });
        for (const [ti, topic] of unit.topics.entries()) {
          const [title, subs] = Array.isArray(topic) ? topic : [topic, []];
          const stableKey = `tk_${randomUUID().slice(0, 16)}`;
          keyOf.set(title, stableKey);
          const topicRow = await db.syllabusTopic.create({
            data: {
              tenantId,
              versionId: version.id,
              parentId: unitRow.id,
              stableKey,
              kind: "TOPIC",
              title,
              orderIndex: ti,
              sourcePage: unitRow.sourcePage,
              confidence: title === "Type conversion" ? 55 : 95,
            },
          });
          for (const [si, sub] of subs.entries()) {
            await db.syllabusTopic.create({
              data: {
                tenantId,
                versionId: version.id,
                parentId: topicRow.id,
                stableKey: `tk_${randomUUID().slice(0, 16)}`,
                kind: "SUBTOPIC",
                title: sub,
                orderIndex: si,
                sourcePage: unitRow.sourcePage,
              },
            });
          }
          order += 1;
        }
      }
      await db.syllabus.update({
        where: { id: syllabus.id },
        data: { currentVersionId: version.id },
      });
      return { versionId: version.id, keyOf, order };
    };
    const progSyllabus = await publish(prog.id, PROG);
    const mathSyllabus = await publish(math.id, MATH);

    const klass = (subjectId: string, sectionId: string, teacherId: string) =>
      db.class.create({
        data: {
          ...sem,
          subjectId,
          sectionId,
          teachers: { create: [{ userId: teacherId, isPrimary: true }] },
        },
      });
    const progA = await klass(prog.id, sectionA.id, people.teacher.id);
    const mathA = await klass(math.id, sectionA.id, people.teacher2.id);
    const progB = await klass(prog.id, sectionB.id, people.teacher.id);

    // A week of entries, written by the CR and approved by the teacher.
    const entry = async (
      klassRow: { id: string; subjectId: string; sectionId: string },
      daysAgo: number,
      topics: string[],
      summary: string,
      keyOf: Map<string, string>,
      syllabusVersionId: string,
      status: "PUBLISHED" | "PENDING",
    ) => {
      const session = await db.classSession.upsert({
        where: { classId_taughtOn: { classId: klassRow.id, taughtOn: day(daysAgo) } },
        create: {
          tenantId,
          classId: klassRow.id,
          taughtOn: day(daysAgo),
          createdById: people.cr.id,
        },
        update: {},
      });
      const created = await db.entry.create({
        data: {
          ...sem,
          sessionId: session.id,
          classId: klassRow.id,
          sectionId: klassRow.sectionId,
          subjectId: klassRow.subjectId,
          taughtOn: day(daysAgo),
          authorId: people.cr.id,
        },
      });
      const structured = {
        topics: topics.map((title) => ({
          title,
          subtopics: [],
          stableKey: keyOf.get(title) ?? null,
          confidence: 90,
        })),
      };
      const version = await db.entryVersion.create({
        data: {
          tenantId,
          entryId: created.id,
          versionNo: 1,
          status,
          inputKind: "TEXT",
          rawText: `${topics.join(", ")}. ${summary}`,
          structured,
          summary,
          organize: "DONE",
          syllabusVersionId,
          authorId: people.cr.id,
          submittedAt: new Date(Date.now() - daysAgo * 86_400_000),
          ...(status === "PUBLISHED"
            ? { approvedById: people.teacher.id, decidedAt: new Date() }
            : {}),
        },
      });
      for (const title of topics) {
        const key = keyOf.get(title);
        if (key)
          await db.entryTopic.create({
            data: { tenantId, entryVersionId: version.id, topicStableKey: key, confidence: 90 },
          });
      }
      if (status === "PUBLISHED")
        await db.entry.update({
          where: { id: created.id },
          data: { currentVersionId: version.id },
        });
      return { entry: created, version };
    };
    const published = [];
    for (const [daysAgo, subject, topics, summary] of ENTRIES) {
      const s = subject === "prog" ? progSyllabus : mathSyllabus;
      published.push(
        await entry(
          subject === "prog" ? progA : mathA,
          daysAgo,
          topics,
          summary,
          s.keyOf,
          s.versionId,
          "PUBLISHED",
        ),
      );
    }
    published.push(
      await entry(
        progB,
        2,
        ["Loops"],
        "for, while and do-while loops with tracing tables.",
        progSyllabus.keyOf,
        progSyllabus.versionId,
        "PUBLISHED",
      ),
    );
    // Waiting for the teacher: today's maths class.
    await entry(
      mathA,
      0,
      ["Rules of differentiation", "Chain rule"],
      "Power, product and quotient rules, then the chain rule with three worked examples.",
      mathSyllabus.keyOf,
      mathSyllabus.versionId,
      "PENDING",
    );

    return { tenantId, prog, math, progSyllabus, mathSyllabus, published, sem };
  });

  let indexed = "skipped (no OPENAI_API_KEY)";
  if (isAiConfigured()) {
    const scope = { tenantId: ids.tenantId };
    const ai = { tenantId: ids.tenantId, userId: null };
    for (const [subject, syllabus] of [
      [ids.prog, ids.progSyllabus],
      [ids.math, ids.mathSyllabus],
    ] as const) {
      const topics = await withTenant(ids.tenantId, (db) =>
        db.syllabusTopic.findMany({ where: { versionId: syllabus.versionId } }),
      );
      const chunks = chunksFor(topics, { name: subject.name, code: subject.code });
      await knowledgeService.indexVersion(
        scope,
        ai,
        "SYLLABUS_INDEX",
        "SYLLABUS_TOPIC",
        syllabus.versionId,
        chunks.map((c) => ({
          sourceId: c.sourceId,
          text: c.text,
          payload: {
            programId: ids.sem.programId,
            batchId: ids.sem.batchId,
            semesterId: ids.sem.semesterId,
            sectionId: null,
            subjectId: subject.id,
            classId: null,
            ownerId: null,
            visibility: "SHARED",
            contentKind: "OFFICIAL_SYLLABUS",
            meta: {
              stableKey: c.stableKey,
              unitNo: c.unitNo,
              unitTitle: c.unitTitle,
              topicTitle: c.topicTitle,
              versionNo: 1,
            },
          },
        })),
      );
    }
    for (const { entry, version } of ids.published)
      await sessionsService.index(scope, entry, version);
    indexed = "done";
  }

  console.log(`Demo College is ready (timezone ${TZ}). Indexing for chat: ${indexed}.`);
  console.log(`Password for every account: ${PASSWORD}\n`);
  for (const [role, who] of <const>[
    ["University Admin", "admin"],
    ["Program Admin (BIT)", "program"],
    ["Teacher (Programming in C)", "teacher"],
    ["Teacher (Mathematics I)", "teacher2"],
    ["CR and student, section A", "cr"],
    ["Student, section A", "student"],
    ["Student, section B", "student2"],
    ["Student, section A", "student3"],
    ["Student, section A", "student4"],
    ["Student, section A", "student5"],
    ["Super Admin (no college)", "platform"],
  ]) {
    console.log(`  ${role.padEnd(28)} ${mail(who)}`);
  }
}

try {
  await main();
} catch (err) {
  console.error(`Seeding failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
} finally {
  await closeQueues();
  await closeRedis();
  await prisma.$disconnect();
}
