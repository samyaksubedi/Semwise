import {
  ErrorCode,
  slugify,
  type CreateTenantInput,
  type InviteAdminInput,
  type PlatformTenantView,
  type TenantView,
  type UpdateCollegeInput,
  type UpdateTenantInput,
} from "@semwise/shared";
import { isUniqueViolation, systemTransaction, transaction } from "../../common/db/scope.js";
import { AppError } from "../../common/errors/app-error.js";
import { env } from "../../config/env.js";
import { auditService } from "../audit/index.js";
import { Action, authorize, type Actor } from "../authz/index.js";
import { invitationsService } from "../invitations/index.js";
import { membershipsService } from "../memberships/index.js";
import { tenantsRepository } from "./tenants.repository.js";

export interface TenantInfo {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  status: "ACTIVE" | "SUSPENDED";
}

type TenantRow = TenantInfo & { createdAt: Date };

function toInfo(t: TenantInfo): TenantInfo {
  return { id: t.id, name: t.name, slug: t.slug, timezone: t.timezone, status: t.status };
}

function toTenantView(t: TenantRow): TenantView {
  return { ...toInfo(t), createdAt: t.createdAt.toISOString() };
}

const alreadyExists = () =>
  AppError.conflict(ErrorCode.ALREADY_EXISTS, "A college with this slug already exists");

export const tenantsService = {
  async findOwn(tenantId: string): Promise<TenantInfo | null> {
    const tenant = await tenantsRepository.findOwn({ tenantId });
    return tenant ? toInfo(tenant) : null;
  },

  async findManyByIds(ids: string[]): Promise<TenantInfo[]> {
    return (await tenantsRepository.findManyByIds(ids)).map(toInfo);
  },

  // ---------- College settings ----------

  /** Every member reads their college's name and timezone (dates are shown in it). */
  async getCollege(actor: Actor): Promise<TenantView> {
    const tenant = await tenantsRepository.findOwn({ tenantId: actor.tenantId! });
    if (!tenant) throw AppError.notFound("College not found");
    return toTenantView(tenant);
  },

  async updateCollege(actor: Actor, input: UpdateCollegeInput): Promise<TenantView> {
    const scope = { tenantId: actor.tenantId! };
    authorize(actor, Action.TENANT_SETTINGS, scope);
    return transaction(scope, async () => {
      const before = await tenantsRepository.findOwn(scope);
      if (!before) throw AppError.notFound("College not found");
      const after = await tenantsRepository.updateOwn(scope, input);
      await auditService.record({
        tenantId: scope.tenantId,
        actorId: actor.userId,
        action: "college.settings.update",
        entityType: "Tenant",
        entityId: scope.tenantId,
        before: { name: before.name, timezone: before.timezone },
        after: { name: after.name, timezone: after.timezone },
      });
      return toTenantView(after);
    });
  },

  // ---------- Platform (Super Admin) ----------

  /** Creates the college, its plan and the first University Admin's invite (emailed after commit). */
  async create(actor: Actor, input: CreateTenantInput): Promise<PlatformTenantView> {
    authorize(actor, Action.TENANT_MANAGE, { tenantId: "" });
    authorize(actor, Action.TENANT_FIRST_ADMIN, { tenantId: "" });
    const slug = input.slug ?? slugify(input.name);
    if (slug.length < 2) {
      throw AppError.invalid("Choose a slug", [{ path: "slug", message: "Required" }]);
    }
    let created: { tenant: TenantRow; invite: { id: string; token: string } };
    try {
      created = await systemTransaction(async () => {
        const tenant = await tenantsRepository.create({
          name: input.name,
          slug,
          timezone: input.timezone,
          monthlyAiBudgetMicros: env.AI_TENANT_MONTHLY_BUDGET_MICROS,
        });
        const invite = await invitationsService.createOrRefresh(
          { tenantId: tenant.id },
          { email: input.adminEmail, displayName: input.adminName, role: "UNIVERSITY_ADMIN" },
          actor.userId,
        );
        await auditService.record({
          tenantId: null,
          actorId: actor.userId,
          action: "tenant.create",
          entityType: "Tenant",
          entityId: tenant.id,
          after: { name: tenant.name, slug: tenant.slug, timezone: tenant.timezone },
        });
        return { tenant, invite };
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw alreadyExists();
      throw err;
    }
    const { tenant, invite } = created;
    await invitationsService.send({ tenantId: tenant.id }, invite.id, invite.token);
    return this.platformView(actor, tenant.id);
  },

  async list(actor: Actor): Promise<PlatformTenantView[]> {
    authorize(actor, Action.TENANT_MANAGE, { tenantId: "" });
    return this.withAdmins(await tenantsRepository.list());
  },

  async platformView(actor: Actor, id: string): Promise<PlatformTenantView> {
    authorize(actor, Action.TENANT_MANAGE, { tenantId: id });
    const tenant = await tenantsRepository.findById(id);
    if (!tenant) throw AppError.notFound("College not found");
    return (await this.withAdmins([tenant]))[0]!;
  },

  /** The Super Admin sees each college's admins and open admin invites, never college content. */
  async withAdmins(tenants: TenantRow[]): Promise<PlatformTenantView[]> {
    const ids = tenants.map((t) => t.id);
    const [admins, open] = await Promise.all([
      membershipsService.universityAdminsByTenant(ids),
      invitationsService.countOpenAdminInvites(ids),
    ]);
    return tenants.map((t) => ({
      ...toTenantView(t),
      universityAdmins: admins.get(t.id) ?? [],
      pendingAdminInvites: open.get(t.id) ?? 0,
    }));
  },

  /** Rename, change timezone, suspend or reactivate. A suspended college's users lose access. */
  async update(actor: Actor, id: string, input: UpdateTenantInput): Promise<PlatformTenantView> {
    authorize(actor, Action.TENANT_MANAGE, { tenantId: id });
    await systemTransaction(async () => {
      const before = await tenantsRepository.findById(id);
      if (!before) throw AppError.notFound("College not found");
      const after = await tenantsRepository.update(id, input);
      const statusChanged = input.status !== undefined && input.status !== before.status;
      const action = !statusChanged
        ? "tenant.update"
        : input.status === "SUSPENDED"
          ? "tenant.suspend"
          : "tenant.reactivate";
      await auditService.record({
        tenantId: null,
        actorId: actor.userId,
        action,
        entityType: "Tenant",
        entityId: id,
        before: { name: before.name, timezone: before.timezone, status: before.status },
        after: { name: after.name, timezone: after.timezone, status: after.status },
      });
    });
    return this.platformView(actor, id);
  },

  /** Invites (another) University Admin, for example when the first one left. */
  async inviteUniversityAdmin(
    actor: Actor,
    id: string,
    input: InviteAdminInput,
  ): Promise<PlatformTenantView> {
    authorize(actor, Action.TENANT_FIRST_ADMIN, { tenantId: id });
    const invite = await systemTransaction(async () => {
      const tenant = await tenantsRepository.findById(id);
      if (!tenant) throw AppError.notFound("College not found");
      const inv = await invitationsService.createOrRefresh(
        { tenantId: id },
        { email: input.email, displayName: input.displayName, role: "UNIVERSITY_ADMIN" },
        actor.userId,
      );
      await auditService.record({
        tenantId: null,
        actorId: actor.userId,
        action: "tenant.universityAdmin.invite",
        entityType: "Tenant",
        entityId: id,
        after: { invitationId: inv.id },
      });
      return inv;
    });
    await invitationsService.send({ tenantId: id }, invite.id, invite.token);
    return this.platformView(actor, id);
  },
};
