import { withTenant, type TenantScope } from "../../common/db/scope.js";
import type { Prisma } from "../../generated/prisma/client.js";
import type { EntryVersionStatus, InputKind, JobState } from "../../generated/prisma/enums.js";

const entryInclude = {
  versions: { orderBy: { versionNo: "desc" }, include: { topics: true } },
} satisfies Prisma.EntryInclude;

export type EntryRow = Prisma.EntryGetPayload<{ include: typeof entryInclude }>;
export type VersionRow = EntryRow["versions"][number];

export interface ClassPath {
  classId: string;
  programId: string;
  batchId: string;
  semesterId: string;
  sectionId: string;
  subjectId: string;
}

export const sessionsRepository = {
  /** The session of a class on a date: one per class and day. */
  findOrCreateSession(scope: TenantScope, classId: string, taughtOn: Date, createdById: string) {
    return withTenant(scope.tenantId, (db) =>
      db.classSession.upsert({
        where: { classId_taughtOn: { classId, taughtOn } },
        create: { tenantId: scope.tenantId, classId, taughtOn, createdById },
        update: {},
      }),
    );
  },

  createEntry(
    scope: TenantScope,
    data: ClassPath & { sessionId: string; taughtOn: Date; authorId: string },
  ) {
    return withTenant(scope.tenantId, (db) =>
      db.entry.create({ data: { ...data, tenantId: scope.tenantId } }),
    );
  },

  updateEntry(
    scope: TenantScope,
    id: string,
    data: Partial<{
      sessionId: string;
      taughtOn: Date;
      currentVersionId: string | null;
      takenDownAt: Date | null;
      takenDownById: string | null;
    }>,
  ) {
    return withTenant(scope.tenantId, (db) =>
      db.entry.update({ where: { id, tenantId: scope.tenantId }, data }),
    );
  },

  deleteEntry(scope: TenantScope, id: string) {
    return withTenant(scope.tenantId, (db) =>
      db.entry.deleteMany({ where: { id, tenantId: scope.tenantId } }),
    );
  },

  findEntry(scope: TenantScope, id: string) {
    return withTenant(scope.tenantId, (db) =>
      db.entry.findFirst({ where: { id, tenantId: scope.tenantId }, include: entryInclude }),
    );
  },

  /** Other entries of the same class and day that are live or on their way (the duplicate check). */
  findOthersOnDay(scope: TenantScope, sessionId: string, exceptEntryId: string) {
    return withTenant(scope.tenantId, (db) =>
      db.entry.findMany({
        where: {
          tenantId: scope.tenantId,
          sessionId,
          id: { not: exceptEntryId },
          takenDownAt: null,
          OR: [
            { currentVersionId: { not: null } },
            { versions: { some: { status: { in: ["PENDING", "APPROVED"] } } } },
          ],
        },
        include: entryInclude,
      }),
    );
  },

  listForClasses(scope: TenantScope, classIds: string[], from?: Date, to?: Date) {
    return withTenant(scope.tenantId, (db) =>
      db.entry.findMany({
        where: {
          tenantId: scope.tenantId,
          classId: { in: classIds },
          ...(from || to
            ? { taughtOn: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }
            : {}),
        },
        include: entryInclude,
        orderBy: [{ taughtOn: "desc" }, { createdAt: "desc" }],
      }),
    );
  },

  /** Live entries of some sections in a date range (catch-up and date questions). */
  listLiveForSections(scope: TenantScope, sectionIds: string[], from: Date, to: Date) {
    return withTenant(scope.tenantId, (db) =>
      db.entry.findMany({
        where: {
          tenantId: scope.tenantId,
          sectionId: { in: sectionIds },
          taughtOn: { gte: from, lte: to },
          takenDownAt: null,
          currentVersionId: { not: null },
        },
        include: { currentVersion: { include: { topics: true } } },
        orderBy: [{ taughtOn: "asc" }, { createdAt: "asc" }],
      }),
    );
  },

  listByAuthor(scope: TenantScope, authorId: string) {
    return withTenant(scope.tenantId, (db) =>
      db.entry.findMany({
        where: { tenantId: scope.tenantId, authorId },
        include: entryInclude,
        orderBy: [{ taughtOn: "desc" }, { createdAt: "desc" }],
        take: 200,
      }),
    );
  },

  /** Entries with a version waiting for the teacher, in some classes or programs. */
  listPending(scope: TenantScope, filter: { classIds: string[]; programIds: string[] }) {
    return withTenant(scope.tenantId, (db) =>
      db.entry.findMany({
        where: {
          tenantId: scope.tenantId,
          OR: [{ classId: { in: filter.classIds } }, { programId: { in: filter.programIds } }],
          versions: { some: { status: "PENDING" } },
        },
        include: entryInclude,
        orderBy: [{ taughtOn: "asc" }],
      }),
    );
  },

  countPendingInClass(scope: TenantScope, classId: string) {
    return withTenant(scope.tenantId, (db) =>
      db.entryVersion.count({
        where: { tenantId: scope.tenantId, status: "PENDING", entry: { classId } },
      }),
    );
  },

  // ---------- Versions ----------

  async nextVersionNo(scope: TenantScope, entryId: string): Promise<number> {
    const top = await withTenant(scope.tenantId, (db) =>
      db.entryVersion.aggregate({
        where: { tenantId: scope.tenantId, entryId },
        _max: { versionNo: true },
      }),
    );
    return (top._max.versionNo ?? 0) + 1;
  },

  createVersion(
    scope: TenantScope,
    data: {
      entryId: string;
      versionNo: number;
      inputKind: InputKind;
      mediaFileId: string | null;
      rawText: string;
      authorId: string;
      organize: JobState;
      structured?: Prisma.InputJsonValue;
      summary?: string | null;
      syllabusVersionId?: string | null;
    },
  ) {
    return withTenant(scope.tenantId, (db) =>
      db.entryVersion.create({
        data: { ...data, tenantId: scope.tenantId },
        include: { topics: true },
      }),
    );
  },

  findVersion(scope: TenantScope, id: string) {
    return withTenant(scope.tenantId, (db) =>
      db.entryVersion.findFirst({
        where: { id, tenantId: scope.tenantId },
        include: { topics: true, entry: true },
      }),
    );
  },

  updateVersion(
    scope: TenantScope,
    id: string,
    data: Partial<{
      status: EntryVersionStatus;
      rawText: string;
      structured: Prisma.InputJsonValue;
      summary: string | null;
      organize: JobState;
      organizeError: string | null;
      syllabusVersionId: string | null;
      mappingStale: boolean;
      minorEdit: boolean;
      submittedAt: Date;
      approvedById: string | null;
      decidedAt: Date;
      rejectionReason: string | null;
      unreviewed: boolean;
      reminderCount: number;
      lastReminderAt: Date;
      escalatedAt: Date;
    }>,
  ) {
    return withTenant(scope.tenantId, (db) =>
      db.entryVersion.update({ where: { id, tenantId: scope.tenantId }, data }),
    );
  },

  deleteVersion(scope: TenantScope, id: string) {
    return withTenant(scope.tenantId, (db) =>
      db.entryVersion.deleteMany({ where: { id, tenantId: scope.tenantId } }),
    );
  },

  /** Replaces the syllabus topics a version covers. */
  setTopics(
    scope: TenantScope,
    versionId: string,
    topics: { topicStableKey: string; confidence: number }[],
  ) {
    return withTenant(scope.tenantId, async (db) => {
      await db.entryTopic.deleteMany({
        where: { tenantId: scope.tenantId, entryVersionId: versionId },
      });
      if (topics.length) {
        await db.entryTopic.createMany({
          data: topics.map((t) => ({ ...t, tenantId: scope.tenantId, entryVersionId: versionId })),
          skipDuplicates: true,
        });
      }
    });
  },

  /** Live versions of a subject's entries that map to topics missing from `validKeys`. */
  async markStaleMappings(
    scope: TenantScope,
    subjectId: string,
    validKeys: string[],
  ): Promise<number> {
    return withTenant(scope.tenantId, async (db) => {
      const result = await db.entryVersion.updateMany({
        where: {
          tenantId: scope.tenantId,
          status: "PUBLISHED",
          entry: { subjectId },
          topics: { some: { topicStableKey: { notIn: validKeys } } },
        },
        data: { mappingStale: true },
      });
      return result.count;
    });
  },
};
