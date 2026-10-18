import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";

export interface RequestContext {
  requestId: string;
  ip: string | null;
}

const storage = new AsyncLocalStorage<RequestContext>();

/** Makes the request id and client IP available to audit and usage records deeper in the call. */
export const requestContext: RequestHandler = (req, _res, next) => {
  storage.run({ requestId: String(req.id ?? randomUUID()), ip: req.ip ?? null }, () => next());
};

/** The current request's context; background jobs get a fresh id per call. */
export function currentRequest(): RequestContext {
  return storage.getStore() ?? { requestId: randomUUID(), ip: null };
}

/** Runs `fn` with its own request id (worker jobs use the job id). */
export function runWithRequestId<T>(requestId: string, fn: () => T): T {
  return storage.run({ requestId, ip: null }, fn);
}
