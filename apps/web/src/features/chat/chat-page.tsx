"use client";

import type {
  AnswerLabel,
  AskResult,
  Citation,
  ConversationSummaryView,
  ConversationView,
  EntryView,
  MessageView,
} from "@semwise/shared";
import { MAX_QUESTION_LENGTH } from "@semwise/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BookMarked,
  ChevronDown,
  History,
  Info,
  MessageCircle,
  MessagesSquare,
  Plus,
  SendHorizontal,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Button, IconButton } from "@/components/ui/button";
import { Switch } from "@/components/ui/field";
import { ConfirmSheet, Sheet } from "@/components/ui/sheet";
import { ErrorState, errorMessage } from "@/components/ui/states";
import {
  ListSkeleton,
  Notice,
  ProgressBar,
  Skeleton,
  StatusPill,
  type Tone,
} from "@/components/ui/surface";
import { useToast } from "@/components/ui/toast";
import { TopicList, useMyClasses } from "@/features/entries/shared";
import { ApiError, api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatDay, todayIn } from "@/lib/format";
import { useTimezone } from "@/lib/session";
import { t } from "@/lib/strings";
import { AnswerText } from "./answer-text";

const keys = {
  list: ["chat", "conversations"] as const,
  one: (id: string) => ["chat", "conversation", id] as const,
};

const LABEL_TONE: Record<AnswerLabel, Tone> = {
  FROM_SYLLABUS: "success",
  REPORTED_IN_CLASS: "accent",
  GENERAL_EXPLANATION: "info",
  OUTSIDE_SYLLABUS: "warning",
  NOT_IN_MATERIAL: "neutral",
};

export function ChatPage({ id }: { id?: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const client = useQueryClient();
  const toast = useToast();
  const conversations = useQuery({
    queryKey: keys.list,
    queryFn: () => api<ConversationSummaryView[]>("/chat/conversations"),
  });
  const conversation = useQuery({
    queryKey: keys.one(id ?? ""),
    queryFn: () => api<ConversationView>(`/chat/conversations/${id}`),
    enabled: Boolean(id),
  });
  const classes = useMyClasses();
  const subjects = useMemo(() => {
    const seen = new Map<string, { id: string; name: string }>();
    for (const c of classes.data ?? [])
      seen.set(c.subject.id, { id: c.subject.id, name: c.subject.name });
    return [...seen.values()];
  }, [classes.data]);

  // A follow-up from catch-up arrives as ?ask=...&subject=...; it fills the box, never sends itself.
  const [text, setText] = useState(() => (id ? "" : (params.get("ask") ?? "")));
  const [newPinned, setNewPinned] = useState<string | null>(() =>
    id ? null : params.get("subject"),
  );
  const [newIncludePast, setNewIncludePast] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [quota, setQuota] = useState<AskResult["quota"] | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const [subjectOpen, setSubjectOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  const current = conversation.data;
  const pinned = id ? (current?.pinnedSubjectId ?? null) : newPinned;
  const includePast = id ? (current?.includePast ?? false) : newIncludePast;
  const messages = current?.messages ?? [];

  const ask = useMutation({
    mutationFn: async (question: string) => {
      let conversationId = id;
      if (!conversationId) {
        const created = await api<ConversationView>("/chat/conversations", {
          body: { pinnedSubjectId: newPinned, includePast: newIncludePast },
        });
        conversationId = created.id;
      }
      const result = await api<AskResult>(`/chat/conversations/${conversationId}/messages`, {
        body: { text: question },
      });
      return { conversationId, result };
    },
    onMutate: (question) => {
      setPending(question);
      setText("");
    },
    onSuccess: ({ conversationId, result }) => {
      setQuota(result.quota);
      client.setQueryData<ConversationView>(keys.one(conversationId), (old) =>
        old ? { ...old, messages: [...old.messages, result.question, result.answer] } : old,
      );
      void client.invalidateQueries({ queryKey: keys.one(conversationId) });
      void client.invalidateQueries({ queryKey: keys.list });
      if (conversationId !== id) router.replace(`/chat/${conversationId}`);
    },
    onError: (_err, question) => setText(question),
    onSettled: () => setPending(null),
  });

  const settings = useMutation({
    mutationFn: (patch: { pinnedSubjectId?: string | null; includePast?: boolean }) =>
      api(`/chat/conversations/${id}`, { method: "PATCH", body: patch }),
    onSuccess: () => void client.invalidateQueries({ queryKey: keys.one(id ?? "") }),
  });
  const remove = useMutation({
    mutationFn: () => api(`/chat/conversations/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast(t.chat.deleted);
      setDeleting(false);
      void client.invalidateQueries({ queryKey: keys.list });
      router.replace("/chat");
    },
  });

  // Keep the newest turn in view.
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [messages.length, pending]);

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    const question = text.trim();
    if (question && !ask.isPending) ask.mutate(question);
  };
  const choosePinned = (subjectId: string | null) => {
    if (id) settings.mutate({ pinnedSubjectId: subjectId });
    else setNewPinned(subjectId);
    setSubjectOpen(false);
  };
  const pinnedName = subjects.find((s) => s.id === pinned)?.name ?? t.chat.allSubjects;
  const quotaError = ask.error instanceof ApiError && ask.error.code === "QUOTA_EXCEEDED";

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-10rem)] max-w-3xl flex-col md:min-h-[calc(100dvh-5rem)]">
      <header className="mb-4 flex items-center gap-2">
        <h1 className="min-w-0 flex-1 truncate text-xl font-semibold tracking-tight">
          {current?.title ?? t.chat.title}
        </h1>
        <IconButton label={t.chat.chats} onClick={() => setListOpen(true)}>
          <History aria-hidden className="size-5" />
        </IconButton>
        {id && (
          <IconButton label={t.chat.deleteChat} onClick={() => setDeleting(true)}>
            <Trash2 aria-hidden className="size-5" />
          </IconButton>
        )}
        <Link
          href="/chat"
          aria-label={t.chat.newChat}
          title={t.chat.newChat}
          className="inline-flex size-11 items-center justify-center rounded-control text-muted hover:bg-surface-2 hover:text-text"
        >
          <Plus aria-hidden className="size-5" />
        </Link>
      </header>

      <div className="flex flex-1 flex-col gap-5 pb-4">
        {id && conversation.error ? (
          <ErrorState error={conversation.error} onRetry={() => void conversation.refetch()} />
        ) : id && conversation.isPending ? (
          <ListSkeleton rows={3} />
        ) : messages.length === 0 && !pending ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 py-8 text-center">
            <span className="flex size-12 items-center justify-center rounded-full bg-accent-soft text-accent-text">
              <MessageCircle aria-hidden className="size-6" />
            </span>
            <div>
              <p className="text-lg font-semibold">{t.chat.emptyTitle}</p>
              <p className="mx-auto mt-1 max-w-sm text-muted">{t.chat.emptyBody}</p>
            </div>
            <div className="flex max-w-md flex-wrap justify-center gap-2">
              {t.chat.suggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => {
                    setText(s);
                    input.current?.focus();
                  }}
                  className="min-h-11 rounded-full border border-border bg-surface px-4 text-[15px] transition-calm hover:border-accent hover:text-accent-text"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m) => <Message key={m.id} message={m} />)
        )}
        {pending && (
          <>
            <UserBubble text={pending} />
            <div role="status" className="flex flex-col gap-2">
              <p className="text-sm text-muted">{t.chat.thinking}</p>
              <Skeleton className="h-4 w-11/12" />
              <Skeleton className="h-4 w-4/5" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          </>
        )}
        <div ref={bottom} />
      </div>

      <div className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] -mx-4 border-t border-border bg-bg/95 px-4 pt-2 pb-2 backdrop-blur md:bottom-0 md:mx-0 md:rounded-card md:border md:px-3">
        {ask.error && (
          <Notice tone={quotaError ? "warning" : "danger"} className="mb-2">
            {errorMessage(ask.error)}
          </Notice>
        )}
        {quota?.warn && quota.limit !== null && (
          <div className="mb-2 flex flex-col gap-1">
            <p className="text-xs text-muted">{t.chat.quota(quota.used, quota.limit)}</p>
            <ProgressBar
              value={quota.used}
              max={quota.limit}
              label={t.chat.quota(quota.used, quota.limit)}
            />
          </div>
        )}
        <button
          type="button"
          onClick={() => setSubjectOpen(true)}
          className="mb-2 inline-flex h-8 items-center gap-1 rounded-full bg-surface-2 px-3 text-sm font-medium text-muted hover:text-text"
        >
          <BookMarked aria-hidden className="size-4" />
          {pinnedName}
          <ChevronDown aria-hidden className="size-4" />
        </button>
        <form onSubmit={submit} className="flex items-end gap-2">
          <textarea
            ref={input}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              // Enter sends with a keyboard and mouse; on touch screens it starts a new line.
              if (e.key === "Enter" && !e.shiftKey && window.matchMedia("(pointer: fine)").matches)
                submit(e);
            }}
            rows={1}
            maxLength={MAX_QUESTION_LENGTH}
            aria-label={t.chat.placeholder}
            placeholder={t.chat.placeholder}
            className="max-h-40 min-h-11 flex-1 resize-none rounded-control border border-border bg-surface px-3 py-2.5 text-base [field-sizing:content] hover:border-border-strong focus:border-accent"
          />
          <IconButton
            type="submit"
            label={t.chat.send}
            disabled={!text.trim() || ask.isPending}
            className="bg-accent text-on-accent hover:bg-accent-hover hover:text-on-accent"
          >
            <SendHorizontal aria-hidden className="size-5" />
          </IconButton>
        </form>
        <p className="mt-1.5 text-xs text-faint">{t.chat.disclaimer}</p>
      </div>

      <Sheet open={listOpen} onClose={() => setListOpen(false)} title={t.chat.chats}>
        <Link
          href="/chat"
          onClick={() => setListOpen(false)}
          className="mb-3 flex h-11 items-center gap-2 rounded-control px-3 font-medium text-accent hover:bg-accent-soft"
        >
          <Plus aria-hidden className="size-5" />
          {t.chat.newChat}
        </Link>
        {conversations.isPending ? (
          <ListSkeleton rows={3} />
        ) : !conversations.data?.length ? (
          <p className="text-muted">{t.chat.noChats}</p>
        ) : (
          <ul className="flex flex-col">
            {conversations.data.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/chat/${c.id}`}
                  onClick={() => setListOpen(false)}
                  aria-current={c.id === id ? "page" : undefined}
                  className="flex min-h-12 items-center gap-3 rounded-control px-3 hover:bg-surface-2 aria-[current=page]:bg-accent-soft"
                >
                  <MessagesSquare aria-hidden className="size-4 shrink-0 text-muted" />
                  <span className="min-w-0 flex-1 truncate">{c.title}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Sheet>

      <Sheet open={subjectOpen} onClose={() => setSubjectOpen(false)} title={t.chat.pickSubject}>
        <p className="mb-3 text-sm text-muted">{t.chat.pickSubjectLead}</p>
        <div role="radiogroup" aria-label={t.chat.pickSubject} className="flex flex-col gap-1">
          {[{ id: null as string | null, name: t.chat.allSubjects }, ...subjects].map((s) => (
            <button
              key={s.id ?? "all"}
              type="button"
              role="radio"
              aria-checked={pinned === s.id}
              onClick={() => choosePinned(s.id)}
              className="flex min-h-12 items-center rounded-control px-3 text-left text-[15px] hover:bg-surface-2 aria-checked:bg-accent-soft aria-checked:font-medium aria-checked:text-accent-text"
            >
              {s.name}
            </button>
          ))}
        </div>
        <div className="mt-4 border-t border-border pt-3">
          <Switch
            label={t.chat.includePast}
            checked={includePast}
            onChange={(value) =>
              id ? settings.mutate({ includePast: value }) : setNewIncludePast(value)
            }
          />
        </div>
      </Sheet>

      <ConfirmSheet
        open={deleting}
        onClose={() => setDeleting(false)}
        title={t.chat.deleteTitle}
        body={t.chat.deleteBody}
        confirmLabel={t.chat.deleteChat}
        busy={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
    </div>
  );
}

function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <p className="max-w-[85%] rounded-card rounded-br-[4px] bg-accent-soft px-4 py-2.5 text-[15px] break-words whitespace-pre-wrap text-text">
        <span className="sr-only">{t.chat.you}: </span>
        {text}
      </p>
    </div>
  );
}

function citationLabel(c: Citation, today: string) {
  return c.kind === "SYLLABUS"
    ? t.chat.sourceSyllabus(c.unitNo, c.unitTitle)
    : t.chat.sourceClass(formatDay(c.taughtOn ?? "", today));
}

function Message({ message }: { message: MessageView }) {
  const tz = useTimezone();
  const today = todayIn(tz);
  const [open, setOpen] = useState<Citation | null>(null);
  if (message.role === "USER") return <UserBubble text={message.content} />;

  if (message.scope === "UNRELATED") {
    return (
      <div className="flex gap-3 rounded-card border border-dashed border-border-strong p-4">
        <Info aria-hidden className="mt-0.5 size-5 shrink-0 text-muted" />
        <div>
          <p className="font-medium">{t.chat.declined}</p>
          <p className="mt-0.5 text-[15px] text-muted">{message.content}</p>
        </div>
      </div>
    );
  }

  const byKey = new Map(message.citations.map((c) => [c.key, c]));
  return (
    <article className="flex flex-col gap-3" aria-label={t.chat.assistant}>
      {message.labels.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {message.labels.map((label) => (
            <StatusPill key={label} tone={LABEL_TONE[label]} icon={null}>
              {t.chat.labels[label]}
            </StatusPill>
          ))}
        </div>
      )}
      <AnswerText
        text={message.content}
        renderSource={(key) => {
          const c = byKey.get(key);
          if (!c) return null;
          return (
            <button
              type="button"
              onClick={() => setOpen(c)}
              aria-label={citationLabel(c, today)}
              title={citationLabel(c, today)}
              className="inline-flex h-5 min-w-5 -translate-y-0.5 items-center justify-center rounded-full bg-surface-2 px-1.5 align-middle text-[11px] font-semibold text-accent-text hover:bg-accent-soft"
            >
              {key.slice(1)}
            </button>
          );
        }}
      />
      {message.outdated && <Notice tone="warning">{t.chat.outdated}</Notice>}
      {message.citations.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs font-semibold tracking-wide text-muted uppercase">
            {t.chat.sources}
          </p>
          <div className="flex flex-wrap gap-2">
            {message.citations.map((c) => (
              <button
                key={c.key}
                type="button"
                onClick={() => setOpen(c)}
                className="inline-flex min-h-9 max-w-full items-center gap-1.5 rounded-full border border-border bg-surface px-3 text-sm transition-calm hover:border-accent"
              >
                <span className="font-semibold text-accent-text">{c.key.slice(1)}</span>
                <span className="truncate">{citationLabel(c, today)}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      {open && <SourceSheet citation={open} onClose={() => setOpen(null)} />}
    </article>
  );
}

/** The source of a claim: the syllabus topic, or the class entry as students see it now. */
function SourceSheet({ citation, onClose }: { citation: Citation; onClose: () => void }) {
  const tz = useTimezone();
  const entry = useQuery({
    queryKey: ["entry", citation.entryId ?? ""],
    queryFn: () => api<EntryView>(`/entries/${citation.entryId}`),
    enabled: citation.kind === "CLASS" && Boolean(citation.entryId),
  });
  return (
    <Sheet open onClose={onClose} title={t.chat.sourceTitle}>
      <div className="flex flex-col gap-3">
        <p className="font-semibold">{citation.subject.name}</p>
        {citation.kind === "SYLLABUS" ? (
          <>
            <p className="text-sm text-muted">{t.chat.syllabusVersion(citation.versionNo)}</p>
            <p className="text-[15px]">
              {t.chat.unitTopic(
                `${t.syllabus.unit} ${citation.unitNo ?? ""}${citation.unitTitle ? `: ${citation.unitTitle}` : ""}`,
                citation.topicTitle,
              )}
            </p>
          </>
        ) : (
          <>
            <p className="text-sm text-muted">
              {formatDay(citation.taughtOn ?? "", todayIn(tz), true)} ·{" "}
              {t.chat.classVersion(citation.versionNo)}
            </p>
            {entry.error ? (
              <Notice tone="warning">{t.chat.outdated}</Notice>
            ) : entry.isPending ? (
              <ListSkeleton rows={2} />
            ) : entry.data.live ? (
              <>
                <TopicList topics={entry.data.live.topics} />
                {entry.data.live.summary && (
                  <p className="text-[15px] text-muted">{entry.data.live.summary}</p>
                )}
                {entry.data.live.id !== citation.entryVersionId && (
                  <Notice tone="warning">{t.chat.outdated}</Notice>
                )}
              </>
            ) : (
              <Notice tone="warning">{t.chat.outdated}</Notice>
            )}
          </>
        )}
        <Button variant="secondary" onClick={onClose} className={cn("mt-2 self-start")}>
          {t.common.close}
        </Button>
      </div>
    </Sheet>
  );
}
