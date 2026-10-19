/**
 * The pure parts of create-super-admin: reading flags and environment, and checking each answer
 * with the same rules the app uses. No I/O here, so it can be tested without a terminal.
 */
import { parseArgs } from "node:util";
import type { z } from "zod";
import { emailSchema, nameSchema, newPasswordSchema } from "@semwise/shared";

export interface SuperAdminInput {
  email?: string;
  name?: string;
  password?: string;
}

export type Check<T = string> = { ok: true; value: T } | { ok: false; message: string };

export const USAGE =
  "Usage: pnpm super-admin:create   (then answer the prompts)\n" +
  "   or: SUPER_ADMIN_PASSWORD=... pnpm super-admin:create -- --email you@example.com --name Name";

/** Flags --email and --name, and the password from SUPER_ADMIN_PASSWORD (never from a flag). */
export function readInput(argv: string[], env: NodeJS.ProcessEnv): SuperAdminInput {
  const { values } = parseArgs({
    // pnpm forwards the "--" separator; drop it so the flags after it are read as flags.
    args: argv.filter((arg) => arg !== "--"),
    options: { email: { type: "string" }, name: { type: "string" } },
    allowPositionals: true,
  });
  return {
    email: values.email,
    name: values.name,
    password: env.SUPER_ADMIN_PASSWORD || undefined,
  };
}

function check(schema: z.ZodType<string, string>, value: string): Check {
  const result = schema.safeParse(value);
  if (result.success) return { ok: true, value: result.data };
  return { ok: false, message: result.error.issues.map((issue) => issue.message).join("; ") };
}

export function checkEmail(value: string): Check {
  const result = check(emailSchema, value.trim());
  return result.ok ? result : { ok: false, message: "Enter a valid email address" };
}

export function checkName(value: string): Check {
  return check(nameSchema(120), value);
}

export function checkPassword(value: string): Check {
  return check(newPasswordSchema, value);
}

/** The value of a passing check; otherwise throws its message, prefixed with what was checked. */
export function valueOf(result: Check, label?: string): string {
  if (result.ok) return result.value;
  throw new Error(label ? `${label}: ${result.message}` : result.message);
}

/**
 * With --email, --name and SUPER_ADMIN_PASSWORD all given, the script runs without prompts
 * (scripts and CI). Returns null when something is missing, so the script asks for it instead.
 */
export function nonInteractiveInput(
  input: SuperAdminInput,
): Check<Required<SuperAdminInput>> | null {
  if (!input.email || !input.name || !input.password) return null;
  const email = checkEmail(input.email);
  if (!email.ok) return email;
  const name = checkName(input.name);
  if (!name.ok) return { ok: false, message: `Name: ${name.message}` };
  const password = checkPassword(input.password);
  if (!password.ok) return { ok: false, message: `SUPER_ADMIN_PASSWORD: ${password.message}` };
  return { ok: true, value: { email: email.value, name: name.value, password: password.value } };
}
