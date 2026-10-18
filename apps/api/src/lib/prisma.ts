import { PrismaPg } from "@prisma/adapter-pg";
import { env } from "../config/env.js";
import { PrismaClient } from "../generated/prisma/client.js";

/**
 * The one database client for the process. Only repositories (and scripts and tests) import it.
 * Prisma 7 talks to Postgres through the `pg` driver adapter.
 */
export const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: env.DATABASE_URL }),
  log: env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
});

export { Prisma } from "../generated/prisma/client.js";
