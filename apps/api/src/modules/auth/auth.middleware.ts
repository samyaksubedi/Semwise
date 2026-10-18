import { parseCookie } from "cookie";
import type { RequestHandler } from "express";
import { AppError } from "../../common/errors/app-error.js";
import { authService } from "./auth.service.js";
import type { AuthContext } from "./auth.types.js";
import { SESSION_COOKIE } from "./session.js";

export function readSessionToken(cookieHeader: string | undefined): string | undefined {
  if (!cookieHeader) return undefined;
  const token = parseCookie(cookieHeader)[SESSION_COOKIE];
  return token && token.length <= 128 ? token : undefined;
}

/** Attaches `req.auth` when the request carries a valid session cookie. Never rejects. */
export const loadSession: RequestHandler = async (req, _res, next) => {
  const token = readSessionToken(req.headers.cookie);
  if (token) {
    const auth = await authService.resolveSession(token);
    if (auth) req.auth = auth;
  }
  next();
};

/** Rejects the request with 401 unless `loadSession` found a valid session. */
export const requireAuth: RequestHandler = (req, _res, next) => {
  next(req.auth ? undefined : AppError.unauthenticated());
};

/** Narrows `req.auth` inside handlers that run after `requireAuth`. */
export function getAuth(req: { auth?: AuthContext }): AuthContext {
  if (!req.auth) throw AppError.unauthenticated();
  return req.auth;
}
