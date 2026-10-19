"use client";

import type { ClassView, TeacherView } from "@semwise/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LayoutGrid, Plus, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Select } from "@/components/ui/field";
import { FormSheet } from "@/components/ui/sheet";
import { ErrorState, errorMessage } from "@/components/ui/states";
import {
  Card,
  EmptyState,
  ListSkeleton,
  PageHeader,
  SectionTitle,
  StatusPill,
} from "@/components/ui/surface";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import { t } from "@/lib/strings";
import { keys, type SemesterOption } from "./queries";
import { WithSemester } from "./semester-picker";

export function ClassesPage() {
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t.classes.title} lead={t.classes.lead} />
      <WithSemester>{(option) => <ClassesPanel option={option} />}</WithSemester>
    </div>
  );
}

function ClassesPanel({ option }: { option: SemesterOption }) {
  const semesterId = option.semester.id;
  const classes = useQuery({
    queryKey: keys.classes(semesterId),
    queryFn: () => api<ClassView[]>(`/semesters/${semesterId}/classes`),
  });
  const [editing, setEditing] = useState<ClassView | "new" | null>(null);
  const bySection = useMemo(() => {
    const groups = new Map<string, ClassView[]>();
    for (const c of classes.data ?? [])
      groups.set(c.section.name, [...(groups.get(c.section.name) ?? []), c]);
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [classes.data]);

  if (classes.error)
    return <ErrorState error={classes.error} onRetry={() => void classes.refetch()} />;
  return (
    <div className="flex flex-col gap-5">
      <div>
        <Button onClick={() => setEditing("new")}>
          <Plus aria-hidden className="size-4" />
          {t.classes.newClass}
        </Button>
      </div>
      {classes.isPending ? (
        <ListSkeleton rows={3} />
      ) : classes.data.length === 0 ? (
        <EmptyState icon={LayoutGrid} title={t.classes.noClasses} body={t.classes.noClassesBody} />
      ) : (
        bySection.map(([section, list]) => (
          <section key={section}>
            <SectionTitle>{t.classes.sectionHeading(section)}</SectionTitle>
            <div className="grid gap-3 sm:grid-cols-2">
              {list.map((c) => (
                <Card key={c.id} className="flex flex-col gap-2 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{c.subject.name}</p>
                      <p className="text-sm text-muted">{c.subject.code}</p>
                    </div>
                    {c.status === "ARCHIVED" && <StatusPill>{t.classes.archived}</StatusPill>}
                  </div>
                  <p className="flex items-center gap-1.5 text-sm text-muted">
                    <Users aria-hidden className="size-4 shrink-0" />
                    <span className="truncate">
                      {c.teachers
                        .map((x) =>
                          x.isPrimary && c.teachers.length > 1
                            ? `${x.displayName} (${t.classes.primary})`
                            : x.displayName,
                        )
                        .join(", ") || t.common.none}
                    </span>
                  </p>
                  <div className="mt-1">
                    <Button size="sm" variant="secondary" onClick={() => setEditing(c)}>
                      {t.classes.editTeachers}
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          </section>
        ))
      )}
      {editing && (
        <ClassSheet
          option={option}
          existing={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function ClassSheet({
  option,
  existing,
  onClose,
}: {
  option: SemesterOption;
  existing: ClassView | null;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const toast = useToast();
  const teachers = useQuery({
    queryKey: keys.teachers,
    queryFn: () => api<TeacherView[]>("/teachers"),
  });
  const joined = (teachers.data ?? []).filter((x) => x.userId);
  const [subjectId, setSubjectId] = useState("");
  const [sectionId, setSectionId] = useState("");
  const [chosen, setChosen] = useState<string[]>(existing?.teachers.map((x) => x.userId) ?? []);
  const toggle = (id: string) =>
    setChosen((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]));

  const save = useMutation({
    mutationFn: () =>
      existing
        ? api(`/classes/${existing.id}/teachers`, {
            method: "PUT",
            body: { teacherUserIds: chosen },
          })
        : api("/classes", { body: { subjectId, sectionId, teacherUserIds: chosen } }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: keys.classes(option.semester.id) });
      toast(existing ? t.structure.saved : t.classes.created);
      onClose();
    },
  });
  const archive = useMutation({
    mutationFn: () =>
      api(`/classes/${existing!.id}`, {
        method: "PATCH",
        body: { status: existing!.status === "ACTIVE" ? "ARCHIVED" : "ACTIVE" },
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: keys.classes(option.semester.id) });
      onClose();
    },
  });
  // The API explains a refusal plainly (no published syllabus yet, class already exists).
  const error = save.error ? errorMessage(save.error) : null;

  return (
    <FormSheet
      open
      onClose={onClose}
      title={existing ? `${existing.subject.name} · ${existing.section.name}` : t.classes.newClass}
      submitLabel={existing ? t.common.save : t.common.create}
      onSubmit={() => save.mutate()}
      busy={save.isPending}
      error={error}
    >
      {!existing && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t.classes.subject}>
            {(p) => (
              <Select {...p} value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
                <option value="">{t.classes.chooseSubject}</option>
                {option.subjects.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.code})
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={t.classes.section}>
            {(p) => (
              <Select {...p} value={sectionId} onChange={(e) => setSectionId(e.target.value)}>
                <option value="">{t.classes.chooseSection}</option>
                {option.sections.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
      )}
      <fieldset>
        <legend className="text-sm font-medium">{t.classes.teachers}</legend>
        <p className="mb-1 text-sm text-muted">{t.classes.teachersHint}</p>
        {teachers.isPending ? (
          <ListSkeleton rows={2} />
        ) : joined.length === 0 ? (
          <p className="text-sm text-muted">{t.classes.noTeachersYet}</p>
        ) : (
          joined.map((x) => (
            <Checkbox
              key={x.userId}
              checked={chosen.includes(x.userId!)}
              onChange={() => toggle(x.userId!)}
              label={
                <>
                  {x.displayName ?? x.email}
                  {chosen[0] === x.userId && chosen.length > 1 && (
                    <span className="ml-1 text-sm text-muted">({t.classes.primary})</span>
                  )}
                </>
              }
            />
          ))
        )}
      </fieldset>
      {existing && (
        <div className="border-t border-border pt-4">
          <Button variant="ghost" loading={archive.isPending} onClick={() => archive.mutate()}>
            {existing.status === "ACTIVE" ? t.classes.archive : t.classes.restore}
          </Button>
        </div>
      )}
    </FormSheet>
  );
}
