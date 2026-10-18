import type { RoleGrant } from "@semwise/shared";
import { describe, expect, it } from "vitest";
import { Action, rules } from "./authz.rules.js";
import { can } from "./authz.service.js";
import type { Actor, Resource } from "./authz.types.js";

/**
 * The whole permission matrix (docs/permissions.md), row by row. Each row lists exactly who is
 * allowed on a resource in college A, program P1, batch B1, section S1, class C1 (taught by
 * teacher T1). Everyone else, including people one boundary away, must be denied.
 */

const T = "tenant-a";
const OTHER_T = "tenant-b";

function actor(
  name: string,
  memberships: RoleGrant[],
  extra: Partial<Actor> = {},
  tenantId: string | null = T,
): [string, Actor] {
  return [
    name,
    { userId: name, tenantId, isSuperAdmin: false, memberships, enrollments: [], ...extra },
  ];
}

const g = (
  role: RoleGrant["role"],
  programId: string | null = null,
  sectionId: string | null = null,
) => ({ role, programId, sectionId }) as RoleGrant;

const enrolled = (sectionId: string, batchId: string) => ({
  enrollments: [{ programId: "P1", batchId, semesterId: "SEM1", sectionId, current: true }],
});

const actors = new Map<string, Actor>([
  ["SA", { userId: "SA", tenantId: null, isSuperAdmin: true, memberships: [], enrollments: [] }],
  actor("UA", [g("UNIVERSITY_ADMIN")]),
  actor("PA", [g("PROGRAM_ADMIN", "P1")]),
  actor("PA_other_program", [g("PROGRAM_ADMIN", "P2")]),
  actor("T1", [g("TEACHER")]),
  actor("T_other_class", [g("TEACHER")]),
  actor("CR", [g("STUDENT"), g("CR", null, "S1")], enrolled("S1", "B1")),
  actor("CR_other_section", [g("STUDENT"), g("CR", null, "S2")], enrolled("S2", "B1")),
  actor("S", [g("STUDENT")], enrolled("S1", "B1")),
  actor("S_other_section", [g("STUDENT")], enrolled("S2", "B1")),
  actor("S_other_batch", [g("STUDENT")], enrolled("S9", "B2")),
  // Same roles, other college: must never pass anything in college A.
  actor("UA_other_college", [g("UNIVERSITY_ADMIN")], {}, OTHER_T),
  actor("PA_other_college", [g("PROGRAM_ADMIN", "P1")], {}, OTHER_T),
  actor(
    "S_other_college",
    [g("STUDENT")],
    {
      enrollments: [
        { programId: "P1", batchId: "B1", semesterId: "SEM1", sectionId: "S1", current: true },
      ],
    },
    OTHER_T,
  ),
]);

const base: Resource = {
  tenantId: T,
  programId: "P1",
  batchId: "B1",
  semesterId: "SEM1",
  sectionId: "S1",
  classId: "C1",
  teacherUserIds: ["T1"],
};

type Row = { action: Action; allowed: string[]; resource?: Partial<Resource> };

const matrix: Row[] = [
  // Platform and tenant
  { action: Action.TENANT_MANAGE, allowed: ["SA"] },
  { action: Action.TENANT_FIRST_ADMIN, allowed: ["SA"] },
  { action: Action.TENANT_SETTINGS, allowed: ["UA"] },
  { action: Action.USAGE_READ, allowed: ["SA", "UA"] },
  { action: Action.USAGE_READ_AGGREGATE, allowed: ["SA", "UA", "PA"] },
  { action: Action.PLAN_MANAGE, allowed: ["SA"] },
  { action: Action.AUDIT_READ, allowed: ["SA", "UA", "PA"] },

  // Academic structure and people
  { action: Action.PROGRAM_CREATE, allowed: ["UA"] },
  { action: Action.PROGRAM_ADMIN_ASSIGN, allowed: ["UA"] },
  { action: Action.STRUCTURE_MANAGE, allowed: ["UA", "PA"] },
  {
    action: Action.STRUCTURE_READ,
    allowed: ["UA", "PA", "T1", "CR", "S", "CR_other_section", "S_other_section"],
  },
  { action: Action.STUDENTS_MANAGE, allowed: ["UA", "PA"] },
  { action: Action.ENROLLMENT_MANAGE, allowed: ["UA", "PA"] },
  { action: Action.CR_MANAGE, allowed: ["UA", "PA"] },
  { action: Action.CLASS_MANAGE, allowed: ["UA", "PA"] },

  // Syllabus (read published: students of the batch, whatever their section)
  { action: Action.SYLLABUS_MANAGE, allowed: ["UA", "PA"] },
  {
    action: Action.SYLLABUS_READ_PUBLISHED,
    allowed: ["UA", "PA", "T1", "CR", "S", "CR_other_section", "S_other_section"],
  },
  { action: Action.SYLLABUS_READ_DRAFT, allowed: ["UA", "PA"] },

  // Class content
  { action: Action.ENTRY_CREATE, allowed: ["T1", "CR"] },
  { action: Action.ENTRY_USE_MEDIA, allowed: ["CR"] },
  { action: Action.ENTRY_EDIT_OWN, allowed: ["CR"], resource: { ownerId: "CR" } },
  { action: Action.ENTRY_EDIT_OWN, allowed: ["T1"], resource: { ownerId: "T1" } },
  { action: Action.ENTRY_EDIT_OWN, allowed: [], resource: { ownerId: "someone-else" } },
  { action: Action.ENTRY_REVIEW, allowed: ["PA", "T1"] },
  { action: Action.ENTRY_TAKEDOWN, allowed: ["UA", "PA", "T1"] },
  { action: Action.ENTRY_READ_PUBLISHED, allowed: ["UA", "PA", "T1", "CR", "S"] },
  { action: Action.ENTRY_READ_PENDING, allowed: ["PA", "T1", "CR"], resource: { ownerId: "CR" } },
  { action: Action.ENTRY_READ_PENDING, allowed: ["PA", "T1"], resource: { ownerId: "T1" } },
  { action: Action.APPROVAL_SET_DEFAULT, allowed: ["UA", "PA"] },
  { action: Action.APPROVAL_OVERRIDE_CLASS, allowed: ["PA", "T1"], resource: { locked: false } },
  { action: Action.APPROVAL_OVERRIDE_CLASS, allowed: ["PA"], resource: { locked: true } },

  // Student features: only the student themself, never an admin or the Super Admin
  { action: Action.CHAT_USE, allowed: ["S"], resource: { ownerId: "S" } },
  { action: Action.CHAT_USE, allowed: ["CR"], resource: { ownerId: "CR" } },
  { action: Action.CATCHUP_USE, allowed: ["S"], resource: { ownerId: "S" } },
  { action: Action.PRIVATE_DATA_READ, allowed: ["S"], resource: { ownerId: "S" } },
  { action: Action.PRIVATE_DATA_READ, allowed: [], resource: { ownerId: "UA" } },

  // Files
  { action: Action.FILE_UPLOAD_SYLLABUS, allowed: ["UA", "PA"] },
  { action: Action.FILE_UPLOAD_MEDIA, allowed: ["CR"] },
];

describe("permission matrix", () => {
  it("has a rule for every action and a test row for every action", () => {
    const tested = new Set(matrix.map((row) => row.action));
    for (const action of Object.values(Action)) {
      expect(rules[action], action).toBeTypeOf("function");
      expect(tested.has(action), `no matrix row for ${action}`).toBe(true);
    }
  });

  for (const row of matrix) {
    const label = `${row.action} ${row.resource ? JSON.stringify(row.resource) : ""}`;
    it(`${label}: only ${row.allowed.join(", ") || "nobody"}`, () => {
      const resource = { ...base, ...row.resource };
      const result = Object.fromEntries(
        [...actors].map(([name, a]) => [name, can(a, row.action, resource)]),
      );
      const expected = Object.fromEntries(
        [...actors.keys()].map((name) => [name, row.allowed.includes(name)]),
      );
      expect(result).toEqual(expected);
    });
  }

  it("denies an unknown action", () => {
    expect(can(actors.get("UA")!, "nope" as Action, base)).toBe(false);
  });

  it("never grants on a missing scope field", () => {
    const pa = actors.get("PA")!;
    expect(can(pa, Action.STRUCTURE_MANAGE, { tenantId: T })).toBe(false);
    const cr = actors.get("CR")!;
    expect(can(cr, Action.ENTRY_CREATE, { tenantId: T })).toBe(false);
  });
});
