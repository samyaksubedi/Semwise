import { defineConfig } from "prisma/config";

// Load apps/api/.env for local CLI commands. In production the variables come from Coolify.
try {
  process.loadEnvFile(".env");
} catch {
  // No .env file: rely on the real environment.
}

/**
 * Migrations run as the database owner (MIGRATION_DATABASE_URL). The running API connects as a
 * separate role that cannot bypass row-level security (DATABASE_URL).
 */
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL ?? "",
  },
});
