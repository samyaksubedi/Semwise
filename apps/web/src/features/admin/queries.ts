"use client";

import type {
  BatchTreeView,
  BatchView,
  ProgramView,
  SectionView,
  SemesterView,
  SubjectView,
} from "@semwise/shared";
import { useQueries, useQuery } from "@tanstack/react-query";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";
import { api } from "@/lib/api";

export const keys = {
  programs: ["programs"] as const,
  batches: (programId: string) => ["batches", programId] as const,
  tree: (batchId: string) => ["batch-tree", batchId] as const,
  programAdmins: (programId: string) => ["program-admins", programId] as const,
  students: (semesterId: string) => ["students", semesterId] as const,
  inviteProgress: (semesterId: string) => ["invite-progress", semesterId] as const,
  classes: (semesterId: string) => ["classes", semesterId] as const,
  teachers: ["teachers"] as const,
  approvalSettings: (programId: string) => ["approval-settings", programId] as const,
  college: ["college"] as const,
  syllabusStatus: (semesterId: string) => ["syllabus-status", semesterId] as const,
};

export function usePrograms() {
  return useQuery({ queryKey: keys.programs, queryFn: () => api<ProgramView[]>("/programs") });
}

export function useBatches(programId: string | undefined) {
  return useQuery({
    queryKey: keys.batches(programId ?? ""),
    queryFn: () => api<BatchView[]>(`/programs/${programId}/batches`),
    enabled: Boolean(programId),
  });
}

export function useBatchTree(batchId: string | undefined) {
  return useQuery({
    queryKey: keys.tree(batchId ?? ""),
    queryFn: () => api<BatchTreeView>(`/batches/${batchId}/tree`),
    enabled: Boolean(batchId),
  });
}

export interface SemesterOption {
  semester: SemesterView;
  program: ProgramView;
  batch: BatchView;
  sections: SectionView[];
  subjects: SubjectView[];
  label: string;
}

const REMEMBER = "semwise-semester";

function remembered(): string | null {
  try {
    return localStorage.getItem(REMEMBER);
  } catch {
    return null;
  }
}

/**
 * The semester the admin screens work on: from `?semester=`, else the last one used, else the
 * first active one. Every semester the admin can see is listed for the picker.
 */
export function useSemesterContext() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const programs = usePrograms();
  const batchLists = useQueries({
    queries: (programs.data ?? []).map((p) => ({
      queryKey: keys.batches(p.id),
      queryFn: () => api<BatchView[]>(`/programs/${p.id}/batches`),
    })),
  });
  const batches = batchLists.flatMap((q) => q.data ?? []);
  const trees = useQueries({
    queries: batches.map((b) => ({
      queryKey: keys.tree(b.id),
      queryFn: () => api<BatchTreeView>(`/batches/${b.id}/tree`),
    })),
  });

  const options = useMemo(() => {
    const list: SemesterOption[] = [];
    for (const tree of trees) {
      const batch = tree.data;
      if (!batch) continue;
      const program = programs.data?.find((p) => p.id === batch.programId);
      if (!program) continue;
      for (const s of batch.semesters) {
        list.push({
          semester: s,
          program,
          batch,
          sections: s.sections,
          subjects: s.subjects,
          label: `${program.code} · ${batch.name} · Semester ${s.number}`,
        });
      }
    }
    const rank = { ACTIVE: 0, UPCOMING: 1, COMPLETED: 2 } as const;
    return list.sort(
      (x, y) => rank[x.semester.status] - rank[y.semester.status] || x.label.localeCompare(y.label),
    );
  }, [trees, programs.data]);

  const wanted = params.get("semester") ?? remembered();
  const current = options.find((o) => o.semester.id === wanted) ?? options[0] ?? null;

  const choose = useCallback(
    (semesterId: string) => {
      try {
        localStorage.setItem(REMEMBER, semesterId);
      } catch {
        // Not remembered; the URL still carries it.
      }
      const next = new URLSearchParams(params);
      next.set("semester", semesterId);
      router.replace(`${pathname}?${next.toString()}`);
    },
    [params, pathname, router],
  );

  const isPending =
    programs.isPending || batchLists.some((q) => q.isPending) || trees.some((q) => q.isPending);
  const error =
    programs.error ?? batchLists.find((q) => q.error)?.error ?? trees.find((q) => q.error)?.error;
  return { options, current, choose, isPending, error, refetch: programs.refetch };
}
