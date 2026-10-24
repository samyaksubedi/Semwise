"use client";

import { useId, type ComponentProps, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { t } from "@/lib/strings";

const control =
  "w-full rounded-control border border-border-input bg-surface px-3 text-text placeholder:text-faint transition-calm hover:border-muted focus:border-accent disabled:opacity-60 aria-[invalid=true]:border-danger";

/** A labelled form field: label above, hint and error below (errors are announced). */
export function Field({
  label,
  hint,
  error,
  optional,
  children,
  className,
}: {
  label: string;
  hint?: ReactNode;
  error?: string;
  optional?: boolean;
  children: (props: {
    id: string;
    "aria-describedby"?: string;
    "aria-invalid"?: boolean;
  }) => ReactNode;
  className?: string;
}) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-sm font-medium text-text">
        {label}
        {optional && <span className="ml-1 font-normal text-faint">({t.common.optional})</span>}
      </label>
      {children({ id, "aria-describedby": describedBy, "aria-invalid": error ? true : undefined })}
      {hint && !error && (
        <p id={hintId} className="text-sm text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn(control, "h-11", className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return (
    <textarea className={cn(control, "min-h-28 py-2.5 leading-relaxed", className)} {...props} />
  );
}

export function Select({ className, ...props }: ComponentProps<"select">) {
  return <select className={cn(control, "h-11 pr-8", className)} {...props} />;
}

export function Checkbox({
  label,
  className,
  ...props
}: ComponentProps<"input"> & { label: ReactNode }) {
  return (
    <label className={cn("flex min-h-11 cursor-pointer items-center gap-3 text-[15px]", className)}>
      <input type="checkbox" className="size-5 accent-[var(--accent)]" {...props} />
      <span>{label}</span>
    </label>
  );
}

/** An on/off switch with a visible label. */
export function Switch({
  label,
  description,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex min-h-11 items-center justify-between gap-4">
      <label htmlFor={id} className="flex flex-col">
        <span className="text-[15px] font-medium">{label}</span>
        {description && <span className="text-sm text-muted">{description}</span>}
      </label>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative h-7 w-12 shrink-0 rounded-full transition-calm disabled:opacity-50",
          checked ? "bg-accent" : "bg-border-input",
        )}
      >
        <span
          className={cn(
            "absolute top-1 left-1 size-5 rounded-full bg-white shadow-soft transition-calm",
            checked && "translate-x-5",
          )}
        />
      </button>
    </div>
  );
}
