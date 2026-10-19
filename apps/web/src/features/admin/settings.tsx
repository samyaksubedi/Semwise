"use client";

import type { ApprovalSettingsView, ProgramView, TenantView } from "@semwise/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Switch } from "@/components/ui/field";
import { ErrorState, errorMessage } from "@/components/ui/states";
import { Card, ListSkeleton, Notice, PageHeader, SectionTitle } from "@/components/ui/surface";
import { useToast } from "@/components/ui/toast";
import { ApiError, api } from "@/lib/api";
import { SESSION_KEY, useSession } from "@/lib/session";
import { t } from "@/lib/strings";
import { keys, usePrograms } from "./queries";

const UNREVIEWED_DAYS = [3, 7, 14, 30];

export function SettingsPage() {
  const { data: session } = useSession();
  const programs = usePrograms();
  const isUa = session?.roles.some((r) => r.role === "UNIVERSITY_ADMIN") ?? false;
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <PageHeader title={t.settings.title} lead={t.settings.lead} />
      <section>
        <SectionTitle>{t.settings.approvals}</SectionTitle>
        <p className="mb-3 text-muted">{t.settings.approvalsLead}</p>
        {programs.error ? (
          <ErrorState error={programs.error} onRetry={() => void programs.refetch()} />
        ) : programs.isPending ? (
          <ListSkeleton rows={1} />
        ) : (
          <div className="flex flex-col gap-3">
            {programs.data.map((p) => (
              <ApprovalCard key={p.id} program={p} />
            ))}
          </div>
        )}
      </section>
      {isUa && <CollegeCard />}
    </div>
  );
}

function ApprovalCard({ program }: { program: ProgramView }) {
  const client = useQueryClient();
  const toast = useToast();
  const settings = useQuery({
    queryKey: keys.approvalSettings(program.id),
    queryFn: () => api<ApprovalSettingsView>(`/programs/${program.id}/approval-settings`),
  });
  const save = useMutation({
    mutationFn: (next: Omit<ApprovalSettingsView, "programId">) =>
      api<ApprovalSettingsView>(`/programs/${program.id}/approval-settings`, {
        method: "PUT",
        body: next,
      }),
    onSuccess: (data) => {
      client.setQueryData(keys.approvalSettings(program.id), data);
      toast(t.structure.saved);
    },
  });
  if (settings.error)
    return <ErrorState error={settings.error} onRetry={() => void settings.refetch()} />;
  if (settings.isPending) return <ListSkeleton rows={1} />;
  const s = settings.data;
  const update = (patch: Partial<ApprovalSettingsView>) =>
    save.mutate({
      autoApprove: patch.autoApprove ?? s.autoApprove,
      locked: patch.locked ?? s.locked,
      unreviewedPublishAfterDays:
        patch.unreviewedPublishAfterDays !== undefined
          ? patch.unreviewedPublishAfterDays
          : s.unreviewedPublishAfterDays,
    });
  return (
    <Card className="flex flex-col gap-3 p-4">
      <p className="font-semibold">
        {program.name} <span className="font-normal text-muted">({program.code})</span>
      </p>
      {save.error && <Notice tone="danger">{errorMessage(save.error)}</Notice>}
      <Switch
        label={t.settings.autoApprove}
        description={t.settings.autoApproveHint}
        checked={s.autoApprove}
        disabled={save.isPending}
        onChange={(value) => update({ autoApprove: value })}
      />
      <Switch
        label={t.settings.lock}
        description={t.settings.lockHint}
        checked={s.locked}
        disabled={save.isPending}
        onChange={(value) => update({ locked: value })}
      />
      <Field label={t.settings.unreviewed}>
        {(p) => (
          <Select
            {...p}
            disabled={save.isPending || s.autoApprove}
            value={s.unreviewedPublishAfterDays ?? ""}
            onChange={(e) =>
              update({ unreviewedPublishAfterDays: e.target.value ? Number(e.target.value) : null })
            }
          >
            <option value="">{t.settings.unreviewedOff}</option>
            {UNREVIEWED_DAYS.map((d) => (
              <option key={d} value={d}>
                {t.settings.unreviewedAfter(d)}
              </option>
            ))}
          </Select>
        )}
      </Field>
    </Card>
  );
}

function CollegeCard() {
  const client = useQueryClient();
  const toast = useToast();
  const college = useQuery({ queryKey: keys.college, queryFn: () => api<TenantView>("/college") });
  const zones = useMemo(() => Intl.supportedValuesOf("timeZone"), []);
  const [name, setName] = useState<string | null>(null);
  const [zone, setZone] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () =>
      api<TenantView>("/college", {
        method: "PATCH",
        body: {
          ...(name !== null ? { name } : {}),
          ...(zone !== null ? { timezone: zone } : {}),
        },
      }),
    onSuccess: (data) => {
      client.setQueryData(keys.college, data);
      // The college name and timezone also live in the session (top bar, dates).
      void client.invalidateQueries({ queryKey: SESSION_KEY });
      setName(null);
      setZone(null);
      toast(t.structure.saved);
    },
  });
  if (college.error)
    return <ErrorState error={college.error} onRetry={() => void college.refetch()} />;
  const fieldError = (path: string) =>
    save.error instanceof ApiError ? save.error.field(path) : undefined;
  return (
    <section>
      <SectionTitle>{t.settings.college}</SectionTitle>
      {college.isPending ? (
        <ListSkeleton rows={1} />
      ) : (
        <Card className="p-4">
          <form
            className="flex flex-col gap-4"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate();
            }}
          >
            {save.error && !fieldError("name") && !fieldError("timezone") && (
              <Notice tone="danger">{errorMessage(save.error)}</Notice>
            )}
            <Field label={t.settings.collegeName} error={fieldError("name")}>
              {(p) => (
                <Input
                  {...p}
                  value={name ?? college.data.name}
                  onChange={(e) => setName(e.target.value)}
                />
              )}
            </Field>
            <Field
              label={t.settings.timezone}
              hint={t.settings.timezoneHint}
              error={fieldError("timezone")}
            >
              {(p) => (
                <Select
                  {...p}
                  value={zone ?? college.data.timezone}
                  onChange={(e) => setZone(e.target.value)}
                >
                  {zones.map((z) => (
                    <option key={z} value={z}>
                      {z.replaceAll("_", " ")}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <div>
              <Button
                type="submit"
                loading={save.isPending}
                disabled={name === null && zone === null}
              >
                {t.common.save}
              </Button>
            </div>
          </form>
        </Card>
      )}
    </section>
  );
}
