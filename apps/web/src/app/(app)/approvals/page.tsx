import type { Metadata } from "next";
import { ApprovalsPage } from "@/features/teacher/approvals";
import { t } from "@/lib/strings";

export const metadata: Metadata = { title: t.teacher.approvalsTitle };

export default function Page() {
  return <ApprovalsPage />;
}
