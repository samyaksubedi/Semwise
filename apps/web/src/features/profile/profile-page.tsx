"use client";

import { PASSWORD_MIN_LENGTH, changePasswordSchema } from "@semwise/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, LogOut, Monitor, Moon, Sun } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Card, Notice, PageHeader, SectionTitle } from "@/components/ui/surface";
import { useToast } from "@/components/ui/toast";
import { CollegeList } from "@/features/auth/college-picker";
import { ApiError, api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { areaHome, areaLabel, areasFor, homeFor } from "@/lib/nav";
import { activeCollege, useSession } from "@/lib/session";
import { t } from "@/lib/strings";
import { setTheme, useTheme, type ThemeChoice } from "@/lib/theme";

export function ProfilePage() {
  const { data: session } = useSession();
  const router = useRouter();
  const client = useQueryClient();
  const signOut = useMutation({
    mutationFn: (all: boolean) =>
      api(all ? "/auth/logout-all" : "/auth/logout", { method: "POST" }),
    onSettled: () => {
      client.clear();
      router.replace("/login");
    },
  });
  if (!session) return null;
  const college = activeCollege(session);
  const areas = areasFor(session);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <PageHeader title={t.profile.title} />

      <section>
        <SectionTitle>{t.profile.account}</SectionTitle>
        <Card className="p-4">
          <p className="font-semibold">{session.user.displayName}</p>
          <p className="text-muted">{session.user.email}</p>
          {college && (
            <p className="mt-2 text-sm text-muted">
              {college.name} · {session.roles.map((r) => t.roles[r.role]).join(", ")}
            </p>
          )}
        </Card>
      </section>

      {areas.length > 1 && (
        <section>
          <SectionTitle>{t.profile.areas}</SectionTitle>
          <p className="mb-2 text-sm text-muted">{t.profile.areasLead}</p>
          <Card className="divide-y divide-border">
            {areas.map((area) => (
              <Link
                key={area}
                href={areaHome(area)}
                className="flex min-h-12 items-center justify-between px-4 text-[15px] font-medium hover:bg-surface-2"
              >
                {areaLabel(area)}
                <ChevronRight aria-hidden className="size-5 text-faint" />
              </Link>
            ))}
          </Card>
        </section>
      )}

      {session.tenants.length > 1 && (
        <section>
          <SectionTitle>{t.profile.switchCollege}</SectionTitle>
          <CollegeList onPicked={(next) => router.replace(homeFor(next))} />
        </section>
      )}

      <section>
        <SectionTitle>{t.profile.appearance}</SectionTitle>
        <ThemePicker />
      </section>

      <section>
        <SectionTitle>{t.auth.changePassword}</SectionTitle>
        <ChangePassword />
      </section>

      <section className="flex flex-col gap-2 sm:flex-row">
        <Button
          variant="secondary"
          onClick={() => signOut.mutate(false)}
          loading={signOut.isPending}
        >
          <LogOut aria-hidden className="size-4" />
          {t.auth.signOut}
        </Button>
        <Button variant="ghost" onClick={() => signOut.mutate(true)} disabled={signOut.isPending}>
          {t.auth.signOutAll}
        </Button>
      </section>
    </div>
  );
}

function ThemePicker() {
  const theme = useTheme();
  const options: { value: ThemeChoice; label: string; icon: typeof Sun }[] = [
    { value: "system", label: t.theme.system, icon: Monitor },
    { value: "light", label: t.theme.light, icon: Sun },
    { value: "dark", label: t.theme.dark, icon: Moon },
  ];
  return (
    <div role="radiogroup" aria-label={t.theme.label} className="grid grid-cols-3 gap-2">
      {options.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={theme === value}
          onClick={() => setTheme(value)}
          className={cn(
            "flex h-16 flex-col items-center justify-center gap-1 rounded-control border text-sm font-medium transition-calm",
            theme === value
              ? "border-accent bg-accent-soft text-accent-text"
              : "border-border bg-surface text-muted hover:border-border-strong",
          )}
        >
          <Icon aria-hidden className="size-5" />
          {label}
        </button>
      ))}
    </div>
  );
}

function ChangePassword() {
  const toast = useToast();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [errors, setErrors] = useState<{ current?: string; next?: string }>({});
  const change = useMutation({
    mutationFn: () =>
      api("/auth/password/change", { body: { currentPassword: current, newPassword: next } }),
    onSuccess: () => {
      setCurrent("");
      setNext("");
      toast(t.auth.passwordChanged);
    },
    onError: (err) => {
      if (err instanceof ApiError)
        setErrors({ current: err.field("currentPassword"), next: err.field("newPassword") });
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const parsed = changePasswordSchema.safeParse({ currentPassword: current, newPassword: next });
    if (!parsed.success) {
      const issue = (path: string) => parsed.error.issues.find((i) => i.path[0] === path)?.message;
      setErrors({
        current: issue("currentPassword") && t.common.required,
        next: issue("newPassword"),
      });
      return;
    }
    setErrors({});
    change.mutate();
  };
  return (
    <Card className="p-4">
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        {change.error && !errors.current && !errors.next && (
          <Notice tone="danger">{change.error.message}</Notice>
        )}
        <Field label={t.auth.currentPassword} error={errors.current}>
          {(props) => (
            <Input
              {...props}
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
            />
          )}
        </Field>
        <Field
          label={t.auth.newPassword}
          hint={t.auth.passwordHint(PASSWORD_MIN_LENGTH)}
          error={errors.next}
        >
          {(props) => (
            <Input
              {...props}
              type="password"
              autoComplete="new-password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
            />
          )}
        </Field>
        <div>
          <Button type="submit" loading={change.isPending}>
            {t.auth.changePassword}
          </Button>
        </div>
      </form>
    </Card>
  );
}
