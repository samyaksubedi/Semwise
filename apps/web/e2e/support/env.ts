import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { FAKE_OPENAI_URL } from "./fake-openai";

export const API_DIR = fileURLToPath(new URL("../../../api/", import.meta.url));
export const WEB_DIR = fileURLToPath(new URL("../../", import.meta.url));

/**
 * The environment for the API, the worker and the seed during browser tests: apps/api/.env
 * (the local Docker services and the development database) with the AI pointed at the fake
 * server. The real OPENAI_API_KEY is dropped, so no test can make a paid call.
 */
export function apiEnv(): Record<string, string> {
  const file = `${API_DIR}.env`;
  const fromFile = existsSync(file) ? parseEnv(readFileSync(file, "utf8")) : {};
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries({ ...process.env, ...fromFile })) {
    if (value !== undefined) env[key] = value;
  }
  return {
    ...env,
    NODE_ENV: "development",
    LOG_LEVEL: "info",
    PORT: "4000",
    CORS_ORIGINS: "http://localhost:3000",
    WEB_ORIGIN: "http://localhost:3000",
    OPENAI_API_KEY: "e2e-fake-key",
    OPENAI_BASE_URL: FAKE_OPENAI_URL,
  };
}
