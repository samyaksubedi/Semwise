import { Router, type RequestHandler } from "express";
import { requireTrustedOrigin } from "./common/middleware/origin-check.js";
import { userLimit } from "./common/middleware/rate-limit.js";
import { auditPlatformRouter, auditRouter } from "./modules/audit/index.js";
import { authRouter, loadSession, requireAuth } from "./modules/auth/index.js";
import { requireSuperAdmin, resolveTenant } from "./modules/authz/index.js";
import { healthRouter } from "./modules/health/index.js";
import { invitationsPublicRouter } from "./modules/invitations/index.js";
import {
  batchesRouter,
  programsRouter,
  sectionsRouter,
  semestersRouter,
  subjectsRouter,
} from "./modules/structure/index.js";
import { collegeRouter, tenantsPlatformRouter } from "./modules/tenants/index.js";

/** Tenant routes: the active college always comes from the session, never from the client. */
const tenantGuard: RequestHandler[] = [
  requireTrustedOrigin,
  loadSession,
  requireAuth,
  userLimit,
  resolveTenant,
];

/** Platform routes: Super Admin only. */
const platformGuard: RequestHandler[] = [
  requireTrustedOrigin,
  loadSession,
  requireAuth,
  userLimit,
  requireSuperAdmin,
];

/**
 * Mounts every module under /v1:
 *   /v1/health      liveness and readiness
 *   /v1/auth/*      login, sessions, password reset, invite acceptance
 *   /v1/platform/*  Super Admin only (tenant provisioning)
 *   /v1/*           tenant routes: session, active college from the session, then authz per action
 */
export function createV1Router(): Router {
  const router = Router();

  router.use("/health", healthRouter);
  router.use("/auth/invitations", invitationsPublicRouter);
  router.use("/auth", authRouter);

  const platformRoutes: [string, Router][] = [
    ["/tenants", tenantsPlatformRouter],
    ["/audit", auditPlatformRouter],
  ];
  for (const [path, sub] of platformRoutes) router.use(`/platform${path}`, ...platformGuard, sub);

  const tenantRoutes: [string, Router][] = [
    ["/college", collegeRouter],
    ["/programs", programsRouter],
    ["/batches", batchesRouter],
    ["/semesters", semestersRouter],
    ["/sections", sectionsRouter],
    ["/subjects", subjectsRouter],
    ["/audit", auditRouter],
  ];
  for (const [path, sub] of tenantRoutes) router.use(path, ...tenantGuard, sub);

  return router;
}
