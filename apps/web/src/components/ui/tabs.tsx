"use client";

import { useRef, type KeyboardEvent } from "react";
import { cn } from "@/lib/cn";

/** Segmented tabs (arrow keys move between them). The panel is rendered by the caller. */
export function Tabs<T extends string>({
  value,
  onChange,
  items,
  label,
  className,
}: {
  value: T;
  onChange: (value: T) => void;
  items: { value: T; label: string; badge?: number }[];
  label: string;
  className?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: KeyboardEvent, index: number) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const next = (index + (e.key === "ArrowRight" ? 1 : items.length - 1)) % items.length;
    refs.current[next]?.focus();
    onChange(items[next]!.value);
  };
  return (
    <div
      role="tablist"
      aria-label={label}
      className={cn("flex gap-1 overflow-x-auto rounded-control bg-surface-2 p-1", className)}
    >
      {items.map((item, i) => {
        const selected = item.value === value;
        return (
          <button
            key={item.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            role="tab"
            type="button"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onKeyDown={(e) => onKey(e, i)}
            onClick={() => onChange(item.value)}
            className={cn(
              "flex h-9 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-[6px] px-3 text-sm font-medium whitespace-nowrap transition-calm",
              selected ? "bg-surface text-text shadow-soft" : "text-muted hover:text-text",
            )}
          >
            {item.label}
            {item.badge ? (
              <span className="rounded-full bg-accent px-1.5 text-xs text-on-accent">
                {item.badge}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
