import type { Metadata } from "next";
import { TodayPage } from "@/features/entries/pages";
import { t } from "@/lib/strings";

export const metadata: Metadata = { title: t.entry.todayTitle };

export default function Page() {
  return <TodayPage />;
}
