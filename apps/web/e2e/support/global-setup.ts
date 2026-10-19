import { spawn } from "node:child_process";
import { API_DIR, apiEnv } from "./env";
import { startFakeOpenAi } from "./fake-openai";

/** Runs the demo seed; asynchronous, so the fake server in this process keeps answering. */
function seedDemo(): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--import", "tsx", "src/scripts/seed-demo.ts"], {
      cwd: API_DIR,
      env: apiEnv() as NodeJS.ProcessEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => (output += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (output += chunk.toString()));
    child.on("exit", (code) => resolve({ code, output }));
  });
}

/**
 * Starts the fake OpenAI server (it lives for the whole run) and recreates the demo college, so
 * every run starts from the same data. The seed indexes the demo content through the fake.
 */
export default async function globalSetup() {
  const fake = await startFakeOpenAi();
  const seed = await seedDemo();
  if (seed.code !== 0 || !seed.output.includes("Indexing for chat: done")) {
    fake.close();
    throw new Error(`seed:demo failed or did not index the demo content:\n${seed.output}`);
  }
  return () => new Promise<void>((resolve) => fake.close(() => resolve()));
}
