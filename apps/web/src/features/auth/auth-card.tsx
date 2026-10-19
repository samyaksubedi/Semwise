"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import { Card } from "@/components/ui/surface";

export function AuthCard({
  title,
  lead,
  children,
  footer,
}: {
  title: string;
  lead?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <>
      <Card className="p-5 sm:p-6">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {lead && <p className="mt-1 text-muted">{lead}</p>}
        <div className="mt-5">{children}</div>
      </Card>
      {footer && <div className="mt-4 text-center text-sm">{footer}</div>}
    </>
  );
}

function tokenFromHash(): string | null {
  return new URLSearchParams(window.location.hash.slice(1)).get("token");
}

function onHashChange(listener: () => void) {
  window.addEventListener("hashchange", listener);
  return () => window.removeEventListener("hashchange", listener);
}

/**
 * The token from a link's fragment (#token=...): fragments never reach a server log. Undefined
 * while rendering on the server, null when the link has no token.
 */
export function useHashToken(): string | null | undefined {
  return useSyncExternalStore(onHashChange, tokenFromHash, () => undefined);
}
