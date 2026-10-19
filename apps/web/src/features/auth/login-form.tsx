"use client";

import { loginSchema, type SessionView } from "@semwise/shared";
import { useMutation } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Notice } from "@/components/ui/surface";
import { ApiError, api } from "@/lib/api";
import { homeFor } from "@/lib/nav";
import { useSession, useSetSession } from "@/lib/session";
import { t } from "@/lib/strings";
import { AuthCard } from "./auth-card";

/** Only same-site paths are followed after login (no open redirects). */
export function safeNext(next: string | null): string | null {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : null;
}

/** Where to go once signed in: a chosen college first, then the page asked for or the home. */
export function afterLogin(session: SessionView, next: string | null): string {
  if (!session.activeTenantId && !session.user.isSuperAdmin) return "/choose-college";
  return safeNext(next) ?? homeFor(session);
}

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const setSession = useSetSession();
  const { data: existing } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);

  // Already signed in (for example after the back button): go on.
  useEffect(() => {
    if (existing) router.replace(afterLogin(existing, params.get("next")));
  }, [existing, params, router]);

  const login = useMutation({
    mutationFn: (input: { email: string; password: string }) =>
      api<SessionView>("/auth/login", { body: input }),
    onSuccess: (session) => {
      setSession(session);
      router.replace(afterLogin(session, params.get("next")));
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const parsed = loginSchema.safeParse({ email, password });
    if (!parsed.success) {
      setFieldError(t.auth.badLogin);
      return;
    }
    setFieldError(null);
    login.mutate(parsed.data);
  };

  const error = login.error instanceof ApiError ? login.error : null;
  const message =
    fieldError ??
    (error?.status === 401
      ? t.auth.badLogin
      : error?.code === "ACCOUNT_LOCKED" || error?.status === 429
        ? t.auth.locked
        : error?.message);

  return (
    <AuthCard
      title={t.auth.loginTitle}
      lead={t.auth.loginLead}
      footer={
        <Link href="/forgot-password" className="text-accent hover:underline">
          {t.auth.forgot}
        </Link>
      }
    >
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        {message && <Notice tone="danger">{message}</Notice>}
        <Field label={t.auth.email}>
          {(props) => (
            <Input
              {...props}
              type="email"
              autoComplete="username"
              inputMode="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          )}
        </Field>
        <Field label={t.auth.password}>
          {(props) => (
            <Input
              {...props}
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          )}
        </Field>
        <Button type="submit" loading={login.isPending} className="mt-1 w-full">
          {login.isPending ? t.auth.signingIn : t.auth.signIn}
        </Button>
      </form>
    </AuthCard>
  );
}
