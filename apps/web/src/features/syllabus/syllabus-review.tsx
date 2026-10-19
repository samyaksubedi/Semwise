"use client";

import {
  LOW_CONFIDENCE,
  type ChangeRequestView,
  type ProposedOp,
  type SyllabusStatusRow,
  type SubjectView,
  type SyllabusVersionView,
  type TopicKind,
  type TopicNode,
} from "@semwise/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ChevronLeft, ChevronRight, FileSearch, Plus, Sparkles } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Button, IconButton } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { ConfirmSheet, FormSheet } from "@/components/ui/sheet";
import { ErrorState, errorMessage } from "@/components/ui/states";
import {
  Card,
  ListSkeleton,
  Notice,
  PageHeader,
  SectionTitle,
  Skeleton,
  StatusPill,
} from "@/components/ui/surface";
import { Tabs } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";
import { keys } from "@/features/admin/queries";
import { ApiError, api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatDay, todayIn } from "@/lib/format";
import { useTimezone } from "@/lib/session";
import { t } from "@/lib/strings";

const versionKey = (id: string) => ["syllabus-version", id] as const;
const changesKey = (id: string) => ["syllabus-changes", id] as const;

const KIND_LABEL: Record<TopicKind, string> = {
  UNIT: t.syllabus.unit,
  TOPIC: t.syllabus.topic,
  SUBTOPIC: t.syllabus.subtopic,
};
const CHILD: Partial<Record<TopicKind, TopicKind>> = { UNIT: "TOPIC", TOPIC: "SUBTOPIC" };

function BackToList() {
  return (
    <Link
      href="/admin/syllabus"
      className="mb-2 -ml-1 inline-flex h-9 items-center gap-1 rounded-control px-1 text-sm text-muted hover:text-text"
    >
      <ChevronLeft aria-hidden className="size-4" />
      {t.syllabus.title}
    </Link>
  );
}

function VersionStatus({ version }: { version: SyllabusVersionView }) {
  const map = {
    DRAFT: { tone: "warning", label: t.syllabus.statusDraft },
    PUBLISHING: { tone: "info", label: t.syllabus.statusPublishing },
    PUBLISHED: { tone: "success", label: t.syllabus.statusPublished },
    SUPERSEDED: { tone: "neutral", label: t.syllabus.statusSuperseded },
  } as const;
  const s = map[version.status];
  return <StatusPill tone={s.tone}>{s.label}</StatusPill>;
}

// ---------- A draft (or any version) under review ----------

export function VersionPage({ id }: { id: string }) {
  const router = useRouter();
  const client = useQueryClient();
  const toast = useToast();
  const version = useQuery({
    queryKey: versionKey(id),
    queryFn: () => api<SyllabusVersionView>(`/syllabus/versions/${id}`),
    // Reading and publishing run as jobs: follow them until they finish.
    refetchInterval: (q) => {
      const v = q.state.data;
      return v &&
        (v.extraction === "QUEUED" || v.extraction === "RUNNING" || v.status === "PUBLISHING")
        ? 4000
        : false;
    },
  });
  const [publishing, setPublishing] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const tz = useTimezone();
  const [effectiveFrom, setEffectiveFrom] = useState(() => todayIn(tz));
  const changed = (v: SyllabusVersionView) => {
    client.setQueryData(versionKey(id), v);
    void client.invalidateQueries({ queryKey: keys.syllabusStatus(v.semesterId) });
  };
  const publish = useMutation({
    mutationFn: () =>
      api<SyllabusVersionView>(`/syllabus/versions/${id}/publish`, { body: { effectiveFrom } }),
    onSuccess: (v) => {
      changed(v);
      setPublishing(false);
      toast(t.syllabus.publishing);
    },
  });
  const discard = useMutation({
    mutationFn: () => api(`/syllabus/versions/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast(t.syllabus.discarded);
      void client.invalidateQueries({ queryKey: ["syllabus-status"] });
      router.replace("/admin/syllabus");
    },
  });
  const subjectId = version.data?.subjectId;
  const subject = useQuery({
    queryKey: ["subject", subjectId],
    queryFn: () => api<SubjectView>(`/subjects/${subjectId}`),
    enabled: Boolean(subjectId),
  });
  const retry = useMutation({
    mutationFn: () =>
      api<SyllabusVersionView>(`/syllabus/versions/${id}/retry`, { method: "POST" }),
    onSuccess: changed,
  });

  if (version.error)
    return <ErrorState error={version.error} onRetry={() => void version.refetch()} />;
  if (version.isPending)
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-64" />
        <ListSkeleton rows={4} />
      </div>
    );
  const v = version.data;
  const reading = v.extraction === "QUEUED" || v.extraction === "RUNNING";
  const isDraft = v.status === "DRAFT";
  const editable = isDraft && v.extraction === "DONE";

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        back={<BackToList />}
        title={
          subject.data
            ? t.syllabus.subjectVersion(subject.data.name, v.versionNo)
            : v.suggestedName && !v.subjectId
              ? v.suggestedName
              : t.syllabus.version(v.versionNo)
        }
        lead={
          <span className="flex flex-wrap items-center gap-2">
            <VersionStatus version={v} />
            {v.credits !== null && <span>{t.syllabus.credits(v.credits)}</span>}
            {v.effectiveFrom && <span>{formatDay(v.effectiveFrom, undefined, true)}</span>}
          </span>
        }
        actions={
          isDraft && (
            <>
              <Button variant="ghost" onClick={() => setDiscarding(true)}>
                {t.syllabus.discard}
              </Button>
              <Button
                disabled={!editable || !v.subjectId || v.topics.length === 0}
                onClick={() => setPublishing(true)}
              >
                {t.syllabus.publish}
              </Button>
            </>
          )
        }
      />

      {reading && (
        <Notice
          tone="info"
          title={v.extraction === "QUEUED" ? t.syllabus.extractionQueued : undefined}
        >
          {t.syllabus.extractionRunning}
        </Notice>
      )}
      {v.extraction === "FAILED" && (
        <Notice
          tone="danger"
          title={t.syllabus.extractionFailed}
          action={
            <Button
              size="sm"
              variant="secondary"
              loading={retry.isPending}
              onClick={() => retry.mutate()}
            >
              {t.syllabus.retry}
            </Button>
          }
        >
          {v.extractionError}
        </Notice>
      )}
      {v.status === "PUBLISHING" && <Notice tone="info">{t.syllabus.statusPublishing}</Notice>}
      {v.usedOcr && editable && <Notice tone="warning">{t.syllabus.scanned}</Notice>}
      {editable && !v.subjectId && <ConfirmSubject version={v} onDone={changed} />}

      {reading ? (
        <ListSkeleton rows={4} />
      ) : (
        <ReviewPanels version={v} editable={editable} onChanged={changed} />
      )}

      <ConfirmSheet
        open={publishing}
        onClose={() => setPublishing(false)}
        title={t.syllabus.publishTitle}
        body={t.syllabus.publishBody}
        confirmLabel={t.syllabus.publish}
        danger={false}
        busy={publish.isPending}
        onConfirm={() => publish.mutate()}
      >
        <div className="mt-4">
          {publish.error && <Notice tone="danger">{errorMessage(publish.error)}</Notice>}
          <Field label={t.syllabus.effectiveFrom}>
            {(p) => (
              <Input
                {...p}
                type="date"
                value={effectiveFrom}
                onChange={(e) => setEffectiveFrom(e.target.value)}
              />
            )}
          </Field>
        </div>
      </ConfirmSheet>
      <ConfirmSheet
        open={discarding}
        onClose={() => setDiscarding(false)}
        title={t.syllabus.discardTitle}
        body={t.syllabus.discardBody}
        confirmLabel={t.syllabus.discard}
        busy={discard.isPending}
        onConfirm={() => discard.mutate()}
      />
    </div>
  );
}

/** An imported PDF: create its subject from what was read, or link a subject without a syllabus. */
function ConfirmSubject({
  version,
  onDone,
}: {
  version: SyllabusVersionView;
  onDone: (v: SyllabusVersionView) => void;
}) {
  const toast = useToast();
  const status = useQuery({
    queryKey: keys.syllabusStatus(version.semesterId),
    queryFn: () => api<SyllabusStatusRow[]>(`/semesters/${version.semesterId}/syllabus-status`),
  });
  const free = (status.data ?? []).filter((r) => r.subjectId && r.state === "NONE");
  const [existing, setExisting] = useState("");
  const [name, setName] = useState(version.suggestedName ?? "");
  const [code, setCode] = useState(version.suggestedCode ?? "");
  const confirm = useMutation({
    mutationFn: () =>
      api<SyllabusVersionView>(`/syllabus/versions/${version.id}/confirm-subject`, {
        body: existing ? { subjectId: existing } : { name, code, credits: version.credits },
      }),
    onSuccess: (v) => {
      toast(t.syllabus.confirmed);
      onDone(v);
    },
  });
  const fieldOf = (path: string) =>
    confirm.error instanceof ApiError ? confirm.error.field(path) : undefined;
  return (
    <Card className="flex flex-col gap-4 p-4">
      <div>
        <p className="font-semibold">{t.syllabus.confirmTitle}</p>
        <p className="text-sm text-muted">{t.syllabus.confirmLead}</p>
      </div>
      {confirm.error && !fieldOf("name") && !fieldOf("code") && (
        <Notice tone="danger">{errorMessage(confirm.error)}</Notice>
      )}
      {free.length > 0 && (
        <Field label={t.classes.subject}>
          {(p) => (
            <Select {...p} value={existing} onChange={(e) => setExisting(e.target.value)}>
              <option value="">{t.syllabus.confirmCreate}</option>
              {free.map((r) => (
                <option key={r.subjectId} value={r.subjectId!}>
                  {r.subjectName} ({r.subjectCode})
                </option>
              ))}
            </Select>
          )}
        </Field>
      )}
      {!existing && (
        <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
          <Field label={t.structure.subjectName} error={fieldOf("name")}>
            {(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} />}
          </Field>
          <Field label={t.structure.subjectCode} error={fieldOf("code")}>
            {(p) => (
              <Input
                {...p}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className="uppercase"
              />
            )}
          </Field>
        </div>
      )}
      <div>
        <Button loading={confirm.isPending} onClick={() => confirm.mutate()}>
          {t.common.confirm}
        </Button>
      </div>
    </Card>
  );
}

// ---------- The live syllabus of a subject ----------

export function SubjectSyllabusPage({ subjectId }: { subjectId: string }) {
  const router = useRouter();
  const live = useQuery({
    queryKey: ["syllabus-live", subjectId],
    queryFn: () => api<SyllabusVersionView>(`/subjects/${subjectId}/syllabus`),
  });
  const versions = useQuery({
    queryKey: ["syllabus-versions", subjectId],
    queryFn: () =>
      api<
        {
          id: string;
          versionNo: number;
          status: string;
          publishedAt: string | null;
          live: boolean;
        }[]
      >(`/subjects/${subjectId}/syllabus/versions`),
  });
  const edit = useMutation({
    mutationFn: () =>
      api<SyllabusVersionView>(`/subjects/${subjectId}/syllabus/drafts`, {
        body: { fromCurrent: true },
      }),
    onSuccess: (v) => router.push(`/admin/syllabus/versions/${v.id}`),
  });
  const subject = useQuery({
    queryKey: ["subject", subjectId],
    queryFn: () => api<SubjectView>(`/subjects/${subjectId}`),
  });
  const open = versions.data?.find((x) => x.status === "DRAFT" || x.status === "PUBLISHING");

  if (live.error) return <ErrorState error={live.error} onRetry={() => void live.refetch()} />;
  if (live.isPending) return <ListSkeleton rows={4} />;
  const v = live.data;
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        back={<BackToList />}
        title={
          subject.data
            ? t.syllabus.subjectVersion(subject.data.name, v.versionNo)
            : t.syllabus.version(v.versionNo)
        }
        lead={
          <span className="flex flex-wrap items-center gap-2">
            <VersionStatus version={v} />
            {v.effectiveFrom && <span>{formatDay(v.effectiveFrom, undefined, true)}</span>}
          </span>
        }
        actions={
          open ? (
            <Button onClick={() => router.push(`/admin/syllabus/versions/${open.id}`)}>
              {t.syllabus.openDraft}
            </Button>
          ) : (
            <Button loading={edit.isPending} onClick={() => edit.mutate()}>
              {t.syllabus.editAsNew}
            </Button>
          )
        }
      />
      {edit.error && <Notice tone="danger">{errorMessage(edit.error)}</Notice>}
      <ReviewPanels version={v} editable={false} onChanged={() => undefined} />
      {versions.data && versions.data.length > 1 && (
        <section>
          <SectionTitle>{t.syllabus.history}</SectionTitle>
          <Card className="divide-y divide-border">
            {versions.data.map((x) => (
              <Link
                key={x.id}
                href={`/admin/syllabus/versions/${x.id}`}
                className="flex min-h-12 items-center justify-between gap-2 px-4 hover:bg-surface-2"
              >
                <span>
                  {t.syllabus.version(x.versionNo)}
                  {x.live && <span className="ml-2 text-sm text-success">({t.syllabus.live})</span>}
                </span>
                <ChevronRight aria-hidden className="size-5 text-faint" />
              </Link>
            ))}
          </Card>
        </section>
      )}
    </div>
  );
}

// ---------- The three panels: topic tree, source page, change requests ----------

type Panel = "tree" | "source" | "changes";

function flatten(nodes: TopicNode[], depth = 0): { node: TopicNode; depth: number }[] {
  return nodes.flatMap((node) => [{ node, depth }, ...flatten(node.children, depth + 1)]);
}

function ReviewPanels({
  version,
  editable,
  onChanged,
}: {
  version: SyllabusVersionView;
  editable: boolean;
  onChanged: (v: SyllabusVersionView) => void;
}) {
  const rows = useMemo(() => flatten(version.topics), [version.topics]);
  const firstDoubt = rows.find((r) => r.node.confidence < LOW_CONFIDENCE)?.node.sourcePage;
  const [page, setPage] = useState(firstDoubt ?? 1);
  const [panel, setPanel] = useState<Panel>("tree");
  const showPage = (n: number) => {
    setPage(n);
    setPanel("source");
  };
  const tabs = [
    {
      value: "tree" as const,
      label: t.syllabus.tabTree,
      badge: version.lowConfidenceCount || undefined,
    },
    { value: "source" as const, label: t.syllabus.tabSource },
    ...(editable ? [{ value: "changes" as const, label: t.syllabus.tabChanges }] : []),
  ];
  const hidden = (p: Panel) => (panel === p ? "" : "hidden xl:block");

  return (
    <div className="flex flex-col gap-4">
      <Tabs
        label={t.syllabus.title}
        value={panel}
        onChange={setPanel}
        items={tabs}
        className="xl:hidden"
      />
      <div
        className={cn(
          "grid gap-4",
          editable ? "xl:grid-cols-[1.4fr_1fr_1fr]" : "xl:grid-cols-[1.4fr_1fr]",
        )}
      >
        <section className={hidden("tree")} aria-label={t.syllabus.tabTree}>
          <TopicTree
            version={version}
            rows={rows}
            editable={editable}
            onChanged={onChanged}
            onShowPage={showPage}
          />
        </section>
        <section className={hidden("source")} aria-label={t.syllabus.tabSource}>
          <SourcePanel version={version} page={page} onPage={setPage} />
        </section>
        {editable && (
          <section className={hidden("changes")} aria-label={t.syllabus.tabChanges}>
            <ChangesPanel version={version} onChanged={onChanged} />
          </section>
        )}
      </div>
    </div>
  );
}

function TopicTree({
  version,
  rows,
  editable,
  onChanged,
  onShowPage,
}: {
  version: SyllabusVersionView;
  rows: { node: TopicNode; depth: number }[];
  editable: boolean;
  onChanged: (v: SyllabusVersionView) => void;
  onShowPage: (page: number) => void;
}) {
  const [selected, setSelected] = useState<TopicNode | null>(null);
  const [addingUnit, setAddingUnit] = useState(false);
  return (
    <div className="flex flex-col gap-3">
      {version.lowConfidenceCount > 0 && editable && (
        <Notice tone="warning" title={t.syllabus.lowConfidence(version.lowConfidenceCount)}>
          {t.syllabus.lowConfidenceHint}
        </Notice>
      )}
      {!editable && version.status !== "DRAFT" && (
        <p className="text-sm text-muted">{t.syllabus.readOnly}</p>
      )}
      <Card className="overflow-hidden">
        {rows.length === 0 ? (
          <p className="p-4 text-muted">{t.syllabus.emptyTree}</p>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map(({ node, depth }) => {
              const doubtful = node.confidence < LOW_CONFIDENCE;
              return (
                <li
                  key={node.id}
                  className={cn("flex items-center gap-1", doubtful && "bg-warning-soft/60")}
                >
                  <button
                    type="button"
                    onClick={() => setSelected(node)}
                    className="flex min-h-12 min-w-0 flex-1 flex-col justify-center py-2 pr-2 text-left transition-calm hover:bg-surface-2"
                    style={{ paddingLeft: `${16 + depth * 18}px` }}
                  >
                    <span
                      className={cn(
                        "truncate",
                        node.kind === "UNIT"
                          ? "font-semibold"
                          : node.kind === "SUBTOPIC"
                            ? "text-[15px] text-muted"
                            : "",
                      )}
                    >
                      {node.kind === "UNIT" &&
                        `${KIND_LABEL.UNIT} ${version.topics.indexOf(node) + 1}: `}
                      {node.title}
                    </span>
                    {/* The pieces sit in a flex row; the commas keep them apart when read out. */}
                    <span className="flex flex-wrap items-center gap-2 text-xs text-muted">
                      {node.kind !== "UNIT" && (
                        <span>
                          <span className="sr-only">, </span>
                          {KIND_LABEL[node.kind]}
                        </span>
                      )}
                      {node.hours !== null && (
                        <span>
                          <span className="sr-only">, </span>
                          {t.syllabus.hours(node.hours)}
                        </span>
                      )}
                      {doubtful && (
                        <StatusPill tone="warning" icon={AlertTriangle}>
                          <span className="sr-only">, </span>
                          {t.syllabus.check}
                        </StatusPill>
                      )}
                    </span>
                  </button>
                  {node.sourcePage !== null && version.pageCount > 0 && (
                    <button
                      type="button"
                      onClick={() => onShowPage(node.sourcePage!)}
                      aria-label={t.syllabus.showPage(node.sourcePage)}
                      className="mr-2 h-9 shrink-0 rounded-control px-2 text-xs font-medium text-accent hover:bg-accent-soft"
                    >
                      {t.syllabus.page(node.sourcePage)}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      {editable && (
        <div>
          <Button size="sm" variant="secondary" onClick={() => setAddingUnit(true)}>
            <Plus aria-hidden className="size-4" />
            {t.syllabus.addUnit}
          </Button>
        </div>
      )}
      {selected && (
        <NodeSheet
          version={version}
          node={selected}
          editable={editable}
          onChanged={onChanged}
          onShowPage={(n) => {
            setSelected(null);
            onShowPage(n);
          }}
          onClose={() => setSelected(null)}
        />
      )}
      {addingUnit && (
        <AddTopicSheet
          version={version}
          parent={null}
          onChanged={onChanged}
          onClose={() => setAddingUnit(false)}
        />
      )}
    </div>
  );
}

function NodeSheet({
  version,
  node,
  editable,
  onChanged,
  onShowPage,
  onClose,
}: {
  version: SyllabusVersionView;
  node: TopicNode;
  editable: boolean;
  onChanged: (v: SyllabusVersionView) => void;
  onShowPage: (page: number) => void;
  onClose: () => void;
}) {
  const toast = useToast();
  const [title, setTitle] = useState(node.title);
  const [hours, setHours] = useState(node.hours === null ? "" : String(node.hours));
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const base = `/syllabus/versions/${version.id}/topics/${node.id}`;
  const save = useMutation({
    mutationFn: () =>
      api<SyllabusVersionView>(base, {
        method: "PATCH",
        body: { title, ...(node.kind === "UNIT" ? { hours: hours ? Number(hours) : null } : {}) },
      }),
    onSuccess: (v) => {
      onChanged(v);
      toast(t.structure.saved);
      onClose();
    },
  });
  const remove = useMutation({
    mutationFn: () => api<SyllabusVersionView>(base, { method: "DELETE" }),
    onSuccess: (v) => {
      onChanged(v);
      onClose();
    },
  });
  const child = CHILD[node.kind];

  if (adding && child)
    return (
      <AddTopicSheet version={version} parent={node} onChanged={onChanged} onClose={onClose} />
    );

  return (
    <>
      <FormSheet
        open={!deleting}
        onClose={onClose}
        title={KIND_LABEL[node.kind]}
        submitLabel={editable ? t.common.save : t.common.close}
        onSubmit={() => (editable ? save.mutate() : onClose())}
        busy={save.isPending}
        error={save.error || remove.error ? errorMessage(save.error ?? remove.error) : null}
      >
        {node.confidence < LOW_CONFIDENCE && (
          <Notice tone="warning">{t.syllabus.lowConfidenceHint}</Notice>
        )}
        {editable ? (
          <>
            <Field label={t.syllabus.titleLabel}>
              {(p) => <Input {...p} value={title} onChange={(e) => setTitle(e.target.value)} />}
            </Field>
            {node.kind === "UNIT" && (
              <Field label={t.syllabus.hoursLabel} optional>
                {(p) => (
                  <Input
                    {...p}
                    inputMode="numeric"
                    value={hours}
                    onChange={(e) => setHours(e.target.value.replace(/\D/g, ""))}
                  />
                )}
              </Field>
            )}
          </>
        ) : (
          <p className="text-[15px]">{node.title}</p>
        )}
        <div className="flex flex-wrap gap-2">
          {node.sourcePage !== null && version.pageCount > 0 && (
            <Button size="sm" variant="secondary" onClick={() => onShowPage(node.sourcePage!)}>
              <FileSearch aria-hidden className="size-4" />
              {t.syllabus.showPage(node.sourcePage)}
            </Button>
          )}
          {editable && child && (
            <Button size="sm" variant="secondary" onClick={() => setAdding(true)}>
              <Plus aria-hidden className="size-4" />
              {t.syllabus.addChild(KIND_LABEL[child])}
            </Button>
          )}
          {editable && (
            <Button size="sm" variant="quietDanger" onClick={() => setDeleting(true)}>
              {t.common.delete}
            </Button>
          )}
        </div>
      </FormSheet>
      <ConfirmSheet
        open={deleting}
        onClose={() => setDeleting(false)}
        title={t.syllabus.deleteItem(node.title)}
        body={t.syllabus.deleteItemBody}
        confirmLabel={t.common.delete}
        busy={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
    </>
  );
}

function AddTopicSheet({
  version,
  parent,
  onChanged,
  onClose,
}: {
  version: SyllabusVersionView;
  parent: TopicNode | null;
  onChanged: (v: SyllabusVersionView) => void;
  onClose: () => void;
}) {
  const kind: TopicKind = parent ? CHILD[parent.kind]! : "UNIT";
  const [title, setTitle] = useState("");
  const add = useMutation({
    mutationFn: () =>
      api<SyllabusVersionView>(`/syllabus/versions/${version.id}/topics`, {
        body: { parentId: parent?.id ?? null, kind, title },
      }),
    onSuccess: (v) => {
      onChanged(v);
      onClose();
    },
  });
  return (
    <FormSheet
      open
      onClose={onClose}
      title={t.syllabus.addChild(KIND_LABEL[kind])}
      submitLabel={t.common.add}
      onSubmit={() => add.mutate()}
      busy={add.isPending}
      error={add.error ? errorMessage(add.error) : null}
    >
      {parent && <p className="text-sm text-muted">{parent.title}</p>}
      <Field label={t.syllabus.titleLabel}>
        {(p) => <Input {...p} value={title} onChange={(e) => setTitle(e.target.value)} />}
      </Field>
    </FormSheet>
  );
}

function SourcePanel({
  version,
  page,
  onPage,
}: {
  version: SyllabusVersionView;
  page: number;
  onPage: (n: number) => void;
}) {
  const total = version.pageCount;
  const current = Math.min(Math.max(page, 1), Math.max(total, 1));
  const text = useQuery({
    queryKey: ["syllabus-page", version.id, current],
    queryFn: () =>
      api<{ pageNo: number; text: string }>(`/syllabus/versions/${version.id}/pages/${current}`),
    enabled: total > 0,
  });
  if (total === 0) return <p className="text-muted">{t.syllabus.noPages}</p>;
  return (
    <Card className="flex flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-border px-2 py-1">
        <IconButton
          label={t.syllabus.previousPage}
          disabled={current <= 1}
          onClick={() => onPage(current - 1)}
        >
          <ChevronLeft aria-hidden className="size-5" />
        </IconButton>
        <span className="text-sm font-medium">{t.syllabus.pageOf(current, total)}</span>
        <IconButton
          label={t.syllabus.nextPage}
          disabled={current >= total}
          onClick={() => onPage(current + 1)}
        >
          <ChevronRight aria-hidden className="size-5" />
        </IconButton>
      </div>
      <div className="max-h-[70dvh] overflow-y-auto p-4">
        {text.error ? (
          <ErrorState error={text.error} onRetry={() => void text.refetch()} />
        ) : text.isPending ? (
          <ListSkeleton rows={3} />
        ) : (
          <p className="text-[15px] leading-relaxed break-words whitespace-pre-wrap">
            {text.data.text}
          </p>
        )}
      </div>
    </Card>
  );
}

const OP_LABEL: Record<ProposedOp["op"], string> = {
  add: t.syllabus.opAdd,
  rename: t.syllabus.opRename,
  move: t.syllabus.opMove,
  delete: t.syllabus.opDelete,
};

function ChangesPanel({
  version,
  onChanged,
}: {
  version: SyllabusVersionView;
  onChanged: (v: SyllabusVersionView) => void;
}) {
  const client = useQueryClient();
  const [text, setText] = useState("");
  const requests = useQuery({
    queryKey: changesKey(version.id),
    queryFn: () => api<ChangeRequestView[]>(`/syllabus/versions/${version.id}/change-requests`),
  });
  const propose = useMutation({
    mutationFn: () =>
      api<ChangeRequestView>(`/syllabus/versions/${version.id}/change-requests`, {
        body: { text },
      }),
    onSuccess: () => {
      setText("");
      void client.invalidateQueries({ queryKey: changesKey(version.id) });
    },
  });
  const fieldError = propose.error instanceof ApiError ? propose.error.field("text") : undefined;
  return (
    <div className="flex flex-col gap-3">
      <Card className="flex flex-col gap-3 p-4">
        <Field label={t.syllabus.changeLabel} hint={t.syllabus.changeHint} error={fieldError}>
          {(p) => (
            <Textarea
              {...p}
              value={text}
              onChange={(e) => setText(e.target.value)}
              className="min-h-24"
              maxLength={1000}
            />
          )}
        </Field>
        {propose.error && !fieldError && (
          <Notice tone="danger">{errorMessage(propose.error)}</Notice>
        )}
        <div>
          <Button
            loading={propose.isPending}
            disabled={text.trim().length < 3}
            onClick={() => propose.mutate()}
          >
            <Sparkles aria-hidden className="size-4" />
            {propose.isPending ? t.syllabus.proposing : t.syllabus.propose}
          </Button>
        </div>
      </Card>
      {requests.error ? (
        <ErrorState error={requests.error} onRetry={() => void requests.refetch()} />
      ) : requests.isPending ? (
        <ListSkeleton rows={2} />
      ) : requests.data.length === 0 ? (
        <p className="text-sm text-muted">{t.syllabus.noChanges}</p>
      ) : (
        [...requests.data]
          .reverse()
          .map((r) => (
            <ChangeRequest key={r.id} request={r} versionId={version.id} onChanged={onChanged} />
          ))
      )}
    </div>
  );
}

function ChangeRequest({
  request,
  versionId,
  onChanged,
}: {
  request: ChangeRequestView;
  versionId: string;
  onChanged: (v: SyllabusVersionView) => void;
}) {
  const client = useQueryClient();
  const toast = useToast();
  const open = request.status === "PROPOSED";
  const [choices, setChoices] = useState<Record<string, boolean>>({});
  const decided = request.ops.every((op) => op.id in choices);
  const decide = useMutation({
    mutationFn: () =>
      api<ChangeRequestView>(`/syllabus/change-requests/${request.id}/decide`, {
        body: { decisions: request.ops.map((op) => ({ opId: op.id, accept: choices[op.id]! })) },
      }),
    onSuccess: async () => {
      void client.invalidateQueries({ queryKey: changesKey(versionId) });
      onChanged(await api<SyllabusVersionView>(`/syllabus/versions/${versionId}`));
      toast(t.syllabus.applied);
    },
  });
  const all = (accept: boolean) =>
    setChoices(Object.fromEntries(request.ops.map((op) => [op.id, accept])));

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[15px] font-medium">&ldquo;{request.requestText}&rdquo;</p>
        {!open && (
          <StatusPill tone={request.status === "REJECTED" ? "neutral" : "success"}>
            {t.syllabus.decided[request.status]}
          </StatusPill>
        )}
      </div>
      <p className="text-sm text-muted">
        {request.ops.length ? t.syllabus.proposed(request.ops.length) : t.syllabus.noOps}
      </p>
      {request.note && <Notice tone="info">{request.note}</Notice>}
      <ul className="flex flex-col gap-2">
        {request.ops.map((op) => {
          const choice = open
            ? choices[op.id]
            : op.decision === "ACCEPTED"
              ? true
              : op.decision === "REJECTED"
                ? false
                : undefined;
          return (
            <li key={op.id} className="rounded-control border border-border p-3">
              <p className="text-xs font-semibold tracking-wide text-muted uppercase">
                {OP_LABEL[op.op]}
              </p>
              {op.before && (
                <p className="mt-1 text-[15px] break-words">
                  <span className="sr-only">{t.syllabus.before}: </span>
                  <del className="rounded bg-danger-soft px-1 text-danger decoration-danger/60">
                    {op.before}
                  </del>
                </p>
              )}
              {op.after && (
                <p className="mt-1 text-[15px] break-words">
                  <span className="sr-only">{t.syllabus.after}: </span>
                  <ins className="rounded bg-success-soft px-1 text-success no-underline">
                    {op.after}
                  </ins>
                </p>
              )}
              <p className="mt-1 text-sm text-muted">{op.reason}</p>
              {open ? (
                <div className="mt-2 flex gap-2" role="group" aria-label={OP_LABEL[op.op]}>
                  <Button
                    size="sm"
                    variant={choice === true ? "primary" : "secondary"}
                    aria-pressed={choice === true}
                    onClick={() => setChoices((c) => ({ ...c, [op.id]: true }))}
                  >
                    {t.syllabus.accept}
                  </Button>
                  <Button
                    size="sm"
                    variant={choice === false ? "danger" : "secondary"}
                    aria-pressed={choice === false}
                    onClick={() => setChoices((c) => ({ ...c, [op.id]: false }))}
                  >
                    {t.syllabus.reject}
                  </Button>
                </div>
              ) : (
                <p
                  className={cn("mt-1 text-sm font-medium", choice ? "text-success" : "text-muted")}
                >
                  {choice ? t.syllabus.accept : t.syllabus.reject}
                </p>
              )}
            </li>
          );
        })}
      </ul>
      {open && request.ops.length > 0 && (
        <div className="flex flex-wrap gap-2 border-t border-border pt-3">
          <Button size="sm" variant="ghost" onClick={() => all(true)}>
            {t.syllabus.acceptAll}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => all(false)}>
            {t.syllabus.rejectAll}
          </Button>
          <Button
            size="sm"
            className="ml-auto"
            disabled={!decided}
            loading={decide.isPending}
            onClick={() => decide.mutate()}
          >
            {t.syllabus.apply}
          </Button>
        </div>
      )}
      {decide.error && <Notice tone="danger">{errorMessage(decide.error)}</Notice>}
    </Card>
  );
}
