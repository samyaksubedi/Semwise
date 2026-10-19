"use client";

import type {
  ImportResult,
  InviteProgress,
  ProgramView,
  StudentView,
  TeacherView,
} from "@semwise/shared";
import { MAX_CRS_PER_SECTION } from "@semwise/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronRight,
  FileUp,
  GraduationCap,
  Mail,
  Search,
  Star,
  UserPlus,
  Users,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { ConfirmSheet, FormSheet, Sheet } from "@/components/ui/sheet";
import { ErrorState, errorMessage } from "@/components/ui/states";
import {
  Card,
  EmptyState,
  ListSkeleton,
  Notice,
  PageHeader,
  ProgressBar,
  StatusPill,
} from "@/components/ui/surface";
import { Tabs } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";
import { ApiError, api } from "@/lib/api";
import { t } from "@/lib/strings";
import { keys, usePrograms, type SemesterOption } from "./queries";
import { WithSemester } from "./semester-picker";

const fieldOf = (error: unknown, path: string) =>
  error instanceof ApiError ? error.field(path) : undefined;
const formError = (error: unknown, fields: string[]) =>
  error && !fields.some((f) => fieldOf(error, f)) ? errorMessage(error) : null;

export function PeoplePage() {
  const [tab, setTab] = useState<"students" | "teachers">("students");
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t.people.title} lead={t.people.lead} />
      <Tabs
        label={t.people.title}
        value={tab}
        onChange={setTab}
        items={[
          { value: "students", label: t.people.tabStudents },
          { value: "teachers", label: t.people.tabTeachers },
        ]}
        className="max-w-sm"
      />
      {tab === "students" ? (
        <WithSemester>{(option) => <StudentsPanel option={option} />}</WithSemester>
      ) : (
        <TeachersPanel />
      )}
    </div>
  );
}

// ---------- Students ----------

function StudentsPanel({ option }: { option: SemesterOption }) {
  const semesterId = option.semester.id;
  const students = useQuery({
    queryKey: keys.students(semesterId),
    queryFn: () => api<StudentView[]>(`/semesters/${semesterId}/students`),
  });
  const progress = useQuery({
    queryKey: keys.inviteProgress(semesterId),
    queryFn: () => api<InviteProgress>(`/semesters/${semesterId}/students/invite-progress`),
    // While invitations are still going out, keep the numbers moving.
    refetchInterval: (q) => ((q.state.data?.queued ?? 0) > 0 ? 10_000 : false),
  });
  const [query, setQuery] = useState("");
  const [section, setSection] = useState("");
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [selected, setSelected] = useState<StudentView | null>(null);

  const sectionName = useMemo(
    () => new Map(option.sections.map((s) => [s.id, s.name])),
    [option.sections],
  );
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (students.data ?? []).filter(
      (s) =>
        (!section || s.sectionId === section) &&
        (!q ||
          s.email.includes(q) ||
          s.rollNo.toLowerCase().includes(q) ||
          (s.displayName ?? "").toLowerCase().includes(q)),
    );
  }, [students.data, query, section]);

  if (students.error)
    return <ErrorState error={students.error} onRetry={() => void students.refetch()} />;

  return (
    <div className="flex flex-col gap-4">
      {progress.data && progress.data.total > 0 && <InviteProgressCard progress={progress.data} />}

      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <div className="relative md:max-w-sm md:flex-1">
          <Search
            aria-hidden
            className="pointer-events-none absolute top-3 left-3 size-5 text-faint"
          />
          <Input
            type="search"
            aria-label={t.people.search}
            placeholder={t.people.search}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-10"
          />
        </div>
        <Select
          aria-label={t.people.section}
          value={section}
          onChange={(e) => setSection(e.target.value)}
          className="md:w-44"
        >
          <option value="">{t.people.allSections}</option>
          {option.sections.map((s) => (
            <option key={s.id} value={s.id}>
              {t.people.section} {s.name}
            </option>
          ))}
        </Select>
        <div className="flex gap-2 md:ml-auto">
          <Button
            variant="secondary"
            onClick={() => setImporting(true)}
            className="flex-1 md:flex-none"
          >
            <FileUp aria-hidden className="size-4" />
            {t.people.importCsv}
          </Button>
          <Button onClick={() => setAdding(true)} className="flex-1 md:flex-none">
            <UserPlus aria-hidden className="size-4" />
            {t.people.addStudent}
          </Button>
        </div>
      </div>

      {students.isPending ? (
        <ListSkeleton rows={5} />
      ) : students.data.length === 0 ? (
        <EmptyState
          icon={GraduationCap}
          title={t.people.noStudents}
          body={t.people.noStudentsBody}
        />
      ) : shown.length === 0 ? (
        <p className="py-6 text-center text-muted">{t.people.noMatches}</p>
      ) : (
        <Card className="divide-y divide-border overflow-hidden">
          {shown.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setSelected(s)}
              className="flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left transition-calm hover:bg-surface-2 md:grid md:grid-cols-[minmax(0,2fr)_8rem_6rem_auto_1.25rem]"
            >
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 truncate font-medium">
                  <span className="truncate">{s.displayName ?? s.email}</span>
                  {s.isCr && (
                    <StatusPill tone="accent" icon={Star}>
                      {t.people.cr}
                    </StatusPill>
                  )}
                </p>
                <p className="truncate text-sm text-muted">
                  {s.email}
                  <span className="md:hidden">
                    {" "}
                    · {s.rollNo} ·{" "}
                    {s.sectionId
                      ? `${t.people.section} ${sectionName.get(s.sectionId)}`
                      : t.people.notPlaced}
                  </span>
                </p>
              </div>
              <span className="hidden truncate text-sm md:block">{s.rollNo}</span>
              <span className="hidden text-sm md:block">
                {s.sectionId ? sectionName.get(s.sectionId) : t.people.notPlaced}
              </span>
              <StudentStatus student={s} />
              <ChevronRight aria-hidden className="size-5 shrink-0 text-faint" />
            </button>
          ))}
        </Card>
      )}

      <AddStudentSheet option={option} open={adding} onClose={() => setAdding(false)} />
      {importing && <ImportSheet semesterId={semesterId} onClose={() => setImporting(false)} />}
      {selected && (
        <StudentSheet
          student={selected}
          option={option}
          classmates={students.data ?? []}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

function StudentStatus({ student }: { student: StudentView }) {
  if (student.status === "ACTIVE") return <StatusPill tone="success">{t.people.joined}</StatusPill>;
  if (student.status === "DEACTIVATED")
    return <StatusPill tone="neutral">{t.people.deactivated}</StatusPill>;
  return (
    <StatusPill tone={student.invite?.status === "FAILED" ? "danger" : "warning"} icon={Mail}>
      {t.people.invited}
    </StatusPill>
  );
}

function InviteProgressCard({ progress }: { progress: InviteProgress }) {
  const sent = progress.sent + progress.accepted;
  return (
    <Card className="flex flex-col gap-2 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-semibold">{t.people.progressTitle}</p>
        <p className="text-sm text-muted">
          {t.people.progressToday(progress.today.sent, progress.today.cap)}
        </p>
      </div>
      <ProgressBar value={sent} max={progress.total} label={t.people.progressTitle} />
      <p className="text-sm text-muted">
        {t.people.progressBody(sent, progress.total, progress.accepted)}
      </p>
      {progress.failed > 0 && (
        <p className="text-sm text-danger">{t.people.progressFailed(progress.failed)}</p>
      )}
    </Card>
  );
}

function useStudentChanged(semesterId: string) {
  const client = useQueryClient();
  return () => {
    void client.invalidateQueries({ queryKey: keys.students(semesterId) });
    void client.invalidateQueries({ queryKey: keys.inviteProgress(semesterId) });
  };
}

function AddStudentSheet({
  option,
  open,
  onClose,
}: {
  option: SemesterOption;
  open: boolean;
  onClose: () => void;
}) {
  const toast = useToast();
  const changed = useStudentChanged(option.semester.id);
  const [form, setForm] = useState({ email: "", rollNo: "", displayName: "", sectionId: "" });
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));
  const add = useMutation({
    mutationFn: () =>
      api(`/semesters/${option.semester.id}/students`, {
        body: {
          email: form.email,
          rollNo: form.rollNo,
          sectionId: form.sectionId || option.sections[0]?.id,
          ...(form.displayName.trim() ? { displayName: form.displayName.trim() } : {}),
        },
      }),
    onSuccess: () => {
      changed();
      toast(t.people.added);
      setForm({ email: "", rollNo: "", displayName: "", sectionId: form.sectionId });
      onClose();
    },
  });
  const fields = ["email", "rollNo", "displayName", "sectionId"];
  return (
    <FormSheet
      open={open}
      onClose={onClose}
      title={t.people.addStudent}
      submitLabel={t.structure.sendInvite}
      onSubmit={() => add.mutate()}
      busy={add.isPending}
      error={formError(add.error, fields)}
    >
      <Field label={t.people.email} error={fieldOf(add.error, "email")}>
        {(p) => (
          <Input {...p} type="email" inputMode="email" value={form.email} onChange={set("email")} />
        )}
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t.people.rollNo} error={fieldOf(add.error, "rollNo")}>
          {(p) => (
            <Input {...p} value={form.rollNo} onChange={set("rollNo")} className="uppercase" />
          )}
        </Field>
        <Field label={t.people.section} error={fieldOf(add.error, "sectionId")}>
          {(p) => (
            <Select
              {...p}
              value={form.sectionId || option.sections[0]?.id}
              onChange={set("sectionId")}
            >
              {option.sections.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      <Field label={t.people.name} optional error={fieldOf(add.error, "displayName")}>
        {(p) => (
          <Input {...p} autoComplete="off" value={form.displayName} onChange={set("displayName")} />
        )}
      </Field>
    </FormSheet>
  );
}

function ImportSheet({ semesterId, onClose }: { semesterId: string; onClose: () => void }) {
  const toast = useToast();
  const changed = useStudentChanged(semesterId);
  const [csv, setCsv] = useState("");
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const check = useMutation({
    mutationFn: () =>
      api<ImportResult>(`/semesters/${semesterId}/students/import/preview`, { body: { csv } }),
    onSuccess: setPreview,
  });
  const run = useMutation({
    mutationFn: () =>
      api<ImportResult>(`/semesters/${semesterId}/students/import`, { body: { csv } }),
    onSuccess: (result) => {
      changed();
      toast(t.people.imported(result.counts.ok));
      onClose();
    },
  });
  const readFile = async (file: File | undefined) => {
    if (!file) return;
    setCsv(await file.text());
    setPreview(null);
  };
  const problems = preview?.rows.filter((r) => r.status !== "ok") ?? [];
  return (
    <Sheet
      open
      onClose={onClose}
      title={t.people.importTitle}
      wide
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t.common.cancel}
          </Button>
          {preview && preview.counts.ok > 0 ? (
            <Button loading={run.isPending} onClick={() => run.mutate()}>
              {t.people.importRun(preview.counts.ok)}
            </Button>
          ) : (
            <Button loading={check.isPending} disabled={!csv.trim()} onClick={() => check.mutate()}>
              {t.people.preview}
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-muted">{t.people.importLead}</p>
        {(check.error || run.error) && (
          <Notice tone="danger">{errorMessage(check.error ?? run.error)}</Notice>
        )}
        <label className="flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-control border border-dashed border-border-strong px-4 py-3 text-[15px] font-medium text-accent hover:bg-accent-soft">
          <FileUp aria-hidden className="size-5" />
          {t.people.importFile}
          <input
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            onChange={(e) => void readFile(e.target.files?.[0])}
          />
        </label>
        <Field label={t.people.importPaste}>
          {(p) => (
            <Textarea
              {...p}
              value={csv}
              onChange={(e) => {
                setCsv(e.target.value);
                setPreview(null);
              }}
              placeholder={t.people.importExample}
              className="min-h-36 font-mono text-sm"
              spellCheck={false}
            />
          )}
        </Field>
        {preview && (
          <div className="flex flex-col gap-2">
            <Notice tone={preview.counts.error ? "warning" : "success"}>
              {t.people.previewCounts(
                preview.counts.ok,
                preview.counts.error,
                preview.counts.skipped,
              )}
            </Notice>
            {problems.length > 0 && (
              <ul className="flex flex-col divide-y divide-border rounded-card border border-border">
                {problems.map((row) => (
                  <li key={row.line} className="px-3 py-2.5 text-sm">
                    <p className="font-medium">
                      {t.people.rowLine(row.line)} · {row.email || row.rollNo || "—"}
                    </p>
                    <p className={row.status === "error" ? "text-danger" : "text-muted"}>
                      {row.messages.join("; ")}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </Sheet>
  );
}

function StudentSheet({
  student,
  option,
  classmates,
  onClose,
}: {
  student: StudentView;
  option: SemesterOption;
  classmates: StudentView[];
  onClose: () => void;
}) {
  const toast = useToast();
  const changed = useStudentChanged(option.semester.id);
  const [section, setSection] = useState(student.sectionId ?? option.sections[0]?.id ?? "");
  const [confirming, setConfirming] = useState(false);
  const [crFull, setCrFull] = useState(false);
  const done = (message: string) => {
    changed();
    toast(message);
    onClose();
  };
  const action = useMutation({
    mutationFn: async (
      kind: "resend" | "revoke" | "move" | "cr" | "uncr" | "deactivate" | `replace:${string}`,
    ) => {
      const sectionId = student.sectionId;
      switch (kind) {
        case "resend":
          return api(`/students/${student.id}/resend-invite`, { method: "POST" });
        case "revoke":
          return api(`/students/${student.id}/revoke-invite`, { method: "POST" });
        case "move":
          return api(`/students/${student.id}/enrollments/${option.semester.id}`, {
            method: "PUT",
            body: { sectionId: section },
          });
        case "cr":
          return api(`/sections/${sectionId}/cr`, { body: { studentId: student.id } });
        case "uncr":
          return api(`/sections/${sectionId}/cr/${student.id}`, { method: "DELETE" });
        case "deactivate":
          return api(`/students/${student.id}/deactivate`, { method: "POST" });
        default:
          return api(`/sections/${sectionId}/cr`, {
            body: { studentId: student.id, replaceStudentId: kind.slice("replace:".length) },
          });
      }
    },
    onSuccess: (_data, kind) => {
      const messages: Record<string, string> = {
        resend: t.people.resent,
        revoke: t.people.revoked,
        move: t.people.moved,
        cr: t.people.crGranted,
        uncr: t.people.crRemoved,
        deactivate: t.people.deactivated2,
      };
      done(messages[kind] ?? t.people.crGranted);
    },
    onError: (err, kind) => {
      // CONFLICT is "the section is full"; other 409s (not joined, other section) are shown as is.
      if (kind === "cr" && err instanceof ApiError && err.code === "CONFLICT") setCrFull(true);
    },
  });
  const otherCrs = classmates.filter(
    (c) => c.isCr && c.sectionId === student.sectionId && c.id !== student.id,
  );
  const name = student.displayName ?? student.email;
  const busy = action.isPending;

  return (
    <Sheet open onClose={onClose} title={name}>
      <div className="flex flex-col gap-5">
        <div className="text-[15px]">
          <p className="text-muted">{student.email}</p>
          <p className="mt-1 flex flex-wrap items-center gap-2">
            <span>{student.rollNo}</span>
            <StudentStatus student={student} />
            {student.isCr && (
              <StatusPill tone="accent" icon={Star}>
                {t.people.cr}
              </StatusPill>
            )}
          </p>
        </div>
        {action.error && !crFull && <Notice tone="danger">{errorMessage(action.error)}</Notice>}

        {student.status === "INVITED" && (
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" disabled={busy} onClick={() => action.mutate("resend")}>
              {t.people.resend}
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => action.mutate("revoke")}>
              {t.people.revoke}
            </Button>
          </div>
        )}

        {student.status !== "DEACTIVATED" && option.sections.length > 1 && (
          <div className="flex items-end gap-2">
            <Field label={t.people.move} className="flex-1">
              {(p) => (
                <Select {...p} value={section} onChange={(e) => setSection(e.target.value)}>
                  {option.sections.map((s) => (
                    <option key={s.id} value={s.id}>
                      {t.people.section} {s.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Button
              variant="secondary"
              disabled={busy || section === student.sectionId}
              onClick={() => action.mutate("move")}
            >
              {t.common.save}
            </Button>
          </div>
        )}

        {student.status === "ACTIVE" && student.sectionId && (
          <div>
            {student.isCr ? (
              <Button variant="secondary" disabled={busy} onClick={() => action.mutate("uncr")}>
                {t.people.removeCr}
              </Button>
            ) : (
              <Button variant="secondary" disabled={busy} onClick={() => action.mutate("cr")}>
                <Star aria-hidden className="size-4" />
                {t.people.makeCr}
              </Button>
            )}
            {crFull && (
              <div className="mt-3 flex flex-col gap-2">
                <Notice tone="warning">{t.people.crFull(MAX_CRS_PER_SECTION)}</Notice>
                {otherCrs.map((c) => (
                  <div
                    key={c.id}
                    className="flex items-center justify-between gap-2 rounded-control border border-border px-3 py-2"
                  >
                    <span className="truncate">{c.displayName ?? c.email}</span>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy}
                      aria-label={t.people.replaceCrNamed(c.displayName ?? c.email)}
                      onClick={() => action.mutate(`replace:${c.id}`)}
                    >
                      {t.people.replaceCr}
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {student.status !== "DEACTIVATED" && (
          <div className="border-t border-border pt-4">
            <Button variant="quietDanger" onClick={() => setConfirming(true)}>
              {t.people.deactivate}
            </Button>
          </div>
        )}
      </div>
      <ConfirmSheet
        open={confirming}
        onClose={() => setConfirming(false)}
        title={t.people.deactivateTitle(name)}
        body={t.people.deactivateBody}
        confirmLabel={t.people.deactivate}
        busy={busy}
        onConfirm={() => action.mutate("deactivate")}
      />
    </Sheet>
  );
}

// ---------- Teachers ----------

function TeachersPanel() {
  const client = useQueryClient();
  const toast = useToast();
  const teachers = useQuery({
    queryKey: keys.teachers,
    queryFn: () => api<TeacherView[]>("/teachers"),
  });
  const programs = usePrograms();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ email: "", displayName: "", programId: "" });
  const programId = form.programId || programs.data?.[0]?.id || "";
  const invite = useMutation({
    mutationFn: () =>
      api("/teachers/invite", {
        body: {
          email: form.email,
          programId,
          ...(form.displayName.trim() ? { displayName: form.displayName.trim() } : {}),
        },
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: keys.teachers });
      toast(t.people.teacherInvited);
      setForm({ email: "", displayName: "", programId: form.programId });
      setOpen(false);
    },
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-muted">{t.people.teachersLead}</p>
        <Button onClick={() => setOpen(true)}>
          <UserPlus aria-hidden className="size-4" />
          {t.people.inviteTeacher}
        </Button>
      </div>
      {teachers.error ? (
        <ErrorState error={teachers.error} onRetry={() => void teachers.refetch()} />
      ) : teachers.isPending ? (
        <ListSkeleton rows={3} />
      ) : teachers.data.length === 0 ? (
        <EmptyState icon={Users} title={t.people.noTeachers} body={t.people.noTeachersBody} />
      ) : (
        <Card className="divide-y divide-border">
          {teachers.data.map((teacher) => (
            <div key={teacher.email} className="flex min-h-14 items-center gap-3 px-4 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{teacher.displayName ?? teacher.email}</p>
                <p className="truncate text-sm text-muted">{teacher.email}</p>
              </div>
              {teacher.status === "ACTIVE" ? (
                <StatusPill tone="success">{t.people.joined}</StatusPill>
              ) : (
                <StatusPill tone="warning" icon={Mail}>
                  {t.people.pending}
                </StatusPill>
              )}
            </div>
          ))}
        </Card>
      )}
      <FormSheet
        open={open}
        onClose={() => setOpen(false)}
        title={t.people.inviteTeacher}
        submitLabel={t.structure.sendInvite}
        onSubmit={() => invite.mutate()}
        busy={invite.isPending}
        error={formError(invite.error, ["email", "programId"])}
      >
        <Field label={t.people.email} error={fieldOf(invite.error, "email")}>
          {(p) => (
            <Input
              {...p}
              type="email"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            />
          )}
        </Field>
        <Field label={t.people.name} optional>
          {(p) => (
            <Input
              {...p}
              value={form.displayName}
              onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))}
            />
          )}
        </Field>
        <Field label={t.people.program} error={fieldOf(invite.error, "programId")}>
          {(p) => (
            <Select
              {...p}
              value={programId}
              onChange={(e) => setForm((f) => ({ ...f, programId: e.target.value }))}
            >
              {(programs.data ?? []).map((program: ProgramView) => (
                <option key={program.id} value={program.id}>
                  {program.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </FormSheet>
    </div>
  );
}
