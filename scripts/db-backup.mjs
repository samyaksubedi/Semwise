/**
 * Backs up the Semwise database to a pg_dump custom-format file, checks the file can be read
 * back, and deletes backups older than --keep-days. Restore steps are in docs/deploy.md.
 *
 *   node scripts/db-backup.mjs --container <postgres container> [--user semwise] [--db semwise]
 *   node scripts/db-backup.mjs --url-env BACKUP_DATABASE_URL     (pg_dump installed locally)
 *
 * Options: --out <dir> (default ./backups), --keep-days <n> (default 14).
 * Dump as the owner or a superuser: tables force row-level security, so a role that is bound by
 * it would get an error (or empty tables). The connection string is read from an environment
 * variable so it never appears in the process list or shell history, and it is never printed.
 */
import { spawn } from "node:child_process";
import {
  createReadStream,
  createWriteStream,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    container: { type: "string" },
    "url-env": { type: "string" },
    user: { type: "string", default: "semwise" },
    db: { type: "string", default: "semwise" },
    out: { type: "string", default: "backups" },
    "keep-days": { type: "string", default: "14" },
  },
});

function fail(message) {
  console.error(`Backup failed: ${message}`);
  process.exit(1);
}

/** The command that runs a Postgres client tool, in the container or on this machine. */
function tool(name, args) {
  if (values.container)
    return ["docker", ["exec", "-i", values.container, name, "-U", values.user, ...args]];
  const variable = values["url-env"];
  if (!variable) fail("pass --container <name> or --url-env <VARIABLE>");
  const url = process.env[variable];
  if (!url) fail(`${variable} is not set`);
  return [name, ["--dbname", url, ...args]];
}

function run(command, args, { stdout, stdin } = {}) {
  return new Promise((done) => {
    const child = spawn(command, args, {
      stdio: [stdin ? "pipe" : "ignore", stdout ? "pipe" : "ignore", "pipe"],
    });
    let errors = "";
    child.stderr.on("data", (chunk) => (errors += chunk));
    if (stdout) child.stdout.pipe(stdout);
    if (stdin) stdin.pipe(child.stdin);
    child.on("error", (err) => done({ code: 1, errors: err.message }));
    child.on("close", (code) => done({ code, errors }));
  });
}

const outDir = resolve(values.out);
mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");
const file = join(outDir, `semwise-${values.db}-${stamp}Z.dump`);

// 1. Dump (custom format: compressed, restorable table by table with pg_restore).
const [dumpCmd, dumpArgs] = tool("pg_dump", [
  ...(values.container ? ["-d", values.db] : []),
  "--format=custom",
  "--no-owner",
]);
const target = createWriteStream(file);
const dumped = await run(dumpCmd, dumpArgs, { stdout: target });
await new Promise((done) => target.end(done));
if (dumped.code !== 0) {
  rmSync(file, { force: true });
  fail(dumped.errors.trim() || `pg_dump exited with ${dumped.code}`);
}

// 2. Read the file back: pg_restore --list fails on a truncated or corrupt dump.
const [listCmd, listArgs] = values.container
  ? ["docker", ["exec", "-i", values.container, "pg_restore", "--list"]]
  : ["pg_restore", ["--list"]];
const listed = await run(listCmd, listArgs, { stdin: createReadStream(file) });
if (listed.code !== 0) fail(`the dump could not be read back: ${listed.errors.trim()}`);

const size = (statSync(file).size / 1024 / 1024).toFixed(2);
console.log(`Backup written: ${file} (${size} MB), checked with pg_restore --list.`);

// 3. Keep the last --keep-days days.
const keepDays = Number(values["keep-days"]);
if (Number.isFinite(keepDays) && keepDays > 0) {
  const cutoff = Date.now() - keepDays * 86_400_000;
  for (const name of readdirSync(outDir)) {
    if (!/^semwise-.+\.dump$/.test(name)) continue;
    const path = join(outDir, name);
    if (statSync(path).mtimeMs < cutoff) {
      rmSync(path);
      console.log(`Removed old backup ${name}`);
    }
  }
}
