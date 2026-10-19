import type { Metadata } from "next";
import { Suspense } from "react";
import { SettingsPage } from "@/features/admin/settings";
import { t } from "@/lib/strings";

export const metadata: Metadata = { title: t.settings.title };

export default function Page() {
  return (
    <Suspense>
      <SettingsPage />
    </Suspense>
  );
}
