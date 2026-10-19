"use client";

import { PASSWORD_MIN_LENGTH, forgotPasswordSchema, newPasswordSchema } from "@semwise/shared";
import { useMutation } from "@tanstack/react-query";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Button, ButtonLink } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Notice } from "@/components/ui/surface";
import { ApiError, api } from "@/lib/api";
import { t } from "@/lib/strings";
import { AuthCard, useHashToken } from "./auth-card";

const backToLogin = (
  <Link href="/login" className="text-accent hover:underline">
    {t.auth.backToLogin}
  </Link>
);

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [invalid, setInvalid] = useState(false);
  const send = useMutation({
    mutationFn: (value: string) => api("/auth/password/forgot", { body: { email: value } }),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const parsed = forgotPasswordSchema.safeParse({ email });
    setInvalid(!parsed.success);
    if (parsed.success) send.mutate(parsed.data.email);
  };
  return (
    <AuthCard title={t.auth.forgotTitle} lead={t.auth.forgotLead} footer={backToLogin}>
      {send.isSuccess ? (
        <Notice tone="success">{t.auth.linkSent}</Notice>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          {send.error && <Notice tone="danger">{send.error.message}</Notice>}
          <Field label={t.auth.email} error={invalid ? "Enter a valid email address" : undefined}>
            {(props) => (
              <Input
                {...props}
                type="email"
                autoComplete="email"
                inputMode="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            )}
          </Field>
          <Button type="submit" loading={send.isPending} className="w-full">
            {t.auth.sendLink}
          </Button>
        </form>
      )}
    </AuthCard>
  );
}

export function ResetPasswordForm() {
  const token = useHashToken();
  const [password, setPassword] = useState("");
  const [fieldError, setFieldError] = useState<string>();

  const reset = useMutation({
    mutationFn: (input: { token: string; newPassword: string }) =>
      api("/auth/password/reset", { body: input }),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const parsed = newPasswordSchema.safeParse(password);
    setFieldError(parsed.success ? undefined : parsed.error.issues[0]?.message);
    if (parsed.success && token) reset.mutate({ token, newPassword: parsed.data });
  };

  const tokenProblem =
    reset.error instanceof ApiError &&
    (reset.error.code === "INVALID_TOKEN" || reset.error.status === 400) &&
    !reset.error.field("newPassword");

  return (
    <AuthCard title={t.auth.resetTitle} footer={backToLogin}>
      {reset.isSuccess ? (
        <div className="flex flex-col gap-4">
          <Notice tone="success">{t.auth.resetDone}</Notice>
          <ButtonLink href="/login" className="w-full">
            {t.auth.signIn}
          </ButtonLink>
        </div>
      ) : token === undefined ? null : token === null || tokenProblem ? (
        <Notice tone="danger">{t.auth.badToken}</Notice>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          {reset.error && !tokenProblem && <Notice tone="danger">{reset.error.message}</Notice>}
          <Field
            label={t.auth.newPassword}
            hint={t.auth.passwordHint(PASSWORD_MIN_LENGTH)}
            error={fieldError}
          >
            {(props) => (
              <Input
                {...props}
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            )}
          </Field>
          <Button type="submit" loading={reset.isPending} className="w-full">
            {t.auth.setPassword}
          </Button>
        </form>
      )}
    </AuthCard>
  );
}
