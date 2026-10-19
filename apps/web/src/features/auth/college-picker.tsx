"use client";

import type { SessionView } from "@semwise/shared";
import { useMutation } from "@tanstack/react-query";
import { Building2, ChevronRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Notice, Skeleton } from "@/components/ui/surface";
import { api } from "@/lib/api";
import { homeFor } from "@/lib/nav";
import { useSession, useSetSession } from "@/lib/session";
import { t } from "@/lib/strings";
import { AuthCard } from "./auth-card";

/** The list of colleges; picking one makes it the session's active college. */
export function CollegeList({ onPicked }: { onPicked?: (session: SessionView) => void }) {
  const { data: session } = useSession();
  const setSession = useSetSession();
  const pick = useMutation({
    mutationFn: (tenantId: string) =>
      api<SessionView>("/auth/active-tenant", { body: { tenantId } }),
    onSuccess: (next) => {
      setSession(next);
      onPicked?.(next);
    },
  });
  if (!session) return <Skeleton className="h-28 w-full" />;
  return (
    <div className="flex flex-col gap-2">
      {pick.error && <Notice tone="danger">{pick.error.message}</Notice>}
      <ul className="flex flex-col gap-2">
        {session.tenants.map((college) => (
          <li key={college.id}>
            <button
              type="button"
              disabled={pick.isPending}
              onClick={() => pick.mutate(college.id)}
              aria-current={college.id === session.activeTenantId ? "true" : undefined}
              className="flex min-h-14 w-full items-center gap-3 rounded-control border border-border bg-surface px-3 text-left transition-calm hover:border-border-strong aria-[current=true]:border-accent"
            >
              <Building2 aria-hidden className="size-5 text-muted" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{college.name}</span>
                <span className="block truncate text-sm text-muted">
                  {college.roles.map((r) => t.roles[r]).join(", ")}
                </span>
              </span>
              <ChevronRight aria-hidden className="size-5 text-faint" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ChooseCollege() {
  const router = useRouter();
  const { data: session, isPending } = useSession();
  // Login already picks the only college, so this page is for people in several.
  useEffect(() => {
    if (!isPending && !session) router.replace("/login");
  }, [session, isPending, router]);
  return (
    <AuthCard title={t.auth.chooseCollegeTitle} lead={t.auth.chooseCollegeLead}>
      <CollegeList onPicked={(next) => router.replace(homeFor(next))} />
    </AuthCard>
  );
}
