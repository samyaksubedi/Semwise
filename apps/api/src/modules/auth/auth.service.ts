import {
  ErrorCode,
  type ChangePasswordInput,
  type ForgotPasswordInput,
  type LoginInput,
  type ResetPasswordInput,
  type SessionView,
} from "@semwise/shared";
import { AppError } from "../../common/errors/app-error.js";
import { logger } from "../../lib/logger.js";
import { membershipsService } from "../memberships/index.js";
import { notificationsService } from "../notifications/index.js";
import { tenantsService } from "../tenants/index.js";
import { usersService, type UserRecord } from "../users/index.js";
import { authRepository } from "./auth.repository.js";
import type { AuthContext } from "./auth.types.js";
import { getDummyHash, hashPassword, verifyPassword } from "./password.js";
import {
  SESSION_ABSOLUTE_MS,
  SESSION_TOUCH_INTERVAL_MS,
  createSessionToken,
  hashSessionToken,
  nextIdleExpiry,
} from "./session.js";

export const MAX_FAILED_LOGINS = 5;
export const LOCK_DURATION_MS = 15 * 60_000;
export const RESET_TOKEN_TTL_MS = 60 * 60_000;

const INVALID_CREDENTIALS = "Invalid email or password";

export interface ClientInfo {
  ip: string | null;
  userAgent: string | null;
}

export interface LoginResult {
  view: SessionView;
  token: string;
  cookieExpiresAt: Date;
}

/** Same hashing as session tokens: SHA-256, only the hash is stored. */
export const hashToken = hashSessionToken;
export const createToken = createSessionToken;

async function buildView(
  user: UserRecord,
  activeTenantId: string | null,
  isSuperAdmin: boolean,
): Promise<SessionView> {
  const rolesByTenant = await membershipsService.tenantRolesForUser(user.id);
  const tenants = (await tenantsService.findManyByIds([...rolesByTenant.keys()]))
    .filter((t) => t.status === "ACTIVE")
    .map((t) => ({
      id: t.id,
      name: t.name,
      slug: t.slug,
      timezone: t.timezone,
      roles: rolesByTenant.get(t.id) ?? [],
    }));
  const active = tenants.some((t) => t.id === activeTenantId) ? activeTenantId : null;
  const roles = active
    ? await membershipsService.grantsInTenant({ tenantId: active }, user.id)
    : [];
  return {
    user: { id: user.id, email: user.email, displayName: user.displayName, isSuperAdmin },
    tenants,
    activeTenantId: active,
    roles,
  };
}

export const authService = {
  async login(input: LoginInput, client: ClientInfo, now = new Date()): Promise<LoginResult> {
    const user = await usersService.findByEmail(input.email);

    if (!user || !user.passwordHash) {
      // Same work as a real check, so timing does not reveal whether the email exists.
      await verifyPassword(await getDummyHash(), input.password);
      throw AppError.unauthenticated(INVALID_CREDENTIALS);
    }

    if (user.lockedUntil && user.lockedUntil > now) {
      const minutes = Math.ceil((user.lockedUntil.getTime() - now.getTime()) / 60_000);
      throw new AppError(
        423,
        ErrorCode.ACCOUNT_LOCKED,
        `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
      );
    }

    if (!(await verifyPassword(user.passwordHash, input.password))) {
      const failures = user.failedLoginCount + 1;
      const locks = failures >= MAX_FAILED_LOGINS;
      await usersService.recordFailedLogin(
        user.id,
        locks ? 0 : failures,
        locks ? new Date(now.getTime() + LOCK_DURATION_MS) : null,
      );
      throw AppError.unauthenticated(INVALID_CREDENTIALS);
    }

    // Only someone who knows the password learns that the account is switched off.
    if (user.status !== "ACTIVE") {
      throw new AppError(403, ErrorCode.ACCOUNT_INACTIVE, "This account is not active");
    }

    await usersService.recordSuccessfulLogin(user.id, now);

    const isSuperAdmin = await membershipsService.isSuperAdmin(user.id);
    const tenantIds = [...(await membershipsService.tenantRolesForUser(user.id)).keys()];
    // One college: it becomes the active one straight away. Several: the user picks.
    const activeTenantId = tenantIds.length === 1 ? tenantIds[0]! : null;

    const { token, cookieExpiresAt } = await this.startSession(
      user.id,
      activeTenantId,
      client,
      now,
    );
    return { view: await buildView(user, activeTenantId, isSuperAdmin), token, cookieExpiresAt };
  },

  /** Creates a session row and returns the cookie token (sent once, never stored). */
  async startSession(
    userId: string,
    activeTenantId: string | null,
    client: ClientInfo,
    now = new Date(),
  ): Promise<{ token: string; cookieExpiresAt: Date }> {
    const token = createSessionToken();
    const absoluteExpiresAt = new Date(now.getTime() + SESSION_ABSOLUTE_MS);
    await authRepository.createSession({
      userId,
      tokenHash: hashSessionToken(token),
      activeTenantId,
      expiresAt: nextIdleExpiry(now, absoluteExpiresAt),
      absoluteExpiresAt,
      ip: client.ip,
      userAgent: client.userAgent?.slice(0, 512) ?? null,
    });
    return { token, cookieExpiresAt: absoluteExpiresAt };
  },

  /** Turns a cookie token into an auth context, or null if unknown, revoked, expired or inactive. */
  async resolveSession(token: string, now = new Date()): Promise<AuthContext | null> {
    const session = await authRepository.findSessionByTokenHash(hashSessionToken(token));
    if (!session || session.revokedAt || session.expiresAt <= now) return null;
    if (session.user.status !== "ACTIVE") return null;

    if (now.getTime() - session.lastUsedAt.getTime() >= SESSION_TOUCH_INTERVAL_MS) {
      await authRepository.touchSession(
        session.id,
        now,
        nextIdleExpiry(now, session.absoluteExpiresAt),
      );
    }
    return {
      userId: session.userId,
      sessionId: session.id,
      activeTenantId: session.activeTenantId,
      isSuperAdmin: await membershipsService.isSuperAdmin(session.userId),
    };
  },

  async me(auth: AuthContext): Promise<SessionView> {
    const user = await usersService.findById(auth.userId);
    if (!user) throw AppError.unauthenticated();
    return buildView(user, auth.activeTenantId, auth.isSuperAdmin);
  },

  /** Chooses the active college for this session. Only a college the user belongs to. */
  async setActiveTenant(auth: AuthContext, tenantId: string): Promise<SessionView> {
    const roles = await membershipsService.tenantRolesForUser(auth.userId);
    const [tenant] = roles.has(tenantId) ? await tenantsService.findManyByIds([tenantId]) : [];
    if (!tenant || tenant.status !== "ACTIVE") {
      // Same answer for "no such college" and "not yours".
      throw AppError.notFound("College not found");
    }
    await authRepository.setActiveTenant(auth.sessionId, auth.userId, tenantId);
    return this.me({ ...auth, activeTenantId: tenantId });
  },

  async logout(auth: AuthContext, now = new Date()): Promise<void> {
    await authRepository.revokeSession(auth.userId, auth.sessionId, now);
  },

  async logoutAll(auth: AuthContext, now = new Date()): Promise<void> {
    await authRepository.revokeAllSessions(auth.userId, now);
  },

  /** Changes the password and logs out every other session. The current one stays. */
  async changePassword(
    auth: AuthContext,
    input: ChangePasswordInput,
    now = new Date(),
  ): Promise<void> {
    const user = await usersService.findById(auth.userId);
    if (!user?.passwordHash) throw AppError.unauthenticated();
    if (!(await verifyPassword(user.passwordHash, input.currentPassword))) {
      throw AppError.invalid("The current password is wrong", [
        { path: "currentPassword", message: "The current password is wrong" },
      ]);
    }
    await usersService.setPassword(user.id, await hashPassword(input.newPassword));
    await authRepository.revokeAllSessions(user.id, now, auth.sessionId);
    await authRepository.expireOpenResets(user.id, now);
  },

  /**
   * Starts a password reset. The caller always gets the same answer, whether or not the address
   * belongs to an account, so the response never reveals who has one.
   */
  async forgotPassword(input: ForgotPasswordInput, now = new Date()): Promise<void> {
    const user = await usersService.findByEmail(input.email);
    if (!user || user.status !== "ACTIVE") {
      // Comparable work, so timing reveals little.
      hashSessionToken(createSessionToken());
      return;
    }
    const token = createSessionToken();
    await authRepository.createPasswordReset({
      userId: user.id,
      tokenHash: hashSessionToken(token),
      expiresAt: new Date(now.getTime() + RESET_TOKEN_TTL_MS),
    });
    await notificationsService.queueEmail({
      tenantId: null,
      to: user.email,
      template: "password_reset",
      params: { token },
    });
    logger.info({ userId: user.id }, "Password reset requested");
  },

  /** Sets a new password from a reset link, then logs out every session of the account. */
  async resetPassword(input: ResetPasswordInput, now = new Date()): Promise<void> {
    const reset = await authRepository.findPasswordReset(hashSessionToken(input.token));
    const invalid = new AppError(
      400,
      ErrorCode.INVALID_TOKEN,
      "This link is invalid or has expired. Ask for a new one.",
    );
    if (!reset || reset.usedAt || reset.expiresAt <= now) throw invalid;
    const user = await usersService.findById(reset.userId);
    if (!user || user.status !== "ACTIVE") throw invalid;
    if (!(await authRepository.usePasswordReset(reset.id, now))) throw invalid;

    await usersService.setPassword(user.id, await hashPassword(input.newPassword));
    await authRepository.expireOpenResets(user.id, now);
    await authRepository.revokeAllSessions(user.id, now);
  },

  cleanupSessions(now = new Date()): Promise<number> {
    return authRepository.deleteDeadSessions(now);
  },
};
