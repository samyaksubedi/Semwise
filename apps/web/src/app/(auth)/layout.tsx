import type { ReactNode } from "react";
import { t } from "@/lib/strings";

/** Signed-out pages: one centred column, the product name above. */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center px-4 py-10 sm:justify-center">
      <div className="mb-8 flex items-center gap-2.5">
        <span
          aria-hidden
          className="flex size-9 items-center justify-center rounded-[10px] bg-accent font-bold text-on-accent"
        >
          S
        </span>
        <span className="text-xl font-semibold tracking-tight">{t.app.name}</span>
      </div>
      <div className="w-full max-w-sm">{children}</div>
    </main>
  );
}
