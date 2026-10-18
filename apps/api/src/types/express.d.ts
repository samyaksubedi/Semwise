import type { AuthContext } from "../modules/auth/auth.types.js";
import type { Actor } from "../modules/authz/authz.types.js";

declare global {
  namespace Express {
    interface Request {
      /** Set by `loadSession` when the request carries a valid session cookie. */
      auth?: AuthContext;
      /** Set by `resolveTenant` (tenant routes) or `requireSuperAdmin` (platform routes). */
      actor?: Actor;
      /** The active college, set by `resolveTenant` from the session. */
      tenant?: { id: string; timezone: string };
    }
  }
}

export {};
