"use client";

import type { SyllabusStatusRow, SyllabusVersionView } from "@semwise/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, FilePlus2, FileText, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Button, ButtonLink } from "@/components/ui/button";
import { Field, Select } from "@/components/ui/field";
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
import { keys, useSemesterContext, type SemesterOption } from "@/features/admin/queries";
import { WithSemester } from "@/features/admin/semester-picker";
import { api } from "@/lib/api";
import { t } from "@/lib/strings";
import { uploadFile, type UploadTarget } from "@/lib/upload";

export function SyllabusListPage() {
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t.syllabus.title} lead={t.syllabus.lead} />
      <WithSemester>{(option) => <SyllabusList option={option} />}</WithSemester>
    </div>
  );
}

export function StatePill({ row }: { row: SyllabusStatusRow }) {
  if (row.state === "PUBLISHED")
    return (
      <span className="flex flex-wrap gap-1">
        <StatusPill tone="success">{t.syllabus.published(row.liveVersionNo ?? 1)}</StatusPill>
        {row.hasOpenDraft && <StatusPill tone="warning">{t.syllabus.draftOpen}</StatusPill>}
      </span>
    );
  if (row.state === "PROCESSING") return <StatusPill tone="info">{t.syllabus.reading}</StatusPill>;
  if (row.state === "DRAFT") return <StatusPill tone="warning">{t.syllabus.draft}</StatusPill>;
  return <StatusPill>{t.syllabus.none}</StatusPill>;
}

/**
 * A button that opens the file picker and uploads a PDF, then calls `onUploaded` with the file
 * id. Errors from the upload are shown by the caller through `onError`.
 */
function PdfButton({
  target,
  label,
  onUploaded,
  onError,
  variant = "secondary",
}: {
  target: UploadTarget;
  label: string;
  onUploaded: (fileId: string) => Promise<unknown>;
  onError: (message: string) => void;
  variant?: "primary" | "secondary";
}) {
  const input = useRef<HTMLInputElement>(null);
  const upload = useMutation({
    mutationFn: async (file: File) => onUploaded(await uploadFile("SYLLABUS_PDF", file, target)),
    onError: (err) => onError(errorMessage(err)),
  });
  return (
    <>
      <Button
        size="sm"
        variant={variant}
        loading={upload.isPending}
        onClick={() => input.current?.click()}
      >
        <Upload aria-hidden className="size-4" />
        {upload.isPending ? t.syllabus.uploading : label}
      </Button>
      <input
        ref={input}
        type="file"
        accept="application/pdf,.pdf"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) upload.mutate(file);
        }}
      />
    </>
  );
}

function SyllabusList({ option }: { option: SemesterOption }) {
  const id = option.semester.id;
  const router = useRouter();
  const client = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [copying, setCopying] = useState<SyllabusStatusRow | null>(null);
  const status = useQuery({
    queryKey: keys.syllabusStatus(id),
    queryFn: () => api<SyllabusStatusRow[]>(`/semesters/${id}/syllabus-status`),
    // While a PDF is being read, keep the list current.
    refetchInterval: (q) => (q.state.data?.some((r) => r.state === "PROCESSING") ? 5000 : false),
  });
  const opened = (version: SyllabusVersionView) => {
    void client.invalidateQueries({ queryKey: keys.syllabusStatus(id) });
    router.push(`/admin/syllabus/versions/${version.id}`);
  };

  if (status.error)
    return <ErrorState error={status.error} onRetry={() => void status.refetch()} />;
  if (status.isPending) return <ListSkeleton rows={3} />;
  const rows = status.data;

  return (
    <div className="flex flex-col gap-4">
      {error && <Notice tone="danger">{error}</Notice>}
      {rows.length === 0 ? (
        <EmptyState
          icon={FileText}
          title={t.syllabus.noSubjects}
          body={t.syllabus.noSubjectsBody}
        />
      ) : (
        <Card className="divide-y divide-border overflow-hidden">
          {rows.map((row) => (
            <div
              key={row.subjectId ?? row.openVersionId}
              className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">
                  {row.subjectName ?? t.syllabus.unknownSubject}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
                  {row.subjectCode && <span>{row.subjectCode}</span>}
                  {row.subjectId ? (
                    <StatePill row={row} />
                  ) : (
                    <StatusPill tone="warning">{t.syllabus.waitingSubject}</StatusPill>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {row.openVersionId && (
                  <ButtonLink size="sm" href={`/admin/syllabus/versions/${row.openVersionId}`}>
                    {t.syllabus.openDraft}
                  </ButtonLink>
                )}
                {row.state === "PUBLISHED" && row.subjectId && (
                  <ButtonLink
                    size="sm"
                    variant="secondary"
                    href={`/admin/syllabus/subjects/${row.subjectId}`}
                  >
                    {t.syllabus.openLive}
                  </ButtonLink>
                )}
                {row.state === "NONE" && row.subjectId && (
                  <>
                    <PdfButton
                      variant="primary"
                      target={{ subjectId: row.subjectId }}
                      label={t.syllabus.upload}
                      onError={setError}
                      onUploaded={async (fileId) => {
                        setError(null);
                        opened(
                          await api<SyllabusVersionView>(
                            `/subjects/${row.subjectId}/syllabus/drafts`,
                            {
                              body: { fileId },
                            },
                          ),
                        );
                      }}
                    />
                    <Button size="sm" variant="secondary" onClick={() => setCopying(row)}>
                      <Copy aria-hidden className="size-4" />
                      {t.syllabus.copy}
                    </Button>
                  </>
                )}
              </div>
            </div>
          ))}
        </Card>
      )}
      <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
        <FilePlus2 aria-hidden className="hidden size-6 shrink-0 text-muted sm:block" />
        <div className="min-w-0 flex-1">
          <p className="font-medium">{t.syllabus.uploadNewSubject}</p>
          <p className="text-sm text-muted">{t.syllabus.uploadNewSubjectHint}</p>
        </div>
        <PdfButton
          target={{ semesterId: id }}
          label={t.syllabus.upload}
          onError={setError}
          onUploaded={async (fileId) => {
            setError(null);
            opened(
              await api<SyllabusVersionView>(`/semesters/${id}/syllabus-imports`, {
                body: { fileId },
              }),
            );
          }}
        />
      </Card>
      {copying?.subjectId && (
        <CopySheet
          option={option}
          row={copying}
          onClose={() => setCopying(null)}
          onCopied={opened}
        />
      )}
    </div>
  );
}

/** Subjects of the same program in other batches: the same code is listed first. */
function CopySheet({
  option,
  row,
  onClose,
  onCopied,
}: {
  option: SemesterOption;
  row: SyllabusStatusRow;
  onClose: () => void;
  onCopied: (version: SyllabusVersionView) => void;
}) {
  const toast = useToast();
  const { options } = useSemesterContext();
  const candidates = options
    .filter((o) => o.program.id === option.program.id && o.batch.id !== option.batch.id)
    .flatMap((o) =>
      o.subjects.map((s) => ({ subject: s, label: `${o.batch.name} · ${s.name} (${s.code})` })),
    )
    .sort(
      (x, y) =>
        Number(y.subject.code === row.subjectCode) - Number(x.subject.code === row.subjectCode),
    );
  const [from, setFrom] = useState(candidates[0]?.subject.id ?? "");
  const copy = useMutation({
    mutationFn: () =>
      api<SyllabusVersionView>(`/subjects/${row.subjectId}/syllabus/copy`, {
        body: { fromSubjectId: from },
      }),
    onSuccess: (version) => {
      toast(t.syllabus.copied);
      onCopied(version);
    },
  });
  return (
    <FormSheet
      open
      onClose={onClose}
      title={t.syllabus.copy}
      submitLabel={t.syllabus.copy}
      onSubmit={() => from && copy.mutate()}
      busy={copy.isPending}
      error={copy.error ? errorMessage(copy.error) : null}
    >
      <p className="text-muted">{t.syllabus.copyLead}</p>
      {candidates.length === 0 ? (
        <p>{t.syllabus.copyNone}</p>
      ) : (
        <Field label={t.syllabus.copyFrom}>
          {(p) => (
            <Select {...p} value={from} onChange={(e) => setFrom(e.target.value)}>
              {candidates.map((c) => (
                <option key={c.subject.id} value={c.subject.id}>
                  {c.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
      )}
    </FormSheet>
  );
}
