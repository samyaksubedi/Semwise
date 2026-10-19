import type { Metadata } from "next";
import { CollegesPage } from "@/features/platform/colleges";
import { t } from "@/lib/strings";

export const metadata: Metadata = { title: t.platform.title };

export default function Page() {
  return <CollegesPage />;
}
