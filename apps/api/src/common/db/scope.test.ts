import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../lib/prisma.js";
import { resetDatabase } from "../../test/db.js";
import { addMembership, createTenant, createUser } from "../../test/helpers.js";
import { withSystem, withTenant } from "./scope.js";

/**
 * Row-level security is the second line of defence: even a query that forgets its tenant filter
 * must not see another college's rows. These run as the app role (no RLS bypass).
 */
describe("row-level security", () => {
  let a: { id: string };
  let b: { id: string };

  beforeEach(async () => {
    await resetDatabase();
    [a, b] = await Promise.all([createTenant(), createTenant()]);
    const user = await createUser();
    await addMembership(user.id, a.id, "STUDENT");
    await addMembership(user.id, b.id, "STUDENT");
  });

  it("the API connects as a role that cannot bypass RLS", async () => {
    const [role] = await prisma.$queryRaw<{ rolbypassrls: boolean; rolsuper: boolean }[]>`
      SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = current_user`;
    expect(role).toEqual({ rolbypassrls: false, rolsuper: false });
  });

  it("shows nothing at all without a tenant setting", async () => {
    expect(await prisma.membership.count()).toBe(0);
    expect(await prisma.tenant.count()).toBe(0);
  });

  it("shows only the scoped college's rows, even with no where clause", async () => {
    const rows = await withTenant(a.id, (db) => db.membership.findMany());
    expect(rows.map((r) => r.tenantId)).toEqual([a.id]);
    const tenants = await withTenant(a.id, (db) => db.tenant.findMany());
    expect(tenants.map((t) => t.id)).toEqual([a.id]);
  });

  it("refuses to write a row for another college", async () => {
    const user = await createUser();
    await expect(
      withTenant(a.id, (db) =>
        db.membership.create({ data: { userId: user.id, tenantId: b.id, role: "STUDENT" } }),
      ),
    ).rejects.toThrow();
  });

  it("refuses to move a row to another college", async () => {
    const changed = await withTenant(a.id, async (db) => {
      try {
        return await db.membership.updateMany({ data: { tenantId: b.id } });
      } catch {
        return { count: -1 };
      }
    });
    expect(changed.count).toBe(-1);
  });

  it("system scope sees every college (login and platform only)", async () => {
    const rows = await withSystem((db) => db.membership.findMany());
    expect(new Set(rows.map((r) => r.tenantId))).toEqual(new Set([a.id, b.id]));
  });

  it("refuses to nest another tenant or system inside a tenant scope", async () => {
    await expect(withTenant(a.id, () => withTenant(b.id, async () => 1))).rejects.toThrow();
    await expect(withTenant(a.id, () => withSystem(async () => 1))).rejects.toThrow();
  });

  it("reuses the open transaction for the same tenant, so a failure rolls everything back", async () => {
    const user = await createUser();
    await expect(
      withTenant(a.id, async () => {
        await withTenant(a.id, (db) =>
          db.membership.create({ data: { userId: user.id, tenantId: a.id, role: "TEACHER" } }),
        );
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    const teachers = await withTenant(a.id, (db) =>
      db.membership.count({ where: { role: "TEACHER" } }),
    );
    expect(teachers).toBe(0);
  });
});
