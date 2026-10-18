import type { ErrorCode } from "./errors.js";

/** Every successful response: `{ data, meta? }`. */
export interface ApiSuccess<TData, TMeta = undefined> {
  data: TData;
  meta?: TMeta;
}

/** Field-level problems attached to a VALIDATION_FAILED error. */
export interface ApiIssue {
  path: string;
  message: string;
}

/** Every error response: `{ error: { code, message, details?, requestId } }`. */
export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    details?: ApiIssue[];
    requestId: string;
  };
}

/** Paging info for cursor-based lists. */
export interface CursorMeta {
  nextCursor: string | null;
}

/** Paging info for page-based admin tables. */
export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}
