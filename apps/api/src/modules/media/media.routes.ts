import { Router } from "express";
import { aiLimit } from "../../common/middleware/rate-limit.js";
import { mediaController as c } from "./media.controller.js";

/** Mounted at /v1/classes, next to the class routes. */
export const classMediaRouter: Router = Router();
classMediaRouter.post("/:id/transcriptions", aiLimit, c.transcribe);
classMediaRouter.post("/:id/photo-readings", aiLimit, c.readPhoto);

/** Mounted at /v1/media-readings. */
export const mediaReadingsRouter: Router = Router();
mediaReadingsRouter.get("/:id", c.get);
