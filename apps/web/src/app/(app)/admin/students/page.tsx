import type { Metadata } from "next";
import { Suspense } from "react";
import { PeoplePage } from "@/features/admin/people";
import { t } from "@/lib/strings";

export const metadata: Metadata = { title: t.people.title };

export default function Page() {
  return (
    <Suspense>
      <PeoplePage />
    </Suspense>
  );
}
