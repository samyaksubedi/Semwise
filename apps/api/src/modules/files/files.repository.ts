import { withTenant, type TenantScope } from "../../common/db/scope.js";
import type { FileKind, FileStatus } from "../../generated/prisma/enums.js";

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
