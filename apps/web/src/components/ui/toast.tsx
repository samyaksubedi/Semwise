"use client";

import { CheckCircle2, XCircle } from "lucide-react";
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";

interface Toast {
  id: number;
  tone: "success" | "danger";
  text: string;
}

const ToastContext = createContext<(text: string, tone?: Toast["tone"]) => void>(() => undefined);

/** Short confirmations ("Saved", "Entry published"), announced politely, gone after 4 s. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const show = useCallback((text: string, tone: Toast["tone"] = "success") => {
    const id = Date.now() + Math.random();
    setToasts((all) => [...all.slice(-2), { id, tone, text }]);
    setTimeout(() => setToasts((all) => all.filter((x) => x.id !== id)), 4000);
  }, []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-50 flex flex-col items-center gap-2 px-4 md:bottom-6"
      >
        {toasts.map((toast) => {
          const Icon = toast.tone === "success" ? CheckCircle2 : XCircle;
          return (
            <div
              key={toast.id}
              className={cn(
                "pointer-events-auto flex max-w-md items-center gap-2 rounded-card border border-border bg-surface px-4 py-3 text-[15px] shadow-lift",
              )}
            >
              <Icon
                aria-hidden
                className={cn("size-5", toast.tone === "success" ? "text-success" : "text-danger")}
              />
              {toast.text}
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
