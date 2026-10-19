"use client";

import { X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
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
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        // A click on the backdrop (the dialog element itself) closes it.
        if (e.target === ref.current) onClose();
      }}
      aria-labelledby="sheet-title"
      className={cn(
        "m-0 mt-auto max-h-[90dvh] w-full max-w-none overflow-hidden rounded-t-card border border-border bg-surface p-0 text-text shadow-lift backdrop:bg-black/40",
        "md:m-auto md:max-h-[85dvh] md:rounded-card",
        wide ? "md:max-w-2xl" : "md:max-w-lg",
      )}
    >
      {open && (
        <div className="flex max-h-[90dvh] flex-col md:max-h-[85dvh]">
          <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2">
            <h2 id="sheet-title" className="text-lg font-semibold">
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
