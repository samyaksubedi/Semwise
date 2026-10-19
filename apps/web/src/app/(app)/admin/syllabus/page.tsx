import type { Metadata } from "next";
import { Suspense } from "react";
import { SyllabusListPage } from "@/features/syllabus/syllabus-list";
import { t } from "@/lib/strings";

export const metadata: Metadata = { title: t.syllabus.title };

export default function Page() {
  return (
    <Suspense>
      <SyllabusListPage />
    </Suspense>
  );
}
