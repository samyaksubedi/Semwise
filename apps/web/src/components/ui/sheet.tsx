"use client";

import { X } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { t } from "@/lib/strings";
import { Button, IconButton } from "./button";

/**
 * A bottom sheet on phones and a centred dialog from 768 px. Built on <dialog>, so focus is
 * trapped while open and returns to the opener on close; Escape closes it.
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  // Unique per sheet: a confirmation can open on top of another sheet.
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      // React passes a nested sheet's close and cancel events up the tree: only react to our own.
      onClose={(e) => {
        if (e.target === ref.current) onClose();
      }}
      onCancel={(e) => {
        if (e.target !== ref.current) return;
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        // A click on the backdrop (the dialog element itself) closes it.
        if (e.target === ref.current) onClose();
      }}
      aria-labelledby={titleId}
      className={cn(
        "m-0 mt-auto max-h-[90dvh] w-full max-w-none overflow-hidden rounded-t-card border border-border bg-surface p-0 text-text shadow-lift backdrop:bg-black/40",
        "md:m-auto md:max-h-[85dvh] md:rounded-card",
        wide ? "md:max-w-2xl" : "md:max-w-lg",
      )}
    >
      {open && (
        <div className="flex max-h-[90dvh] flex-col md:max-h-[85dvh]">
          <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2">
            <h2 id={titleId} className="text-lg font-semibold">
              {title}
            </h2>
            <IconButton label={t.common.close} onClick={onClose}>
              <X aria-hidden className="size-5" />
            </IconButton>
          </div>
          <div className="overflow-y-auto px-4 py-4">{children}</div>
          {footer && (
            <div className="flex flex-wrap justify-end gap-2 border-t border-border px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
              {footer}
            </div>
          )}
        </div>
      )}
    </dialog>
  );
}

/**
 * A small form in a sheet: the fields, the API's error above them (field errors are passed to
 * the fields by the caller), and one submit button.
 */
export function FormSheet({
  open,
  onClose,
  title,
  submitLabel,
  onSubmit,
  busy,
  error,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  submitLabel: string;
  onSubmit: () => void;
  busy?: boolean;
  error?: string | null;
  children: ReactNode;
  wide?: boolean;
}) {
  const formId = useId();
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title}
      wide={wide}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t.common.cancel}
          </Button>
          <Button type="submit" form={formId} loading={busy}>
            {submitLabel}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
        className="flex flex-col gap-4"
      >
        {error && (
          <p
            role="alert"
            className="rounded-control bg-danger-soft px-3 py-2.5 text-[15px] text-danger"
          >
            {error}
          </p>
        )}
        {children}
      </form>
    </Sheet>
  );
}

/** "Reject this entry?": one question, specific wording, one destructive button. */
export function ConfirmSheet({
  open,
  onClose,
  title,
  body,
  confirmLabel,
  onConfirm,
  busy,
  danger = true,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  body?: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  busy?: boolean;
  danger?: boolean;
  children?: ReactNode;
}) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t.common.cancel}
          </Button>
          <Button variant={danger ? "danger" : "primary"} loading={busy} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {body && <p className="text-muted">{body}</p>}
      {children}
    </Sheet>
  );
}
