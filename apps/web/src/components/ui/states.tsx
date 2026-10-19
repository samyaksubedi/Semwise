"use client";

import { RefreshCw } from "lucide-react";
import { ApiError } from "@/lib/api";
import { t } from "@/lib/strings";
import { Button } from "./button";
import { Notice } from "./surface";

/** Plain words and a retry; the request id helps support find the log line. */
export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const apiError = error instanceof ApiError ? error : null;
  const message =
    apiError?.status === 404
      ? t.common.notFoundBody
      : apiError?.status === 403
        ? t.common.forbiddenBody
        : apiError?.message || t.common.errorTitle;
  return (
    <Notice
      tone="danger"
      title={apiError?.status === 404 ? t.common.notFoundTitle : t.common.errorTitle}
      action={
        onRetry && apiError?.status !== 404 && apiError?.status !== 403 ? (
          <Button size="sm" variant="secondary" onClick={onRetry}>
            <RefreshCw aria-hidden className="size-4" />
            {t.common.retry}
          </Button>
        ) : undefined
      }
    >
      <p>{message}</p>
      {apiError?.requestId && (
        <p className="mt-1 text-xs text-muted">{t.common.requestId(apiError.requestId)}</p>
      )}
    </Notice>
  );
}

/** The message for a failed mutation, shown beside the form. */
export function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : t.common.errorTitle;
}
