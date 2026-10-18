import {
  ErrorCode,
  ROLE_LABELS,
  type AcceptInvitationInput,
  type AcceptInvitationResult,
  type InvitationPreview,
  type InviteSendStatus,
  type InviteTeacherInput,
  type Role,
  type TeacherView,
} from "@semwise/shared";
import { transaction, type TenantScope } from "../../common/db/scope.js";
import { AppError } from "../../common/errors/app-error.js";
import { auditService } from "../audit/index.js";
import { Action, authorize, can, adminProgramIds, hasRole, type Actor } from "../authz/index.js";
import {
  authService,
  createToken,
  hashPassword,
  hashToken,
  type ClientInfo,
} from "../auth/index.js";
import { membershipsService } from "../memberships/index.js";
import { notificationsService } from "../notifications/index.js";
import { tenantsService } from "../tenants/index.js";
import { usersService, type UserRecord } from "../users/index.js";
import { invitationsRepository, type InvitationScopeFields } from "./invitations.repository.js";

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface InviteSpec extends InvitationScopeFields {
  email: string;
  displayName?: string | null;
  rollNo?: string | null;
  role: Role;
}

type InvitationRow = NonNullable<Awaited<ReturnType<typeof invitationsRepository.findById>>>;

/**
 * What accepting an invite grants. Admin roles are handled here; later features register the
 * student and teacher parts (student record, enrollment) without this module depending on them.
 */
export type AcceptHandler = (
  scope: TenantScope,
  invitation: InvitationRow,
  user: UserRecord,
) => Promise<void>;

const acceptHandlers = new Map<Role, AcceptHandler>([
  [
    "UNIVERSITY_ADMIN",
    async (scope, inv, user) => {
      await membershipsService.ensureRole(scope, user.id, "UNIVERSITY_ADMIN", inv.invitedById);
    },
  ],
  [
    "PROGRAM_ADMIN",
    async (scope, inv, user) => {
      if (!inv.programId) throw AppError.invalidState("This invite has no program");
      await membershipsService.ensureRole(scope, user.id, "PROGRAM_ADMIN", inv.invitedById, {
        programId: inv.programId,
      });
    },
  ],
  [
    "TEACHER",
    async (scope, inv, user) => {
      await membershipsService.ensureRole(scope, user.id, "TEACHER", inv.invitedById);
    },
  ],
]);

export function registerAcceptHandler(role: Role, handler: AcceptHandler): void {
  acceptHandlers.set(role, handler);
}

const invalidLink = () =>
  new AppError(400, ErrorCode.INVALID_TOKEN, "This invite link is invalid or has expired.");

function isOpen(inv: { usedAt: Date | null; revokedAt: Date | null; expiresAt: Date }, now: Date) {
  return !inv.usedAt && !inv.revokedAt && inv.expiresAt > now;
}

export const invitationsService = {
  /**
   * Creates an invite, or refreshes the open one for the same person, role and scope (new token,
   * new expiry), so inviting twice never leaves two live links. Safe inside a transaction;
   * call `send` after it commits.
   */
  async createOrRefresh(
    scope: TenantScope,
    spec: InviteSpec,
    invitedById: string | null,
    now = new Date(),
  ): Promise<{ id: string; token: string }> {
    const token = createToken();
    const tokenHash = hashToken(token);
    const expiresAt = new Date(now.getTime() + INVITE_TTL_MS);
    const open = await invitationsRepository.findOpen(scope, spec.email, spec.role, spec, now);
    if (open) {
      await invitationsRepository.rotateToken(scope, open.id, tokenHash, expiresAt);
      return { id: open.id, token };
    }
    const created = await invitationsRepository.create(scope, {
      email: spec.email,
      displayName: spec.displayName ?? null,
      rollNo: spec.rollNo ?? null,
      role: spec.role,
      programId: spec.programId ?? null,
      batchId: spec.batchId ?? null,
      semesterId: spec.semesterId ?? null,
      sectionId: spec.sectionId ?? null,
      tokenHash,
      expiresAt,
      invitedById,
    });
    return { id: created.id, token };
  },

  /** Queues the invite email through the throttled queue and links it to the invite. */
  async send(scope: TenantScope, invitationId: string, token: string, now = new Date()) {
    const inv = await invitationsRepository.findById(scope, invitationId);
    if (!inv) throw AppError.notFound("Invite not found");
    const tenant = await tenantsService.findOwn(scope.tenantId);
    const emailLogId = await notificationsService.queueEmail({
      tenantId: scope.tenantId,
      to: inv.email,
      template: "invitation",
      params: {
        token,
        collegeName: tenant?.name ?? "your college",
        roleLabel: ROLE_LABELS[inv.role],
      },
    });
    await invitationsRepository.recordSent(scope, inv.id, emailLogId, now);
    return emailLogId;
  },

  /** What the accept page needs to show. Only the holder of the emailed token can ask. */
  async preview(token: string, now = new Date()): Promise<InvitationPreview> {
    const inv = await invitationsRepository.findByTokenHash(hashToken(token));
    if (!inv || !isOpen(inv, now) || inv.tenant.status !== "ACTIVE") throw invalidLink();
    const user = await usersService.findByEmail(inv.email);
    return {
      collegeName: inv.tenant.name,
      role: inv.role,
      roleLabel: ROLE_LABELS[inv.role],
      email: inv.email,
      displayName: user?.displayName ?? inv.displayName,
      needsPassword: !user?.passwordHash,
    };
  },

  /**
   * Accepts an invite. A new person sets their password and is signed in; someone who already
   * has a Semwise account joins this college with the account they have.
   */
  async accept(
    input: AcceptInvitationInput,
    client: ClientInfo,
    now = new Date(),
  ): Promise<{
    result: AcceptInvitationResult;
    session: { token: string; cookieExpiresAt: Date } | null;
  }> {
    const found = await invitationsRepository.findByTokenHash(hashToken(input.token));
    if (!found || !isOpen(found, now) || found.tenant.status !== "ACTIVE") throw invalidLink();
    const scope = { tenantId: found.tenantId };
    const handler = acceptHandlers.get(found.role);
    if (!handler) throw AppError.invalidState("This kind of invite cannot be accepted yet");

    const existing = await usersService.findByEmail(found.email);
    if (existing?.status === "DEACTIVATED") {
      throw new AppError(403, ErrorCode.ACCOUNT_INACTIVE, "This account is not active");
    }
    const needsPassword = !existing?.passwordHash;
    if (needsPassword && !input.password) {
      throw AppError.invalid("Choose a password", [{ path: "password", message: "Required" }]);
    }
    // Hash before the transaction: Argon2 is deliberately slow.
    const passwordHash = needsPassword ? await hashPassword(input.password!) : null;

    const user = await transaction(scope, async () => {
      if (!(await invitationsRepository.markUsed(scope, found.id, now))) throw invalidLink();
      let account =
        existing ??
        (await usersService.findOrCreateInvited(
          found.email,
          input.displayName ?? found.displayName ?? found.email.split("@")[0]!,
        ));
      if (passwordHash)
        account = await usersService.activate(account.id, passwordHash, input.displayName);
      await handler(scope, found, account);
      await auditService.record({
        tenantId: scope.tenantId,
        programId: found.programId,
        actorId: account.id,
        action: "invitation.accept",
        entityType: "Invitation",
        entityId: found.id,
        after: { role: found.role, programId: found.programId, sectionId: found.sectionId },
      });
      return account;
    });

    const session = passwordHash
      ? await authService.startSession(user.id, scope.tenantId, client, now)
      : null;
    return { result: { loggedIn: Boolean(session), tenantId: scope.tenantId }, session };
  },

  findManyByIds(scope: TenantScope, ids: string[]) {
    return ids.length ? invitationsRepository.findManyByIds(scope, ids) : Promise.resolve([]);
  },

  /** Withdraws an open invite: its link stops working. Returns false if it was not open. */
  async revoke(scope: TenantScope, id: string, now = new Date()): Promise<boolean> {
    return (await invitationsRepository.revoke(scope, id, now)).count === 1;
  },

  /** Corrects the address of an unaccepted invite; returns the new token to email. */
  async changeEmail(scope: TenantScope, id: string, email: string, now = new Date()) {
    const token = createToken();
    await invitationsRepository.changeEmail(
      scope,
      id,
      email,
      hashToken(token),
      new Date(now.getTime() + INVITE_TTL_MS),
    );
    return token;
  },

  /** Issues a new token for an open invite (resend). */
  async refreshToken(scope: TenantScope, id: string, now = new Date()) {
    const token = createToken();
    await invitationsRepository.rotateToken(
      scope,
      id,
      hashToken(token),
      new Date(now.getTime() + INVITE_TTL_MS),
    );
    return token;
  },

  /** Send status, last send time and count of each invite, for lists and progress bars. */
  async sendInfo(scope: TenantScope, invitationIds: string[]) {
    const invitations = await this.findManyByIds(scope, invitationIds);
    const logIds = invitations.flatMap((i) => (i.emailLogId ? [i.emailLogId] : []));
    const statuses = await notificationsService.statuses(scope.tenantId, logIds);
    return new Map(
      invitations.map((inv) => {
        const status: InviteSendStatus = inv.emailLogId
          ? (statuses.get(inv.emailLogId) ?? "QUEUED")
          : "NONE";
        return [
          inv.id,
          {
            status,
            lastSentAt: inv.lastSentAt?.toISOString() ?? null,
            sendCount: inv.sendCount,
            accepted: Boolean(inv.usedAt),
            open: isOpen(inv, new Date()),
          },
        ];
      }),
    );
  },

  // ---------- Teachers ----------

  /** Invites a teacher to the college. Who may assign teachers to classes may invite them. */
  async inviteTeacher(actor: Actor, input: InviteTeacherInput) {
    const scope = { tenantId: actor.tenantId! };
    authorize(actor, Action.CLASS_MANAGE, { ...scope, programId: input.programId });
    const invite = await transaction(scope, async () => {
      const inv = await this.createOrRefresh(
        scope,
        {
          email: input.email,
          displayName: input.displayName,
          role: "TEACHER",
          programId: input.programId,
        },
        actor.userId,
      );
      await auditService.record({
        tenantId: scope.tenantId,
        programId: input.programId,
        actorId: actor.userId,
        action: "teacher.invite",
        entityType: "Invitation",
        entityId: inv.id,
        after: { role: "TEACHER" },
      });
      return inv;
    });
    await this.send(scope, invite.id, invite.token);
    return { invitationId: invite.id };
  },

  /** The college's teachers (joined and invited), for assigning them to classes. */
  async listTeachers(actor: Actor, now = new Date()): Promise<TeacherView[]> {
    const scope = { tenantId: actor.tenantId! };
    const manages =
      hasRole(actor, "UNIVERSITY_ADMIN") ||
      adminProgramIds(actor).some((programId) =>
        can(actor, Action.CLASS_MANAGE, { ...scope, programId }),
      );
    if (!manages) throw AppError.forbidden();
    const userIds = await membershipsService.holders(scope, "TEACHER");
    const users = await usersService.findManyByIds(userIds);
    const joined: TeacherView[] = users.map((u) => ({
      userId: u.id,
      email: u.email,
      displayName: u.displayName,
      status: "ACTIVE",
    }));
    const emails = new Set(joined.map((t) => t.email));
    const pending = (await invitationsRepository.listOpen(scope, "TEACHER", now))
      .filter((inv) => !emails.has(inv.email))
      .map((inv): TeacherView => ({
        userId: null,
        email: inv.email,
        displayName: inv.displayName,
        status: "INVITED",
      }));
    return [...joined, ...pending].sort((a, b) =>
      (a.displayName ?? a.email).localeCompare(b.displayName ?? b.email),
    );
  },

  async countOpenAdminInvites(tenantIds: string[], now = new Date()) {
    return invitationsRepository.countOpenByTenant(tenantIds, "UNIVERSITY_ADMIN", now);
  },
};
