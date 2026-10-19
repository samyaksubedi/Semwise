"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Skeleton } from "@/components/ui/surface";
import { homeFor } from "@/lib/nav";
import { useSession } from "@/lib/session";

/** The front door: sign in, pick a college, or go to the home of the person's first area. */
export default function Home() {
  const router = useRouter();
  const { data: session, isPending } = useSession();
  useEffect(() => {
    if (isPending) return;
    if (!session) router.replace("/login");
    else if (!session.activeTenantId && !session.user.isSuperAdmin)
      router.replace("/choose-college");
    else router.replace(homeFor(session));
  }, [session, isPending, router]);
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 p-4 pt-8">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-24 w-full" />
    </div>
  );
}
