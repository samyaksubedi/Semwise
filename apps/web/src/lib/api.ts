import type { ApiErrorBody, ApiIssue, ErrorCode } from "@semwise/shared";
import { API_URL } from "./env";
import { t } from "./strings";

/** An error answered by the API (or a network failure, as code NETWORK). */
export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode | "NETWORK";
  readonly details: ApiIssue[];
  readonly requestId: string | null;

  constructor(
    status: number,
    code: ErrorCode | "NETWORK",
    message: string,
    details: ApiIssue[] = [],
    requestId: string | null = null,
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
    this.requestId = requestId;
  }

  /** The message for one form field, from VALIDATION_FAILED details. */
  field(path: string): string | undefined {
    return this.details.find((d) => d.path === path)?.message;
  }
}

type Query = Record<string, string | number | boolean | null | undefined>;

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  query?: Query;
  signal?: AbortSignal;
}

export function buildUrl(path: string, query?: Query): string {
  const url = new URL(`${API_URL}/v1${path}`);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null && value !== "")
      url.searchParams.set(key, String(value));
  }
  return url.toString();
}

/**
 * Calls the API with the session cookie and unwraps the `{ data }` envelope. Errors become an
 * ApiError with the API's stable code, never a raw message to branch on.
 */
export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = options.body === undefined ? "GET" : "POST", body, query, signal } = options;
  let res: Response;
  try {
    res = await fetch(buildUrl(path, query), {
      method,
      credentials: "include",
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    throw new ApiError(0, "NETWORK", t.network.offline);
  }
  if (res.status === 204) return undefined as T;
  const json = (await res.json().catch(() => null)) as { data?: T } | ApiErrorBody | null;
  if (!res.ok) {
    const error = json && "error" in json ? json.error : null;
    throw new ApiError(
      res.status,
      error?.code ?? "INTERNAL",
      error?.message ?? t.network.failed,
      error?.details ?? [],
      error?.requestId ?? null,
    );
  }
  return (json as { data: T }).data;
}

/** PUTs a file straight to storage through the signed URL the API issued. */
export async function putToStorage(url: string, file: Blob, contentType: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch(url, { method: "PUT", body: file, headers: { "Content-Type": contentType } });
  } catch {
    throw new ApiError(0, "NETWORK", t.network.uploadFailed);
  }
  if (!res.ok) throw new ApiError(res.status, "INTERNAL", t.network.uploadRefused);
}
