import { withTenant, type TenantScope } from "../../common/db/scope.js";
import type { SemesterStatus, StructureStatus } from "../../generated/prisma/enums.js";

/**
 * Programs, batches, semesters, sections and subjects. Every query names the tenant, and every
 * child is created with its parent's path (program, batch, semester), which composite foreign
 * keys check in the database.
 */
export const structureRepository = {
  // ---------- Programs ----------

  listPrograms(scope: TenantScope) {
    return withTenant(scope.tenantId, (db) =>
      db.program.findMany({ where: { tenantId: scope.tenantId }, orderBy: { code: "asc" } }),
    );
  },

  findProgram(scope: TenantScope, id: string) {
    return withTenant(scope.tenantId, (db) =>
      db.program.findFirst({ where: { id, tenantId: scope.tenantId } }),
    );
  },

  createProgram(scope: TenantScope, data: { name: string; code: string }) {
    return withTenant(scope.tenantId, (db) =>
      db.program.create({ data: { ...data, tenantId: scope.tenantId } }),
    );
  },

  updateProgram(
    scope: TenantScope,
    id: string,
    data: { name?: string; code?: string; status?: StructureStatus },
  ) {
    return withTenant(scope.tenantId, (db) =>
      db.program.update({ where: { id, tenantId: scope.tenantId }, data }),
    );
  },

  // ---------- Batches ----------

  listBatches(scope: TenantScope, programId: string) {
    return withTenant(scope.tenantId, (db) =>
      db.batch.findMany({
        where: { tenantId: scope.tenantId, programId },
        orderBy: [{ intakeYear: "desc" }, { name: "asc" }],
      }),
    );
  },

  findBatch(scope: TenantScope, id: string) {
    return withTenant(scope.tenantId, (db) =>
      db.batch.findFirst({ where: { id, tenantId: scope.tenantId } }),
    );
  },

  createBatch(scope: TenantScope, data: { programId: string; name: string; intakeYear: number }) {
    return withTenant(scope.tenantId, (db) =>
      db.batch.create({ data: { ...data, tenantId: scope.tenantId } }),
    );
  },

  updateBatch(
    scope: TenantScope,
    id: string,
    data: { name?: string; intakeYear?: number; status?: StructureStatus },
  ) {
    return withTenant(scope.tenantId, (db) =>
      db.batch.update({ where: { id, tenantId: scope.tenantId }, data }),
    );
  },

  /** A batch with its semesters, sections and subjects (the admin structure screen). */
  findBatchTree(scope: TenantScope, id: string) {
    return withTenant(scope.tenantId, (db) =>
      db.batch.findFirst({
        where: { id, tenantId: scope.tenantId },
        include: {
          semesters: {
            orderBy: { number: "asc" },
            include: {
              sections: { orderBy: { name: "asc" } },
              subjects: { orderBy: { code: "asc" } },
            },
          },
        },
      }),
    );
  },

  // ---------- Semesters ----------

  listSemesters(scope: TenantScope, batchId: string) {
    return withTenant(scope.tenantId, (db) =>
      db.semester.findMany({
        where: { tenantId: scope.tenantId, batchId },
        orderBy: { number: "asc" },
      }),
    );
  },

  findSemester(scope: TenantScope, id: string) {
    return withTenant(scope.tenantId, (db) =>
      db.semester.findFirst({ where: { id, tenantId: scope.tenantId } }),
    );
  },

  findActiveSemester(scope: TenantScope, batchId: string) {
    return withTenant(scope.tenantId, (db) =>
      db.semester.findFirst({ where: { tenantId: scope.tenantId, batchId, status: "ACTIVE" } }),
    );
  },

  createSemester(
    scope: TenantScope,
    data: {
      programId: string;
      batchId: string;
      number: number;
      startDate: Date | null;
      endDate: Date | null;
      status: SemesterStatus;
    },
  ) {
    return withTenant(scope.tenantId, (db) =>
      db.semester.create({ data: { ...data, tenantId: scope.tenantId } }),
    );
  },

  updateSemester(
    scope: TenantScope,
    id: string,
    data: {
      number?: number;
      startDate?: Date | null;
      endDate?: Date | null;
      status?: SemesterStatus;
    },
  ) {
    return withTenant(scope.tenantId, (db) =>
      db.semester.update({ where: { id, tenantId: scope.tenantId }, data }),
    );
  },

  // ---------- Sections ----------

  listSections(scope: TenantScope, semesterId: string) {
    return withTenant(scope.tenantId, (db) =>
      db.section.findMany({
        where: { tenantId: scope.tenantId, semesterId },
        orderBy: { name: "asc" },
      }),
    );
  },

  findSection(scope: TenantScope, id: string) {
    return withTenant(scope.tenantId, (db) =>
      db.section.findFirst({ where: { id, tenantId: scope.tenantId } }),
    );
  },

  findSections(scope: TenantScope, ids: string[]) {
    return withTenant(scope.tenantId, (db) =>
      db.section.findMany({ where: { id: { in: ids }, tenantId: scope.tenantId } }),
    );
  },

  createSection(
    scope: TenantScope,
    data: { programId: string; batchId: string; semesterId: string; name: string },
  ) {
    return withTenant(scope.tenantId, (db) =>
      db.section.create({ data: { ...data, tenantId: scope.tenantId } }),
    );
  },

  updateSection(scope: TenantScope, id: string, data: { name: string }) {
    return withTenant(scope.tenantId, (db) =>
      db.section.update({ where: { id, tenantId: scope.tenantId }, data }),
    );
  },

  // ---------- Subjects ----------

  listSubjects(scope: TenantScope, semesterId: string) {
    return withTenant(scope.tenantId, (db) =>
      db.subject.findMany({
        where: { tenantId: scope.tenantId, semesterId },
        orderBy: { code: "asc" },
      }),
    );
  },

  findSubject(scope: TenantScope, id: string) {
    return withTenant(scope.tenantId, (db) =>
      db.subject.findFirst({ where: { id, tenantId: scope.tenantId } }),
    );
  },

  findSubjects(scope: TenantScope, ids: string[]) {
    return withTenant(scope.tenantId, (db) =>
      db.subject.findMany({ where: { id: { in: ids }, tenantId: scope.tenantId } }),
    );
  },

  createSubject(
    scope: TenantScope,
    data: {
      programId: string;
      batchId: string;
      semesterId: string;
      name: string;
      code: string;
      credits: number | null;
    },
  ) {
    return withTenant(scope.tenantId, (db) =>
      db.subject.create({ data: { ...data, tenantId: scope.tenantId } }),
    );
  },

  updateSubject(
    scope: TenantScope,
    id: string,
    data: { name?: string; code?: string; credits?: number | null; status?: StructureStatus },
  ) {
    return withTenant(scope.tenantId, (db) =>
      db.subject.update({ where: { id, tenantId: scope.tenantId }, data }),
    );
  },
};
