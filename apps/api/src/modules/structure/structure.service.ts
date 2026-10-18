import {
  ErrorCode,
  type BatchTreeView,
  type CreateBatchInput,
  type CreateProgramInput,
  type CreateSectionInput,
  type CreateSemesterInput,
  type CreateSubjectInput,
  type InviteAdminInput,
  type ProgramAdminView,
  type UpdateBatchInput,
  type UpdateProgramInput,
  type UpdateSectionInput,
  type UpdateSemesterInput,
  type UpdateSubjectInput,
} from "@semwise/shared";
import { isUniqueViolation, transaction, type TenantScope } from "../../common/db/scope.js";
import { AppError } from "../../common/errors/app-error.js";
import { auditService } from "../audit/index.js";
import { Action, authorize, can, type Actor, type Resource } from "../authz/index.js";
import { invitationsService } from "../invitations/index.js";
import { membershipsService } from "../memberships/index.js";
import { usersService } from "../users/index.js";
import {
  fromDateOnly,
  toBatchView,
  toProgramView,
  toSectionView,
  toSemesterView,
  toSubjectView,
} from "./structure.mapper.js";
import { structureRepository as repo } from "./structure.repository.js";

type Node = {
  id: string;
  tenantId: string;
  programId?: string;
  batchId?: string;
  semesterId?: string;
};

/** The authorization resource of a structure row: its own id plus the path above it. */
function programResource(p: { id: string; tenantId: string }): Resource {
  return { tenantId: p.tenantId, programId: p.id };
}
function batchResource(b: Node): Resource {
  return { tenantId: b.tenantId, programId: b.programId, batchId: b.id };
}
function semesterResource(s: Node): Resource {
  return { tenantId: s.tenantId, programId: s.programId, batchId: s.batchId, semesterId: s.id };
}
function sectionResource(s: Node): Resource {
  return {
    tenantId: s.tenantId,
    programId: s.programId,
    batchId: s.batchId,
    semesterId: s.semesterId,
    sectionId: s.id,
  };
}
function subjectResource(s: Node): Resource {
  return {
    tenantId: s.tenantId,
    programId: s.programId,
    batchId: s.batchId,
    semesterId: s.semesterId,
    subjectId: s.id,
  };
}

const scopeOf = (actor: Actor): TenantScope => ({ tenantId: actor.tenantId! });

function duplicate(what: string): AppError {
  return AppError.conflict(ErrorCode.ALREADY_EXISTS, `${what} already exists`);
}

/** Runs a write, turning a unique-constraint clash into a clear 409. */
async function unique<T>(what: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (isUniqueViolation(err)) throw duplicate(what);
    throw err;
  }
}

function audit(
  actor: Actor,
  programId: string | null,
  action: string,
  entityType: string,
  entityId: string,
  before: object | null,
  after: object | null,
) {
  return auditService.record({
    tenantId: actor.tenantId,
    programId,
    actorId: actor.userId,
    action,
    entityType,
    entityId,
    before,
    after,
  });
}

/** Loads a row in the actor's college (404 when missing or foreign) and checks the action. */
async function load<T extends Node>(
  actor: Actor,
  find: (scope: TenantScope, id: string) => Promise<T | null>,
  id: string,
  toResource: (row: T) => Resource,
  action: Action,
  label: string,
): Promise<T> {
  const row = await find(scopeOf(actor), id);
  if (!row) throw AppError.notFound(`${label} not found`);
  const resource = toResource(row);
  if (!can(actor, action, resource)) {
    // A row the actor may not even read answers 404, so its existence does not leak.
    throw can(actor, Action.STRUCTURE_READ, resource)
      ? AppError.forbidden()
      : AppError.notFound(`${label} not found`);
  }
  return row;
}

export const structureService = {
  // ---------- Programs ----------

  async listPrograms(actor: Actor) {
    const rows = await repo.listPrograms(scopeOf(actor));
    return rows
      .filter((p) => can(actor, Action.STRUCTURE_READ, programResource(p)))
      .map(toProgramView);
  },

  async getProgram(actor: Actor, id: string) {
    const program = await load(
      actor,
      repo.findProgram,
      id,
      programResource,
      Action.STRUCTURE_READ,
      "Program",
    );
    return toProgramView(program);
  },

  async createProgram(actor: Actor, input: CreateProgramInput) {
    const scope = scopeOf(actor);
    authorize(actor, Action.PROGRAM_CREATE, scope);
    return unique("A program with this code", () =>
      transaction(scope, async () => {
        const program = await repo.createProgram(scope, input);
        await audit(actor, program.id, "program.create", "Program", program.id, null, input);
        return toProgramView(program);
      }),
    );
  },

  async updateProgram(actor: Actor, id: string, input: UpdateProgramInput) {
    const scope = scopeOf(actor);
    const before = await load(
      actor,
      repo.findProgram,
      id,
      programResource,
      Action.PROGRAM_CREATE,
      "Program",
    );
    return unique("A program with this code", () =>
      transaction(scope, async () => {
        const after = await repo.updateProgram(scope, id, input);
        await audit(actor, id, "program.update", "Program", id, toProgramView(before), input);
        return toProgramView(after);
      }),
    );
  },

  // ---------- Program Admins ----------

  async listProgramAdmins(actor: Actor, programId: string): Promise<ProgramAdminView[]> {
    await load(
      actor,
      repo.findProgram,
      programId,
      programResource,
      Action.STRUCTURE_MANAGE,
      "Program",
    );
    const userIds = await membershipsService.holders(scopeOf(actor), "PROGRAM_ADMIN", {
      programId,
    });
    const users = await usersService.findManyByIds(userIds);
    return users.map((u) => ({ userId: u.id, email: u.email, displayName: u.displayName }));
  },

  /** Invites a Program Admin by email; the role is granted when they accept. */
  async inviteProgramAdmin(actor: Actor, programId: string, input: InviteAdminInput) {
    const scope = scopeOf(actor);
    await load(
      actor,
      repo.findProgram,
      programId,
      programResource,
      Action.PROGRAM_ADMIN_ASSIGN,
      "Program",
    );
    const invite = await transaction(scope, async () => {
      const inv = await invitationsService.createOrRefresh(
        scope,
        { email: input.email, displayName: input.displayName, role: "PROGRAM_ADMIN", programId },
        actor.userId,
      );
      await audit(actor, programId, "programAdmin.invite", "Invitation", inv.id, null, {
        role: "PROGRAM_ADMIN",
        programId,
      });
      return inv;
    });
    await invitationsService.send(scope, invite.id, invite.token);
    return { invitationId: invite.id };
  },

  async removeProgramAdmin(actor: Actor, programId: string, userId: string) {
    const scope = scopeOf(actor);
    await load(
      actor,
      repo.findProgram,
      programId,
      programResource,
      Action.PROGRAM_ADMIN_ASSIGN,
      "Program",
    );
    await transaction(scope, async () => {
      const removed = await membershipsService.revoke(scope, userId, "PROGRAM_ADMIN", {
        programId,
      });
      if (removed === 0) throw AppError.notFound("This person is not a Program Admin here");
      await audit(actor, programId, "programAdmin.remove", "User", userId, { programId }, null);
    });
  },

  // ---------- Batches ----------

  async listBatches(actor: Actor, programId: string) {
    await load(
      actor,
      repo.findProgram,
      programId,
      programResource,
      Action.STRUCTURE_READ,
      "Program",
    );
    const rows = await repo.listBatches(scopeOf(actor), programId);
    return rows.filter((b) => can(actor, Action.STRUCTURE_READ, batchResource(b))).map(toBatchView);
  },

  async getBatchTree(actor: Actor, id: string): Promise<BatchTreeView> {
    await load(actor, repo.findBatch, id, batchResource, Action.STRUCTURE_READ, "Batch");
    const tree = await repo.findBatchTree(scopeOf(actor), id);
    if (!tree) throw AppError.notFound("Batch not found");
    return {
      ...toBatchView(tree),
      semesters: tree.semesters
        .filter((s) => can(actor, Action.STRUCTURE_READ, semesterResource(s)))
        .map((s) => ({
          ...toSemesterView(s),
          sections: s.sections
            .filter((x) => can(actor, Action.STRUCTURE_READ, sectionResource(x)))
            .map(toSectionView),
          subjects: s.subjects
            .filter((x) => can(actor, Action.STRUCTURE_READ, subjectResource(x)))
            .map(toSubjectView),
        })),
    };
  },

  async createBatch(actor: Actor, programId: string, input: CreateBatchInput) {
    const scope = scopeOf(actor);
    await load(
      actor,
      repo.findProgram,
      programId,
      programResource,
      Action.STRUCTURE_MANAGE,
      "Program",
    );
    return unique("A batch with this name", () =>
      transaction(scope, async () => {
        const batch = await repo.createBatch(scope, { programId, ...input });
        await audit(actor, programId, "batch.create", "Batch", batch.id, null, input);
        return toBatchView(batch);
      }),
    );
  },

  async updateBatch(actor: Actor, id: string, input: UpdateBatchInput) {
    const scope = scopeOf(actor);
    const before = await load(
      actor,
      repo.findBatch,
      id,
      batchResource,
      Action.STRUCTURE_MANAGE,
      "Batch",
    );
    return unique("A batch with this name", () =>
      transaction(scope, async () => {
        const after = await repo.updateBatch(scope, id, input);
        await audit(
          actor,
          before.programId,
          "batch.update",
          "Batch",
          id,
          toBatchView(before),
          input,
        );
        return toBatchView(after);
      }),
    );
  },

  // ---------- Semesters ----------

  async listSemesters(actor: Actor, batchId: string) {
    await load(actor, repo.findBatch, batchId, batchResource, Action.STRUCTURE_READ, "Batch");
    const rows = await repo.listSemesters(scopeOf(actor), batchId);
    return rows
      .filter((s) => can(actor, Action.STRUCTURE_READ, semesterResource(s)))
      .map(toSemesterView);
  },

  async createSemester(actor: Actor, batchId: string, input: CreateSemesterInput) {
    const scope = scopeOf(actor);
    const batch = await load(
      actor,
      repo.findBatch,
      batchId,
      batchResource,
      Action.STRUCTURE_MANAGE,
      "Batch",
    );
    return unique("This semester number", () =>
      transaction(scope, async () => {
        if (input.status === "ACTIVE") await this.completeActive(actor, batchId, null);
        const semester = await repo.createSemester(scope, {
          programId: batch.programId,
          batchId,
          number: input.number,
          startDate: fromDateOnly(input.startDate) ?? null,
          endDate: fromDateOnly(input.endDate) ?? null,
          status: input.status,
        });
        await audit(
          actor,
          batch.programId,
          "semester.create",
          "Semester",
          semester.id,
          null,
          input,
        );
        return toSemesterView(semester);
      }),
    );
  },

  async updateSemester(actor: Actor, id: string, input: UpdateSemesterInput) {
    const scope = scopeOf(actor);
    const before = await load(
      actor,
      repo.findSemester,
      id,
      semesterResource,
      Action.STRUCTURE_MANAGE,
      "Semester",
    );
    const startDate = fromDateOnly(input.startDate);
    const endDate = fromDateOnly(input.endDate);
    const start = startDate === undefined ? before.startDate : startDate;
    const end = endDate === undefined ? before.endDate : endDate;
    if (start && end && start > end) {
      throw AppError.invalid("The end date is before the start date", [
        { path: "endDate", message: "Before the start date" },
      ]);
    }
    return unique("This semester number", () =>
      transaction(scope, async () => {
        // Making a semester active completes the batch's previous active semester.
        if (input.status === "ACTIVE" && before.status !== "ACTIVE") {
          await this.completeActive(actor, before.batchId, id);
        }
        const after = await repo.updateSemester(scope, id, {
          ...(input.number !== undefined ? { number: input.number } : {}),
          ...(startDate !== undefined ? { startDate } : {}),
          ...(endDate !== undefined ? { endDate } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
        });
        await audit(
          actor,
          before.programId,
          "semester.update",
          "Semester",
          id,
          toSemesterView(before),
          input,
        );
        return toSemesterView(after);
      }),
    );
  },

  /** Marks the batch's active semester (other than `exceptId`) completed. Inside a transaction. */
  async completeActive(actor: Actor, batchId: string, exceptId: string | null) {
    const scope = scopeOf(actor);
    const active = await repo.findActiveSemester(scope, batchId);
    if (!active || active.id === exceptId) return;
    await repo.updateSemester(scope, active.id, { status: "COMPLETED" });
    await audit(
      actor,
      active.programId,
      "semester.complete",
      "Semester",
      active.id,
      { status: "ACTIVE" },
      { status: "COMPLETED" },
    );
  },

  // ---------- Sections ----------

  async listSections(actor: Actor, semesterId: string) {
    await load(
      actor,
      repo.findSemester,
      semesterId,
      semesterResource,
      Action.STRUCTURE_READ,
      "Semester",
    );
    const rows = await repo.listSections(scopeOf(actor), semesterId);
    return rows
      .filter((s) => can(actor, Action.STRUCTURE_READ, sectionResource(s)))
      .map(toSectionView);
  },

  async createSection(actor: Actor, semesterId: string, input: CreateSectionInput) {
    const scope = scopeOf(actor);
    const semester = await load(
      actor,
      repo.findSemester,
      semesterId,
      semesterResource,
      Action.STRUCTURE_MANAGE,
      "Semester",
    );
    return unique("A section with this name", () =>
      transaction(scope, async () => {
        const section = await repo.createSection(scope, {
          programId: semester.programId,
          batchId: semester.batchId,
          semesterId,
          name: input.name,
        });
        await audit(
          actor,
          semester.programId,
          "section.create",
          "Section",
          section.id,
          null,
          input,
        );
        return toSectionView(section);
      }),
    );
  },

  async updateSection(actor: Actor, id: string, input: UpdateSectionInput) {
    const scope = scopeOf(actor);
    const before = await load(
      actor,
      repo.findSection,
      id,
      sectionResource,
      Action.STRUCTURE_MANAGE,
      "Section",
    );
    return unique("A section with this name", () =>
      transaction(scope, async () => {
        const after = await repo.updateSection(scope, id, input);
        await audit(
          actor,
          before.programId,
          "section.update",
          "Section",
          id,
          toSectionView(before),
          input,
        );
        return toSectionView(after);
      }),
    );
  },

  // ---------- Subjects ----------

  async listSubjects(actor: Actor, semesterId: string) {
    await load(
      actor,
      repo.findSemester,
      semesterId,
      semesterResource,
      Action.STRUCTURE_READ,
      "Semester",
    );
    const rows = await repo.listSubjects(scopeOf(actor), semesterId);
    return rows
      .filter((s) => can(actor, Action.STRUCTURE_READ, subjectResource(s)))
      .map(toSubjectView);
  },

  async getSubject(actor: Actor, id: string) {
    return toSubjectView(
      await load(actor, repo.findSubject, id, subjectResource, Action.STRUCTURE_READ, "Subject"),
    );
  },

  async createSubject(actor: Actor, semesterId: string, input: CreateSubjectInput) {
    const scope = scopeOf(actor);
    const semester = await load(
      actor,
      repo.findSemester,
      semesterId,
      semesterResource,
      Action.STRUCTURE_MANAGE,
      "Semester",
    );
    return unique("A subject with this code in this semester", () =>
      transaction(scope, async () => {
        const subject = await repo.createSubject(scope, {
          programId: semester.programId,
          batchId: semester.batchId,
          semesterId,
          name: input.name,
          code: input.code,
          credits: input.credits ?? null,
        });
        await audit(
          actor,
          semester.programId,
          "subject.create",
          "Subject",
          subject.id,
          null,
          input,
        );
        return toSubjectView(subject);
      }),
    );
  },

  async updateSubject(actor: Actor, id: string, input: UpdateSubjectInput) {
    const scope = scopeOf(actor);
    const before = await load(
      actor,
      repo.findSubject,
      id,
      subjectResource,
      Action.STRUCTURE_MANAGE,
      "Subject",
    );
    return unique("A subject with this code in this semester", () =>
      transaction(scope, async () => {
        const after = await repo.updateSubject(scope, id, input);
        await audit(
          actor,
          before.programId,
          "subject.update",
          "Subject",
          id,
          toSubjectView(before),
          input,
        );
        return toSubjectView(after);
      }),
    );
  },

  // ---------- Lookups for other modules (no authorization: callers check their own action) ----------

  findSemester: (scope: TenantScope, id: string) => repo.findSemester(scope, id),
  findSection: (scope: TenantScope, id: string) => repo.findSection(scope, id),
  findSections: (scope: TenantScope, ids: string[]) => repo.findSections(scope, ids),
  findSubject: (scope: TenantScope, id: string) => repo.findSubject(scope, id),
  findSubjects: (scope: TenantScope, ids: string[]) => repo.findSubjects(scope, ids),
  findBatch: (scope: TenantScope, id: string) => repo.findBatch(scope, id),
  findProgram: (scope: TenantScope, id: string) => repo.findProgram(scope, id),
  findActiveSemester: (scope: TenantScope, batchId: string) =>
    repo.findActiveSemester(scope, batchId),
};
