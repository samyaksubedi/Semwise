import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "quietDanger";
type Size = "md" | "sm";

const base =
  "inline-flex items-center justify-center gap-2 rounded-control font-medium transition-calm select-none disabled:opacity-50 disabled:pointer-events-none whitespace-nowrap";

const variants: Record<Variant, string> = {
  primary: "bg-accent text-on-accent hover:bg-accent-hover shadow-soft",
  secondary:
    "bg-surface text-text border border-border hover:border-border-strong hover:bg-surface-2",
  // Accent text so a lone ghost button still reads as an action, not a label.
  ghost: "text-accent-text hover:bg-accent-soft",
  danger: "bg-danger text-white hover:opacity-90",
  /** A destructive action that opens a confirmation (it is not the main action on the page). */
  quietDanger: "text-danger hover:bg-danger-soft",
};

// md is 44 px tall: the touch target on phones. sm looks 36 px tall but an invisible layer
// widens its hit area to 44 px (4 px each side, so neighbours 8 px apart do not overlap).
const sizes: Record<Size, string> = {
  md: "h-11 px-4 text-[15px]",
  sm: "relative h-9 px-3 text-sm after:absolute after:-inset-1 after:content-['']",
};

export function buttonClass(variant: Variant = "primary", size: Size = "md", extra?: string) {
  return cn(base, variants[variant], sizes[size], extra);
}

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  className,
  children,
  disabled,
  type = "button",
  ...props
}: ComponentProps<"button"> & { variant?: Variant; size?: Size; loading?: boolean }) {
  return (
    <button
      type={type}
      className={buttonClass(variant, size, className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading && (
        <span
          aria-hidden
          className="size-4 animate-spin rounded-full border-2 border-current border-r-transparent"
        />
      )}
      {children}
    </button>
  );
}

export function ButtonLink({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ComponentProps<typeof Link> & { variant?: Variant; size?: Size }) {
  return <Link className={buttonClass(variant, size, className)} {...props} />;
}

/** A square icon-only button; `label` is read by screen readers. */
export function IconButton({
  label,
  children,
  className,
  type = "button",
  ...props
}: ComponentProps<"button"> & { label: string; children: ReactNode }) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex size-11 items-center justify-center rounded-control text-muted transition-calm hover:bg-surface-2 hover:text-text disabled:opacity-50",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
