/**
 * `pnpm dev`: builds the shared package, starts the API, waits until it answers, then starts the
 * worker and (once it exists) the web app. Starting everything at the same moment made the API hang
 * on Windows, so they start in turn. Ctrl+C stops all of them.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";

const isWindows = process.platform === "win32";
const children = [];

function pnpm(args, options = {}) {
  return { command: "pnpm", args, options: { stdio: "inherit", shell: isWindows, ...options } };
}

let stopping = false;

function start({ command, args, options }, name) {
  const child = spawn(command, args, options);
  children.push(child);
  child.on("exit", (code) => {
    if (!stopping) {
      console.log(`\n[dev] ${name} stopped (exit code ${code ?? "none"}); stopping everything.`);
      stop(code ?? 1);
    }
  });
  return child;
}

function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (child.exitCode !== null) continue;
    if (isWindows)
      spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    else child.kill("SIGTERM");
  }
  process.exit(code);
}
process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));

function apiPort() {
  const file = new URL("../apps/api/.env", import.meta.url);
  const fromFile = existsSync(file) ? parseEnv(readFileSync(file, "utf8")).PORT : undefined;
  return Number(fromFile || 4000);
}

async function waitForApi(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && !stopping) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (res.ok) return true;
    } catch {
      // Not up yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

const build = pnpm(["--filter", "@semwise/shared", "build"]);
const built = spawnSync(build.command, build.args, build.options);
if (built.status !== 0) process.exit(built.status ?? 1);

start(pnpm(["--filter", "@semwise/api", "dev"]), "API");

const healthUrl = `http://localhost:${apiPort()}/v1/health`;
if (await waitForApi(healthUrl, 60_000)) {
  console.log(`\n[dev] API is up (${healthUrl}). Starting the worker and the web app…\n`);
} else if (!stopping) {
  console.log(
    `\n[dev] The API did not answer at ${healthUrl} within 60s. Starting the rest anyway.\n`,
  );
}

if (!stopping) start(pnpm(["--filter", "@semwise/api", "dev:worker"]), "Worker");
if (!stopping && existsSync(new URL("../apps/web/package.json", import.meta.url))) {
  start(pnpm(["--filter", "@semwise/web", "dev"]), "Web app");
}
