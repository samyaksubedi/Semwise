import {
  ErrorCode,
  type ClassView,
  type CreateClassInput,
  type SetClassTeachersInput,
  type UpdateClassInput,
} from "@semwise/shared";
import { isUniqueViolation, transaction, type TenantScope } from "../../common/db/scope.js";
import { AppError } from "../../common/errors/app-error.js";
import { auditService } from "../audit/index.js";
import {
  Action,
  can,
  hasRole,
  type Actor,
  type ActorClass,
  type Resource,
} from "../authz/index.js";
import { membershipsService } from "../memberships/index.js";
import { structureService } from "../structure/index.js";
import { classesRepository as repo } from "./classes.repository.js";

type ClassRow = NonNullable<Awaited<ReturnType<typeof repo.find>>>;

/**
 * Whether a subject has a published syllabus. The syllabus module provides the real check; until
 * it is registered no class can be created, because the rule is "published syllabus first".
 */
type SyllabusGate = (scope: TenantScope, subjectId: string) => Promise<boolean>;
let syllabusGate: SyllabusGate = async () => false;

export function registerSyllabusGate(gate: SyllabusGate): void {
  syllabusGate = gate;
}

const scopeOf = (actor: Actor): TenantScope => ({ tenantId: actor.tenantId! });

export function classResource(c: {
  id: string;
  tenantId: string;
  programId: string;
  batchId: string;
  semesterId: string;
  sectionId: string;
  subjectId: string;
}): Resource {
  return {
    tenantId: c.tenantId,
    programId: c.programId,
    batchId: c.batchId,
    semesterId: c.semesterId,
    sectionId: c.sectionId,
    subjectId: c.subjectId,
    classId: c.id,
  };
}

function toView(c: ClassRow): ClassView {
  return {
    id: c.id,
    programId: c.programId,
    batchId: c.batchId,
    semesterId: c.semesterId,
    subject: c.subject,
    section: c.section,
    teachers: c.teachers.map((t) => ({
      userId: t.userId,
      displayName: t.user.displayName,
      isPrimary: t.isPrimary,
    })),
    status: c.status,
  };
}

async function load(actor: Actor, id: string, action: Action): Promise<ClassRow> {
  const row = await repo.find(scopeOf(actor), id);
  if (!row) throw AppError.notFound("Class not found");
  const resource = classResource(row);
  if (!can(actor, action, resource)) {
    throw can(actor, Action.STRUCTURE_READ, resource)
      ? AppError.forbidden()
      : AppError.notFound("Class not found");
  }
  return row;
}

/** Only people who hold the TEACHER role in this college can be subject teachers. */
async function assertTeachers(scope: TenantScope, userIds: string[]): Promise<void> {
  for (const userId of userIds) {
    if (!(await membershipsService.hasRole(scope, userId, "TEACHER"))) {
      throw AppError.invalid("Choose teachers of this college", [
        { path: "teacherUserIds", message: `${userId} is not a teacher here` },
      ]);
    }
  }
}

export const classesService = {
  async create(actor: Actor, input: CreateClassInput): Promise<ClassView> {
    const scope = scopeOf(actor);
    const [subject, section] = await Promise.all([
      structureService.findSubject(scope, input.subjectId),
      structureService.findSection(scope, input.sectionId),
    ]);
    if (!subject) throw AppError.notFound("Subject not found");
    if (!section) throw AppError.notFound("Section not found");
    if (subject.semesterId !== section.semesterId) {
      throw AppError.invalid("The subject and the section must be in the same semester");
    }
    const resource: Resource = {
      tenantId: scope.tenantId,
      programId: subject.programId,
      batchId: subject.batchId,
      semesterId: subject.semesterId,
    };
    if (!can(actor, Action.CLASS_MANAGE, resource)) {
      throw can(actor, Action.STRUCTURE_READ, resource)
        ? AppError.forbidden()
        : AppError.notFound("Subject not found");
    }
    if (!(await syllabusGate(scope, subject.id))) {
      throw AppError.invalidState("Publish this subject's syllabus before creating its classes");
    }
    await assertTeachers(scope, input.teacherUserIds);
    try {
      return await transaction(scope, async () => {
        const created = await repo.create(
          scope,
          {
            programId: subject.programId,
            batchId: subject.batchId,
            semesterId: subject.semesterId,
            subjectId: subject.id,
            sectionId: section.id,
          },
          input.teacherUserIds,
        );
        await auditService.record({
          tenantId: scope.tenantId,
          programId: subject.programId,
          actorId: actor.userId,
          action: "class.create",
          entityType: "Class",
          entityId: created.id,
          after: input,
        });
        return toView(created);
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw AppError.conflict(ErrorCode.ALREADY_EXISTS, "This section already has this subject");
      }
      throw err;
    }
  },

  async listForSemester(actor: Actor, semesterId: string): Promise<ClassView[]> {
    const scope = scopeOf(actor);
    const semester = await structureService.findSemester(scope, semesterId);
    const resource: Resource | null = semester && {
      tenantId: scope.tenantId,
      programId: semester.programId,
      batchId: semester.batchId,
      semesterId: semester.id,
    };
    if (!resource || !can(actor, Action.STRUCTURE_READ, resource)) {
      throw AppError.notFound("Semester not found");
    }
    const rows = await repo.listBySemester(scope, semesterId);
    return rows.filter((c) => can(actor, Action.STRUCTURE_READ, classResource(c))).map(toView);
  },

  /**
   * The classes that matter to the person: taught (teacher), of the section they represent (CR),
   * of their current section (student).
   */
  async mine(actor: Actor): Promise<ClassView[]> {
    const scope = scopeOf(actor);
    const byId = new Map<string, ClassRow>();
    if (hasRole(actor, "TEACHER")) {
      for (const c of await repo.listTaughtBy(scope, actor.userId)) byId.set(c.id, c);
    }
    const sectionIds = new Set<string>();
    for (const m of actor.memberships)
      if (m.role === "CR" && m.sectionId) sectionIds.add(m.sectionId);
    for (const e of actor.enrollments) if (e.current) sectionIds.add(e.sectionId);
    if (sectionIds.size) {
      for (const c of await repo.listBySections(scope, [...sectionIds])) byId.set(c.id, c);
    }
    return [...byId.values()].map(toView);
  },

  async get(actor: Actor, id: string): Promise<ClassView> {
    return toView(await load(actor, id, Action.STRUCTURE_READ));
  },

  async setTeachers(actor: Actor, id: string, input: SetClassTeachersInput): Promise<ClassView> {
    const before = await load(actor, id, Action.CLASS_MANAGE);
    const scope = scopeOf(actor);
    await assertTeachers(scope, input.teacherUserIds);
    return transaction(scope, async () => {
      const after = await repo.setTeachers(scope, id, input.teacherUserIds);
      await auditService.record({
        tenantId: scope.tenantId,
        programId: before.programId,
        actorId: actor.userId,
        action: "class.teachers.set",
        entityType: "Class",
        entityId: id,
        before: { teacherUserIds: before.teachers.map((t) => t.userId) },
        after: input,
      });
      return toView(after!);
    });
  },

  async update(actor: Actor, id: string, input: UpdateClassInput): Promise<ClassView> {
    const before = await load(actor, id, Action.CLASS_MANAGE);
    const scope = scopeOf(actor);
    return transaction(scope, async () => {
      const after = await repo.updateStatus(scope, id, input.status);
      await auditService.record({
        tenantId: scope.tenantId,
        programId: before.programId,
        actorId: actor.userId,
        action: input.status === "ARCHIVED" ? "class.archive" : "class.restore",
        entityType: "Class",
        entityId: id,
        before: { status: before.status },
        after: input,
      });
      return toView(after);
    });
  },

  // ---------- Hooks and lookups for other modules ----------

  /** authz: the classes a teacher teaches, with their full path. */
  async teaching(tenantId: string, userId: string): Promise<ActorClass[]> {
    const rows = await repo.listTaughtBy({ tenantId }, userId);
    return rows.map((c) => ({
      programId: c.programId,
      batchId: c.batchId,
      semesterId: c.semesterId,
      sectionId: c.sectionId,
      subjectId: c.subjectId,
      classId: c.id,
    }));
  },

  /** A class with its subject, section and teachers (callers check their own action). */
  find: (scope: TenantScope, id: string) => repo.find(scope, id),
  listBySections: (scope: TenantScope, sectionIds: string[]) =>
    repo.listBySections(scope, sectionIds),
  toView,
};
