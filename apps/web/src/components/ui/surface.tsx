import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  Clock,
  Info,
  Sparkles,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";

export function Card({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn("rounded-card border border-border bg-surface shadow-soft", className)}
      {...props}
    />
  );
}

/**
 * A page heading with an optional lead line and actions (actions wrap below on phones). It has
 * no bottom margin: pages put it in a `flex flex-col gap-*` column that spaces it.
 */
export function PageHeader({
  title,
  lead,
  actions,
  back,
}: {
  title: string;
  lead?: ReactNode;
  actions?: ReactNode;
  back?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {back}
        <h1 className="text-2xl font-semibold tracking-tight text-balance">{title}</h1>
        {lead && <p className="mt-1 text-muted text-pretty">{lead}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

export function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-2">
      <h2 className="text-sm font-semibold tracking-wide text-muted uppercase">{children}</h2>
      {aside}
    </div>
  );
}

export type Tone = "neutral" | "accent" | "success" | "warning" | "danger" | "info";

const tones: Record<Tone, string> = {
  neutral: "bg-surface-2 text-muted",
  accent: "bg-accent-soft text-accent-text",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
  info: "bg-info-soft text-info",
};

const toneIcons: Record<Tone, LucideIcon> = {
  neutral: CircleDashed,
  accent: Sparkles,
  success: CheckCircle2,
  warning: Clock,
  danger: XCircle,
  info: Info,
};

/** A status shown by text and icon, never by colour alone. */
export function StatusPill({
  tone = "neutral",
  icon,
  children,
  className,
}: {
  tone?: Tone;
  icon?: LucideIcon | null;
  children: ReactNode;
  className?: string;
}) {
  const Icon = icon === undefined ? toneIcons[tone] : icon;
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1 rounded-full px-2 text-xs font-medium whitespace-nowrap",
        tones[tone],
        className,
      )}
    >
      {Icon && <Icon aria-hidden className="size-3.5" />}
      {children}
    </span>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <div aria-hidden className={cn("animate-pulse rounded-control bg-surface-2", className)} />
  );
}

/** Placeholder rows while a list loads. */
export function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div role="status" aria-label="Loading" className="flex flex-col gap-3">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-16 w-full" />
      ))}
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  body,
  action,
}: {
  icon: LucideIcon;
  title: string;
  body?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-card border border-dashed border-border-strong px-6 py-10 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-accent-soft text-accent-text">
        <Icon aria-hidden className="size-6" />
      </span>
      <div>
        <p className="font-semibold">{title}</p>
        {body && <p className="mt-1 max-w-sm text-muted text-pretty">{body}</p>}
      </div>
      {action}
    </div>
  );
}

/** A calm notice inside a page (errors, warnings, AI notes). */
export function Notice({
  tone = "info",
  title,
  children,
  action,
  className,
}: {
  tone?: Exclude<Tone, "neutral" | "accent">;
  title?: string;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  const Icon = tone === "danger" ? AlertTriangle : toneIcons[tone];
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={cn("flex gap-3 rounded-card p-3.5", tones[tone], className)}
    >
      <Icon aria-hidden className="mt-0.5 size-5 shrink-0" />
      <div className="min-w-0 flex-1 text-[15px]">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={cn(title && "mt-0.5", "text-text/90")}>{children}</div>}
        {action && <div className="mt-2">{action}</div>}
      </div>
    </div>
  );
}

export function ProgressBar({ value, max, label }: { value: number; max: number; label: string }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={max}
        className="h-2 overflow-hidden rounded-full bg-surface-2"
      >
        <div
          className="h-full rounded-full bg-accent transition-calm"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
