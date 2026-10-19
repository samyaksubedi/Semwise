import type { Metadata } from "next";
import { ChooseCollege } from "@/features/auth/college-picker";
import { t } from "@/lib/strings";

export const metadata: Metadata = { title: t.auth.chooseCollegeTitle };

export default function ChooseCollegePage() {
  return <ChooseCollege />;
}
