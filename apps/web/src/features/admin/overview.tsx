"use client";

import type { ApprovalItem, SyllabusStatusRow } from "@semwise/shared";
import { useQuery } from "@tanstack/react-query";
import { CheckCheck, FileText, GitFork, LayoutGrid, Users } from "lucide-react";
import Link from "next/link";
import { ButtonLink } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/states";
import {
  Card,
  EmptyState,
  ListSkeleton,
  PageHeader,
  ProgressBar,
  StatusPill,
} from "@/components/ui/surface";
import { api } from "@/lib/api";
import { activeCollege, useSession } from "@/lib/session";
import { t } from "@/lib/strings";
import { keys, useSemesterContext, type SemesterOption } from "./queries";

export function OverviewPage() {
  const { data: session } = useSession();
  const { options, isPending, error, refetch } = useSemesterContext();
  const approvals = useQuery({
    queryKey: ["approvals"],
    queryFn: () => api<ApprovalItem[]>("/approvals"),
  });
  const active = options.filter((o) => o.semester.status === "ACTIVE");
  const waiting = approvals.data?.length ?? 0;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t.nav.overview}
        lead={t.admin.overviewLead(activeCollege(session)?.name ?? "")}
      />
      {waiting > 0 && (
        <Card className="flex items-center gap-4 p-4">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-warning-soft text-warning">
            <CheckCheck aria-hidden className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold">{t.admin.waiting}</p>
            <p className="text-sm text-muted">{t.admin.waitingBody(waiting)}</p>
          </div>
        </Card>
      )}
      {error ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : isPending ? (
        <ListSkeleton rows={2} />
      ) : options.length === 0 ? (
        <EmptyState
          icon={GitFork}
          title={t.admin.noProgramsTitle}
          body={t.admin.noSemesterBody}
          action={<ButtonLink href="/admin/structure">{t.nav.structure}</ButtonLink>}
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {(active.length ? active : options.slice(0, 2)).map((o) => (
            <SemesterCard key={o.semester.id} option={o} />
          ))}
        </div>
      )}
    </div>
  );
}

function SemesterCard({ option }: { option: SemesterOption }) {
  const id = option.semester.id;
  const status = useQuery({
    queryKey: keys.syllabusStatus(id),
    queryFn: () => api<SyllabusStatusRow[]>(`/semesters/${id}/syllabus-status`),
  });
  const subjects = (status.data ?? []).filter((r) => r.subjectId);
  const published = subjects.filter((r) => r.state === "PUBLISHED").length;
  const link = (path: string) => `${path}?semester=${id}`;
  return (
    <Card className="flex flex-col gap-4 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-semibold">{option.label}</p>
          <p className="text-sm text-muted">
            {t.admin.sections(option.sections.length)} · {t.admin.subjects(option.subjects.length)}
          </p>
        </div>
        {option.semester.status === "ACTIVE" && (
          <StatusPill tone="success">{t.structure.statusActive}</StatusPill>
        )}
      </div>
      {subjects.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <p className="text-sm">{t.admin.syllabiPublished(published, subjects.length)}</p>
          <ProgressBar value={published} max={subjects.length} label={t.nav.syllabus} />
        </div>
      )}
      <div className="grid grid-cols-3 gap-2">
        {[
          { href: link("/admin/students"), label: t.admin.quickStudents, icon: Users },
          { href: link("/admin/syllabus"), label: t.admin.quickSyllabus, icon: FileText },
          { href: link("/admin/classes"), label: t.admin.quickClasses, icon: LayoutGrid },
        ].map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className="flex h-16 flex-col items-center justify-center gap-1 rounded-control border border-border text-sm font-medium text-muted transition-calm hover:border-border-strong hover:text-text"
          >
            <Icon aria-hidden className="size-5" />
            {label}
          </Link>
        ))}
      </div>
    </Card>
  );
}
