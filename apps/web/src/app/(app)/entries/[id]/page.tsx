import type { Metadata } from "next";
import { EntryPage } from "@/features/entries/pages";
import { t } from "@/lib/strings";

export const metadata: Metadata = { title: t.entry.mineTitle };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <EntryPage id={id} />;
}
