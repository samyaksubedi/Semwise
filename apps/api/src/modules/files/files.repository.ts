import { withSystem, withTenant, type TenantScope } from "../../common/db/scope.js";
import type { FileKind, FileStatus } from "../../generated/prisma/enums.js";

/** Past their delete date, or uploads never completed. */
const dueWhere = (now: Date, staleBefore: Date) => ({
  OR: [
    { status: { not: "DELETED" as const }, deleteAfter: { lte: now } },
    { status: "PENDING" as const, createdAt: { lte: staleBefore } },
  ],
});

export const filesRepository = {
  create(
    scope: TenantScope,
    data: {
      id: string;
      storageKey: string;
      mime: string;
      size: number;
      kind: FileKind;
      programId: string | null;
      batchId: string | null;
      semesterId: string | null;
      subjectId: string | null;
      sectionId: string | null;
      classId: string | null;
      uploadedById: string;
    },
  ) {
    return withTenant(scope.tenantId, (db) =>
      db.fileObject.create({ data: { ...data, tenantId: scope.tenantId } }),
    );
  },

  find(scope: TenantScope, id: string) {
    return withTenant(scope.tenantId, (db) =>
      db.fileObject.findFirst({ where: { id, tenantId: scope.tenantId } }),
    );
  },

  /**
   * Retention (system maintenance): the colleges that have files due for deletion. Only ids are
   * read across colleges; the files themselves are then handled in each college's own scope.
   */
  async tenantsWithDueFiles(now: Date, staleBefore: Date): Promise<string[]> {
    const rows = await withSystem((db) =>
      db.fileObject.findMany({
        where: dueWhere(now, staleBefore),
        distinct: ["tenantId"],
        select: { tenantId: true },
      }),
    );
    return rows.map((r) => r.tenantId);
  },

  listDue(scope: TenantScope, now: Date, staleBefore: Date, take: number) {
    return withTenant(scope.tenantId, (db) =>
      db.fileObject.findMany({
        where: { tenantId: scope.tenantId, ...dueWhere(now, staleBefore) },
        take,
      }),
    );
  },

  update(
    scope: TenantScope,
    id: string,
    data: Partial<{ status: FileStatus; size: number; deleteAfter: Date | null }>,
  ) {
    return withTenant(scope.tenantId, (db) =>
      db.fileObject.update({ where: { id, tenantId: scope.tenantId }, data }),
    );
  },
};
