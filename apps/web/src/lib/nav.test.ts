import type { RoleGrant, SessionView } from "@semwise/shared";
import { describe, expect, it } from "vitest";
import { areasFor, currentArea, homeFor, isActive, navFor } from "./nav";

function session(roles: RoleGrant["role"][], extra: Partial<SessionView> = {}): SessionView {
  return {
    user: { id: "u1", email: "a@b.c", displayName: "A", isSuperAdmin: false },
    tenants: [{ id: "t1", name: "College", slug: "c", timezone: "Asia/Kathmandu", roles }],
    activeTenantId: "t1",
    roles: roles.map((role) => ({ role, programId: null, sectionId: null })),
    ...extra,
  };
}

describe("navigation by role", () => {
  it("gives each role its own area and home", () => {
    expect(areasFor(session(["STUDENT"]))).toEqual(["student"]);
    expect(areasFor(session(["STUDENT", "CR"]))).toEqual(["cr"]);
    expect(areasFor(session(["TEACHER"]))).toEqual(["teacher"]);
    expect(areasFor(session(["PROGRAM_ADMIN", "TEACHER"]))).toEqual(["admin", "teacher"]);
    expect(homeFor(session(["STUDENT"]))).toBe("/chat");
    expect(homeFor(session(["STUDENT", "CR"]))).toBe("/today");
    expect(homeFor(session(["UNIVERSITY_ADMIN"]))).toBe("/admin");
  });

  it("shows nothing of a college without an active one, except the platform", () => {
    expect(areasFor(session(["STUDENT"], { activeTenantId: null }))).toEqual([]);
    const sa = session([], {
      activeTenantId: null,
      user: { id: "u", email: "s@a.c", displayName: "S", isSuperAdmin: true },
    });
    expect(areasFor(sa)).toEqual(["platform"]);
    expect(homeFor(sa)).toBe("/platform/colleges");
  });

  it("follows the page for people with several roles, and keeps a CR in the CR tabs", () => {
    const both = session(["PROGRAM_ADMIN", "TEACHER"]);
    expect(currentArea(both, "/approvals")).toBe("teacher");
    expect(currentArea(both, "/admin/students")).toBe("admin");
    expect(currentArea(both, "/profile", "teacher")).toBe("teacher");
    expect(currentArea(both, "/profile")).toBe("admin");
    expect(currentArea(session(["STUDENT", "CR"]), "/chat")).toBe("cr");
    // A page of an area the person does not have falls back to their own.
    expect(currentArea(session(["STUDENT"]), "/admin")).toBe("student");
  });

  it("marks the most specific item as active", () => {
    const items = navFor("admin");
    expect(isActive(items, "/admin", "/admin")).toBe(true);
    expect(isActive(items, "/admin", "/admin/students")).toBe(false);
    expect(isActive(items, "/admin/students", "/admin/students/abc")).toBe(true);
    expect(navFor("student").at(-1)?.href).toBe("/profile");
  });
});
