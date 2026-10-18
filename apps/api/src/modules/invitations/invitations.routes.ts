import { Router } from "express";
import { requireTrustedOrigin } from "../../common/middleware/origin-check.js";
import { inviteLimit, tokenRequestLimit } from "../../common/middleware/rate-limit.js";
import { invitationsController } from "./invitations.controller.js";

/** Mounted at /v1/auth/invitations: used by people who are not signed in yet. */
export const invitationsPublicRouter: Router = Router();

invitationsPublicRouter.use(requireTrustedOrigin, tokenRequestLimit);
invitationsPublicRouter.post("/preview", invitationsController.preview);
invitationsPublicRouter.post("/accept", invitationsController.accept);

/** Mounted at /v1/teachers (tenant routes). */
export const teachersRouter: Router = Router();
teachersRouter.get("/", invitationsController.listTeachers);
teachersRouter.post("/invite", inviteLimit, invitationsController.inviteTeacher);
