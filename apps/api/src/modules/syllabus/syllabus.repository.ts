import { withTenant, type TenantScope } from "../../common/db/scope.js";
import type { Prisma } from "../../generated/prisma/client.js";
import type {
  ChangeRequestStatus,
  JobState,
  SyllabusVersionStatus,
  TopicKind,
} from "../../generated/prisma/enums.js";

export interface TopicRow {
  id: string;
  parentId: string | null;
  stableKey: string;
  kind: TopicKind;
  title: string;
  description: string | null;
  hours: number | null;
  orderIndex: number;
  sourcePage: number | null;
  confidence: number;
}

const versionInclude = {
  syllabus: true,
  topics: { orderBy: { orderIndex: "asc" } },
  _count: { select: { pages: true } },
} satisfies Prisma.SyllabusVersionInclude;

export const syllabusRepository = {
  // ---------- Syllabi ----------

  createSyllabus(
    scope: TenantScope,
    data: { programId: string; batchId: string; semesterId: string; subjectId: string | null },
  ) {
    return withTenant(scope.tenantId, (db) =>
      db.syllabus.create({ data: { ...data, tenantId: scope.tenantId } }),
    );
  },

  findSyllabus(scope: TenantScope, id: string) {
    return withTenant(scope.tenantId, (db) =>
      db.syllabus.findFirst({ where: { id, tenantId: scope.tenantId } }),
    );
  },

  findSyllabusBySubject(scope: TenantScope, subjectId: string) {
    return withTenant(scope.tenantId, (db) =>
      db.syllabus.findFirst({ where: { tenantId: scope.tenantId, subjectId } }),
    );
  },

  linkSubject(scope: TenantScope, syllabusId: string, subjectId: string) {
    return withTenant(scope.tenantId, (db) =>
      db.syllabus.update({
        where: { id: syllabusId, tenantId: scope.tenantId },
        data: { subjectId },
      }),
    );
  },

  setCurrent(scope: TenantScope, syllabusId: string, versionId: string) {
    return withTenant(scope.tenantId, (db) =>
      db.syllabus.update({
        where: { id: syllabusId, tenantId: scope.tenantId },
        data: { currentVersionId: versionId },
      }),
    );
  },

  deleteSyllabus(scope: TenantScope, id: string) {
    return withTenant(scope.tenantId, (db) =>
      db.syllabus.deleteMany({ where: { id, tenantId: scope.tenantId } }),
    );
  },

  /** Every syllabus of a semester with its versions' status (the dashboard). */
  listForSemesters(scope: TenantScope, semesterIds: string[]) {
    return withTenant(scope.tenantId, (db) =>
      db.syllabus.findMany({
        where: { tenantId: scope.tenantId, semesterId: { in: semesterIds } },
        include: {
          versions: { select: { id: true, versionNo: true, status: true, extraction: true } },
          currentVersion: { select: { versionNo: true } },
        },
      }),
    );
  },

  // ---------- Versions ----------

  async nextVersionNo(scope: TenantScope, syllabusId: string): Promise<number> {
    const top = await withTenant(scope.tenantId, (db) =>
      db.syllabusVersion.aggregate({
        where: { tenantId: scope.tenantId, syllabusId },
        _max: { versionNo: true },
      }),
    );
    return (top._max.versionNo ?? 0) + 1;
  },

  createVersion(
    scope: TenantScope,
    data: {
      syllabusId: string;
      versionNo: number;
      sourceFileId: string | null;
      copiedFromVersionId: string | null;
      extraction: JobState;
      createdById: string;
      credits?: number | null;
      references?: Prisma.InputJsonValue;
      effectiveFrom?: Date | null;
    },
  ) {
    return withTenant(scope.tenantId, (db) =>
      db.syllabusVersion.create({ data: { ...data, tenantId: scope.tenantId } }),
    );
  },

  findVersion(scope: TenantScope, id: string) {
    return withTenant(scope.tenantId, (db) =>
      db.syllabusVersion.findFirst({
        where: { id, tenantId: scope.tenantId },
        include: versionInclude,
      }),
    );
  },

  findOpenVersion(scope: TenantScope, syllabusId: string) {
    return withTenant(scope.tenantId, (db) =>
      db.syllabusVersion.findFirst({
        where: { tenantId: scope.tenantId, syllabusId, status: { in: ["DRAFT", "PUBLISHING"] } },
      }),
    );
  },

  listVersions(scope: TenantScope, syllabusId: string) {
    return withTenant(scope.tenantId, (db) =>
      db.syllabusVersion.findMany({
        where: { tenantId: scope.tenantId, syllabusId },
        orderBy: { versionNo: "desc" },
      }),
    );
  },

  updateVersion(
    scope: TenantScope,
    id: string,
    data: Partial<{
      status: SyllabusVersionStatus;
      extraction: JobState;
      extractionError: string | null;
      usedOcr: boolean;
      suggestedName: string | null;
      suggestedCode: string | null;
      credits: number | null;
      references: Prisma.InputJsonValue;
      effectiveFrom: Date | null;
      publishedById: string;
      publishedAt: Date;
    }>,
  ) {
    return withTenant(scope.tenantId, (db) =>
      db.syllabusVersion.update({ where: { id, tenantId: scope.tenantId }, data }),
    );
  },

  deleteVersion(scope: TenantScope, id: string) {
    return withTenant(scope.tenantId, (db) =>
      db.syllabusVersion.deleteMany({ where: { id, tenantId: scope.tenantId } }),
    );
  },

  // ---------- Topics ----------

  listTopics(scope: TenantScope, versionId: string): Promise<TopicRow[]> {
    return withTenant(scope.tenantId, (db) =>
      db.syllabusTopic.findMany({
        where: { tenantId: scope.tenantId, versionId },
        orderBy: { orderIndex: "asc" },
      }),
    );
  },

  /** Rows must come parents first; ids are chosen by the caller so children can refer to them. */
  createTopics(scope: TenantScope, versionId: string, rows: TopicRow[]) {
    return withTenant(scope.tenantId, (db) =>
      db.syllabusTopic.createMany({
        data: rows.map((r) => ({ ...r, versionId, tenantId: scope.tenantId })),
      }),
    );
  },

  deleteTopicsOfVersion(scope: TenantScope, versionId: string) {
    return withTenant(scope.tenantId, (db) =>
      db.syllabusTopic.deleteMany({ where: { tenantId: scope.tenantId, versionId } }),
    );
  },

  updateTopic(
    scope: TenantScope,
    id: string,
    data: Partial<
      Pick<TopicRow, "title" | "description" | "hours" | "parentId" | "orderIndex" | "confidence">
    >,
  ) {
    return withTenant(scope.tenantId, (db) =>
      db.syllabusTopic.update({ where: { id, tenantId: scope.tenantId }, data }),
    );
  },

  /** Deletes a node; its children go with it (cascade). */
  deleteTopic(scope: TenantScope, id: string) {
    return withTenant(scope.tenantId, (db) =>
      db.syllabusTopic.deleteMany({ where: { id, tenantId: scope.tenantId } }),
    );
  },

  // ---------- Pages ----------

  replacePages(scope: TenantScope, versionId: string, pages: string[]) {
    return withTenant(scope.tenantId, async (db) => {
      await db.syllabusPage.deleteMany({ where: { tenantId: scope.tenantId, versionId } });
      await db.syllabusPage.createMany({
        data: pages.map((text, i) => ({
          tenantId: scope.tenantId,
          versionId,
          pageNo: i + 1,
          text,
        })),
      });
    });
  },

  copyPages(scope: TenantScope, fromVersionId: string, toVersionId: string) {
    return withTenant(scope.tenantId, async (db) => {
      const pages = await db.syllabusPage.findMany({
        where: { tenantId: scope.tenantId, versionId: fromVersionId },
      });
      await db.syllabusPage.createMany({
        data: pages.map((p) => ({
          tenantId: scope.tenantId,
          versionId: toVersionId,
          pageNo: p.pageNo,
          text: p.text,
        })),
      });
    });
  },

  findPage(scope: TenantScope, versionId: string, pageNo: number) {
    return withTenant(scope.tenantId, (db) =>
      db.syllabusPage.findFirst({ where: { tenantId: scope.tenantId, versionId, pageNo } }),
    );
  },

  // ---------- Change requests ----------

  createChangeRequest(
    scope: TenantScope,
    data: {
      versionId: string;
      requestText: string;
      proposedOps: Prisma.InputJsonValue;
      note: string | null;
      createdById: string;
    },
  ) {
    return withTenant(scope.tenantId, (db) =>
      db.syllabusChangeRequest.create({ data: { ...data, tenantId: scope.tenantId } }),
    );
  },

  findChangeRequest(scope: TenantScope, id: string) {
    return withTenant(scope.tenantId, (db) =>
      db.syllabusChangeRequest.findFirst({ where: { id, tenantId: scope.tenantId } }),
    );
  },

  listChangeRequests(scope: TenantScope, versionId: string) {
    return withTenant(scope.tenantId, (db) =>
      db.syllabusChangeRequest.findMany({
        where: { tenantId: scope.tenantId, versionId },
        orderBy: { createdAt: "desc" },
      }),
    );
  },

  decideChangeRequest(
    scope: TenantScope,
    id: string,
    data: {
      status: ChangeRequestStatus;
      proposedOps: Prisma.InputJsonValue;
      decidedById: string;
      decidedAt: Date;
    },
  ) {
    return withTenant(scope.tenantId, (db) =>
      db.syllabusChangeRequest.update({ where: { id, tenantId: scope.tenantId }, data }),
    );
  },
};
