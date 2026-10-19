import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { membershipsService } from "../modules/memberships/index.js";
import { usersService } from "../modules/users/index.js";
import { resetDatabase } from "../test/db.js";
import { PASSWORD, agent, createUser, login } from "../test/helpers.js";
import {
  checkEmail,
  checkName,
  checkPassword,
  nonInteractiveInput,
  readInput,
  valueOf,
} from "./super-admin-input.js";

const NEW_PASSWORD = "a brand new operator password";

describe("super admin input", () => {
  it("reads --email and --name after pnpm's -- separator, and the password only from the environment", () => {
    const input = readInput(["--", "--email", "a@b.test", "--name", "Ops"], {
      SUPER_ADMIN_PASSWORD: "secret from env",
    });
    expect(input).toEqual({ email: "a@b.test", name: "Ops", password: "secret from env" });
    expect(readInput([], {})).toEqual({ email: undefined, name: undefined, password: undefined });
    expect(readInput([], { SUPER_ADMIN_PASSWORD: "" }).password).toBeUndefined();
  });

  it("validates the email like the app, trimming and lowercasing it", () => {
    expect(checkEmail("  Ops@College.Test ")).toEqual({ ok: true, value: "ops@college.test" });
    expect(checkEmail("not an email")).toEqual({
      ok: false,
      message: "Enter a valid email address",
    });
    expect(checkEmail("")).toMatchObject({ ok: false });
  });

  it("applies the app's password rules", () => {
    expect(checkPassword("short")).toEqual({ ok: false, message: "Use at least 12 characters" });
    expect(checkPassword("x".repeat(257))).toMatchObject({ ok: false });
    expect(checkPassword(NEW_PASSWORD)).toEqual({ ok: true, value: NEW_PASSWORD });
  });

  it("requires a one-line name", () => {
    expect(checkName("  Platform Admin ")).toEqual({ ok: true, value: "Platform Admin" });
    expect(checkName("   ")).toMatchObject({ ok: false });
    expect(checkName("two\nlines")).toMatchObject({ ok: false });
  });

  it("runs without prompts only when email, name and password are all given", () => {
    expect(nonInteractiveInput({ email: "a@b.test", name: "Ops" })).toBeNull();
    expect(nonInteractiveInput({ email: "a@b.test", password: NEW_PASSWORD })).toBeNull();
    expect(nonInteractiveInput({ name: "Ops", password: NEW_PASSWORD })).toBeNull();
    expect(
      nonInteractiveInput({ email: "A@B.test", name: " Ops ", password: NEW_PASSWORD }),
    ).toEqual({ ok: true, value: { email: "a@b.test", name: "Ops", password: NEW_PASSWORD } });
    expect(nonInteractiveInput({ email: "a@b.test", name: "Ops", password: "short" })).toEqual({
      ok: false,
      message: "SUPER_ADMIN_PASSWORD: Use at least 12 characters",
    });
    expect(nonInteractiveInput({ email: "nope", name: "Ops", password: NEW_PASSWORD })).toEqual({
      ok: false,
      message: "Enter a valid email address",
    });
  });

  it("valueOf returns a passing value and throws a labelled message otherwise", () => {
    expect(valueOf(checkName("Ops"))).toBe("Ops");
    expect(() => valueOf(checkPassword("short"), "SUPER_ADMIN_PASSWORD")).toThrow(
      "SUPER_ADMIN_PASSWORD: Use at least 12 characters",
    );
  });
});

const run = promisify(execFile);
const tsx = createRequire(import.meta.url).resolve("tsx/cli");
const script = fileURLToPath(new URL("./create-super-admin.ts", import.meta.url));

/** Runs the real script against the test database, with no terminal (stdin closed). */
async function runScript(args: string[], password?: string) {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.SUPER_ADMIN_PASSWORD;
  if (password !== undefined) env.SUPER_ADMIN_PASSWORD = password;
  try {
    const { stdout, stderr } = await run(process.execPath, [tsx, script, ...args], {
      env,
      timeout: 30_000,
    });
    return { code: 0, output: stdout + stderr };
  } catch (error) {
    const failed = error as { code?: number; stdout?: string; stderr?: string };
    return { code: failed.code ?? 1, output: (failed.stdout ?? "") + (failed.stderr ?? "") };
  }
}

describe("create-super-admin, non-interactive", () => {
  const app = createApp();

  beforeEach(async () => {
    await resetDatabase();
  });

  it("creates a Super Admin who can sign in, without printing the password", async () => {
    const result = await runScript(
      ["--", "--email", "Ops@Platform.Test", "--name", "Platform Ops"],
      NEW_PASSWORD,
    );
    expect(result.code).toBe(0);
    expect(result.output).toContain("Super Admin created: ops@platform.test");
    expect(result.output).not.toContain(NEW_PASSWORD);

    const user = await usersService.findByEmail("ops@platform.test");
    expect(user).toMatchObject({ displayName: "Platform Ops", status: "ACTIVE" });
    expect(await membershipsService.isSuperAdmin(user!.id)).toBe(true);
    await login(app, "ops@platform.test", NEW_PASSWORD);
  });

  it("resets an existing account's password, makes it Super Admin and logs out its sessions", async () => {
    const user = await createUser({ email: "existing@platform.test" });
    const session = await login(app, "existing@platform.test");
    expect((await session.get("/v1/auth/me")).status).toBe(200);

    const result = await runScript(
      ["--email", "existing@platform.test", "--name", "Renamed Ops"],
      NEW_PASSWORD,
    );
    expect(result.code).toBe(0);
    expect(result.output).toContain("Password reset for existing@platform.test");
    expect(result.output).not.toContain(NEW_PASSWORD);

    expect(await membershipsService.isSuperAdmin(user.id)).toBe(true);
    expect((await usersService.findById(user.id))?.displayName).toBe("Renamed Ops");
    expect((await session.get("/v1/auth/me")).status).toBe(401);
    await login(app, "existing@platform.test", NEW_PASSWORD);
    const oldPassword = await agent(app)
      .post("/v1/auth/login")
      .send({ email: "existing@platform.test", password: PASSWORD });
    expect(oldPassword.status).toBe(401);
  });

  it("rejects a weak password and changes nothing", async () => {
    const result = await runScript(["--email", "weak@platform.test", "--name", "Ops"], "short");
    expect(result.code).toBe(1);
    expect(result.output).toContain("SUPER_ADMIN_PASSWORD: Use at least 12 characters");
    expect(await usersService.findByEmail("weak@platform.test")).toBeNull();
  });

  it("fails with usage instead of waiting for input when something is missing and there is no terminal", async () => {
    const result = await runScript(["--email", "half@platform.test"]);
    expect(result.code).toBe(1);
    expect(result.output).toContain("Give --email, --name and SUPER_ADMIN_PASSWORD");
    expect(result.output).toContain("pnpm super-admin:create");
    expect(await usersService.findByEmail("half@platform.test")).toBeNull();
  });
});
