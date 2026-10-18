import { ErrorCode, type ApiErrorBody, type ApiIssue } from "@semwise/shared";
import type { ErrorRequestHandler, Response } from "express";
import { ZodError } from "zod";
import { AppError } from "../errors/app-error.js";

interface BodyParserError {
  type: string;
  status: number;
}

function isBodyParserError(err: unknown): err is BodyParserError {
  return typeof err === "object" && err !== null && "type" in err && "status" in err;
}

function send(
  res: Response,
  status: number,
  requestId: string,
  code: ErrorCode,
  message: string,
  details?: ApiIssue[],
): void {
  const body: ApiErrorBody = {
    error: { code, message, requestId, ...(details ? { details } : {}) },
  };
  res.status(status).json(body);
}

/**
 * Last middleware in the chain. Turns every thrown error into the error envelope.
 * Expected errors keep their message; anything unexpected is logged and hidden behind a generic 500.
 */
export const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }

  const requestId = String(req.id ?? "");

  if (err instanceof ZodError) {
    const details = err.issues.map((issue) => ({
      path: issue.path.map(String).join("."),
      message: issue.message,
    }));
    send(res, 400, requestId, ErrorCode.VALIDATION_FAILED, "Some fields are invalid", details);
    return;
  }

  if (err instanceof AppError) {
    if (err.status >= 500) req.log.error({ err }, err.message);
    send(res, err.status, requestId, err.code, err.message, err.details);
    return;
  }

  if (isBodyParserError(err)) {
    if (err.type === "entity.parse.failed") {
      send(res, 400, requestId, ErrorCode.VALIDATION_FAILED, "The request body is not valid JSON");
      return;
    }
    if (err.type === "entity.too.large") {
      send(res, 413, requestId, ErrorCode.VALIDATION_FAILED, "The request body is too large");
      return;
    }
  }

  req.log.error({ err }, "Unhandled error");
  send(res, 500, requestId, ErrorCode.INTERNAL, "Something went wrong");
};
