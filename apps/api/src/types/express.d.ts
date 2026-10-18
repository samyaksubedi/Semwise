import type { AuthContext } from "../modules/auth/auth.types.js";

declare global {
  namespace Express {
    interface Request {
      /** Set by `loadSession` when the request carries a valid session cookie. */
      auth?: AuthContext;
    }
  }
}

export {};
