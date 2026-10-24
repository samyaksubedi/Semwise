"use client";

import type { ApprovalItem, EntryTopicView } from "@semwise/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCheck, Pencil, X } from "lucide-react";
import { useState } from "react";
import { Button, IconButton } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { FormSheet } from "@/components/ui/sheet";
import { ErrorState, errorMessage } from "@/components/ui/states";
import {
  Card,
  EmptyState,
  ListSkeleton,
  Notice,
  PageHeader,
  StatusPill,
} from "@/components/ui/surface";
import { useToast } from "@/components/ui/toast";
import { entryKeys, TopicList } from "@/features/entries/shared";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatDay, todayIn } from "@/lib/format";
import { useTimezone } from "@/lib/session";
import { t } from "@/lib/strings";

export function useApprovals(enabled = true) {
  return useQuery({
    queryKey: entryKeys.approvals,
    queryFn: () => api<ApprovalItem[]>("/approvals"),
    enabled,
    refetchInterval: 60_000,
  });
}

export function ApprovalsPage() {
  const client = useQueryClient();
  const toast = useToast();
  const queue = useApprovals();
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const done = () => void client.invalidateQueries({ queryKey: entryKeys.approvals });
  const bulk = useMutation({
    mutationFn: () =>
      api<{ approved: number }>("/approvals/bulk-approve", { body: { versionIds: selected } }),
    onSuccess: (r) => {
      toast(t.teacher.bulkDone(r.approved));
      setSelected([]);
      setSelecting(false);
      done();
    },
  });
  const items = queue.data ?? [];

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5">
      <PageHeader
        title={t.teacher.approvalsTitle}
        lead={t.teacher.approvalsLead}
        actions={
          items.length > 1 && (
            <Button
              variant="secondary"
              onClick={() => {
                setSelecting((v) => !v);
                setSelected([]);
              }}
            >
              {selecting ? t.teacher.cancelSelect : t.teacher.select}
            </Button>
          )
        }
      />
      {bulk.error && <Notice tone="danger">{errorMessage(bulk.error)}</Notice>}
      {queue.error ? (
        <ErrorState error={queue.error} onRetry={() => void queue.refetch()} />
      ) : queue.isPending ? (
        <ListSkeleton rows={3} />
      ) : items.length === 0 ? (
        <EmptyState icon={CheckCheck} title={t.teacher.empty} body={t.teacher.emptyBody} />
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((item) => (
            <ApprovalCard
              key={item.versionId}
              item={item}
              selecting={selecting}
              selected={selected.includes(item.versionId)}
              onSelect={(on) =>
                setSelected((list) =>
                  on ? [...list, item.versionId] : list.filter((x) => x !== item.versionId),
                )
              }
              onDone={done}
            />
          ))}
        </ul>
      )}
      {selecting && selected.length > 0 && (
        <div className="sticky bottom-[calc(5rem+env(safe-area-inset-bottom))] flex justify-end md:bottom-6">
          <Button className="shadow-lift" loading={bulk.isPending} onClick={() => bulk.mutate()}>
            {t.teacher.approveSelected(selected.length)}
          </Button>
        </div>
      )}
    </div>
  );
}

function ApprovalCard({
  item,
  selecting,
  selected,
  onSelect,
  onDone,
}: {
  item: ApprovalItem;
  selecting: boolean;
  selected: boolean;
  onSelect: (on: boolean) => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const tz = useTimezone();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [editing, setEditing] = useState(false);
  const approve = useMutation({
    mutationFn: () => api(`/approvals/${item.versionId}/approve`, { body: {} }),
    onSuccess: () => {
      toast(t.teacher.approved);
      onDone();
    },
  });
  const reject = useMutation({
    mutationFn: () => api(`/approvals/${item.versionId}/reject`, { body: { reason } }),
    onSuccess: () => {
      toast(t.teacher.rejected);
      onDone();
    },
  });
  const day = formatDay(item.taughtOn, todayIn(tz));
  const busy = approve.isPending || reject.isPending;

  return (
    <li>
      <Card className={cn("flex flex-col gap-3 p-4", selected && "border-accent")}>
        <div className="flex items-start gap-3">
          {selecting && (
            <input
              type="checkbox"
              checked={selected}
              onChange={(e) => onSelect(e.target.checked)}
              aria-label={t.teacher.selectEntry(item.subject.name, day)}
              className="mt-1 size-5 shrink-0 accent-[var(--accent)]"
            />
          )}
          <div className="min-w-0 flex-1">
            <p className="font-semibold">{item.subject.name}</p>
            <p className="text-sm text-muted">
              {day} · {t.people.section} {item.section.name}
            </p>
          </div>
          {item.isEdit && <StatusPill tone="info">{t.entry.edited}</StatusPill>}
        </div>
        <TopicList topics={item.topics} />
        {item.summary && <p className="text-[15px] text-muted text-pretty">{item.summary}</p>}
        {(approve.error || reject.error) && (
          <Notice tone="danger">{errorMessage(approve.error ?? reject.error)}</Notice>
        )}
        {!selecting &&
          (rejecting ? (
            <form
              className="flex flex-col gap-2 sm:flex-row sm:items-end"
              onSubmit={(e) => {
                e.preventDefault();
                if (reason.trim().length >= 3) reject.mutate();
              }}
            >
              <Field label={t.teacher.rejectReason} className="flex-1">
                {(p) => (
                  <Input
                    {...p}
                    autoFocus
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    maxLength={500}
                  />
                )}
              </Field>
              <div className="flex gap-2">
                <IconButton label={t.common.cancel} onClick={() => setRejecting(false)}>
                  <X aria-hidden className="size-5" />
                </IconButton>
                <Button
                  type="submit"
                  variant="danger"
                  loading={reject.isPending}
                  disabled={reason.trim().length < 3}
                >
                  {t.teacher.rejectSend}
                </Button>
              </div>
            </form>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="ghost" onClick={() => setEditing(true)} disabled={busy}>
                <Pencil aria-hidden className="size-4" />
                {t.teacher.editApprove}
              </Button>
              <div className="ml-auto flex gap-2">
                <Button variant="secondary" onClick={() => setRejecting(true)} disabled={busy}>
                  {t.teacher.reject}
                </Button>
                <Button
                  loading={approve.isPending}
                  disabled={busy}
                  onClick={() => approve.mutate()}
                >
                  {t.teacher.approve}
                </Button>
              </div>
            </div>
          ))}
      </Card>
      {editing && (
        <EditApproveSheet item={item} onClose={() => setEditing(false)} onDone={onDone} />
      )}
    </li>
  );
}

/** The teacher corrects the summary or drops a wrong topic, then approves in one step. */
function EditApproveSheet({
  item,
  onClose,
  onDone,
}: {
  item: ApprovalItem;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [summary, setSummary] = useState(item.summary ?? "");
  const [topics, setTopics] = useState<EntryTopicView[]>(item.topics);
  const save = useMutation({
    mutationFn: () =>
      api(`/approvals/${item.versionId}/approve`, {
        body: {
          summary,
          topics: topics.map(({ title, subtopics, stableKey }) => ({
            title,
            subtopics,
            stableKey,
          })),
        },
      }),
    onSuccess: () => {
      toast(t.teacher.approved);
      onDone();
      onClose();
    },
  });
  return (
    <FormSheet
      open
      onClose={onClose}
      title={t.teacher.editTitle}
      submitLabel={t.teacher.approve}
      onSubmit={() => save.mutate()}
      busy={save.isPending}
      error={save.error ? errorMessage(save.error) : null}
    >
      <fieldset className="flex flex-col gap-1">
        <legend className="mb-1 text-sm font-medium">{t.entry.topics}</legend>
        {topics.map((topic, i) => (
          <div
            key={`${topic.title}-${i}`}
            className="flex items-center gap-2 rounded-control border border-border pl-3"
          >
            <span className="min-w-0 flex-1 truncate text-[15px]">{topic.title}</span>
            <IconButton
              label={t.teacher.removeTopic(topic.title)}
              onClick={() => setTopics((list) => list.filter((_, j) => j !== i))}
            >
              <X aria-hidden className="size-4" />
            </IconButton>
          </div>
        ))}
      </fieldset>
      <Field label={t.entry.summary}>
        {(p) => (
          <Textarea
            {...p}
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            maxLength={1500}
          />
        )}
      </Field>
    </FormSheet>
  );
}
