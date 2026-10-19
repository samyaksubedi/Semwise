"use client";

import type { SessionView, TenantSummary } from "@semwise/shared";
import {
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { ToastProvider } from "@/components/ui/toast";
import { ApiError, api } from "./api";

export const SESSION_KEY = ["session"] as const;

function makeClient(onSignedOut: () => void) {
  const signedOut = (error: unknown) => {
    if (error instanceof ApiError && error.status === 401) onSignedOut();
  };
  return new QueryClient({
    queryCache: new QueryCache({ onError: signedOut }),
    mutationCache: new MutationCache({ onError: signedOut }),
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        // A 4xx will not change on a retry; network blips and 5xx get one more try.
        retry: (count, error) =>
          !(error instanceof ApiError && error.status >= 400 && error.status < 500) && count < 1,
      },
    },
  });
}

export function Providers({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [client] = useState(() => {
    const created: QueryClient = makeClient(() => {
      created.setQueryData(SESSION_KEY, null);
      const next = window.location.pathname + window.location.search;
      if (!window.location.pathname.startsWith("/login"))
        router.replace(`/login?next=${encodeURIComponent(next)}`);
    });
    return created;
  });
  return (
    <QueryClientProvider client={client}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  );
}

/** The signed-in person (null when signed out). */
export function useSession() {
  return useQuery({
    queryKey: SESSION_KEY,
    queryFn: async (): Promise<SessionView | null> => {
      try {
        return await api<SessionView>("/auth/me");
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
    staleTime: 5 * 60_000,
  });
}

/** The active college of a loaded session. */
export function activeCollege(session: SessionView | null | undefined): TenantSummary | null {
  return session?.tenants.find((c) => c.id === session.activeTenantId) ?? null;
}

/** The college's timezone, for showing dates (falls back to Kathmandu, the first market). */
export function useTimezone(): string {
  const { data } = useSession();
  return activeCollege(data)?.timezone ?? "Asia/Kathmandu";
}

/** After login or a college switch: store the new session and drop everything else cached. */
export function useSetSession() {
  const client = useQueryClient();
  return (session: SessionView | null) => {
    client.removeQueries({ predicate: (q) => q.queryKey[0] !== SESSION_KEY[0] });
    client.setQueryData(SESSION_KEY, session);
  };
}
