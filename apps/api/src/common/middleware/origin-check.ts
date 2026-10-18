import { ErrorCode } from "@semwise/shared";
import type { RequestHandler } from "express";
import { env } from "../../config/env.js";
import { AppError } from "../errors/app-error.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const trusted = new Set(env.CORS_ORIGINS);

/**
 * Blocks forged requests: every write must come from the web app's origin.
 * Browsers always send Origin on POST/PATCH/DELETE, so another site cannot pass this check.
 * A request with no Origin is not from a browser page (curl, scripts) and cannot carry a forged cookie.
 */
export const requireTrustedOrigin: RequestHandler = (req, _res, next) => {
  if (SAFE_METHODS.has(req.method)) return next();
  const origin = req.headers.origin;
  if (origin === undefined || trusted.has(origin)) return next();
  next(new AppError(403, ErrorCode.FORBIDDEN_ORIGIN, "This origin may not make changes"));
};
