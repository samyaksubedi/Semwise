"use client";

import type { CatchupView } from "@semwise/shared";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, MessageCircle } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ButtonLink } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { ErrorState } from "@/components/ui/states";
import { Card, EmptyState, ListSkeleton, PageHeader } from "@/components/ui/surface";
import { Tabs } from "@/components/ui/tabs";
import { TopicList } from "@/features/entries/shared";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { addDays, dayParts, formatDay, todayIn } from "@/lib/format";
import { useTimezone } from "@/lib/session";
import { t } from "@/lib/strings";

/** Days shown in the strip, newest at the right. */
const STRIP_DAYS = 21;

export function CatchupPage() {
  const tz = useTimezone();
  const today = todayIn(tz);
  const [mode, setMode] = useState<"day" | "range">("day");
  const [day, setDay] = useState(today);
  const [from, setFrom] = useState(addDays(today, -6));
  const [to, setTo] = useState(today);
  const range =
    mode === "day"
      ? { from: day, to: day }
      : { from: from <= to ? from : to, to: from <= to ? to : from };
  const view = useQuery({
    queryKey: ["catchup", range.from, range.to],
    queryFn: () => api<CatchupView>("/catchup", { query: range }),
  });

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5">
      <PageHeader title={t.catchup.title} lead={t.catchup.lead} />
      <Tabs
        label={t.catchup.title}
        value={mode}
        onChange={setMode}
        items={[
          { value: "day", label: t.catchup.singleDay },
          { value: "range", label: t.catchup.range },
        ]}
        className="max-w-xs"
      />
      {mode === "day" ? (
        <DateStrip today={today} selected={day} onSelect={setDay} />
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <Field label={t.catchup.from}>
            {(p) => (
              <Input
                {...p}
                type="date"
                max={today}
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            )}
          </Field>
          <Field label={t.catchup.to}>
            {(p) => (
              <Input
                {...p}
                type="date"
                max={today}
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            )}
          </Field>
        </div>
      )}

      {view.error ? (
        <ErrorState error={view.error} onRetry={() => void view.refetch()} />
      ) : view.isPending ? (
        <ListSkeleton rows={2} />
      ) : view.data.subjects.length === 0 ? (
        <EmptyState icon={CalendarDays} title={t.catchup.nothing} body={t.catchup.nothingBody} />
      ) : (
        <div className="flex flex-col gap-4">
          {view.data.subjects.map(({ subject, entries }) => (
            <Card key={subject.id} className="flex flex-col gap-4 p-4">
              <div className="flex items-baseline justify-between gap-2">
                <h2 className="text-lg font-semibold">{subject.name}</h2>
                <span className="shrink-0 text-sm text-muted">
                  {t.catchup.entries(entries.length)}
                </span>
              </div>
              {entries.map((e) => (
                <section
                  key={e.entryId}
                  className="flex flex-col gap-2 border-t border-border pt-3 first:border-t-0 first:pt-0"
                >
                  {mode === "range" && (
                    <p className="text-sm font-medium text-muted">{formatDay(e.taughtOn, today)}</p>
                  )}
                  {e.summary && <p className="text-[15px] text-pretty">{e.summary}</p>}
                  <TopicList topics={e.topics} />
                </section>
              ))}
              <ButtonLink
                variant="secondary"
                size="sm"
                className="self-start"
                href={`/chat?${new URLSearchParams({
                  ask: t.catchup.followUpText(
                    subject.name,
                    range.from === range.to
                      ? formatDay(range.from)
                      : `${formatDay(range.from)} – ${formatDay(range.to)}`,
                  ),
                  subject: subject.id,
                }).toString()}`}
              >
                <MessageCircle aria-hidden className="size-4" />
                {t.catchup.askFollowUp}
              </ButtonLink>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

/** Recent days in a strip that scrolls sideways (swipe on phones); today is at the right. */
function DateStrip({
  today,
  selected,
  onSelect,
}: {
  today: string;
  selected: string;
  onSelect: (day: string) => void;
}) {
  const days = useMemo(
    () => Array.from({ length: STRIP_DAYS }, (_, i) => addDays(today, i - STRIP_DAYS + 1)),
    [today],
  );
  const strip = useRef<HTMLDivElement>(null);
  // Start scrolled to the newest days.
  useEffect(() => {
    strip.current?.scrollTo({ left: strip.current.scrollWidth });
  }, []);
  return (
    <div
      ref={strip}
      role="radiogroup"
      aria-label={t.catchup.days}
      className="-mx-4 flex snap-x gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:px-0"
    >
      {days.map((d) => {
        const { weekday, date } = dayParts(d);
        const active = d === selected;
        return (
          <button
            key={d}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={formatDay(d, today, true)}
            onClick={() => onSelect(d)}
            className={cn(
              "flex h-16 w-14 shrink-0 snap-end flex-col items-center justify-center rounded-control border text-sm transition-calm",
              active
                ? "border-accent bg-accent text-on-accent"
                : "border-border bg-surface text-muted hover:border-border-strong hover:text-text",
            )}
          >
            <span className="text-xs">{d === today ? t.dates.today : weekday}</span>
            <span className="text-lg font-semibold">{date}</span>
          </button>
        );
      })}
    </div>
  );
}
