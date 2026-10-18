import { withSystem, withTenant } from "../../common/db/scope.js";
import type { EmailStatus } from "../../generated/prisma/enums.js";

/** Email logs of a college run in its scope; platform mail (password resets) has no tenant. */
function inScope<T>(tenantId: string | null, fn: Parameters<typeof withSystem<T>>[0]) {
  return tenantId ? withTenant(tenantId, fn) : withSystem(fn);
}

export const notificationsRepository = {
  create(tenantId: string | null, data: { template: string; toHash: string }) {
    return inScope(tenantId, (db) => db.emailLog.create({ data: { ...data, tenantId } }));
  },

  find(tenantId: string | null, id: string) {
    return inScope(tenantId, (db) => db.emailLog.findFirst({ where: { id, tenantId } }));
  },

  findMany(tenantId: string | null, ids: string[]) {
    return inScope(tenantId, (db) =>
      db.emailLog.findMany({ where: { id: { in: ids }, tenantId } }),
    );
  },

  update(
    tenantId: string | null,
    id: string,
    data: Partial<{
      status: EmailStatus;
      messageId: string;
      attempts: number;
      error: string | null;
      sentAt: Date;
    }>,
  ) {
    return inScope(tenantId, (db) => db.emailLog.updateMany({ where: { id, tenantId }, data }));
  },
};
