/**
 * Creates the platform operator account (or makes an existing account Super Admin).
 *
 *   pnpm super-admin:create -- --email you@example.com --name "Your Name"
 *
 * The password is read from SUPER_ADMIN_PASSWORD, so it never lands in shell history.
 */
import { parseArgs } from "node:util";
import { emailSchema, newPasswordSchema } from "@semwise/shared";
import { prisma } from "../lib/prisma.js";
import { hashPassword } from "../modules/auth/index.js";
import { membershipsService } from "../modules/memberships/index.js";
import { usersService } from "../modules/users/index.js";

const { values } = parseArgs({
  // pnpm forwards the "--" separator; drop it so the flags after it are read as flags.
  args: process.argv.slice(2).filter((arg) => arg !== "--"),
  options: { email: { type: "string" }, name: { type: "string" } },
  allowPositionals: true,
});

try {
  const email = emailSchema.parse(values.email);
  const name = (values.name ?? "Super Admin").trim();
  const password = newPasswordSchema.parse(process.env.SUPER_ADMIN_PASSWORD);

  let user = await usersService.findByEmail(email);
  if (user) {
    user = await usersService.activate(user.id, await hashPassword(password));
  } else {
    user = await usersService.createActive(email, name, await hashPassword(password));
  }
  await membershipsService.grantSuperAdmin(user.id);
  console.log(`Super Admin ready: ${user.email}`);
} catch (err) {
  console.error(
    err instanceof Error ? err.message : err,
    "\nUsage: SUPER_ADMIN_PASSWORD=... pnpm super-admin:create -- --email you@example.com --name Name",
  );
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
