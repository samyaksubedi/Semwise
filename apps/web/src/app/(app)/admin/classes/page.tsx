import type { Metadata } from "next";
import { Suspense } from "react";
import { ClassesPage } from "@/features/admin/classes";
import { t } from "@/lib/strings";

export const metadata: Metadata = { title: t.classes.title };

export default function Page() {
  return (
    <Suspense>
      <ClassesPage />
    </Suspense>
  );
}
