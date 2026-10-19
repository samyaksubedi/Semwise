import type { Metadata } from "next";
import { Suspense } from "react";
import { OverviewPage } from "@/features/admin/overview";
import { t } from "@/lib/strings";

export const metadata: Metadata = { title: t.nav.overview };

export default function Page() {
  return (
    <Suspense>
      <OverviewPage />
    </Suspense>
  );
}
