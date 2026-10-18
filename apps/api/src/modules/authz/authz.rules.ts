import type { Role } from "@semwise/shared";
import type { Actor, ActorClass, Resource } from "./authz.types.js";

/**
 * The permission matrix from docs/permissions.md, as code. Deny by default: an action with no
 * rule, or a rule that returns false, is not allowed. Each rule checks role and scope together
 * against the target record loaded on the server.
 */
export const Action = {
  // Platform and tenant
  TENANT_MANAGE: "tenant.manage",
  TENANT_FIRST_ADMIN: "tenant.firstAdmin.create",
  TENANT_SETTINGS: "tenant.settings.update",
  USAGE_READ: "usage.read",
  USAGE_READ_AGGREGATE: "usage.readAggregate",
  PLAN_MANAGE: "plan.manage",
  AUDIT_READ: "audit.read",

  // Academic structure and people
  PROGRAM_CREATE: "program.create",
  PROGRAM_ADMIN_ASSIGN: "programAdmin.assign",
  STRUCTURE_MANAGE: "structure.manage",
  STRUCTURE_READ: "structure.read",
  STUDENTS_MANAGE: "students.manage",
  ENROLLMENT_MANAGE: "enrollment.manage",
  CR_MANAGE: "cr.manage",
  CLASS_MANAGE: "class.manage",

  // Syllabus
  SYLLABUS_MANAGE: "syllabus.manage",
  SYLLABUS_READ_PUBLISHED: "syllabus.readPublished",
  SYLLABUS_READ_DRAFT: "syllabus.readDraft",

  // Class content
  ENTRY_CREATE: "entry.create",
  ENTRY_USE_MEDIA: "entry.useMedia",
  ENTRY_EDIT_OWN: "entry.editOwn",
  ENTRY_REVIEW: "entry.review",
  ENTRY_TAKEDOWN: "entry.takedown",
  ENTRY_READ_PUBLISHED: "entry.readPublished",
  ENTRY_READ_PENDING: "entry.readPending",
  APPROVAL_SET_DEFAULT: "approval.setDefault",
  APPROVAL_OVERRIDE_CLASS: "approval.overrideClass",

  // Student features (private to the student)
  CHAT_USE: "chat.use",
  CATCHUP_USE: "catchup.use",
  PRIVATE_DATA_READ: "private.read",

  // Files
  FILE_UPLOAD_SYLLABUS: "file.uploadSyllabus",
  FILE_UPLOAD_MEDIA: "file.uploadMedia",
} as const;
export type Action = (typeof Action)[keyof typeof Action];

type Rule = (actor: Actor, resource: Resource) => boolean;

// ---------- Predicates (role + scope) ----------

const inTenant: Rule = (a, r) => a.tenantId !== null && a.tenantId === r.tenantId;
const hasRole = (a: Actor, role: Role) => a.memberships.some((m) => m.role === role);

const superAdmin: Rule = (a) => a.isSuperAdmin;

/** University Admin: everywhere in their college. */
const ua: Rule = (a, r) => inTenant(a, r) && hasRole(a, "UNIVERSITY_ADMIN");

/** Program Admin: only inside a program they administer. */
const paOfProgram: Rule = (a, r) =>
  inTenant(a, r) &&
  Boolean(r.programId) &&
  a.memberships.some((m) => m.role === "PROGRAM_ADMIN" && m.programId === r.programId);

const PATH_KEYS = [
  "programId",
  "batchId",
  "semesterId",
  "sectionId",
  "subjectId",
  "classId",
] as const;

/**
 * True when the resource sits on the path of the class: every scope field the resource names
 * matches the class, and it names at least one. A semester matches the classes taught in it;
 * a subject matches its classes; a section matches classes of that section.
 */
function onClassPath(c: ActorClass, r: Resource): boolean {
  let named = 0;
  for (const key of PATH_KEYS) {
    const value = r[key];
    if (!value) continue;
    named += 1;
    if (c[key] !== value) return false;
  }
  return named > 0;
}

/** Teacher: only on classes they are the subject teacher of. */
const teacherOfClass: Rule = (a, r) =>
  inTenant(a, r) &&
  hasRole(a, "TEACHER") &&
  Boolean(r.classId) &&
  a.teaching.some((c) => c.classId === r.classId);

/** Teacher: anything on the path of a class they teach (its program, batch, semester, subject). */
const teacherOnPath: Rule = (a, r) =>
  inTenant(a, r) && hasRole(a, "TEACHER") && a.teaching.some((c) => onClassPath(c, r));

/** CR: only for the section they represent. */
const crOfSection: Rule = (a, r) =>
  inTenant(a, r) &&
  Boolean(r.sectionId) &&
  a.memberships.some((m) => m.role === "CR" && m.sectionId === r.sectionId);

const isStudent = (a: Actor) => hasRole(a, "STUDENT") || hasRole(a, "CR");

/** Student: a section they are or were enrolled in. */
const studentOfSection: Rule = (a, r) =>
  inTenant(a, r) &&
  isStudent(a) &&
  Boolean(r.sectionId) &&
  a.enrollments.some((e) => e.sectionId === r.sectionId);

/** Student: their own batch, or the program above it (any semester or section of the batch). */
const studentOfBatch: Rule = (a, r) =>
  inTenant(a, r) &&
  isStudent(a) &&
  Boolean(r.batchId || r.programId) &&
  a.enrollments.some(
    (e) => (!r.batchId || e.batchId === r.batchId) && (!r.programId || e.programId === r.programId),
  );

const owns: Rule = (a, r) => inTenant(a, r) && Boolean(r.ownerId) && r.ownerId === a.userId;

/** The student's own private records. No other role is ever listed. */
const studentSelf: Rule = (a, r) => owns(a, r) && isStudent(a);

const any =
  (...rules: Rule[]): Rule =>
  (a, r) =>
    rules.some((rule) => rule(a, r));
const all =
  (...rules: Rule[]): Rule =>
  (a, r) =>
    rules.every((rule) => rule(a, r));

// ---------- The matrix ----------

export const rules: Record<Action, Rule> = {
  [Action.TENANT_MANAGE]: superAdmin,
  [Action.TENANT_FIRST_ADMIN]: superAdmin,
  [Action.TENANT_SETTINGS]: ua,
  [Action.USAGE_READ]: any(superAdmin, ua),
  [Action.USAGE_READ_AGGREGATE]: any(superAdmin, ua, paOfProgram),
  [Action.PLAN_MANAGE]: superAdmin,
  [Action.AUDIT_READ]: any(superAdmin, ua, paOfProgram),

  [Action.PROGRAM_CREATE]: ua,
  [Action.PROGRAM_ADMIN_ASSIGN]: ua,
  [Action.STRUCTURE_MANAGE]: any(ua, paOfProgram),
  [Action.STRUCTURE_READ]: any(ua, paOfProgram, teacherOnPath, crOfSection, studentOfBatch),
  [Action.STUDENTS_MANAGE]: any(ua, paOfProgram),
  [Action.ENROLLMENT_MANAGE]: any(ua, paOfProgram),
  [Action.CR_MANAGE]: any(ua, paOfProgram),
  [Action.CLASS_MANAGE]: any(ua, paOfProgram),

  [Action.SYLLABUS_MANAGE]: any(ua, paOfProgram),
  [Action.SYLLABUS_READ_PUBLISHED]: any(
    ua,
    paOfProgram,
    teacherOnPath,
    crOfSection,
    studentOfBatch,
  ),
  [Action.SYLLABUS_READ_DRAFT]: any(ua, paOfProgram),

  [Action.ENTRY_CREATE]: any(teacherOfClass, crOfSection),
  [Action.ENTRY_USE_MEDIA]: crOfSection,
  [Action.ENTRY_EDIT_OWN]: any(all(teacherOfClass, owns), all(crOfSection, owns)),
  [Action.ENTRY_REVIEW]: any(paOfProgram, teacherOfClass),
  [Action.ENTRY_TAKEDOWN]: any(ua, paOfProgram, teacherOfClass),
  [Action.ENTRY_READ_PUBLISHED]: any(
    ua,
    paOfProgram,
    teacherOfClass,
    crOfSection,
    studentOfSection,
  ),
  [Action.ENTRY_READ_PENDING]: any(paOfProgram, teacherOfClass, all(crOfSection, owns)),
  [Action.APPROVAL_SET_DEFAULT]: any(ua, paOfProgram),
  [Action.APPROVAL_OVERRIDE_CLASS]: any(paOfProgram, (a, r) => !r.locked && teacherOfClass(a, r)),

  [Action.CHAT_USE]: studentSelf,
  [Action.CATCHUP_USE]: studentSelf,
  [Action.PRIVATE_DATA_READ]: studentSelf,

  [Action.FILE_UPLOAD_SYLLABUS]: any(ua, paOfProgram),
  [Action.FILE_UPLOAD_MEDIA]: crOfSection,
};
