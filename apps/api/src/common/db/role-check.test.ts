import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { prisma } from "../../lib/prisma.js";
import { testMigrationDatabaseUrl } from "../../test/database-url.js";
import { ownerQuery } from "../../test/db.js";
import { databaseRoleProblem } from "./role-check.js";

const apiRoot = fileURLToPath(new URL("../../../", import.meta.url));

/** Starts an entry point with the owner role as DATABASE_URL; resolves with its exit code and output. */
function startAsOwner(entry: string): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--import", "tsx", entry], {
      cwd: apiRoot,
      env: {
        ...process.env,
        DATABASE_URL: testMigrationDatabaseUrl,
        LOG_LEVEL: "fatal",
        PORT: "4999",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => (output += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (output += chunk.toString()));
    const timer = setTimeout(() => child.kill(), 25_000);
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ code, output });
    });
  });
}

describe("database role check", () => {
  it("accepts the app role the API and tests connect as", async () => {
    const problem = await databaseRoleProblem((sql) => prisma.$queryRawUnsafe(sql));
    expect(problem).toBeNull();
  });

  it("rejects a superuser (the local owner role)", async () => {
    const problem = await databaseRoleProblem((sql) => ownerQuery(sql));
    expect(problem).toMatch(/SUPERUSER/);
  });

  it("rejects a role with BYPASSRLS", async () => {
    const problem = await databaseRoleProblem(async () => [
      { rolname: "reporting", rolsuper: false, rolbypassrls: true },
    ]);
    expect(problem).toMatch(/"reporting", which has BYPASSRLS/);
  });

  it.each(["src/server.ts", "src/worker.ts"])(
    "%s refuses to start as a superuser",
    async (entry) => {
      const { code, output } = await startAsOwner(entry);
      expect(code).toBe(1);
      expect(output).toMatch(/Unsafe database role/);
      // The message names the role and flags, never the connection string or its password.
      expect(output).not.toContain(testMigrationDatabaseUrl);
    },
    30_000,
  );
});
