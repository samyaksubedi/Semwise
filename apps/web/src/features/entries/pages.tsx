"use client";

import { ENTRY_TEXT_MAX, type EntryVersionView, type EntryView } from "@semwise/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, ChevronLeft, ChevronRight, ListChecks, Mic, ImageIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, ButtonLink } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/field";
import { ConfirmSheet } from "@/components/ui/sheet";
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
import { useToast } from "@/components/ui/toast";
import { ApiError, api } from "@/lib/api";
import { formatDay, todayIn } from "@/lib/format";
import { useTimezone } from "@/lib/session";
import { t } from "@/lib/strings";
import { EntryComposer } from "./composer";
import { EntryStatus, TopicList, entryKeys, useMyClasses } from "./shared";

export function TodayPage() {
  const classes = useMyClasses();
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5">
      <PageHeader title={t.entry.todayTitle} lead={t.entry.todayLead} />
      {classes.error ? (
        <ErrorState error={classes.error} onRetry={() => void classes.refetch()} />
      ) : classes.isPending ? (
        <ListSkeleton rows={3} />
      ) : classes.data.filter((c) => c.status === "ACTIVE").length === 0 ? (
        <EmptyState icon={BookOpen} title={t.entry.noClasses} body={t.entry.noClassesBody} />
      ) : (
        <EntryComposer classes={classes.data.filter((c) => c.status === "ACTIVE")} allowMedia />
      )}
    </div>
  );
}

function MediaPill({ version }: { version: EntryVersionView | null }) {
  if (version?.inputKind === "VOICE")
    return (
      <StatusPill tone="neutral" icon={Mic}>
        {t.entry.voice}
      </StatusPill>
    );
  if (version?.inputKind === "PHOTO")
    return (
      <StatusPill tone="neutral" icon={ImageIcon}>
        {t.entry.fromPhoto}
      </StatusPill>
    );
  return null;
}

/** A row in a list of entries: subject, day, status, first topics. */
export function EntryRow({ entry, href }: { entry: EntryView; href: string }) {
  const tz = useTimezone();
  const version = entry.latest ?? entry.live;
  return (
    <Link
      href={href}
      className="flex min-h-16 items-center gap-3 px-4 py-3 transition-calm hover:bg-surface-2"
    >
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-medium">{entry.subject.name}</span>
          <span className="text-sm text-muted">
            {formatDay(entry.taughtOn, todayIn(tz))} · {entry.section.name}
          </span>
        </p>
        <p className="mt-0.5 truncate text-sm text-muted">
          {version?.topics.map((x) => x.title).join(", ") || version?.rawText}
        </p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          <EntryStatus entry={entry} />
          <MediaPill version={version} />
        </div>
      </div>
      <ChevronRight aria-hidden className="size-5 shrink-0 text-faint" />
    </Link>
  );
}

export function MyEntriesPage() {
  const mine = useQuery({
    queryKey: entryKeys.mine,
    queryFn: () => api<EntryView[]>("/entries/mine"),
  });
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5">
      <PageHeader
        title={t.entry.mineTitle}
        lead={t.entry.mineLead}
        actions={<ButtonLink href="/today">{t.entry.todayTitle}</ButtonLink>}
      />
      {mine.error ? (
        <ErrorState error={mine.error} onRetry={() => void mine.refetch()} />
      ) : mine.isPending ? (
        <ListSkeleton rows={4} />
      ) : mine.data.length === 0 ? (
        <EmptyState icon={ListChecks} title={t.entry.noEntries} body={t.entry.noEntriesBody} />
      ) : (
        <Card className="divide-y divide-border overflow-hidden">
          {mine.data.map((e) => (
            <EntryRow key={e.id} entry={e} href={`/entries/${e.id}`} />
          ))}
        </Card>
      )}
    </div>
  );
}

function VersionBlock({ title, version }: { title: string; version: EntryVersionView }) {
  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <SectionTitle>{title}</SectionTitle>
        <span className="text-xs text-muted">{t.entry.version(version.versionNo)}</span>
      </div>
      {version.topics.length > 0 ? (
        <TopicList topics={version.topics} />
      ) : (
        <p className="text-[15px] whitespace-pre-wrap">{version.rawText}</p>
      )}
      {version.summary && <p className="text-[15px] text-muted text-pretty">{version.summary}</p>}
      {version.status === "REJECTED" && version.rejectionReason && (
        <Notice tone="danger">{t.entry.rejectedBecause(version.rejectionReason)}</Notice>
      )}
    </Card>
  );
}

/** One entry for its author: what is live, what is waiting, and what can be done next. */
export function EntryPage({ id }: { id: string }) {
  const router = useRouter();
  const client = useQueryClient();
  const toast = useToast();
  const tz = useTimezone();
  const entry = useQuery({
    queryKey: entryKeys.entry(id),
    queryFn: () => api<EntryView>(`/entries/${id}`),
    refetchInterval: (q) => {
      const v = q.state.data?.latest;
      return v && (v.organize === "QUEUED" || v.organize === "RUNNING" || v.status === "APPROVED")
        ? 2000
        : false;
    },
  });
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const [withdrawing, setWithdrawing] = useState(false);
  const [duplicate, setDuplicate] = useState(false);
  const refresh = (view?: EntryView | null) => {
    if (view) client.setQueryData(entryKeys.entry(id), view);
    void client.invalidateQueries({ queryKey: entryKeys.mine });
  };
  const edit = useMutation({
    mutationFn: () => api<EntryView>(`/entries/${id}/versions`, { body: { text } }),
    onSuccess: (view) => {
      refresh(view);
      setEditing(false);
    },
  });
  const submit = useMutation({
    mutationFn: (onDuplicate?: "replace" | "add") =>
      api<EntryView>(`/entries/${id}/submit`, { body: onDuplicate ? { onDuplicate } : {} }),
    onSuccess: (view) => {
      setDuplicate(false);
      refresh(view);
      toast(t.entry.sent);
      if (view.id !== id) router.replace(`/entries/${view.id}`);
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === "DUPLICATE_ENTRY") setDuplicate(true);
    },
  });
  const withdraw = useMutation({
    mutationFn: () => api<EntryView | null>(`/entries/${id}/withdraw`, { method: "POST" }),
    onSuccess: (view) => {
      toast(t.entry.withdrawn);
      setWithdrawing(false);
      refresh(view);
      if (!view) router.replace("/entries");
    },
  });

  if (entry.error) return <ErrorState error={entry.error} onRetry={() => void entry.refetch()} />;
  if (entry.isPending) return <ListSkeleton rows={3} />;
  const e = entry.data;
  const latest = e.latest;
  const open = latest && (latest.status === "DRAFT" || latest.status === "PENDING");
  const organizing = latest?.organize === "QUEUED" || latest?.organize === "RUNNING";

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <PageHeader
        back={
          <Link
            href="/entries"
            className="mb-2 -ml-1 inline-flex h-9 items-center gap-1 px-1 text-sm text-muted hover:text-text"
          >
            <ChevronLeft aria-hidden className="size-4" />
            {t.entry.mineTitle}
          </Link>
        }
        title={e.subject.name}
        lead={
          <span className="flex flex-wrap items-center gap-2">
            {formatDay(e.taughtOn, todayIn(tz), true)} · {e.section.name}
            <EntryStatus entry={e} />
          </span>
        }
      />
      {e.live && <VersionBlock title={t.entry.liveVersion} version={e.live} />}
      {latest && (
        <>
          {organizing ? (
            <Notice tone="info">{t.entry.organizing}</Notice>
          ) : (
            <VersionBlock title={e.live ? t.entry.newerVersion : t.entry.topics} version={latest} />
          )}
          {latest.organize === "FAILED" && <Notice tone="danger">{latest.organizeError}</Notice>}
        </>
      )}

      {(submit.error || withdraw.error || edit.error) && !duplicate && (
        <Notice tone="danger">{errorMessage(submit.error ?? withdraw.error ?? edit.error)}</Notice>
      )}
      {duplicate && (
        <Notice
          tone="warning"
          title={t.entry.duplicateTitle}
          action={
            <div className="flex flex-wrap gap-2">
              <Button size="sm" loading={submit.isPending} onClick={() => submit.mutate("replace")}>
                {t.entry.replace}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={submit.isPending}
                onClick={() => submit.mutate("add")}
              >
                {t.entry.addMine}
              </Button>
            </div>
          }
        >
          {t.entry.duplicateBody}
        </Notice>
      )}

      {editing ? (
        <Card className="flex flex-col gap-3 p-4">
          <p className="text-sm text-muted">{t.entry.editLead}</p>
          <Field label={t.entry.text}>
            {(p) => (
              <Textarea
                {...p}
                value={text}
                onChange={(ev) => setText(ev.target.value)}
                maxLength={ENTRY_TEXT_MAX}
                className="min-h-40"
              />
            )}
          </Field>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" onClick={() => setEditing(false)}>
              {t.common.cancel}
            </Button>
            <Button
              loading={edit.isPending}
              disabled={text.trim().length < 3}
              onClick={() => edit.mutate()}
            >
              {t.entry.editSend}
            </Button>
          </div>
        </Card>
      ) : (
        <div className="flex flex-wrap gap-2">
          {latest?.status === "DRAFT" && latest.organize === "DONE" && !duplicate && (
            <Button loading={submit.isPending} onClick={() => submit.mutate(undefined)}>
              {t.entry.sendToTeacher}
            </Button>
          )}
          {e.live && !open && !e.takenDown && (
            <Button
              variant="secondary"
              onClick={() => {
                setText(e.live!.rawText);
                setEditing(true);
              }}
            >
              {t.entry.edit}
            </Button>
          )}
          {!e.live && latest?.status === "REJECTED" && (
            <ButtonLink href="/today">{t.entry.writeAgain}</ButtonLink>
          )}
          {open && (
            <Button variant="ghost" onClick={() => setWithdrawing(true)}>
              {t.entry.withdraw}
            </Button>
          )}
        </div>
      )}
      <ConfirmSheet
        open={withdrawing}
        onClose={() => setWithdrawing(false)}
        title={t.entry.withdrawTitle}
        body={t.entry.withdrawBody}
        confirmLabel={t.entry.withdraw}
        busy={withdraw.isPending}
        onConfirm={() => withdraw.mutate()}
      />
    </div>
  );
}
