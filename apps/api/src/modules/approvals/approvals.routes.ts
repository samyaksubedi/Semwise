import { Router } from "express";
import { approvalsController as c } from "./approvals.controller.js";

/** Mounted at /v1/programs, next to the structure routes. */
export const programApprovalRouter: Router = Router();
programApprovalRouter.get("/:id/approval-settings", c.getProgram);
programApprovalRouter.put("/:id/approval-settings", c.setProgram);

/** Mounted at /v1/classes, next to the class routes. */
export const classApprovalRouter: Router = Router();
classApprovalRouter.get("/:id/approval-settings", c.getClass);
classApprovalRouter.put("/:id/approval-settings", c.setClass);
