"use client";

import { ENTRY_TEXT_MAX, type ClassView, type EntryView } from "@semwise/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, Mic, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { errorMessage } from "@/components/ui/states";
import { Card, Notice, Skeleton } from "@/components/ui/surface";
import { useToast } from "@/components/ui/toast";
import { ApiError, api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { todayIn } from "@/lib/format";
import { useTimezone } from "@/lib/session";
import { t } from "@/lib/strings";
import { clock, readMedia, useRecorder } from "./media";
import { EntryStatus, TopicList, entryKeys } from "./shared";

interface Draft {
  classId: string;
  taughtOn: string;
  text: string;
  /** The voice note or photo the text came from (CR only). */
  media: { kind: "VOICE" | "PHOTO"; fileId: string } | null;
  /** The draft entry on the server, once organized. */
  entryId: string | null;
}

const STORE = "semwise-entry-draft";

function loadDraft(): Partial<Draft> {
  try {
    return JSON.parse(localStorage.getItem(STORE) ?? "{}") as Partial<Draft>;
  } catch {
    return {};
  }
}

function saveDraft(draft: Draft | null) {
  try {
    if (draft) localStorage.setItem(STORE, JSON.stringify(draft));
    else localStorage.removeItem(STORE);
  } catch {
    // Private mode: the draft lasts for this page only.
  }
}

type Step = "write" | "organizing" | "review" | "sent";

/**
 * Write an entry: pick the class, the day and what was taught (typed, dictated or read from a
 * photo), let the API organize it into syllabus topics, check it, send it.
 */
export function EntryComposer({
  classes,
  allowMedia,
  fixedClassId,
  persist = true,
}: {
  classes: ClassView[];
  allowMedia: boolean;
  fixedClassId?: string;
  /** Keep the unsent text on this device (the CR screen). */
  persist?: boolean;
}) {
  const client = useQueryClient();
  const toast = useToast();
  const tz = useTimezone();
  const today = todayIn(tz);
  const [draft, setDraft] = useState<Draft>(() => {
    const saved = persist ? loadDraft() : {};
    const classId =
      fixedClassId ??
      (classes.some((c) => c.id === saved.classId) ? saved.classId! : (classes[0]?.id ?? ""));
    return {
      classId,
      taughtOn: saved.taughtOn && saved.taughtOn <= today ? saved.taughtOn : today,
      text: saved.text ?? "",
      media: allowMedia ? (saved.media ?? null) : null,
      entryId: saved.entryId ?? null,
    };
  });
  const [step, setStep] = useState<Step>("write");
  const [duplicate, setDuplicate] = useState(false);
  const [mediaNote, setMediaNote] = useState<string | null>(null);
  const [sent, setSent] = useState<EntryView | null>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  // Never lose a CR's text: it is kept on the device until it is sent.
  useEffect(() => {
    if (persist) saveDraft(step === "sent" ? null : draft);
  }, [draft, step, persist]);

  const update = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const multipleSections = new Set(classes.map((c) => c.section.id)).size > 1;

  // ---------- Voice and photo ----------
  const recorder = useRecorder();
  const media = useMutation({
    mutationFn: async ({
      kind,
      file,
    }: {
      kind: "AUDIO" | "PHOTO";
      file: Blob & { name?: string };
    }) => readMedia(kind, file, draft.classId),
    onMutate: () => setMediaNote(null),
    onSuccess: ({ text, fileId }, { kind }) => {
      setDraft((d) => ({
        ...d,
        text: d.text.trim() ? `${d.text.trim()}\n\n${text}` : text,
        media: { kind: kind === "AUDIO" ? "VOICE" : "PHOTO", fileId },
      }));
      setMediaNote(t.entry.mediaAdded);
      textRef.current?.focus();
    },
  });
  const toggleRecording = async () => {
    if (recorder.state.status === "recording") {
      const blob = await recorder.stop();
      if (blob && blob.size > 0) media.mutate({ kind: "AUDIO", file: blob });
    } else {
      await recorder.start();
    }
  };

  // ---------- Organize, review, send ----------
  const organize = useMutation({
    mutationFn: async () => {
      if (draft.entryId) {
        try {
          await api(`/entries/${draft.entryId}/draft`, {
            method: "PATCH",
            body: { text: draft.text, taughtOn: draft.taughtOn },
          });
          return draft.entryId;
        } catch (err) {
          // The old draft was sent or withdrawn elsewhere: start a new one.
          if (!(err instanceof ApiError) || (err.status !== 404 && err.status !== 409)) throw err;
        }
      }
      const created = await api<EntryView>(`/classes/${draft.classId}/entries`, {
        body: {
          taughtOn: draft.taughtOn,
          text: draft.text,
          inputKind: draft.media?.kind ?? "TEXT",
          ...(draft.media ? { mediaFileId: draft.media.fileId } : {}),
        },
      });
      return created.id;
    },
    onSuccess: (entryId) => {
      update({ entryId });
      // Drop the old organized result so it never shows while the new one is made.
      client.removeQueries({ queryKey: entryKeys.entry(entryId) });
      setStep("organizing");
    },
  });

  const entry = useQuery({
    queryKey: entryKeys.entry(draft.entryId ?? ""),
    queryFn: () => api<EntryView>(`/entries/${draft.entryId}`),
    enabled: Boolean(draft.entryId) && (step === "organizing" || step === "review"),
    refetchInterval: (q) => {
      const state = q.state.data?.latest?.organize;
      return state === "QUEUED" || state === "RUNNING" ? 2000 : false;
    },
  });
  const organizeState = entry.data?.latest?.organize;
  // Organizing turns into review as soon as the result is in.
  const view: Step = step === "organizing" && organizeState === "DONE" ? "review" : step;

  const submit = useMutation({
    mutationFn: (onDuplicate?: "replace" | "add") =>
      api<EntryView>(`/entries/${draft.entryId}/submit`, {
        body: onDuplicate ? { onDuplicate } : {},
      }),
    onSuccess: (result) => {
      setDuplicate(false);
      setSent(result);
      setStep("sent");
      toast(t.entry.sent);
      void client.invalidateQueries({ queryKey: entryKeys.mine });
      void client.invalidateQueries({ queryKey: entryKeys.classEntries(draft.classId) });
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === "DUPLICATE_ENTRY") setDuplicate(true);
    },
  });

  const reset = () => {
    setDraft((d) => ({ ...d, text: "", media: null, entryId: null, taughtOn: today }));
    setSent(null);
    setMediaNote(null);
    setStep("write");
  };

  // ---------- Screens ----------

  if (view === "sent" && sent) {
    return (
      <Card className="flex flex-col items-start gap-3 p-5">
        <p className="text-lg font-semibold">{sent.subject.name}</p>
        <EntryStatus entry={sent} />
        {sent.latest?.status === "PENDING" && <p className="text-muted">{t.entry.waitingNote}</p>}
        <Button onClick={reset}>{t.entry.newEntry}</Button>
      </Card>
    );
  }

  if (view === "organizing" || view === "review") {
    const latest = entry.data?.latest;
    return (
      <div className="flex flex-col gap-4">
        {entry.error && <Notice tone="danger">{errorMessage(entry.error)}</Notice>}
        {view === "organizing" && organizeState !== "FAILED" && (
          <Card className="flex flex-col gap-3 p-5" role="status">
            <p className="font-medium">{t.entry.organizing}</p>
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-5 w-1/2" />
            <Skeleton className="h-16 w-full" />
          </Card>
        )}
        {organizeState === "FAILED" && (
          <Notice tone="danger" title={t.entry.organizeFailed}>
            {latest?.organizeError}
          </Notice>
        )}
        {view === "review" && latest && (
          <Card className="flex flex-col gap-4 p-5">
            <div>
              <p className="text-lg font-semibold">{t.entry.reviewTitle}</p>
              <p className="text-sm text-muted">{t.entry.reviewLead}</p>
            </div>
            <section>
              <p className="mb-2 text-sm font-semibold text-muted">{t.entry.topics}</p>
              <TopicList topics={latest.topics} />
            </section>
            {latest.summary && (
              <section>
                <p className="mb-1 text-sm font-semibold text-muted">{t.entry.summary}</p>
                <p className="text-[15px] text-pretty">{latest.summary}</p>
              </section>
            )}
          </Card>
        )}
        {submit.error && !duplicate && <Notice tone="danger">{errorMessage(submit.error)}</Notice>}
        {duplicate ? (
          <Notice
            tone="warning"
            title={t.entry.duplicateTitle}
            action={
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  loading={submit.isPending}
                  onClick={() => submit.mutate("replace")}
                >
                  {t.entry.replace}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={submit.isPending}
                  onClick={() => submit.mutate("add")}
                >
                  {t.entry.addMine}
                </Button>
              </div>
            }
          >
            {t.entry.duplicateBody}
          </Notice>
        ) : (
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={() => setStep("write")}>
              {t.entry.changeText}
            </Button>
            <Button
              disabled={view !== "review"}
              loading={submit.isPending}
              onClick={() => submit.mutate(undefined)}
            >
              {allowMedia ? t.entry.sendToTeacher : t.entry.submit}
            </Button>
          </div>
        )}
      </div>
    );
  }

  const recording = recorder.state.status === "recording";
  const busyMedia = media.isPending || recording;
  return (
    <form
      noValidate
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        organize.mutate();
      }}
    >
      {!fixedClassId && (
        <fieldset>
          <legend className="mb-2 text-sm font-medium">{t.entry.subject}</legend>
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
            {classes.map((c) => {
              const selected = c.id === draft.classId;
              return (
                <button
                  key={c.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => update({ classId: c.id, entryId: null, media: null })}
                  className={cn(
                    "h-11 shrink-0 rounded-full border px-4 text-[15px] font-medium whitespace-nowrap transition-calm",
                    selected
                      ? "border-accent bg-accent text-on-accent"
                      : "border-border bg-surface text-text hover:border-border-strong",
                  )}
                >
                  {c.subject.name}
                  {multipleSections && <span className="opacity-80"> · {c.section.name}</span>}
                </button>
              );
            })}
          </div>
        </fieldset>
      )}

      <Field label={t.entry.date} className="max-w-48">
        {(p) => (
          <Input
            {...p}
            type="date"
            max={today}
            value={draft.taughtOn}
            onChange={(e) => update({ taughtOn: e.target.value })}
          />
        )}
      </Field>

      <Field
        label={t.entry.text}
        hint={t.entry.textHint}
        error={organize.error instanceof ApiError ? organize.error.field("text") : undefined}
      >
        {(p) => (
          <Textarea
            {...p}
            ref={textRef}
            value={draft.text}
            onChange={(e) => update({ text: e.target.value })}
            placeholder={t.entry.textPlaceholder}
            maxLength={ENTRY_TEXT_MAX}
            className="min-h-44 text-base"
          />
        )}
      </Field>

      {allowMedia && (
        <div className="flex flex-col gap-2">
          <div className="grid grid-cols-2 gap-2 sm:flex">
            <Button
              variant={recording ? "danger" : "secondary"}
              disabled={media.isPending || !draft.classId}
              onClick={() => void toggleRecording()}
              aria-pressed={recording}
            >
              {recording ? (
                <Square aria-hidden className="size-4" />
              ) : (
                <Mic aria-hidden className="size-4" />
              )}
              {recording && recorder.state.status === "recording"
                ? `${t.entry.stopRecording} · ${clock(recorder.state.seconds)}`
                : t.entry.record}
            </Button>
            <label
              className={cn(
                "inline-flex h-11 cursor-pointer items-center justify-center gap-2 rounded-control border border-border bg-surface px-4 text-[15px] font-medium transition-calm hover:border-border-strong",
                // The file input is visually hidden: show its keyboard focus on the label.
                "has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-focus",
                (busyMedia || !draft.classId) && "pointer-events-none opacity-50",
              )}
            >
              <Camera aria-hidden className="size-4" />
              {t.entry.photo}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                capture="environment"
                className="sr-only"
                disabled={busyMedia || !draft.classId}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) media.mutate({ kind: "PHOTO", file });
                }}
              />
            </label>
          </div>
          {recording && <p className="text-sm text-muted">{t.entry.recordingLimit}</p>}
          {recorder.state.status === "error" && (
            <Notice tone="warning">{recorder.state.message}</Notice>
          )}
          {media.isPending && (
            <Notice tone="info">
              {media.variables?.kind === "AUDIO" ? t.entry.transcribing : t.entry.readingPhoto}
            </Notice>
          )}
          {media.error && <Notice tone="danger">{errorMessage(media.error)}</Notice>}
          {mediaNote && !media.isPending && <Notice tone="success">{mediaNote}</Notice>}
        </div>
      )}

      {organize.error && !(organize.error instanceof ApiError && organize.error.field("text")) && (
        <Notice tone="danger">{errorMessage(organize.error)}</Notice>
      )}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        {persist && draft.text.trim() ? (
          <p className="text-sm text-muted">{t.entry.draftKept}</p>
        ) : (
          <span />
        )}
        <Button
          type="submit"
          loading={organize.isPending}
          disabled={busyMedia || draft.text.trim().length < 3 || !draft.classId}
        >
          {t.entry.organize}
        </Button>
      </div>
    </form>
  );
}
