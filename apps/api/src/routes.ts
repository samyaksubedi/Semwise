import { Router } from "express";
import { healthRouter } from "./modules/health/index.js";

/**
 * Mounts every module under /v1:
 *   /v1/health      liveness and readiness
 *   /v1/auth/*      login, sessions, password reset, invite acceptance
 *   /v1/platform/*  Super Admin only (tenant provisioning)
 *   /v1/*           tenant routes: session, active tenant, then authz per route
 */
export function createV1Router(): Router {
  const router = Router();
  router.use("/health", healthRouter);
  return router;
}
