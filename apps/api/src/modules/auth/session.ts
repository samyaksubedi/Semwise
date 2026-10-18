import { createHash, randomBytes } from "node:crypto";
import type { CookieOptions } from "express";
import { env } from "../../config/env.js";

const DAY = 24 * 60 * 60 * 1000;

/** A session dies after 7 days without use, and after 30 days no matter what. */
export const SESSION_IDLE_MS = 7 * DAY;
export const SESSION_ABSOLUTE_MS = 30 * DAY;
/** lastUsedAt is written at most once a minute, not on every request. */
export const SESSION_TOUCH_INTERVAL_MS = 60_000;

const isProduction = env.NODE_ENV === "production";

/**
 * `__Host-` makes the browser refuse the cookie unless it is Secure, host-only and Path=/.
 * Local development runs over http, so it uses a plain name without Secure.
 */
export const SESSION_COOKIE = isProduction ? "__Host-semwise_sid" : "semwise_sid";

export function sessionCookieOptions(expires: Date): CookieOptions {
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax",
    path: "/",
    expires,
  };
}

export function clearSessionCookieOptions(): CookieOptions {
  return { httpOnly: true, secure: isProduction, sameSite: "lax", path: "/" };
}

/** 32 random bytes, sent to the browser once and never stored. */
export function createSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

/** What the database stores instead of the token. */
export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Expiry after activity: idle window from now, never past the absolute limit. */
export function nextIdleExpiry(now: Date, absoluteExpiresAt: Date): Date {
  return new Date(Math.min(now.getTime() + SESSION_IDLE_MS, absoluteExpiresAt.getTime()));
}
