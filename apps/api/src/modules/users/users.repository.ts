import { withGlobal } from "../../common/db/scope.js";
import type { UserStatus } from "../../generated/prisma/enums.js";

/** Users are global (one account across colleges), so these queries carry no tenant. */
export const usersRepository = {
  findByEmail(email: string) {
    return withGlobal((db) => db.user.findUnique({ where: { email } }));
  },

  findById(id: string) {
    return withGlobal((db) => db.user.findUnique({ where: { id } }));
  },

  findManyByIds(ids: string[]) {
    return withGlobal((db) => db.user.findMany({ where: { id: { in: ids } } }));
  },

  create(data: {
    email: string;
    displayName: string;
    passwordHash?: string | null;
    status: UserStatus;
  }) {
    return withGlobal((db) => db.user.create({ data }));
  },

  update(
    id: string,
    data: Partial<{
      displayName: string;
      passwordHash: string | null;
      status: UserStatus;
      email: string;
      failedLoginCount: number;
      lockedUntil: Date | null;
      lastLoginAt: Date;
    }>,
  ) {
    return withGlobal((db) => db.user.update({ where: { id }, data }));
  },
};
