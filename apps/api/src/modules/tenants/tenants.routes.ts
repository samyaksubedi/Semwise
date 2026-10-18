import { Router } from "express";
import { tenantsController } from "./tenants.controller.js";

/** Mounted at /v1/platform/tenants (Super Admin). */
export const tenantsPlatformRouter: Router = Router();
tenantsPlatformRouter.get("/", tenantsController.list);
tenantsPlatformRouter.post("/", tenantsController.create);
tenantsPlatformRouter.get("/:id", tenantsController.get);
tenantsPlatformRouter.patch("/:id", tenantsController.update);
tenantsPlatformRouter.post("/:id/university-admins", tenantsController.inviteAdmin);

/** Mounted at /v1/college (the active college's settings). */
export const collegeRouter: Router = Router();
collegeRouter.get("/", tenantsController.getCollege);
collegeRouter.patch("/", tenantsController.updateCollege);
