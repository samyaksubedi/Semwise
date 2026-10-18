import { execSync } from "node:child_process";
import { testMigrationDatabaseUrl } from "./database-url.js";

/** Brings the test database up to the latest migration once before all test files. */
export default function setup(): void {
  execSync("prisma migrate deploy", {
    stdio: "pipe",
    env: { ...process.env, MIGRATION_DATABASE_URL: testMigrationDatabaseUrl },
  });
}
