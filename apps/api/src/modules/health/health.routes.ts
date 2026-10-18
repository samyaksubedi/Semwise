import { Router } from "express";
import { liveness, readiness } from "./health.controller.js";

export const healthRouter: Router = Router();

healthRouter.get("/", liveness);
healthRouter.get("/ready", readiness);
