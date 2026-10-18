import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../app.js";
import { runWithRequestId } from "../../common/http/request-context.js";
import { resetDatabase } from "../../test/db.js";
import {
  addMembership,
  createTenant,
  createUser,
  expectDenied,
  login,
} from "../../test/helpers.js";
import { auditService } from "./audit.service.js";

const app = createApp();

describe("audit log", () => {
  let collegeA: { id: string };
  let collegeB: { id: string };
  let uaA: { id: string; email: string };
  let uaB: { id: string; email: string };
  let studentA: { id: string; email: string };
  let superAdmin: { id: string; email: string };

  beforeEach(async () => {
    await resetDatabase();
    [collegeA, collegeB] = await Promise.all([createTenant(), createTenant()]);
    [uaA, uaB, studentA, superAdmin] = await Promise.all([
      createUser(),
      createUser(),
      createUser(),
      createUser(),
    ]);
    await addMembership(uaA.id, collegeA.id, "UNIVERSITY_ADMIN");
    await addMembership(uaB.id, collegeB.id, "UNIVERSITY_ADMIN");
    await addMembership(studentA.id, collegeA.id, "STUDENT");
    await addMembership(superAdmin.id, null, "SUPER_ADMIN");

    await runWithRequestId("req-test-1", () =>
      auditService.record({
        tenantId: collegeA.id,
        actorId: uaA.id,
        action: "program.create",
        entityType: "Program",
        entityId: "p1",
        after: { code: "BIT" },
      }),
    );
    await auditService.record({
      tenantId: collegeB.id,
      actorId: uaB.id,
      action: "program.create",
      entityType: "Program",
      entityId: "p2",
    });
    await auditService.record({
      tenantId: null,
      actorId: superAdmin.id,
      action: "tenant.create",
      entityType: "Tenant",
      entityId: collegeA.id,
    });
  });

  it("a University Admin reads only their own college's trail", async () => {
    const a = await login(app, uaA.email);
    const res = await a.get("/v1/audit");
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toEqual(
      expect.objectContaining({ tenantId: collegeA.id, action: "program.create", entityId: "p1" }),
    );
    expect(res.body.meta.nextCursor).toBeNull();
  });

  it("records the request id with each entry", async () => {
    const { ownerQuery } = await import("../../test/db.js");
    const rows = await ownerQuery<{ requestId: string }>(
      `SELECT "requestId" FROM audit_logs WHERE "entityId" = 'p1'`,
    );
    expect(rows[0]!.requestId).toBe("req-test-1");
  });

  it("students cannot read the trail", async () => {
    const a = await login(app, studentA.email);
    expectDenied(await a.get("/v1/audit"));
  });

  it("only the Super Admin reads the platform trail, across colleges", async () => {
    const sa = await login(app, superAdmin.email);
    const res = await sa.get("/v1/platform/audit");
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(3);
    const filtered = await sa.get(`/v1/platform/audit?tenantId=${collegeB.id}`);
    expect(filtered.body.data.map((e: { entityId: string }) => e.entityId)).toEqual(["p2"]);

    const ua = await login(app, uaA.email);
    expectDenied(await ua.get("/v1/platform/audit"));
  });

  it("the Super Admin has no college area", async () => {
    const sa = await login(app, superAdmin.email);
    expectDenied(await sa.get("/v1/audit"));
  });

  it("validates the query", async () => {
    const a = await login(app, uaA.email);
    const res = await a.get("/v1/audit?limit=500");
    expect(res.status).toBe(400);
  });

  it("pages with a cursor", async () => {
    for (let i = 0; i < 3; i++) {
      await auditService.record({
        tenantId: collegeA.id,
        actorId: uaA.id,
        action: "x.update",
        entityType: "X",
        entityId: `x${i}`,
      });
    }
    const a = await login(app, uaA.email);
    const first = await a.get("/v1/audit?limit=2");
    expect(first.body.data).toHaveLength(2);
    const second = await a.get(`/v1/audit?limit=2&cursor=${first.body.meta.nextCursor}`);
    expect(second.body.data).toHaveLength(2);
    expect(second.body.meta.nextCursor).toBeNull();
  });
});
