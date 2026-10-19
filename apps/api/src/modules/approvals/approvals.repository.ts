import { withTenant, type TenantScope } from "../../common/db/scope.js";

export const approvalsRepository = {
  findProgramDefault(scope: TenantScope, programId: string) {
    return withTenant(scope.tenantId, (db) =>
      db.approvalSetting.findFirst({
        where: { tenantId: scope.tenantId, programId, classId: null },
      }),
    );
  },

  findClassOverride(scope: TenantScope, classId: string) {
    return withTenant(scope.tenantId, (db) =>
      db.approvalSetting.findFirst({ where: { tenantId: scope.tenantId, classId } }),
    );
  },

  async upsertProgramDefault(
    scope: TenantScope,
    programId: string,
    data: {
      autoApprove: boolean;
      locked: boolean;
      unreviewedPublishAfterDays: number | null;
      updatedById: string;
    },
  ) {
    return withTenant(scope.tenantId, async (db) => {
      const existing = await db.approvalSetting.findFirst({
        where: { tenantId: scope.tenantId, programId, classId: null },
      });
      return existing
        ? db.approvalSetting.update({ where: { id: existing.id }, data })
        : db.approvalSetting.create({ data: { ...data, tenantId: scope.tenantId, programId } });
    });
  },

  upsertClassOverride(
    scope: TenantScope,
    programId: string,
    classId: string,
    data: { autoApprove: boolean; updatedById: string },
  ) {
    return withTenant(scope.tenantId, (db) =>
      db.approvalSetting.upsert({
        where: { classId },
        create: { ...data, tenantId: scope.tenantId, programId, classId },
        update: data,
      }),
    );
  },

  deleteClassOverride(scope: TenantScope, classId: string) {
    return withTenant(scope.tenantId, (db) =>
      db.approvalSetting.deleteMany({ where: { tenantId: scope.tenantId, classId } }),
    );
  },
};
