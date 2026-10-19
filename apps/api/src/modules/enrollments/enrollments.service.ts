import {
  ErrorCode,
  IMPORT_COLUMNS,
  MAX_CRS_PER_SECTION,
  MAX_IMPORT_ROWS,
  addStudentSchema,
  parseCsv,
  type AddStudentInput,
  type BulkAssignInput,
  type GrantCrInput,
  type ImportResult,
  type ImportRowResult,
  type InviteProgress,
  type StudentDetailView,
  type StudentView,
  type UpdateStudentInput,
} from "@semwise/shared";
import { isUniqueViolation, transaction, type TenantScope } from "../../common/db/scope.js";
import { AppError } from "../../common/errors/app-error.js";
import { auditService } from "../audit/index.js";
import { Action, can, type Actor, type ActorEnrollment, type Resource } from "../authz/index.js";
import { invitationsService, type AcceptHandler } from "../invitations/index.js";
import { membershipsService } from "../memberships/index.js";
import { sentToday } from "../notifications/index.js";
import { structureService } from "../structure/index.js";
import { enrollmentsRepository as repo } from "./enrollments.repository.js";

/** A resend waits at least this long after the previous send. */
export const RESEND_COOLDOWN_MS = 10 * 60_000;

type Semester = NonNullable<Awaited<ReturnType<typeof structureService.findSemester>>>;
type Section = NonNullable<Awaited<ReturnType<typeof structureService.findSection>>>;
type Student = NonNullable<Awaited<ReturnType<typeof repo.findStudent>>>;

const scopeOf = (actor: Actor): TenantScope => ({ tenantId: actor.tenantId! });

function semesterResource(s: Semester): Resource {
  return { tenantId: s.tenantId, programId: s.programId, batchId: s.batchId, semesterId: s.id };
}
function studentResource(s: { tenantId: string; programId: string; batchId: string }): Resource {
  return { tenantId: s.tenantId, programId: s.programId, batchId: s.batchId };
}
function sectionResource(s: Section): Resource {
  return {
    tenantId: s.tenantId,
    programId: s.programId,
    batchId: s.batchId,
    semesterId: s.semesterId,
    sectionId: s.id,
  };
}

/** 404 when the actor cannot even see the record, 403 when they see it but may not act. */
function check(actor: Actor, action: Action, resource: Resource, label: string): void {
  if (can(actor, action, resource)) return;
  throw can(actor, Action.STRUCTURE_READ, resource)
    ? AppError.forbidden()
    : AppError.notFound(`${label} not found`);
}

async function loadSemester(actor: Actor, id: string, action: Action): Promise<Semester> {
  const semester = await structureService.findSemester(scopeOf(actor), id);
  if (!semester) throw AppError.notFound("Semester not found");
  check(actor, action, semesterResource(semester), "Semester");
  return semester;
}

async function loadSection(actor: Actor, id: string, action: Action): Promise<Section> {
  const section = await structureService.findSection(scopeOf(actor), id);
  if (!section) throw AppError.notFound("Section not found");
  check(actor, action, sectionResource(section), "Section");
  return section;
}

async function loadStudent(actor: Actor, id: string, action: Action): Promise<Student> {
  const student = await repo.findStudent(scopeOf(actor), id);
  if (!student) throw AppError.notFound("Student not found");
  // Student records are admin data: anyone who may not manage them sees 404.
  if (!can(actor, action, studentResource(student))) throw AppError.notFound("Student not found");
  return student;
}

function audit(
  actor: Actor,
  programId: string,
  action: string,
  entityId: string,
  before: object | null,
  after: object | null,
) {
  return auditService.record({
    tenantId: actor.tenantId,
    programId,
    actorId: actor.userId,
    action,
    entityType: "StudentRecord",
    entityId,
    before,
    after,
  });
}

// ---------- CSV import ----------

const normalise = (header: string) => header.toLowerCase().replace(/[\s_-]+/g, "");

function columnIndexes(header: string[]) {
  const names = header.map(normalise);
  const find = (aliases: readonly string[]) => names.findIndex((n) => aliases.includes(n));
  return {
    email: find(IMPORT_COLUMNS.email),
    rollNo: find(IMPORT_COLUMNS.rollNo),
    name: find(IMPORT_COLUMNS.name),
    section: find(IMPORT_COLUMNS.section),
  };
}

interface PlannedRow {
  result: ImportRowResult;
  input?: AddStudentInput;
}

type Pending = { id: string; token: string };

export const enrollmentsService = {
  // ---------- Adding students ----------

  async addStudent(actor: Actor, semesterId: string, input: AddStudentInput) {
    const semester = await loadSemester(actor, semesterId, Action.STUDENTS_MANAGE);
    const section = await structureService.findSection(scopeOf(actor), input.sectionId);
    if (!section || section.semesterId !== semester.id) {
      throw AppError.invalid("This section is not in the semester", [
        { path: "sectionId", message: "Not in this semester" },
      ]);
    }
    const plan = await this.plan(actor, semester, [{ line: 1, input, section: section.name }]);
    const row = plan[0]!;
    if (row.result.status === "error") {
      throw AppError.conflict(ErrorCode.ALREADY_EXISTS, row.result.messages.join(" "));
    }
    if (row.result.status === "skipped") {
      throw AppError.conflict(ErrorCode.ALREADY_EXISTS, row.result.messages.join(" "));
    }
    const pending: Pending[] = [];
    const student = await transaction(scopeOf(actor), () =>
      this.createOrEnroll(actor, semester, row.input!, pending),
    );
    await this.sendInvites(actor, pending);
    return this.getStudent(actor, student.id);
  },

  /** Checks a CSV without writing anything (the preview table). */
  async previewImport(actor: Actor, semesterId: string, csv: string): Promise<ImportResult> {
    const semester = await loadSemester(actor, semesterId, Action.STUDENTS_MANAGE);
    const planned = await this.planCsv(actor, semester, csv);
    return summarise(planned, false);
  },

  /** Adds every valid row; invalid rows are reported and left out. Emails go out throttled. */
  async importStudents(actor: Actor, semesterId: string, csv: string): Promise<ImportResult> {
    const semester = await loadSemester(actor, semesterId, Action.STUDENTS_MANAGE);
    const planned = await this.planCsv(actor, semester, csv);
    const pending: Pending[] = [];
    await transaction(scopeOf(actor), async () => {
      for (const row of planned) {
        if (row.result.status === "ok")
          await this.createOrEnroll(actor, semester, row.input!, pending);
      }
      await auditService.record({
        tenantId: actor.tenantId,
        programId: semester.programId,
        actorId: actor.userId,
        action: "students.import",
        entityType: "Semester",
        entityId: semester.id,
        after: { added: planned.filter((r) => r.result.status === "ok").length },
      });
    });
    await this.sendInvites(actor, pending);
    return summarise(planned, true);
  },

  async planCsv(actor: Actor, semester: Semester, csv: string): Promise<PlannedRow[]> {
    const [header, ...body] = parseCsv(csv);
    if (!header) throw AppError.invalid("The file is empty");
    const cols = columnIndexes(header);
    if (cols.email < 0 || cols.rollNo < 0 || cols.section < 0) {
      throw AppError.invalid("The header needs email, roll number and section columns", [
        { path: "csv", message: "Missing columns: email, roll_no, section (name is optional)" },
      ]);
    }
    if (body.length > MAX_IMPORT_ROWS) {
      throw AppError.invalid(`Import at most ${MAX_IMPORT_ROWS} rows at a time`);
    }
    const sections = await structureService.listSectionsRaw(scopeOf(actor), semester.id);
    const byName = new Map(sections.map((s) => [s.name.trim().toLowerCase(), s]));
    const rows = body.map((cells, i) => {
      const cell = (index: number) => (index >= 0 ? (cells[index] ?? "").trim() : "");
      const sectionName = cell(cols.section);
      const section = byName.get(sectionName.toLowerCase());
      const parsed = addStudentSchema.safeParse({
        email: cell(cols.email),
        rollNo: cell(cols.rollNo),
        displayName: cell(cols.name) || undefined,
        sectionId: section?.id ?? "",
      });
      return {
        line: i + 2,
        section: sectionName,
        raw: { email: cell(cols.email), rollNo: cell(cols.rollNo) },
        sectionKnown: Boolean(section),
        parsed,
      };
    });
    const planned = await this.plan(
      actor,
      semester,
      rows.map((r) => ({
        line: r.line,
        section: r.section,
        input: r.parsed.success ? r.parsed.data : undefined,
        raw: r.raw,
        errors: [
          ...(r.sectionKnown ? [] : [`Unknown section "${r.section}"`]),
          ...(r.parsed.success
            ? []
            : r.parsed.error.issues
                .filter((issue) => issue.path[0] !== "sectionId")
                .map((issue) => `${String(issue.path[0])}: ${issue.message}`)),
        ],
      })),
    );
    return planned;
  },

  /**
   * Decides what happens to each row: a new student (invite), an existing student of this batch
   * placed in this semester, a skip (already here) or an error. Also catches duplicates inside
   * the same list.
   */
  async plan(
    actor: Actor,
    semester: Semester,
    rows: {
      line: number;
      section: string;
      input?: AddStudentInput;
      raw?: { email: string; rollNo: string };
      errors?: string[];
    }[],
  ): Promise<PlannedRow[]> {
    const valid = rows.flatMap((r) => (r.input && !r.errors?.length ? [r.input] : []));
    const existing = await repo.findStudentsByEmailsOrRolls(
      scopeOf(actor),
      valid.map((r) => r.email),
      valid.map((r) => r.rollNo),
    );
    const seenEmails = new Map<string, number>();
    const seenRolls = new Map<string, number>();
    return rows.map((row) => {
      const email = row.input?.email ?? row.raw?.email ?? "";
      const rollNo = row.input?.rollNo ?? row.raw?.rollNo ?? "";
      const result: ImportRowResult = {
        line: row.line,
        email,
        rollNo,
        section: row.section,
        status: "ok",
        messages: [...(row.errors ?? [])],
      };
      if (!row.input || result.messages.length) {
        result.status = "error";
        return { result };
      }
      const dupEmail = seenEmails.get(email);
      const dupRoll = seenRolls.get(rollNo.toLowerCase());
      if (dupEmail) result.messages.push(`Same email as line ${dupEmail}`);
      if (dupRoll) result.messages.push(`Same roll number as line ${dupRoll}`);
      seenEmails.set(email, row.line);
      seenRolls.set(rollNo.toLowerCase(), row.line);

      const byEmail = existing.find((s) => s.email === email);
      const byRoll = existing.find((s) => s.rollNo.toLowerCase() === rollNo.toLowerCase());
      if (byRoll && byRoll.email !== email) {
        result.messages.push("This roll number belongs to another student");
      }
      if (byEmail && byEmail.rollNo.toLowerCase() !== rollNo.toLowerCase()) {
        result.messages.push(`This email is already registered with roll number ${byEmail.rollNo}`);
      }
      if (byEmail && byEmail.batchId !== semester.batchId) {
        result.messages.push("This student belongs to another batch");
      }
      if (byEmail?.status === "DEACTIVATED") result.messages.push("This student was deactivated");
      if (result.messages.length) {
        result.status = "error";
        return { result };
      }
      if (byEmail?.enrollments.some((e) => e.semesterId === semester.id && e.status === "ACTIVE")) {
        result.status = "skipped";
        result.messages.push("Already in this semester");
        return { result };
      }
      return { result, input: row.input };
    });
  },

  /** Inside a transaction: a new student (with an invite) or an existing one placed here. */
  async createOrEnroll(
    actor: Actor,
    semester: Semester,
    input: AddStudentInput,
    pending: Pending[],
  ) {
    const scope = scopeOf(actor);
    let student = await repo.findStudentByEmail(scope, input.email);
    try {
      if (!student) {
        const invite = await invitationsService.createOrRefresh(
          scope,
          {
            email: input.email,
            displayName: input.displayName ?? null,
            rollNo: input.rollNo,
            role: "STUDENT",
            programId: semester.programId,
            batchId: semester.batchId,
            semesterId: semester.id,
            sectionId: input.sectionId,
          },
          actor.userId,
        );
        student = await repo.createStudent(scope, {
          programId: semester.programId,
          batchId: semester.batchId,
          email: input.email,
          displayName: input.displayName ?? null,
          rollNo: input.rollNo,
          invitationId: invite.id,
        });
        pending.push(invite);
        await audit(actor, semester.programId, "student.invite", student.id, null, {
          rollNo: input.rollNo,
          sectionId: input.sectionId,
        });
      }
      await repo.upsertEnrollment(scope, {
        studentRecordId: student.id,
        programId: semester.programId,
        batchId: semester.batchId,
        semesterId: semester.id,
        sectionId: input.sectionId,
      });
      return student;
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw AppError.conflict(
          ErrorCode.ALREADY_EXISTS,
          "A student with this email or roll number exists",
        );
      }
      throw err;
    }
  },

  async sendInvites(actor: Actor, pending: Pending[]) {
    for (const invite of pending)
      await invitationsService.send(scopeOf(actor), invite.id, invite.token);
  },

  // ---------- Lists and progress ----------

  async listStudents(
    actor: Actor,
    semesterId: string,
    filter: { sectionId?: string; status?: "INVITED" | "ACTIVE" | "DEACTIVATED" },
  ): Promise<StudentView[]> {
    const semester = await loadSemester(actor, semesterId, Action.STUDENTS_MANAGE);
    const scope = scopeOf(actor);
    const students = await repo.listStudentsInSemester(scope, semester.id, filter);
    const invites = await invitationsService.sendInfo(
      scope,
      students.flatMap((s) => (s.invitationId ? [s.invitationId] : [])),
    );
    const sections = await structureService.listSectionsRaw(scope, semester.id);
    const crUsers = new Set<string>();
    for (const section of sections) {
      for (const userId of await membershipsService.holders(scope, "CR", {
        sectionId: section.id,
      })) {
        crUsers.add(`${section.id}:${userId}`);
      }
    }
    return students.map((s) => {
      const enrollment = s.enrollments[0];
      const sectionId = enrollment?.status === "ACTIVE" ? enrollment.sectionId : null;
      const invite = s.invitationId ? invites.get(s.invitationId) : undefined;
      return {
        id: s.id,
        email: s.email,
        displayName: s.displayName,
        rollNo: s.rollNo,
        status: s.status,
        sectionId,
        isCr: Boolean(s.userId && sectionId && crUsers.has(`${sectionId}:${s.userId}`)),
        invite: invite
          ? { status: invite.status, lastSentAt: invite.lastSentAt, sendCount: invite.sendCount }
          : null,
      };
    });
  },

  /** "Sending, 120 of 400": where the semester's student invites stand. */
  async inviteProgress(actor: Actor, semesterId: string): Promise<InviteProgress> {
    const semester = await loadSemester(actor, semesterId, Action.STUDENTS_MANAGE);
    const scope = scopeOf(actor);
    const students = await repo.listStudentsInSemester(scope, semester.id, {});
    const info = await invitationsService.sendInfo(
      scope,
      students.flatMap((s) => (s.invitationId ? [s.invitationId] : [])),
    );
    const progress = { total: info.size, queued: 0, sent: 0, failed: 0, accepted: 0 };
    for (const i of info.values()) {
      if (i.accepted) progress.accepted += 1;
      if (i.status === "QUEUED") progress.queued += 1;
      else if (i.status === "SENT") progress.sent += 1;
      else if (i.status === "FAILED") progress.failed += 1;
    }
    return { ...progress, today: await sentToday() };
  },

  async getStudent(actor: Actor, id: string): Promise<StudentDetailView> {
    const student = await loadStudent(actor, id, Action.STUDENTS_MANAGE);
    const scope = scopeOf(actor);
    const info = student.invitationId
      ? (await invitationsService.sendInfo(scope, [student.invitationId])).get(student.invitationId)
      : undefined;
    const sectionIds = student.enrollments.map((e) => e.sectionId);
    const crOf: string[] = [];
    if (student.userId) {
      for (const sectionId of sectionIds) {
        if (await membershipsService.hasRole(scope, student.userId, "CR", { sectionId }))
          crOf.push(sectionId);
      }
    }
    return {
      id: student.id,
      programId: student.programId,
      batchId: student.batchId,
      email: student.email,
      displayName: student.displayName,
      rollNo: student.rollNo,
      status: student.status,
      invite: info
        ? { status: info.status, lastSentAt: info.lastSentAt, sendCount: info.sendCount }
        : null,
      enrollments: student.enrollments.map((e) => ({
        semesterId: e.semesterId,
        semesterNumber: e.semester.number,
        sectionId: e.sectionId,
        sectionName: e.section.name,
        status: e.status,
        current: e.semester.status === "ACTIVE",
      })),
      crOfSectionIds: crOf,
    };
  },

  // ---------- Corrections ----------

  /** Fixes a wrong address (only before the student joins), roll number or name. */
  async updateStudent(actor: Actor, id: string, input: UpdateStudentInput) {
    const student = await loadStudent(actor, id, Action.STUDENTS_MANAGE);
    const scope = scopeOf(actor);
    const emailChanges = input.email !== undefined && input.email !== student.email;
    if (emailChanges && student.status !== "INVITED") {
      throw AppError.invalidState(
        "The email belongs to the student's account once they have joined; they can change it themselves.",
      );
    }
    let token: string | null = null;
    try {
      await transaction(scope, async () => {
        await repo.updateStudent(scope, id, input);
        if (emailChanges && student.invitationId) {
          token = await invitationsService.changeEmail(scope, student.invitationId, input.email!);
        }
        await audit(
          actor,
          student.programId,
          "student.update",
          id,
          { email: student.email, rollNo: student.rollNo, displayName: student.displayName },
          input,
        );
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw AppError.conflict(
          ErrorCode.ALREADY_EXISTS,
          "Another student has this email or roll number",
        );
      }
      throw err;
    }
    if (token && student.invitationId)
      await invitationsService.send(scope, student.invitationId, token);
    return this.getStudent(actor, id);
  },

  /** Sends the invite again with a fresh link (the old one stops working). */
  async resendInvite(actor: Actor, id: string, now = new Date()) {
    const student = await loadStudent(actor, id, Action.STUDENTS_MANAGE);
    if (student.status !== "INVITED" || !student.invitationId) {
      throw AppError.invalidState("Only a student who has not joined yet can be sent the invite");
    }
    const scope = scopeOf(actor);
    const info = (await invitationsService.sendInfo(scope, [student.invitationId])).get(
      student.invitationId,
    );
    const last = info?.lastSentAt ? new Date(info.lastSentAt).getTime() : 0;
    if (now.getTime() - last < RESEND_COOLDOWN_MS) {
      const minutes = Math.ceil((RESEND_COOLDOWN_MS - (now.getTime() - last)) / 60_000);
      throw new AppError(
        429,
        ErrorCode.RATE_LIMITED,
        `Wait ${minutes} more minute(s) before resending.`,
      );
    }
    const token = await invitationsService.refreshToken(scope, student.invitationId, now);
    await audit(actor, student.programId, "student.invite.resend", id, null, null);
    await invitationsService.send(scope, student.invitationId, token, now);
    return this.getStudent(actor, id);
  },

  /** Withdraws the invite of a student who has not joined; they leave the lists. */
  async revokeInvite(actor: Actor, id: string) {
    const student = await loadStudent(actor, id, Action.STUDENTS_MANAGE);
    if (student.status !== "INVITED") {
      throw AppError.invalidState("This student has already joined; deactivate them instead");
    }
    const scope = scopeOf(actor);
    await transaction(scope, async () => {
      if (student.invitationId) await invitationsService.revoke(scope, student.invitationId);
      await repo.updateStudent(scope, id, { status: "DEACTIVATED" });
      await repo.removeOpenEnrollments(scope, id);
      await audit(
        actor,
        student.programId,
        "student.invite.revoke",
        id,
        { status: "INVITED" },
        { status: "DEACTIVATED" },
      );
    });
    return this.getStudent(actor, id);
  },

  /**
   * A student who left: no more access to this college (student and CR roles), out of the
   * current semester. Past semesters, and their own account, are kept.
   */
  async deactivate(actor: Actor, id: string) {
    const student = await loadStudent(actor, id, Action.STUDENTS_MANAGE);
    if (student.status === "DEACTIVATED") return this.getStudent(actor, id);
    if (student.status === "INVITED") return this.revokeInvite(actor, id);
    const scope = scopeOf(actor);
    await transaction(scope, async () => {
      await repo.updateStudent(scope, id, { status: "DEACTIVATED" });
      await repo.removeOpenEnrollments(scope, id);
      if (student.userId) {
        await membershipsService.revoke(scope, student.userId, "STUDENT", {});
        for (const e of student.enrollments) {
          await membershipsService.revoke(scope, student.userId, "CR", { sectionId: e.sectionId });
        }
      }
      await audit(
        actor,
        student.programId,
        "student.deactivate",
        id,
        { status: student.status },
        { status: "DEACTIVATED" },
      );
    });
    return this.getStudent(actor, id);
  },

  // ---------- Sections per semester ----------

  /** Puts a student in a section for a semester, or moves them; history is kept per semester. */
  async assignSection(actor: Actor, studentId: string, semesterId: string, sectionId: string) {
    const student = await loadStudent(actor, studentId, Action.ENROLLMENT_MANAGE);
    const semester = await loadSemester(actor, semesterId, Action.ENROLLMENT_MANAGE);
    await transaction(scopeOf(actor), () => this.place(actor, student, semester, sectionId));
    return this.getStudent(actor, studentId);
  },

  /** Many placements in one semester at once (setting up the next semester). */
  async bulkAssign(actor: Actor, semesterId: string, input: BulkAssignInput) {
    const semester = await loadSemester(actor, semesterId, Action.ENROLLMENT_MANAGE);
    const scope = scopeOf(actor);
    const students = await repo.findStudentsByIds(
      scope,
      input.assignments.map((a) => a.studentId),
    );
    const byId = new Map(students.map((s) => [s.id, s]));
    await transaction(scope, async () => {
      for (const assignment of input.assignments) {
        const student = byId.get(assignment.studentId);
        if (!student) throw AppError.notFound(`Student ${assignment.studentId} not found`);
        await this.place(actor, student, semester, assignment.sectionId);
      }
    });
    return { placed: input.assignments.length };
  },

  /** Inside a transaction: validates and writes one placement. */
  async place(
    actor: Actor,
    student: {
      id: string;
      tenantId: string;
      programId: string;
      batchId: string;
      status: string;
      userId: string | null;
    },
    semester: Semester,
    sectionId: string,
  ) {
    const scope = scopeOf(actor);
    if (student.batchId !== semester.batchId) {
      throw AppError.invalid("This semester belongs to another batch");
    }
    if (student.status === "DEACTIVATED")
      throw AppError.invalidState("This student was deactivated");
    const section = await structureService.findSection(scope, sectionId);
    if (!section || section.semesterId !== semester.id) {
      throw AppError.invalid("This section is not in the semester", [
        { path: "sectionId", message: "Not in this semester" },
      ]);
    }
    const before = await repo.findEnrollment(scope, student.id, semester.id);
    await repo.upsertEnrollment(scope, {
      studentRecordId: student.id,
      programId: semester.programId,
      batchId: semester.batchId,
      semesterId: semester.id,
      sectionId,
    });
    // A CR who moves to another section stops being that section's CR.
    if (before && before.sectionId !== sectionId && student.userId) {
      await membershipsService.revoke(scope, student.userId, "CR", { sectionId: before.sectionId });
    }
    await audit(
      actor,
      semester.programId,
      before ? "enrollment.move" : "enrollment.create",
      student.id,
      before ? { semesterId: semester.id, sectionId: before.sectionId } : null,
      { semesterId: semester.id, sectionId },
    );
  },

  // ---------- Class Representatives ----------

  async grantCr(actor: Actor, sectionId: string, input: GrantCrInput) {
    const section = await loadSection(actor, sectionId, Action.CR_MANAGE);
    const scope = scopeOf(actor);
    const student = await repo.findStudent(scope, input.studentId);
    if (!student) throw AppError.notFound("Student not found");
    if (student.status !== "ACTIVE" || !student.userId) {
      throw AppError.invalidState("Only a student who has joined can be CR");
    }
    const inSection = student.enrollments.some(
      (e) => e.sectionId === section.id && e.status === "ACTIVE",
    );
    if (!inSection) throw AppError.invalidState("The student is not in this section");
    const userId = student.userId;
    let replaced: string | null = null;
    if (input.replaceStudentId) {
      const old = await repo.findStudent(scope, input.replaceStudentId);
      if (!old?.userId) throw AppError.notFound("The CR to replace was not found");
      replaced = old.userId;
    }
    await transaction(scope, async () => {
      const current = await membershipsService.holders(scope, "CR", { sectionId: section.id });
      if (current.includes(userId)) return;
      if (replaced && !current.includes(replaced))
        throw AppError.invalidState("That student is not a CR of this section");
      if (!replaced && current.length >= MAX_CRS_PER_SECTION) {
        throw AppError.conflict(
          ErrorCode.CONFLICT,
          `This section already has ${MAX_CRS_PER_SECTION} CRs. Choose one to replace.`,
        );
      }
      if (replaced)
        await membershipsService.revoke(scope, replaced, "CR", { sectionId: section.id });
      await membershipsService.ensureRole(scope, userId, "CR", actor.userId, {
        sectionId: section.id,
      });
      await auditService.record({
        tenantId: scope.tenantId,
        programId: section.programId,
        actorId: actor.userId,
        action: "cr.grant",
        entityType: "Section",
        entityId: section.id,
        before: replaced ? { replacedUserId: replaced } : null,
        after: { userId },
      });
    });
    return { sectionId: section.id, userId };
  },

  /** Ends one student's CR role in the section; the section's other CRs keep theirs. */
  async removeCr(actor: Actor, sectionId: string, studentId: string) {
    const section = await loadSection(actor, sectionId, Action.CR_MANAGE);
    const scope = scopeOf(actor);
    const student = await repo.findStudent(scope, studentId);
    await transaction(scope, async () => {
      const current = await membershipsService.holders(scope, "CR", { sectionId: section.id });
      if (!student?.userId || !current.includes(student.userId))
        throw AppError.notFound("That student is not a CR of this section");
      await membershipsService.revoke(scope, student.userId, "CR", { sectionId: section.id });
      await auditService.record({
        tenantId: scope.tenantId,
        programId: section.programId,
        actorId: actor.userId,
        action: "cr.remove",
        entityType: "Section",
        entityId: section.id,
        before: { userId: student.userId },
        after: null,
      });
    });
  },

  // ---------- Hooks for other modules ----------

  /** authz: where a signed-in student is placed (all semesters, current marked). */
  async actorEnrollments(tenantId: string, userId: string): Promise<ActorEnrollment[]> {
    const rows = await repo.listForUser({ tenantId }, userId);
    return rows.map((e) => ({
      programId: e.programId,
      batchId: e.batchId,
      semesterId: e.semesterId,
      sectionId: e.sectionId,
      current: e.semester.status === "ACTIVE",
    }));
  },

  /** invitations: accepting a student invite links the record to the account. */
  acceptStudent: (async (scope, invitation, user) => {
    const student = await repo.findStudentByInvitation(scope, invitation.id);
    if (!student || student.status === "DEACTIVATED") {
      throw new AppError(
        400,
        ErrorCode.INVALID_TOKEN,
        "This invite link is invalid or has expired.",
      );
    }
    const other = await repo.findStudentByUser(scope, user.id);
    if (other && other.id !== student.id) {
      throw AppError.conflict(ErrorCode.ALREADY_EXISTS, "This account is already a student here");
    }
    await repo.updateStudent(scope, student.id, {
      userId: user.id,
      status: "ACTIVE",
      email: user.email,
    });
    await membershipsService.ensureRole(scope, user.id, "STUDENT", invitation.invitedById);
  }) satisfies AcceptHandler,
};

function summarise(planned: PlannedRow[], committed: boolean): ImportResult {
  const counts = { ok: 0, error: 0, skipped: 0 };
  for (const row of planned) counts[row.result.status] += 1;
  return { rows: planned.map((r) => r.result), counts, committed };
}
