/**
 * Creates the platform operator account, or resets the password of an existing account and makes
 * sure it is Super Admin. A reset logs out every session of that account.
 *
 *   pnpm super-admin:create                    asks for email, name and password (hidden, twice)
 *
 * Non-interactive (scripts and CI): pass --email and --name and set SUPER_ADMIN_PASSWORD; it then
 * runs without prompts. The password is never taken from a flag, so it stays out of shell history.
 */
import { createInterface, type Interface } from "node:readline/promises";
import { Writable } from "node:stream";
import { prisma } from "../lib/prisma.js";
import { authService, hashPassword } from "../modules/auth/index.js";
import { membershipsService } from "../modules/memberships/index.js";
import { usersService } from "../modules/users/index.js";
import {
  USAGE,
  checkEmail,
  checkName,
  checkPassword,
  nonInteractiveInput,
  readInput,
  valueOf,
  type Check,
  type SuperAdminInput,
} from "./super-admin-input.js";

/** stdout that can be muted, so typed passwords are not echoed. */
class MutableStdout extends Writable {
  muted = false;
  override _write(chunk: Buffer, encoding: BufferEncoding, done: () => void): void {
    if (!this.muted) process.stdout.write(chunk, encoding);
    done();
  }
}

class Prompter {
  private output = new MutableStdout();
  private rl: Interface;

  constructor() {
    this.rl = createInterface({ input: process.stdin, output: this.output, terminal: true });
    this.rl.on("SIGINT", () => {
      this.output.muted = false;
      process.stdout.write("\nCancelled. Nothing changed.\n");
      process.exit(130);
    });
  }

  async ask(question: string): Promise<string> {
    return (await this.rl.question(question)).trim();
  }

  async askHidden(question: string): Promise<string> {
    process.stdout.write(question);
    this.output.muted = true;
    try {
      return await this.rl.question("");
    } finally {
      this.output.muted = false;
      process.stdout.write("\n");
    }
  }

  /** Asks until the answer passes the check. */
  async askValid(question: string, check: (value: string) => Check, fallback?: string) {
    for (;;) {
      const answer = await this.ask(question);
      const result = check(answer || fallback || "");
      if (result.ok) return result.value;
      console.log(`  ${result.message}`);
    }
  }

  async askNewPassword(): Promise<string> {
    for (;;) {
      const password = await this.askHidden("Password (12+ characters, hidden): ");
      const result = checkPassword(password);
      if (!result.ok) {
        console.log(`  ${result.message}`);
        continue;
      }
      if ((await this.askHidden("Repeat password: ")) === password) return result.value;
      console.log("  The passwords do not match. Try again.");
    }
  }

  close(): void {
    this.rl.close();
  }
}

interface Answers {
  email: string;
  name: string;
  password: string;
}

async function save(answers: Answers): Promise<void> {
  const passwordHash = await hashPassword(answers.password);
  const existing = await usersService.findByEmail(answers.email);
  if (existing) {
    const user = await usersService.activate(existing.id, passwordHash, answers.name);
    await membershipsService.grantSuperAdmin(user.id);
    await authService.revokeAccess(user.id);
    console.log(
      `Password reset for ${user.email}; it is Super Admin. All its sessions were logged out.`,
    );
  } else {
    const user = await usersService.createActive(answers.email, answers.name, passwordHash);
    await membershipsService.grantSuperAdmin(user.id);
    console.log(`Super Admin created: ${user.email}`);
  }
}

async function interactive(input: SuperAdminInput): Promise<Answers | null> {
  const prompt = new Prompter();
  try {
    const email = input.email
      ? valueOf(checkEmail(input.email))
      : await prompt.askValid("Email: ", checkEmail);

    const existing = await usersService.findByEmail(email);
    if (existing) {
      const superAdmin = await membershipsService.isSuperAdmin(existing.id);
      console.log(
        `An account already exists for ${existing.email}. This RESETS its password` +
          (superAdmin ? ", keeps it Super Admin" : " and makes it Super Admin") +
          ", and logs out all its sessions.",
      );
      if ((await prompt.ask("Continue? (y/N) ")).toLowerCase() !== "y") return null;
    } else {
      console.log(`No account for ${email} yet. This CREATES a new Super Admin account.`);
    }

    const name = input.name
      ? valueOf(checkName(input.name), "Name")
      : existing
        ? await prompt.askValid(`Name [${existing.displayName}]: `, checkName, existing.displayName)
        : await prompt.askValid("Name: ", checkName);
    const password = input.password
      ? valueOf(checkPassword(input.password), "SUPER_ADMIN_PASSWORD")
      : await prompt.askNewPassword();
    return { email, name, password };
  } finally {
    prompt.close();
  }
}

async function main(): Promise<void> {
  const input = readInput(process.argv.slice(2), process.env);
  const preset = nonInteractiveInput(input);
  if (preset && !preset.ok) throw new Error(preset.message);

  let answers: Answers | null;
  if (preset) {
    answers = preset.value;
  } else if (!process.stdin.isTTY) {
    throw new Error("Give --email, --name and SUPER_ADMIN_PASSWORD, or run it in a terminal.");
  } else {
    answers = await interactive(input);
  }

  if (!answers) {
    console.log("Nothing changed.");
    return;
  }
  await save(answers);
}

main()
  .catch((error: unknown) => {
    console.error(`Failed: ${error instanceof Error ? error.message : String(error)}\n${USAGE}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
