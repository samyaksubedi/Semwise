export type CheckResult = "ok" | "fail";

export interface ReadinessReport {
  status: "ready" | "not_ready";
  checks: Record<string, CheckResult>;
}

type ReadinessCheck = () => Promise<void>;

const checks = new Map<string, { check: ReadinessCheck; critical: boolean }>();

/**
 * Other modules register what "ready" means for them (database, Redis, Qdrant).
 * A check passes when it resolves and fails when it throws.
 */
export function registerReadinessCheck(
  name: string,
  check: ReadinessCheck,
  { critical = true }: { critical?: boolean } = {},
): void {
  checks.set(name, { check, critical });
}

export function getLiveness() {
  return { status: "ok" as const, uptimeSeconds: Math.round(process.uptime()) };
}

export async function getReadiness(): Promise<ReadinessReport> {
  const entries = await Promise.all(
    [...checks].map(
      async ([name, { check, critical }]): Promise<[string, CheckResult, boolean]> => {
        try {
          await check();
          return [name, "ok", critical];
        } catch {
          return [name, "fail", critical];
        }
      },
    ),
  );
  const results = Object.fromEntries(entries.map(([name, result]) => [name, result]));
  // A failing optional check is reported but doesn't take the API out of service.
  const ready = entries.every(([, result, critical]) => result === "ok" || !critical);
  return { status: ready ? "ready" : "not_ready", checks: results };
}
