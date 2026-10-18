import cors from "cors";
import { env } from "../../config/env.js";

const allowed = new Set(env.CORS_ORIGINS);

/**
 * Exact-match origin allow-list; only the web app may send cookies. Requests without an Origin
 * header (curl, server-to-server, Next.js on the server) are not cross-origin calls and pass.
 */
export const corsMiddleware = cors((req, callback) => {
  const origin = req.headers.origin;
  const ok = origin === undefined || allowed.has(origin);
  callback(null, { origin: ok, credentials: ok && origin !== undefined, maxAge: 600 });
});
