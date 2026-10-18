import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";

/** Reads a variable from apps/api/.env, if that file sets it. */
function fromDotEnv(name: string): string | undefined {
  const file = new URL("../../.env", import.meta.url);
  if (!existsSync(file)) return undefined;
  return parseEnv(readFileSync(file, "utf8"))[name] || undefined;
}

function setting(name: string, fallback: string): string {
  return process.env[name] || fromDotEnv(name) || fallback;
}

/**
 * Tests run against a separate database (semwise_test) so local data is never touched.
 * Order: the environment variable, then apps/api/.env, then the Docker default.
 * The app role (no RLS bypass) runs the tests; the owner role migrates and wipes.
 */
export const testDatabaseUrl = setting(
  "TEST_DATABASE_URL",
  "postgresql://semwise_app:semwise_app@localhost:5434/semwise_test",
);
export const testMigrationDatabaseUrl = setting(
  "TEST_MIGRATION_DATABASE_URL",
  "postgresql://semwise:semwise@localhost:5434/semwise_test",
);
export const testRedisUrl = setting("TEST_REDIS_URL", "redis://:semwise@localhost:6380/1");
export const testQdrantUrl = setting("TEST_QDRANT_URL", "http://localhost:6333");
