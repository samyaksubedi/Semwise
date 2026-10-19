import { Router } from "express";
import { aiLimit } from "../../common/middleware/rate-limit.js";
import { sessionsController as c } from "./sessions.controller.js";

/** Mounted at /v1/classes, next to the class routes. */
export const classEntriesRouter: Router = Router();
classEntriesRouter.get("/:id/entries", c.listForClass);
classEntriesRouter.post("/:id/entries", aiLimit, c.create);

/** Mounted at /v1/entries. */
export const entriesRouter: Router = Router();
entriesRouter.get("/mine", c.mine);
entriesRouter.get("/:id", c.get);
entriesRouter.patch("/:id/draft", c.updateDraft);
entriesRouter.post("/:id/submit", c.submit);
entriesRouter.post("/:id/versions", aiLimit, c.newVersion);
entriesRouter.post("/:id/withdraw", c.withdraw);
entriesRouter.post("/:id/takedown", c.takedown);
entriesRouter.post("/:id/restore", c.restore);

/** Mounted at /v1/approvals. */
export const approvalsQueueRouter: Router = Router();
approvalsQueueRouter.get("/", c.queue);
approvalsQueueRouter.post("/bulk-approve", c.bulkApprove);
approvalsQueueRouter.post("/:versionId/approve", c.approve);
approvalsQueueRouter.post("/:versionId/reject", c.reject);
