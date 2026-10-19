import type { Metadata } from "next";
import { ProgramPage } from "@/features/admin/structure";
import { t } from "@/lib/strings";

export const metadata: Metadata = { title: t.structure.title };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ProgramPage id={id} />;
}
