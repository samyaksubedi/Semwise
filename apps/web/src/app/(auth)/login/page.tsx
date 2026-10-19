import type { Metadata } from "next";
import { Suspense } from "react";
import { LoginForm } from "@/features/auth/login-form";
import { t } from "@/lib/strings";

export const metadata: Metadata = { title: t.auth.loginTitle };

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
