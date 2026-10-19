"use client";

import type { BatchView, ProgramAdminView, ProgramView, SemesterView } from "@semwise/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronLeft,
  ChevronRight,
  GitFork,
  Layers,
  Pencil,
  Plus,
  UserMinus,
  UserPlus,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button, IconButton } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { ConfirmSheet, FormSheet } from "@/components/ui/sheet";
import { ErrorState, errorMessage } from "@/components/ui/states";
import {
  Card,
  EmptyState,
  ListSkeleton,
  PageHeader,
  SectionTitle,
  StatusPill,
  type Tone,
} from "@/components/ui/surface";
import { useToast } from "@/components/ui/toast";
import { ApiError, api } from "@/lib/api";
import { formatDay } from "@/lib/format";
import { useSession } from "@/lib/session";
import { t } from "@/lib/strings";
import { keys, useBatchTree, useBatches, usePrograms } from "./queries";

const fieldOf = (error: unknown, path: string) =>
  error instanceof ApiError ? error.field(path) : undefined;

/** Only the API's general message when no field took it. */
const formError = (error: unknown, fields: string[]) =>
  error && !fields.some((f) => fieldOf(error, f)) ? errorMessage(error) : null;

function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="mb-2 -ml-1 inline-flex h-9 items-center gap-1 rounded-control px-1 text-sm text-muted hover:text-text"
    >
      <ChevronLeft aria-hidden className="size-4" />
      {label}
    </Link>
  );
}

function RowLink({
  href,
  title,
  meta,
  aside,
}: {
  href: string;
  title: string;
  meta?: string;
  aside?: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="flex min-h-16 items-center gap-3 px-4 py-3 transition-calm hover:bg-surface-2"
    >
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{title}</p>
        {meta && <p className="truncate text-sm text-muted">{meta}</p>}
      </div>
      {aside}
      <ChevronRight aria-hidden className="size-5 shrink-0 text-faint" />
    </Link>
  );
}

// ---------- Programs ----------

export function ProgramsPage() {
  const programs = usePrograms();
  const { data: session } = useSession();
  const isUa = session?.roles.some((r) => r.role === "UNIVERSITY_ADMIN") ?? false;
  const [open, setOpen] = useState(false);
  return (
    <div>
      <PageHeader
        title={t.structure.title}
        lead={t.structure.lead}
        actions={
          isUa && (
            <Button onClick={() => setOpen(true)}>
              <Plus aria-hidden className="size-4" />
              {t.structure.newProgram}
            </Button>
          )
        }
      />
      {programs.error ? (
        <ErrorState error={programs.error} onRetry={() => void programs.refetch()} />
      ) : programs.isPending ? (
        <ListSkeleton rows={3} />
      ) : programs.data.length === 0 ? (
        <EmptyState icon={GitFork} title={t.admin.noProgramsTitle} body={t.admin.noProgramsBody} />
      ) : (
        <Card className="divide-y divide-border overflow-hidden">
          {programs.data.map((p) => (
            <RowLink
              key={p.id}
              href={`/admin/structure/programs/${p.id}`}
              title={p.name}
              meta={p.code}
              aside={p.status === "ARCHIVED" && <StatusPill>{t.structure.archived}</StatusPill>}
            />
          ))}
        </Card>
      )}
      <NewProgramSheet open={open} onClose={() => setOpen(false)} />
    </div>
  );
}

function NewProgramSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const client = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const create = useMutation({
    mutationFn: () => api<ProgramView>("/programs", { body: { name, code } }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: keys.programs });
      toast(t.structure.created(name));
      setName("");
      setCode("");
      onClose();
    },
  });
  return (
    <FormSheet
      open={open}
      onClose={onClose}
      title={t.structure.newProgram}
      submitLabel={t.common.create}
      onSubmit={() => create.mutate()}
      busy={create.isPending}
      error={formError(create.error, ["name", "code"])}
    >
      <Field label={t.structure.programName} error={fieldOf(create.error, "name")}>
        {(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} />}
      </Field>
      <Field
        label={t.structure.programCode}
        hint={t.structure.programCodeHint}
        error={fieldOf(create.error, "code")}
      >
        {(p) => (
          <Input
            {...p}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="uppercase"
          />
        )}
      </Field>
    </FormSheet>
  );
}

// ---------- One program: batches and admins ----------

export function ProgramPage({ id }: { id: string }) {
  const program = useQuery({
    queryKey: ["program", id],
    queryFn: () => api<ProgramView>(`/programs/${id}`),
  });
  const batches = useBatches(id);
  const { data: session } = useSession();
  const isUa = session?.roles.some((r) => r.role === "UNIVERSITY_ADMIN") ?? false;
  const [open, setOpen] = useState(false);

  if (program.error)
    return <ErrorState error={program.error} onRetry={() => void program.refetch()} />;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        back={<BackLink href="/admin/structure" label={t.structure.title} />}
        title={program.data?.name ?? t.common.loading}
        lead={program.data?.code}
      />
      <section>
        <SectionTitle
          aside={
            <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
              <Plus aria-hidden className="size-4" />
              {t.structure.newBatch}
            </Button>
          }
        >
          {t.structure.batches}
        </SectionTitle>
        {batches.error ? (
          <ErrorState error={batches.error} onRetry={() => void batches.refetch()} />
        ) : batches.isPending ? (
          <ListSkeleton rows={2} />
        ) : batches.data.length === 0 ? (
          <EmptyState
            icon={Layers}
            title={t.structure.noBatches}
            body={t.structure.noBatchesBody}
          />
        ) : (
          <Card className="divide-y divide-border overflow-hidden">
            {batches.data.map((b) => (
              <RowLink
                key={b.id}
                href={`/admin/structure/batches/${b.id}`}
                title={b.name}
                meta={String(b.intakeYear)}
                aside={b.status === "ARCHIVED" && <StatusPill>{t.structure.archived}</StatusPill>}
              />
            ))}
          </Card>
        )}
      </section>
      {isUa && <ProgramAdmins programId={id} />}
      <NewBatchSheet programId={id} open={open} onClose={() => setOpen(false)} />
    </div>
  );
}

function NewBatchSheet({
  programId,
  open,
  onClose,
}: {
  programId: string;
  open: boolean;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState("");
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const create = useMutation({
    mutationFn: () =>
      api<BatchView>(`/programs/${programId}/batches`, {
        body: { name, intakeYear: Number(year) },
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: keys.batches(programId) });
      toast(t.structure.created(name));
      setName("");
      onClose();
    },
  });
  return (
    <FormSheet
      open={open}
      onClose={onClose}
      title={t.structure.newBatch}
      submitLabel={t.common.create}
      onSubmit={() => create.mutate()}
      busy={create.isPending}
      error={formError(create.error, ["name", "intakeYear"])}
    >
      <Field
        label={t.structure.batchName}
        hint={t.structure.batchNameHint}
        error={fieldOf(create.error, "name")}
      >
        {(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} />}
      </Field>
      <Field label={t.structure.intakeYear} error={fieldOf(create.error, "intakeYear")}>
        {(p) => (
          <Input
            {...p}
            inputMode="numeric"
            value={year}
            onChange={(e) => setYear(e.target.value.replace(/\D/g, ""))}
          />
        )}
      </Field>
    </FormSheet>
  );
}

function ProgramAdmins({ programId }: { programId: string }) {
  const client = useQueryClient();
  const toast = useToast();
  const admins = useQuery({
    queryKey: keys.programAdmins(programId),
    queryFn: () => api<ProgramAdminView[]>(`/programs/${programId}/admins`),
  });
  const [inviting, setInviting] = useState(false);
  const [removing, setRemoving] = useState<ProgramAdminView | null>(null);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const invite = useMutation({
    mutationFn: () =>
      api(`/programs/${programId}/admins`, {
        body: { email, ...(name.trim() ? { displayName: name.trim() } : {}) },
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: keys.programAdmins(programId) });
      toast(t.people.teacherInvited);
      setEmail("");
      setName("");
      setInviting(false);
    },
  });
  const remove = useMutation({
    mutationFn: (userId: string) =>
      api(`/programs/${programId}/admins/${userId}`, { method: "DELETE" }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: keys.programAdmins(programId) });
      setRemoving(null);
    },
  });
  return (
    <section>
      <SectionTitle
        aside={
          <Button size="sm" variant="secondary" onClick={() => setInviting(true)}>
            <UserPlus aria-hidden className="size-4" />
            {t.structure.inviteAdmin}
          </Button>
        }
      >
        {t.structure.admins}
      </SectionTitle>
      {admins.error ? (
        <ErrorState error={admins.error} onRetry={() => void admins.refetch()} />
      ) : admins.isPending ? (
        <ListSkeleton rows={1} />
      ) : admins.data.length === 0 ? (
        <p className="text-muted">{t.structure.noAdmins}</p>
      ) : (
        <Card className="divide-y divide-border">
          {admins.data.map((a) => (
            <div key={a.userId} className="flex min-h-14 items-center gap-3 px-4 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{a.displayName}</p>
                <p className="truncate text-sm text-muted">{a.email}</p>
              </div>
              <IconButton label={t.common.remove} onClick={() => setRemoving(a)}>
                <UserMinus aria-hidden className="size-5" />
              </IconButton>
            </div>
          ))}
        </Card>
      )}
      <FormSheet
        open={inviting}
        onClose={() => setInviting(false)}
        title={t.structure.inviteAdmin}
        submitLabel={t.structure.sendInvite}
        onSubmit={() => invite.mutate()}
        busy={invite.isPending}
        error={formError(invite.error, ["email"])}
      >
        <Field label={t.people.email} error={fieldOf(invite.error, "email")}>
          {(p) => (
            <Input {...p} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          )}
        </Field>
        <Field label={t.people.name} optional>
          {(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} />}
        </Field>
      </FormSheet>
      <ConfirmSheet
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title={t.structure.removeAdmin(removing?.displayName ?? "")}
        body={t.structure.removeAdminBody}
        confirmLabel={t.common.remove}
        busy={remove.isPending}
        onConfirm={() => removing && remove.mutate(removing.userId)}
      />
    </section>
  );
}

// ---------- One batch: semesters, sections, subjects ----------

const SEMESTER_TONE: Record<SemesterView["status"], Tone> = {
  ACTIVE: "success",
  UPCOMING: "info",
  COMPLETED: "neutral",
};
const SEMESTER_LABEL: Record<SemesterView["status"], string> = {
  ACTIVE: t.structure.statusActive,
  UPCOMING: t.structure.statusUpcoming,
  COMPLETED: t.structure.statusCompleted,
};

type Adding =
  | { kind: "semester" }
  | { kind: "edit-semester"; semester: SemesterView }
  | { kind: "section"; semesterId: string }
  | { kind: "subject"; semesterId: string }
  | null;

export function BatchPage({ id }: { id: string }) {
  const tree = useBatchTree(id);
  const [adding, setAdding] = useState<Adding>(null);
  if (tree.error) return <ErrorState error={tree.error} onRetry={() => void tree.refetch()} />;
  const batch = tree.data;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        back={
          batch && (
            <BackLink
              href={`/admin/structure/programs/${batch.programId}`}
              label={t.structure.batches}
            />
          )
        }
        title={batch?.name ?? t.common.loading}
        lead={batch ? `${t.structure.intakeYear} ${batch.intakeYear}` : undefined}
        actions={
          <Button onClick={() => setAdding({ kind: "semester" })}>
            <Plus aria-hidden className="size-4" />
            {t.structure.newSemester}
          </Button>
        }
      />
      {tree.isPending ? (
        <ListSkeleton rows={2} />
      ) : batch!.semesters.length === 0 ? (
        <EmptyState
          icon={Layers}
          title={t.structure.noSemesters}
          body={t.structure.noSemestersBody}
        />
      ) : (
        batch!.semesters.map((s) => (
          <Card key={s.id} className="p-4">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold">
                {t.admin.semester} {s.number}
              </h2>
              <StatusPill tone={SEMESTER_TONE[s.status]}>{SEMESTER_LABEL[s.status]}</StatusPill>
              <span className="text-sm text-muted">
                {s.startDate && formatDay(s.startDate, undefined, true)}
                {s.endDate && ` – ${formatDay(s.endDate, undefined, true)}`}
              </span>
              <IconButton
                label={t.structure.editSemester}
                className="ml-auto"
                onClick={() => setAdding({ kind: "edit-semester", semester: s })}
              >
                <Pencil aria-hidden className="size-4" />
              </IconButton>
            </div>
            <div className="mt-4 grid gap-5 md:grid-cols-2">
              <div>
                <SectionTitle
                  aside={
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setAdding({ kind: "section", semesterId: s.id })}
                    >
                      <Plus aria-hidden className="size-4" />
                      {t.structure.addSection}
                    </Button>
                  }
                >
                  {t.structure.sectionsTitle}
                </SectionTitle>
                <div className="flex flex-wrap gap-2">
                  {s.sections.length === 0 && (
                    <span className="text-sm text-muted">{t.common.none}</span>
                  )}
                  {s.sections.map((sec) => (
                    <span
                      key={sec.id}
                      className="rounded-full border border-border px-3 py-1 text-sm font-medium"
                    >
                      {sec.name}
                    </span>
                  ))}
                </div>
              </div>
              <div>
                <SectionTitle
                  aside={
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setAdding({ kind: "subject", semesterId: s.id })}
                    >
                      <Plus aria-hidden className="size-4" />
                      {t.structure.addSubject}
                    </Button>
                  }
                >
                  {t.structure.subjectsTitle}
                </SectionTitle>
                <ul className="flex flex-col gap-1">
                  {s.subjects.length === 0 && (
                    <li className="text-sm text-muted">{t.common.none}</li>
                  )}
                  {s.subjects.map((sub) => (
                    <li
                      key={sub.id}
                      className="flex items-baseline justify-between gap-2 text-[15px]"
                    >
                      <span className="min-w-0 truncate">{sub.name}</span>
                      <span className="shrink-0 text-sm text-muted">
                        {sub.code}
                        {sub.credits !== null && ` · ${sub.credits} cr`}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </Card>
        ))
      )}
      {adding?.kind === "semester" || adding?.kind === "edit-semester" ? (
        <SemesterSheet
          batchId={id}
          semester={adding.kind === "edit-semester" ? adding.semester : null}
          nextNumber={(batch?.semesters.at(-1)?.number ?? 0) + 1}
          onClose={() => setAdding(null)}
        />
      ) : null}
      {adding?.kind === "section" && (
        <SectionSheet batchId={id} semesterId={adding.semesterId} onClose={() => setAdding(null)} />
      )}
      {adding?.kind === "subject" && (
        <SubjectSheet batchId={id} semesterId={adding.semesterId} onClose={() => setAdding(null)} />
      )}
    </div>
  );
}

function SemesterSheet({
  batchId,
  semester,
  nextNumber,
  onClose,
}: {
  batchId: string;
  semester: SemesterView | null;
  nextNumber: number;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const toast = useToast();
  const [number, setNumber] = useState(String(semester?.number ?? nextNumber));
  const [start, setStart] = useState(semester?.startDate ?? "");
  const [end, setEnd] = useState(semester?.endDate ?? "");
  const [status, setStatus] = useState<SemesterView["status"]>(semester?.status ?? "UPCOMING");
  const save = useMutation({
    mutationFn: () => {
      const body = {
        number: Number(number),
        startDate: start || null,
        endDate: end || null,
        status,
      };
      return semester
        ? api(`/semesters/${semester.id}`, { method: "PATCH", body })
        : api(`/batches/${batchId}/semesters`, { body });
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: keys.tree(batchId) });
      toast(semester ? t.structure.saved : t.structure.created(`${t.admin.semester} ${number}`));
      onClose();
    },
  });
  return (
    <FormSheet
      open
      onClose={onClose}
      title={semester ? t.structure.editSemester : t.structure.newSemester}
      submitLabel={semester ? t.common.save : t.common.create}
      onSubmit={() => save.mutate()}
      busy={save.isPending}
      error={formError(save.error, ["number", "startDate", "endDate", "status"])}
    >
      <Field label={t.structure.semesterNumber} error={fieldOf(save.error, "number")}>
        {(p) => (
          <Input
            {...p}
            inputMode="numeric"
            value={number}
            onChange={(e) => setNumber(e.target.value.replace(/\D/g, ""))}
          />
        )}
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t.structure.startDate} optional error={fieldOf(save.error, "startDate")}>
          {(p) => (
            <Input {...p} type="date" value={start} onChange={(e) => setStart(e.target.value)} />
          )}
        </Field>
        <Field label={t.structure.endDate} optional error={fieldOf(save.error, "endDate")}>
          {(p) => <Input {...p} type="date" value={end} onChange={(e) => setEnd(e.target.value)} />}
        </Field>
      </div>
      <Field label={t.structure.status} error={fieldOf(save.error, "status")}>
        {(p) => (
          <Select
            {...p}
            value={status}
            onChange={(e) => setStatus(e.target.value as SemesterView["status"])}
          >
            <option value="UPCOMING">{t.structure.statusUpcoming}</option>
            <option value="ACTIVE">{t.structure.statusActive}</option>
            <option value="COMPLETED">{t.structure.statusCompleted}</option>
          </Select>
        )}
      </Field>
    </FormSheet>
  );
}

function SectionSheet({
  batchId,
  semesterId,
  onClose,
}: {
  batchId: string;
  semesterId: string;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState("");
  const create = useMutation({
    mutationFn: () => api(`/semesters/${semesterId}/sections`, { body: { name } }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: keys.tree(batchId) });
      toast(t.structure.created(`${t.people.section} ${name}`));
      onClose();
    },
  });
  return (
    <FormSheet
      open
      onClose={onClose}
      title={t.structure.addSection}
      submitLabel={t.common.add}
      onSubmit={() => create.mutate()}
      busy={create.isPending}
      error={formError(create.error, ["name"])}
    >
      <Field
        label={t.structure.sectionName}
        hint={t.structure.sectionNameHint}
        error={fieldOf(create.error, "name")}
      >
        {(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} />}
      </Field>
    </FormSheet>
  );
}

function SubjectSheet({
  batchId,
  semesterId,
  onClose,
}: {
  batchId: string;
  semesterId: string;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [credits, setCredits] = useState("");
  const create = useMutation({
    mutationFn: () =>
      api(`/semesters/${semesterId}/subjects`, {
        body: { name, code, credits: credits ? Number(credits) : null },
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: keys.tree(batchId) });
      toast(t.structure.created(name));
      onClose();
    },
  });
  return (
    <FormSheet
      open
      onClose={onClose}
      title={t.structure.addSubject}
      submitLabel={t.common.add}
      onSubmit={() => create.mutate()}
      busy={create.isPending}
      error={formError(create.error, ["name", "code", "credits"])}
    >
      <Field label={t.structure.subjectName} error={fieldOf(create.error, "name")}>
        {(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} />}
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t.structure.subjectCode} error={fieldOf(create.error, "code")}>
          {(p) => (
            <Input
              {...p}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="uppercase"
            />
          )}
        </Field>
        <Field label={t.structure.credits} optional error={fieldOf(create.error, "credits")}>
          {(p) => (
            <Input
              {...p}
              inputMode="numeric"
              value={credits}
              onChange={(e) => setCredits(e.target.value.replace(/\D/g, ""))}
            />
          )}
        </Field>
      </div>
    </FormSheet>
  );
}
