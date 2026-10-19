"use client";

import type { ClassView, EntryTopicView, EntryView } from "@semwise/shared";
import { useQuery } from "@tanstack/react-query";
import { BookMarked, CircleSlash } from "lucide-react";
import { StatusPill, type Tone } from "@/components/ui/surface";
import { api } from "@/lib/api";
import { t } from "@/lib/strings";

export const entryKeys = {
  myClasses: ["classes", "mine"] as const,
  mine: ["entries", "mine"] as const,
  entry: (id: string) => ["entry", id] as const,
  classEntries: (classId: string) => ["class-entries", classId] as const,
  approvals: ["approvals"] as const,
};

export function useMyClasses() {
  return useQuery({
    queryKey: entryKeys.myClasses,
    queryFn: () => api<ClassView[]>("/classes/mine"),
  });
}

/** One status per entry, from the newest version the person may see. */
export function entryStatus(entry: EntryView): { tone: Tone; label: string } {
  if (entry.takenDown) return { tone: "neutral", label: t.entry.status.takenDown };
  const latest = entry.latest;
  if (latest) {
    if (latest.status === "PENDING") return { tone: "warning", label: t.entry.status.pending };
    if (latest.status === "DRAFT") return { tone: "info", label: t.entry.status.draft };
    if (latest.status === "REJECTED") return { tone: "danger", label: t.entry.status.rejected };
    if (latest.status === "APPROVED") return { tone: "info", label: t.entry.status.publishing };
  }
  if (entry.live?.unreviewed) return { tone: "success", label: t.entry.status.unreviewed };
  if (entry.live) return { tone: "success", label: t.entry.status.published };
  return { tone: "neutral", label: t.entry.status.withdrawn };
}

export function EntryStatus({ entry }: { entry: EntryView }) {
  const s = entryStatus(entry);
  return <StatusPill tone={s.tone}>{s.label}</StatusPill>;
}

/** Topics with a mark for whether each is in the syllabus (text and icon, not colour alone). */
export function TopicList({ topics }: { topics: EntryTopicView[] }) {
  return (
    <ul className="flex flex-col gap-2">
      {topics.map((topic, i) => (
        <li key={`${topic.title}-${i}`} className="flex gap-2.5">
          {topic.inSyllabus ? (
            <BookMarked aria-hidden className="mt-0.5 size-4 shrink-0 text-success" />
          ) : (
            <CircleSlash aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
          )}
          <div className="min-w-0">
            <p className="text-[15px] font-medium break-words">
              {topic.title}
              <span className="sr-only">
                {" "}
                ({topic.inSyllabus ? t.entry.inSyllabus : t.entry.notInSyllabus})
              </span>
            </p>
            {topic.subtopics.length > 0 && (
              <p className="text-sm text-muted break-words">{topic.subtopics.join(" · ")}</p>
            )}
            {!topic.inSyllabus && <p className="text-xs text-warning">{t.entry.notInSyllabus}</p>}
          </div>
        </li>
      ))}
    </ul>
  );
}
