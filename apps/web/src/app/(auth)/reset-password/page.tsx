import type { Metadata } from "next";
import { ResetPasswordForm } from "@/features/auth/password-forms";
import { t } from "@/lib/strings";

export const metadata: Metadata = { title: t.auth.resetTitle };

export default function ResetPasswordPage() {
  return <ResetPasswordForm />;
}
