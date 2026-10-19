import { Router, type RequestHandler } from "express";
import { requireTrustedOrigin } from "./common/middleware/origin-check.js";
import { userLimit } from "./common/middleware/rate-limit.js";
import { classApprovalRouter, programApprovalRouter } from "./modules/approvals/index.js";
import { auditPlatformRouter, auditRouter } from "./modules/audit/index.js";
import { authRouter, loadSession, requireAuth } from "./modules/auth/index.js";
import { classesRouter, semesterClassesRouter } from "./modules/classes/index.js";
import { requireSuperAdmin, resolveTenant } from "./modules/authz/index.js";
import { filesRouter } from "./modules/files/index.js";
import { healthRouter } from "./modules/health/index.js";
import { classMediaRouter, mediaReadingsRouter } from "./modules/media/index.js";
import {
  approvalsQueueRouter,
  classEntriesRouter,
  entriesRouter,
} from "./modules/sessions/index.js";
import {
  sectionCrRouter,
  semesterStudentsRouter,
  studentsRouter,
} from "./modules/enrollments/index.js";
import { invitationsPublicRouter, teachersRouter } from "./modules/invitations/index.js";
import {
  batchesRouter,
  programsRouter,
  sectionsRouter,
  semestersRouter,
  subjectsRouter,
} from "./modules/structure/index.js";
import {
  semesterSyllabusRouter,
  subjectSyllabusRouter,
  syllabusRouter,
} from "./modules/syllabus/index.js";
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

  // Several modules may share a prefix (structure and enrollments under /semesters); the guard
  // runs once per request, before any of them.
  const mount = (guard: RequestHandler[], routes: [string, Router][], prefix = "") => {
    router.use([...new Set(routes.map(([path]) => prefix + path))], ...guard);
    for (const [path, sub] of routes) router.use(prefix + path, sub);
  };

  mount(
    platformGuard,
    [
      ["/tenants", tenantsPlatformRouter],
      ["/audit", auditPlatformRouter],
    ],
    "/platform",
  );

  mount(tenantGuard, [
    ["/college", collegeRouter],
    ["/programs", programsRouter],
    ["/programs", programApprovalRouter],
    ["/batches", batchesRouter],
    ["/semesters", semestersRouter],
    ["/semesters", semesterStudentsRouter],
    ["/semesters", semesterClassesRouter],
    ["/semesters", semesterSyllabusRouter],
    ["/classes", classesRouter],
    ["/classes", classApprovalRouter],
    ["/classes", classEntriesRouter],
    ["/classes", classMediaRouter],
    ["/media-readings", mediaReadingsRouter],
    ["/entries", entriesRouter],
    ["/approvals", approvalsQueueRouter],
    ["/sections", sectionsRouter],
    ["/sections", sectionCrRouter],
    ["/subjects", subjectsRouter],
    ["/subjects", subjectSyllabusRouter],
    ["/syllabus", syllabusRouter],
    ["/files", filesRouter],
    ["/students", studentsRouter],
    ["/teachers", teachersRouter],
    ["/audit", auditRouter],
  ]);

  return router;
}
