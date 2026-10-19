import { Router } from "express";
import { catchupController as c } from "./catchup.controller.js";

/** Mounted at /v1/catchup. The student's own section. */
export const catchupRouter: Router = Router();
catchupRouter.get("/", c.view);
