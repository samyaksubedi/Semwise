import { withTenant, type TenantScope } from "../../common/db/scope.js";
import type { FileKind, JobState } from "../../generated/prisma/enums.js";

export const mediaRepository = {
  create(
    scope: TenantScope,
    data: { classId: string; fileId: string; kind: FileKind; createdById: string },
  ) {
    return withTenant(scope.tenantId, (db) =>
      db.mediaReading.create({ data: { ...data, tenantId: scope.tenantId } }),
    );
  },

  find(scope: TenantScope, id: string) {
    return withTenant(scope.tenantId, (db) =>
      db.mediaReading.findFirst({ where: { id, tenantId: scope.tenantId } }),
    );
  },

  findByFile(scope: TenantScope, fileId: string) {
    return withTenant(scope.tenantId, (db) =>
      db.mediaReading.findFirst({ where: { fileId, tenantId: scope.tenantId } }),
    );
  },

  update(
    scope: TenantScope,
    id: string,
    data: Partial<{ status: JobState; text: string | null; error: string | null; seconds: number }>,
  ) {
    return withTenant(scope.tenantId, (db) =>
      db.mediaReading.update({ where: { id, tenantId: scope.tenantId }, data }),
    );
  },
};
