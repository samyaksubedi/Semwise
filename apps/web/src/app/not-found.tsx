import { ButtonLink } from "@/components/ui/button";
import { t } from "@/lib/strings";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-2xl font-semibold">{t.common.notFoundTitle}</h1>
      <p className="max-w-sm text-muted">{t.common.notFoundBody}</p>
      <ButtonLink href="/">{t.common.goHome}</ButtonLink>
    </main>
  );
}
