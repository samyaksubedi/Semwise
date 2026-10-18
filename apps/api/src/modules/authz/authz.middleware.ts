import { ErrorCode } from "@semwise/shared";
import type { Request, RequestHandler } from "express";
import { AppError } from "../../common/errors/app-error.js";
import { tenantsService } from "../tenants/index.js";
import { authzService } from "./authz.service.js";
import type { Actor } from "./authz.types.js";

/**
 * Tenant routes: sets `req.tenant` and `req.actor` from the session's active college and the
 * user's memberships in it. The tenant is never taken from the client.
 */
export const resolveTenant: RequestHandler = async (req, _res, next) => {
  const auth = req.auth;
  if (!auth) return next(AppError.unauthenticated());
  if (!auth.activeTenantId) {
    return next(new AppError(403, ErrorCode.NO_ACTIVE_TENANT, "Choose a college first"));
  }
  const tenant = await tenantsService.findOwn(auth.activeTenantId);
  if (!tenant || tenant.status !== "ACTIVE") {
    return next(new AppError(403, ErrorCode.NO_ACTIVE_TENANT, "This college is not available"));
  }
  const actor = await authzService.loadActor(tenant.id, auth.userId);
  if (actor.memberships.length === 0) {
    return next(
      new AppError(403, ErrorCode.NO_ACTIVE_TENANT, "You are not a member of this college"),
    );
  }
  req.tenant = { id: tenant.id, timezone: tenant.timezone };
  req.actor = actor;
  next();
};

/** Platform routes: only the Super Admin, with an actor outside any college. */
export const requireSuperAdmin: RequestHandler = (req, _res, next) => {
  if (!req.auth?.isSuperAdmin) return next(AppError.forbidden());
  req.actor = authzService.platformActor(req.auth.userId);
  next();
};

/** Narrows `req.actor` inside handlers behind resolveTenant or requireSuperAdmin. */
export function getActor(req: Request): Actor {
  if (!req.actor) throw AppError.unauthenticated();
  return req.actor;
}

/** The active college of a tenant route. */
export function getTenant(req: Request): { id: string; timezone: string } {
  if (!req.tenant) throw new AppError(403, ErrorCode.NO_ACTIVE_TENANT, "Choose a college first");
  return req.tenant;
}
