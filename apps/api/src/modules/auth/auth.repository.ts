import { withGlobal } from "../../common/db/scope.js";

/** Sessions and password resets belong to the global user account, not to one college. */
export const authRepository = {
  createSession(data: {
    userId: string;
    tokenHash: string;
    activeTenantId: string | null;
    expiresAt: Date;
    absoluteExpiresAt: Date;
    ip: string | null;
    userAgent: string | null;
  }) {
    return withGlobal((db) => db.session.create({ data }));
  },

  findSessionByTokenHash(tokenHash: string) {
    return withGlobal((db) =>
      db.session.findUnique({ where: { tokenHash }, include: { user: true } }),
    );
  },

  touchSession(id: string, lastUsedAt: Date, expiresAt: Date) {
    return withGlobal((db) =>
      db.session.update({ where: { id }, data: { lastUsedAt, expiresAt } }),
    );
  },

  setActiveTenant(sessionId: string, userId: string, activeTenantId: string | null) {
    return withGlobal((db) =>
      db.session.updateMany({ where: { id: sessionId, userId }, data: { activeTenantId } }),
    );
  },

  findSession(sessionId: string) {
    return withGlobal((db) => db.session.findUnique({ where: { id: sessionId } }));
  },

  async revokeSession(userId: string, sessionId: string, at: Date): Promise<number> {
    const result = await withGlobal((db) =>
      db.session.updateMany({
        where: { id: sessionId, userId, revokedAt: null },
        data: { revokedAt: at },
      }),
    );
    return result.count;
  },

  async revokeAllSessions(userId: string, at: Date, exceptSessionId?: string): Promise<number> {
    const result = await withGlobal((db) =>
      db.session.updateMany({
        where: {
          userId,
          revokedAt: null,
          ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}),
        },
        data: { revokedAt: at },
      }),
    );
    return result.count;
  },

  async deleteDeadSessions(now: Date): Promise<number> {
    const result = await withGlobal((db) =>
      db.session.deleteMany({
        where: { OR: [{ expiresAt: { lte: now } }, { revokedAt: { not: null } }] },
      }),
    );
    return result.count;
  },

  createPasswordReset(data: { userId: string; tokenHash: string; expiresAt: Date }) {
    return withGlobal((db) => db.passwordReset.create({ data }));
  },

  findPasswordReset(tokenHash: string) {
    return withGlobal((db) => db.passwordReset.findUnique({ where: { tokenHash } }));
  },

  /** Marks the reset used only if it still is unused, so a token works exactly once. */
  async usePasswordReset(id: string, at: Date): Promise<boolean> {
    const result = await withGlobal((db) =>
      db.passwordReset.updateMany({ where: { id, usedAt: null }, data: { usedAt: at } }),
    );
    return result.count === 1;
  },

  /** Unused resets of a user stop working once a newer one is used or the password changes. */
  expireOpenResets(userId: string, at: Date) {
    return withGlobal((db) =>
      db.passwordReset.updateMany({ where: { userId, usedAt: null }, data: { usedAt: at } }),
    );
  },
};
