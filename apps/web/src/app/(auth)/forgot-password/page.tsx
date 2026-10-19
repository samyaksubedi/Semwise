import type { Metadata } from "next";
import { ForgotPasswordForm } from "@/features/auth/password-forms";
import { t } from "@/lib/strings";

export const metadata: Metadata = { title: t.auth.forgotTitle };

export default function ForgotPasswordPage() {
  return <ForgotPasswordForm />;
}
