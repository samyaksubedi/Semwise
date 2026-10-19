import type { Metadata } from "next";
import { MyEntriesPage } from "@/features/entries/pages";
import { t } from "@/lib/strings";

export const metadata: Metadata = { title: t.entry.mineTitle };

export default function Page() {
  return <MyEntriesPage />;
}
