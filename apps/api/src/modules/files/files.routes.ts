import { Router } from "express";
import { uploadSignLimit } from "../../common/middleware/rate-limit.js";
import { filesController } from "./files.controller.js";

/** Mounted at /v1/files. */
export const filesRouter: Router = Router();
filesRouter.post("/uploads", uploadSignLimit, filesController.requestUpload);
filesRouter.post("/:id/complete", filesController.complete);
filesRouter.get("/:id/download-url", filesController.downloadUrl);
