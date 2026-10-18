import { Router } from "express";
import { auditController } from "./audit.controller.js";

/** Mounted at /v1/audit (tenant routes). */
export const auditRouter: Router = Router();
auditRouter.get("/", auditController.list);

/** Mounted at /v1/platform/audit. */
export const auditPlatformRouter: Router = Router();
auditPlatformRouter.get("/", auditController.listPlatform);
