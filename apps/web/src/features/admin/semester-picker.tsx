"use client";

import { CalendarRange } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { EmptyState, Skeleton } from "@/components/ui/surface";
import { ErrorState } from "@/components/ui/states";
import { t } from "@/lib/strings";
import { useSemesterContext, type SemesterOption } from "./queries";

const STATUS: Record<SemesterOption["semester"]["status"], string> = {
  ACTIVE: t.admin.semesterActive,
  UPCOMING: t.admin.semesterUpcoming,
  COMPLETED: t.admin.semesterCompleted,
};

/**
 * Renders the picker, then the page for the chosen semester. Pages that work on one semester
 * (students, syllabus, classes) are wrapped in it.
 */
export function WithSemester({
  children,
}: {
  children: (option: SemesterOption) => React.ReactNode;
}) {
  const { options, current, choose, isPending, error, refetch } = useSemesterContext();
  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />;
  if (isPending) return <Skeleton className="h-11 w-full max-w-md" />;
  if (!current) {
    return (
      <EmptyState
        icon={CalendarRange}
        title={t.admin.noSemesterTitle}
        body={t.admin.noSemesterBody}
        action={<ButtonLink href="/admin/structure">{t.nav.structure}</ButtonLink>}
      />
    );
  }
  return (
    <div className="flex flex-col gap-5">
      <label className="flex max-w-md flex-col gap-1.5">
        <span className="text-sm font-medium text-muted">{t.admin.semester}</span>
        <Select value={current.semester.id} onChange={(e) => choose(e.target.value)}>
          {options.map((o) => (
            <option key={o.semester.id} value={o.semester.id}>
              {o.label} ({STATUS[o.semester.status]})
            </option>
          ))}
        </Select>
      </label>
      {children(current)}
    </div>
  );
}
