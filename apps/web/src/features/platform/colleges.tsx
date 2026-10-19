"use client";

import { slugify, type PlatformTenantView } from "@semwise/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, ChevronRight, Mail, Plus, Search, ShieldCheck } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { ConfirmSheet, FormSheet, Sheet } from "@/components/ui/sheet";
import { ErrorState, errorMessage } from "@/components/ui/states";
import {
  Card,
  EmptyState,
  ListSkeleton,
  Notice,
  PageHeader,
  SectionTitle,
  StatusPill,
} from "@/components/ui/surface";
import { TimezoneSelect } from "@/components/ui/timezone-select";
import { useToast } from "@/components/ui/toast";
import { ApiError, api } from "@/lib/api";
import { formatDay, todayIn } from "@/lib/format";
import { t } from "@/lib/strings";
import { DEFAULT_TIMEZONE } from "@/lib/timezones";

const COLLEGES = ["platform", "colleges"] as const;

const fieldOf = (error: unknown, path: string) =>
  error instanceof ApiError ? error.field(path) : undefined;
const formError = (error: unknown, fields: string[]) =>
  error && !fields.some((f) => fieldOf(error, f)) ? errorMessage(error) : null;

/**
 * The Super Admin's only screen: the list of colleges and their University Admins. The platform
 * API returns no college content, and this page says so.
 */
export function CollegesPage() {
  const colleges = useQuery({
    queryKey: COLLEGES,
    queryFn: () => api<PlatformTenantView[]>("/platform/tenants"),
  });
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (colleges.data ?? []).filter(
      (c) => !q || c.name.toLowerCase().includes(q) || c.slug.includes(q),
    );
  }, [colleges.data, query]);
  const open = colleges.data?.find((c) => c.id === openId) ?? null;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      <PageHeader
        title={t.platform.title}
        lead={t.platform.lead}
        actions={
          <Button onClick={() => setCreating(true)} className="w-full sm:w-auto">
            <Plus aria-hidden className="size-4" />
            {t.platform.add}
          </Button>
        }
      />
      <Notice tone="info" title={t.platform.privacyTitle}>
        {t.platform.privacyBody}
      </Notice>

      {colleges.error ? (
        <ErrorState error={colleges.error} onRetry={() => void colleges.refetch()} />
      ) : colleges.isPending ? (
        <ListSkeleton rows={4} />
      ) : colleges.data.length === 0 ? (
        <EmptyState
          icon={Building2}
          title={t.platform.none}
          body={t.platform.noneBody}
          action={<Button onClick={() => setCreating(true)}>{t.platform.add}</Button>}
        />
      ) : (
        <section aria-labelledby="colleges-heading" className="flex flex-col gap-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 id="colleges-heading" className="text-sm font-semibold text-muted">
              {t.platform.count(colleges.data.length)}
            </h2>
            {colleges.data.length > 5 && (
              <div className="relative sm:w-72">
                <Search
                  aria-hidden
                  className="pointer-events-none absolute top-3 left-3 size-5 text-faint"
                />
                <Input
                  type="search"
                  aria-label={t.platform.search}
                  placeholder={t.platform.search}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="pl-10"
                />
              </div>
            )}
          </div>
          {shown.length === 0 ? (
            <p className="py-6 text-center text-muted">{t.platform.noMatches}</p>
          ) : (
            <Card className="overflow-hidden">
              <ul className="divide-y divide-border">
                {shown.map((c) => (
                  <li key={c.id}>
                    <CollegeRow college={c} onOpen={() => setOpenId(c.id)} />
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </section>
      )}

      <CreateCollegeSheet
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(id) => setOpenId(id)}
      />
      {open && <CollegeSheet college={open} onClose={() => setOpenId(null)} />}
    </div>
  );
}

function CollegeStatus({ college }: { college: PlatformTenantView }) {
  return college.status === "ACTIVE" ? (
    <StatusPill tone="success" className="justify-self-start">
      {t.platform.active}
    </StatusPill>
  ) : (
    <StatusPill tone="danger" className="justify-self-start">
      {t.platform.suspended}
    </StatusPill>
  );
}

function CollegeRow({ college, onOpen }: { college: PlatformTenantView; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left transition-calm hover:bg-surface-2 md:grid md:grid-cols-[minmax(0,2fr)_minmax(0,1.4fr)_6.5rem_1.25rem]"
    >
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{college.name}</p>
        <p className="truncate text-sm text-muted">{college.slug}</p>
        <p className="text-sm text-muted md:hidden">
          {t.platform.admins(college.universityAdmins.length)}
          {college.pendingAdminInvites > 0 &&
            ` · ${t.platform.pending(college.pendingAdminInvites)}`}
        </p>
      </div>
      <p className="hidden text-sm md:block">
        {t.platform.admins(college.universityAdmins.length)}
        {college.pendingAdminInvites > 0 && (
          <span className="block text-muted">
            {t.platform.pending(college.pendingAdminInvites)}
          </span>
        )}
      </p>
      <CollegeStatus college={college} />
      <ChevronRight aria-hidden className="size-5 shrink-0 text-faint" />
    </button>
  );
}

const EMPTY_FORM = {
  name: "",
  slug: "",
  timezone: DEFAULT_TIMEZONE,
  adminEmail: "",
  adminName: "",
};

function CreateCollegeSheet({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const client = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState(EMPTY_FORM);
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));
  const create = useMutation({
    mutationFn: () =>
      api<PlatformTenantView>("/platform/tenants", {
        body: {
          name: form.name.trim(),
          timezone: form.timezone,
          adminEmail: form.adminEmail.trim(),
          ...(form.slug.trim() ? { slug: form.slug.trim() } : {}),
          ...(form.adminName.trim() ? { adminName: form.adminName.trim() } : {}),
        },
      }),
    onSuccess: (college) => {
      client.setQueryData<PlatformTenantView[]>(COLLEGES, (all) =>
        all ? [college, ...all.filter((c) => c.id !== college.id)] : all,
      );
      void client.invalidateQueries({ queryKey: COLLEGES });
      toast(t.platform.created(college.name));
      setForm(EMPTY_FORM);
      create.reset();
      onClose();
      onCreated(college.id);
    },
  });
  const suggested = slugify(form.name);
  const fields = ["name", "slug", "timezone", "adminEmail", "adminName"];
  return (
    <FormSheet
      open={open}
      onClose={onClose}
      title={t.platform.add}
      submitLabel={t.platform.create}
      onSubmit={() => create.mutate()}
      busy={create.isPending}
      error={formError(create.error, fields)}
    >
      <Field label={t.platform.name} error={fieldOf(create.error, "name")}>
        {(p) => <Input {...p} autoComplete="off" value={form.name} onChange={set("name")} />}
      </Field>
      <Field
        label={t.platform.slug}
        optional
        hint={t.platform.slugHint(suggested)}
        error={fieldOf(create.error, "slug")}
      >
        {(p) => (
          <Input
            {...p}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            placeholder={suggested}
            value={form.slug}
            onChange={set("slug")}
          />
        )}
      </Field>
      <Field
        label={t.platform.timezone}
        hint={t.platform.timezoneHint}
        error={fieldOf(create.error, "timezone")}
      >
        {(p) => <TimezoneSelect {...p} value={form.timezone} onChange={set("timezone")} />}
      </Field>
      <fieldset className="flex flex-col gap-4 border-t border-border pt-4">
        <legend className="float-left mb-1 w-full font-semibold">{t.platform.adminSection}</legend>
        <p className="-mt-2 text-sm text-muted">{t.platform.adminHint}</p>
        <Field label={t.platform.adminEmail} error={fieldOf(create.error, "adminEmail")}>
          {(p) => (
            <Input
              {...p}
              type="email"
              inputMode="email"
              autoComplete="off"
              value={form.adminEmail}
              onChange={set("adminEmail")}
            />
          )}
        </Field>
        <Field label={t.platform.adminName} optional error={fieldOf(create.error, "adminName")}>
          {(p) => (
            <Input {...p} autoComplete="off" value={form.adminName} onChange={set("adminName")} />
          )}
        </Field>
      </fieldset>
    </FormSheet>
  );
}

function adminStatus(status: string) {
  if (status === "ACTIVE") return <StatusPill tone="success">{t.platform.joined}</StatusPill>;
  if (status === "DEACTIVATED")
    return <StatusPill tone="neutral">{t.platform.deactivated}</StatusPill>;
  return (
    <StatusPill tone="warning" icon={Mail}>
      {t.platform.invitedStatus}
    </StatusPill>
  );
}

function CollegeSheet({ college, onClose }: { college: PlatformTenantView; onClose: () => void }) {
  const client = useQueryClient();
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [invite, setInvite] = useState({ email: "", displayName: "" });
  const replace = (next: PlatformTenantView) => {
    client.setQueryData<PlatformTenantView[]>(COLLEGES, (all) =>
      all?.map((c) => (c.id === next.id ? next : c)),
    );
  };
  const suspending = college.status === "ACTIVE";
  const status = useMutation({
    mutationFn: () =>
      api<PlatformTenantView>(`/platform/tenants/${college.id}`, {
        method: "PATCH",
        body: { status: suspending ? "SUSPENDED" : "ACTIVE" },
      }),
    onSuccess: (next) => {
      replace(next);
      setConfirming(false);
      toast(
        next.status === "SUSPENDED"
          ? t.platform.suspendedToast(next.name)
          : t.platform.reactivatedToast(next.name),
      );
    },
  });
  const sendInvite = useMutation({
    mutationFn: () =>
      api<PlatformTenantView>(`/platform/tenants/${college.id}/university-admins`, {
        body: {
          email: invite.email.trim(),
          ...(invite.displayName.trim() ? { displayName: invite.displayName.trim() } : {}),
        },
      }),
    onSuccess: (next) => {
      replace(next);
      toast(t.platform.invited(invite.email.trim()));
      setInvite({ email: "", displayName: "" });
      setInviting(false);
    },
  });
  const inviteFields = ["email", "displayName"];

  return (
    <Sheet open onClose={onClose} title={college.name}>
      <div className="flex flex-col gap-5">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[15px]">
          <dt className="text-muted">{t.platform.slugLabel}</dt>
          <dd className="min-w-0 truncate">{college.slug}</dd>
          <dt className="text-muted">{t.platform.timezone}</dt>
          <dd>{college.timezone.replaceAll("_", " ")}</dd>
          <dt className="text-muted">{t.platform.createdOn}</dt>
          <dd>
            {formatDay(todayIn(college.timezone, new Date(college.createdAt)), undefined, true)}
          </dd>
          <dt className="sr-only">Status</dt>
          <dd className="col-span-2 mt-1">
            <CollegeStatus college={college} />
          </dd>
        </dl>
        {college.status === "SUSPENDED" && (
          <Notice tone="warning">{t.platform.suspendedNote}</Notice>
        )}

        <section>
          <SectionTitle>{t.platform.universityAdmins}</SectionTitle>
          {college.universityAdmins.length === 0 ? (
            <p className="text-muted">{t.platform.noAdmins}</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border rounded-card border border-border">
              {college.universityAdmins.map((admin) => (
                <li key={admin.email} className="flex items-center gap-3 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{admin.displayName}</p>
                    <p className="truncate text-sm text-muted">{admin.email}</p>
                  </div>
                  {adminStatus(admin.status)}
                </li>
              ))}
            </ul>
          )}
          {college.pendingAdminInvites > 0 && (
            <p className="mt-2 text-sm text-muted">
              {t.platform.pendingNote(college.pendingAdminInvites)}
            </p>
          )}
        </section>

        <section className="flex flex-col gap-3">
          {inviting ? (
            <form
              noValidate
              className="flex flex-col gap-4 rounded-card border border-border p-4"
              onSubmit={(e) => {
                e.preventDefault();
                sendInvite.mutate();
              }}
            >
              <div>
                <p className="font-semibold">{t.platform.inviteAdmin}</p>
                <p className="text-sm text-muted">{t.platform.inviteLead}</p>
              </div>
              {formError(sendInvite.error, inviteFields) && (
                <Notice tone="danger">{formError(sendInvite.error, inviteFields)}</Notice>
              )}
              <Field label={t.platform.adminEmail} error={fieldOf(sendInvite.error, "email")}>
                {(p) => (
                  <Input
                    {...p}
                    type="email"
                    inputMode="email"
                    autoComplete="off"
                    autoFocus
                    value={invite.email}
                    onChange={(e) => setInvite((v) => ({ ...v, email: e.target.value }))}
                  />
                )}
              </Field>
              <Field
                label={t.platform.adminName}
                optional
                error={fieldOf(sendInvite.error, "displayName")}
              >
                {(p) => (
                  <Input
                    {...p}
                    autoComplete="off"
                    value={invite.displayName}
                    onChange={(e) => setInvite((v) => ({ ...v, displayName: e.target.value }))}
                  />
                )}
              </Field>
              <div className="flex flex-wrap justify-end gap-2">
                <Button
                  variant="secondary"
                  onClick={() => {
                    sendInvite.reset();
                    setInviting(false);
                  }}
                >
                  {t.common.cancel}
                </Button>
                <Button type="submit" loading={sendInvite.isPending}>
                  {t.platform.inviteSubmit}
                </Button>
              </div>
            </form>
          ) : (
            <div>
              <Button variant="secondary" onClick={() => setInviting(true)}>
                <ShieldCheck aria-hidden className="size-4" />
                {t.platform.inviteAdmin}
              </Button>
            </div>
          )}
        </section>

        <div className="border-t border-border pt-4">
          <Button
            variant={suspending ? "quietDanger" : "secondary"}
            onClick={() => setConfirming(true)}
          >
            {suspending ? t.platform.suspend : t.platform.reactivate}
          </Button>
        </div>
      </div>
      <ConfirmSheet
        open={confirming}
        onClose={() => {
          status.reset();
          setConfirming(false);
        }}
        title={
          suspending
            ? t.platform.suspendTitle(college.name)
            : t.platform.reactivateTitle(college.name)
        }
        body={suspending ? t.platform.suspendBody : t.platform.reactivateBody}
        confirmLabel={suspending ? t.platform.suspend : t.platform.reactivate}
        danger={suspending}
        busy={status.isPending}
        onConfirm={() => status.mutate()}
      >
        {status.error && (
          <Notice tone="danger" className="mt-3">
            {errorMessage(status.error)}
          </Notice>
        )}
      </ConfirmSheet>
    </Sheet>
  );
}
