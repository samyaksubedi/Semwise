"use client";

import type { ClassApprovalView, ClassView, EntryView } from "@semwise/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { Sheet } from "@/components/ui/sheet";
import { ErrorState, errorMessage } from "@/components/ui/states";
import {
  Card,
  EmptyState,
  ListSkeleton,
  Notice,
  PageHeader,
  SectionTitle,
} from "@/components/ui/surface";
import { useToast } from "@/components/ui/toast";
import { EntryComposer } from "@/features/entries/composer";
import { EntryStatus, TopicList, entryKeys, useMyClasses } from "@/features/entries/shared";
import { api } from "@/lib/api";
import { formatDay, todayIn } from "@/lib/format";
import { useSession, useTimezone } from "@/lib/session";
import { t } from "@/lib/strings";

/** Classes the person teaches (the CR and student classes are not part of this page). */
function useTaught() {
  const classes = useMyClasses();
  const { data: session } = useSession();
  const userId = session?.user.id;
  return {
    ...classes,
    data: classes.data?.filter((c) => c.teachers.some((x) => x.userId === userId)),
  };
}

export function TeacherClassesPage() {
  const classes = useTaught();
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5">
      <PageHeader title={t.teacher.classesTitle} lead={t.teacher.classesLead} />
      {classes.error ? (
        <ErrorState error={classes.error} onRetry={() => void classes.refetch()} />
      ) : !classes.data ? (
        <ListSkeleton rows={3} />
      ) : classes.data.length === 0 ? (
        <EmptyState icon={BookOpen} title={t.teacher.noClasses} body={t.teacher.noClassesBody} />
      ) : (
        <Card className="divide-y divide-border overflow-hidden">
          {classes.data.map((c) => (
            <Link
              key={c.id}
              href={`/classes/${c.id}`}
              className="flex min-h-16 items-center gap-3 px-4 py-3 hover:bg-surface-2"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{c.subject.name}</p>
                <p className="text-sm text-muted">
                  {c.subject.code} · {t.people.section} {c.section.name}
                </p>
              </div>
              <ChevronRight aria-hidden className="size-5 text-faint" />
            </Link>
          ))}
        </Card>
      )}
    </div>
  );
}

export function TeacherClassPage({ id }: { id: string }) {
  const client = useQueryClient();
  const toast = useToast();
  const tz = useTimezone();
  const klass = useQuery({
    queryKey: ["class", id],
    queryFn: () => api<ClassView>(`/classes/${id}`),
  });
  const entries = useQuery({
    queryKey: entryKeys.classEntries(id),
    queryFn: () => api<EntryView[]>(`/classes/${id}/entries`),
  });
  const [writing, setWriting] = useState(false);
  const changed = () => void client.invalidateQueries({ queryKey: entryKeys.classEntries(id) });
  const toggle = useMutation({
    mutationFn: (e: EntryView) =>
      api(`/entries/${e.id}/${e.takenDown ? "restore" : "takedown"}`, { method: "POST" }),
    onSuccess: (_d, e) => {
      toast(e.takenDown ? t.teacher.restored : t.teacher.takenDown);
      changed();
    },
  });

  if (klass.error) return <ErrorState error={klass.error} onRetry={() => void klass.refetch()} />;
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5">
      <PageHeader
        back={
          <Link
            href="/classes"
            className="mb-2 -ml-1 inline-flex h-9 items-center gap-1 px-1 text-sm text-muted hover:text-text"
          >
            <ChevronLeft aria-hidden className="size-4" />
            {t.teacher.classesTitle}
          </Link>
        }
        title={klass.data?.subject.name ?? t.common.loading}
        lead={
          klass.data &&
          `${klass.data.subject.code} · ${t.people.section} ${klass.data.section.name}`
        }
        actions={
          <Button onClick={() => setWriting(true)} disabled={!klass.data}>
            <Plus aria-hidden className="size-4" />
            {t.teacher.addEntry}
          </Button>
        }
      />
      <ClassApproval classId={id} />
      <section>
        <SectionTitle>{t.teacher.classEntries}</SectionTitle>
        {toggle.error && <Notice tone="danger">{errorMessage(toggle.error)}</Notice>}
        {entries.error ? (
          <ErrorState error={entries.error} onRetry={() => void entries.refetch()} />
        ) : entries.isPending ? (
          <ListSkeleton rows={3} />
        ) : entries.data.length === 0 ? (
          <p className="text-muted">{t.teacher.noClassEntries}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {[...entries.data].reverse().map((e) => {
              const version = e.live ?? e.latest;
              return (
                <li key={e.id}>
                  <Card className="flex flex-col gap-3 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-medium">{formatDay(e.taughtOn, todayIn(tz), true)}</p>
                      <EntryStatus entry={e} />
                    </div>
                    {version && <TopicList topics={version.topics} />}
                    {version?.summary && (
                      <p className="text-[15px] text-muted">{version.summary}</p>
                    )}
                    {e.live && (
                      <div>
                        <Button
                          size="sm"
                          variant="ghost"
                          loading={toggle.isPending && toggle.variables?.id === e.id}
                          onClick={() => toggle.mutate(e)}
                        >
                          {e.takenDown ? t.teacher.restore : t.teacher.takeDown}
                        </Button>
                      </div>
                    )}
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      {klass.data && (
        <Sheet open={writing} onClose={() => setWriting(false)} title={t.teacher.addEntry} wide>
          <EntryComposer
            classes={[klass.data]}
            fixedClassId={id}
            allowMedia={false}
            persist={false}
          />
        </Sheet>
      )}
    </div>
  );
}

/** The teacher's override of the program's approval rule, unless the program admin locked it. */
function ClassApproval({ classId }: { classId: string }) {
  const client = useQueryClient();
  const setting = useQuery({
    queryKey: ["class-approval", classId],
    queryFn: () => api<ClassApprovalView>(`/classes/${classId}/approval-settings`),
  });
  const save = useMutation({
    mutationFn: (autoApprove: boolean | null) =>
      api<ClassApprovalView>(`/classes/${classId}/approval-settings`, {
        method: "PUT",
        body: { autoApprove },
      }),
    onSuccess: (data) => client.setQueryData(["class-approval", classId], data),
  });
  if (!setting.data) return null;
  const s = setting.data;
  return (
    <Card className="flex flex-col gap-2 p-4">
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">{t.teacher.autoApprove}</span>
        <Select
          disabled={s.locked || save.isPending}
          value={s.override === null ? "" : String(s.override)}
          onChange={(e) => save.mutate(e.target.value === "" ? null : e.target.value === "true")}
        >
          <option value="">{t.teacher.useDefault}</option>
          <option value="true">{t.common.yes}</option>
          <option value="false">{t.common.no}</option>
        </Select>
      </label>
      {s.locked && <p className="text-sm text-muted">{t.teacher.autoApproveLocked}</p>}
      {save.error && <Notice tone="danger">{errorMessage(save.error)}</Notice>}
    </Card>
  );
}
