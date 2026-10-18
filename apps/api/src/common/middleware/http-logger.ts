import { randomUUID } from "node:crypto";
import { pinoHttp } from "pino-http";
import { logger } from "../../lib/logger.js";

const REQUEST_ID_HEADER = "x-request-id";
const VALID_REQUEST_ID = /^[A-Za-z0-9._-]{8,128}$/;

/**
 * Logs every request and gives it an id. A well-formed incoming x-request-id is reused
 * (so traces can span services); otherwise a new one is made. The id is echoed back in the response.
 */
export const httpLogger = pinoHttp({
  logger,
  genReqId: (req, res) => {
    const incoming = req.headers[REQUEST_ID_HEADER];
    const id =
      typeof incoming === "string" && VALID_REQUEST_ID.test(incoming) ? incoming : randomUUID();
    res.setHeader(REQUEST_ID_HEADER, id);
    return id;
  },
  customLogLevel: (_req, res, err) => {
    if (err || res.statusCode >= 500) return "error";
    if (res.statusCode >= 400) return "warn";
    return "info";
  },
  // Coolify polls the health check constantly; keep it out of the logs.
  autoLogging: { ignore: (req) => req.url?.startsWith("/v1/health") ?? false },
});
