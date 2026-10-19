import type { Metadata } from "next";
import { ProgramsPage } from "@/features/admin/structure";
import { t } from "@/lib/strings";

export const metadata: Metadata = { title: t.structure.title };

export default function Page() {
  return <ProgramsPage />;
}
