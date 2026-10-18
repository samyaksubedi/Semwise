import { ErrorCode, type ApiIssue } from "@semwise/shared";

/**
 * An expected failure with a known HTTP status and a stable code.
 * Throw it anywhere in a request; the error handler turns it into the error envelope.
 */
export class AppError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly details: ApiIssue[] | undefined;

  constructor(status: number, code: ErrorCode, message: string, details?: ApiIssue[]) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
    this.details = details;
  }

  static notFound(message = "Not found"): AppError {
    return new AppError(404, ErrorCode.NOT_FOUND, message);
  }

  static unauthenticated(message = "Log in to continue"): AppError {
    return new AppError(401, ErrorCode.UNAUTHENTICATED, message);
  }

  static forbidden(message = "You do not have permission to do this"): AppError {
    return new AppError(403, ErrorCode.FORBIDDEN, message);
  }

  static conflict(code: ErrorCode, message: string): AppError {
    return new AppError(409, code, message);
  }

  static invalid(message: string, details?: ApiIssue[]): AppError {
    return new AppError(400, ErrorCode.VALIDATION_FAILED, message, details);
  }

  static invalidState(message: string): AppError {
    return new AppError(409, ErrorCode.INVALID_STATE, message);
  }

  static notConfigured(feature: string): AppError {
    return new AppError(
      503,
      ErrorCode.NOT_CONFIGURED,
      `${feature} is not configured on the server`,
    );
  }
}
