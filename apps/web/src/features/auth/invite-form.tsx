"use client";

import {
  PASSWORD_MIN_LENGTH,
  newPasswordSchema,
  type AcceptInvitationResult,
  type InvitationPreview,
  type SessionView,
} from "@semwise/shared";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button, ButtonLink } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Notice, Skeleton } from "@/components/ui/surface";
import { api } from "@/lib/api";
import { homeFor } from "@/lib/nav";
import { useSetSession } from "@/lib/session";
import { t } from "@/lib/strings";
import { AuthCard, useHashToken } from "./auth-card";

export function AcceptInviteForm() {
  const router = useRouter();
  const setSession = useSetSession();
  const token = useHashToken();
  const [typedName, setName] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [fieldError, setFieldError] = useState<string>();

  // POST, so the token never sits in a URL the server logs.
  const preview = useQuery({
    queryKey: ["invite-preview", token],
    queryFn: () => api<InvitationPreview>("/auth/invitations/preview", { body: { token } }),
    enabled: Boolean(token),
  });
  // The name the admin entered, until the person types their own.
  const name = typedName ?? preview.data?.displayName ?? "";

  const accept = useMutation({
    mutationFn: async () => {
      const result = await api<AcceptInvitationResult>("/auth/invitations/accept", {
        body: {
          token,
          ...(preview.data?.needsPassword ? { password } : {}),
          ...(name.trim() ? { displayName: name.trim() } : {}),
        },
      });
      if (!result.loggedIn) return null;
      return api<SessionView>("/auth/active-tenant", { body: { tenantId: result.tenantId } });
    },
    onSuccess: (session) => {
      if (!session) {
        router.replace("/login");
        return;
      }
      setSession(session);
      router.replace(homeFor(session));
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (preview.data?.needsPassword) {
      const parsed = newPasswordSchema.safeParse(password);
      setFieldError(parsed.success ? undefined : parsed.error.issues[0]?.message);
      if (!parsed.success) return;
    }
    accept.mutate();
  };

  if (token === undefined || (token && preview.isPending)) {
    return (
      <AuthCard title={t.auth.inviteTitle}>
        <div className="flex flex-col gap-3">
          <Skeleton className="h-5 w-3/4" />
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-11 w-full" />
        </div>
      </AuthCard>
    );
  }
  if (!token || !preview.data) {
    return (
      <AuthCard title={t.auth.inviteTitle}>
        <div className="flex flex-col gap-4">
          <Notice tone="danger">{t.auth.badToken}</Notice>
          <ButtonLink href="/login" variant="secondary" className="w-full">
            {t.auth.backToLogin}
          </ButtonLink>
        </div>
      </AuthCard>
    );
  }

  const invite = preview.data;
  return (
    <AuthCard
      title={t.auth.inviteTitle}
      lead={
        <>
          {t.auth.inviteLead(invite.collegeName)}
          <br />
          {t.auth.inviteAs(invite.roleLabel)} · {invite.email}
        </>
      }
    >
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        {accept.error && <Notice tone="danger">{accept.error.message}</Notice>}
        <Field label="Your name">
          {(props) => (
            <Input
              {...props}
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
            />
          )}
        </Field>
        {invite.needsPassword && (
          <Field
            label={t.auth.invitePassword}
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
        )}
        <Button type="submit" loading={accept.isPending} className="w-full">
          {t.auth.acceptInvite}
        </Button>
      </form>
    </AuthCard>
  );
}
