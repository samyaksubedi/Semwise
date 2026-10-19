import type { Metadata } from "next";
import { CatchupPage } from "@/features/chat/catchup-page";
import { t } from "@/lib/strings";

export const metadata: Metadata = { title: t.catchup.title };

export default function Page() {
  return <CatchupPage />;
}
