import { withTenant, type TenantScope } from "../../common/db/scope.js";
import type { StudentStatus } from "../../generated/prisma/enums.js";

const withEnrollments = {
  enrollments: {
    include: {
      semester: { select: { number: true, status: true } },
      section: { select: { name: true } },
    },
    orderBy: { semester: { number: "asc" as const } },
  },
} as const;

export const enrollmentsRepository = {
  // ---------- Student records ----------

  createStudent(
    scope: TenantScope,
    data: {
      programId: string;
      batchId: string;
      email: string;
      displayName: string | null;
      rollNo: string;
      invitationId: string | null;
    },
  ) {
    return withTenant(scope.tenantId, (db) =>
      db.studentRecord.create({ data: { ...data, tenantId: scope.tenantId } }),
    );
  },

  findStudent(scope: TenantScope, id: string) {
    return withTenant(scope.tenantId, (db) =>
      db.studentRecord.findFirst({
        where: { id, tenantId: scope.tenantId },
        include: withEnrollments,
      }),
    );
  },

  findStudentByEmail(scope: TenantScope, email: string) {
    return withTenant(scope.tenantId, (db) =>
      db.studentRecord.findFirst({ where: { tenantId: scope.tenantId, email } }),
    );
  },

  findStudentsByEmailsOrRolls(scope: TenantScope, emails: string[], rollNos: string[]) {
    return withTenant(scope.tenantId, (db) =>
      db.studentRecord.findMany({
        where: {
          tenantId: scope.tenantId,
          OR: [{ email: { in: emails } }, { rollNo: { in: rollNos } }],
        },
        include: { enrollments: { select: { semesterId: true, status: true } } },
      }),
    );
  },

  findStudentByRollNo(scope: TenantScope, rollNo: string) {
    return withTenant(scope.tenantId, (db) =>
      db.studentRecord.findFirst({ where: { tenantId: scope.tenantId, rollNo } }),
    );
  },

  findStudentByInvitation(scope: TenantScope, invitationId: string) {
    return withTenant(scope.tenantId, (db) =>
      db.studentRecord.findFirst({ where: { tenantId: scope.tenantId, invitationId } }),
    );
  },

  findStudentByUser(scope: TenantScope, userId: string) {
    return withTenant(scope.tenantId, (db) =>
      db.studentRecord.findFirst({ where: { tenantId: scope.tenantId, userId } }),
    );
  },

  findStudentsByIds(scope: TenantScope, ids: string[]) {
    return withTenant(scope.tenantId, (db) =>
      db.studentRecord.findMany({ where: { id: { in: ids }, tenantId: scope.tenantId } }),
    );
  },

  updateStudent(
    scope: TenantScope,
    id: string,
    data: Partial<{
      email: string;
      rollNo: string;
      displayName: string | null;
      status: StudentStatus;
      userId: string;
    }>,
  ) {
    return withTenant(scope.tenantId, (db) =>
      db.studentRecord.update({ where: { id, tenantId: scope.tenantId }, data }),
    );
  },

  /** Students placed in a semester (any enrollment status), with that semester's enrollment. */
  listStudentsInSemester(
    scope: TenantScope,
    semesterId: string,
    filter: { sectionId?: string; status?: StudentStatus },
  ) {
    return withTenant(scope.tenantId, (db) =>
      db.studentRecord.findMany({
        where: {
          tenantId: scope.tenantId,
          ...(filter.status ? { status: filter.status } : {}),
          enrollments: {
            some: { semesterId, ...(filter.sectionId ? { sectionId: filter.sectionId } : {}) },
          },
        },
        include: { enrollments: { where: { semesterId } } },
        orderBy: { rollNo: "asc" },
      }),
    );
  },

  // ---------- Enrollments ----------

  /** Places the student in a section for the semester (one row per student and semester). */
  upsertEnrollment(
    scope: TenantScope,
    data: {
      studentRecordId: string;
      programId: string;
      batchId: string;
      semesterId: string;
      sectionId: string;
    },
  ) {
    return withTenant(scope.tenantId, (db) =>
      db.enrollment.upsert({
        where: {
          studentRecordId_semesterId: {
            studentRecordId: data.studentRecordId,
            semesterId: data.semesterId,
          },
        },
        create: { ...data, tenantId: scope.tenantId },
        update: { sectionId: data.sectionId, status: "ACTIVE" },
      }),
    );
  },

  findEnrollment(scope: TenantScope, studentRecordId: string, semesterId: string) {
    return withTenant(scope.tenantId, (db) =>
      db.enrollment.findFirst({
        where: { tenantId: scope.tenantId, studentRecordId, semesterId },
      }),
    );
  },

  /** Takes the student out of every semester that is not finished; past semesters stay. */
  removeOpenEnrollments(scope: TenantScope, studentRecordId: string) {
    return withTenant(scope.tenantId, (db) =>
      db.enrollment.updateMany({
        where: {
          tenantId: scope.tenantId,
          studentRecordId,
          status: "ACTIVE",
          semester: { status: { not: "COMPLETED" } },
        },
        data: { status: "REMOVED" },
      }),
    );
  },

  /** What authz needs about a signed-in student: their placements, current or past. */
  listForUser(scope: TenantScope, userId: string) {
    return withTenant(scope.tenantId, (db) =>
      db.enrollment.findMany({
        where: {
          tenantId: scope.tenantId,
          status: "ACTIVE",
          student: { userId, status: "ACTIVE" },
        },
        include: { semester: { select: { status: true } } },
      }),
    );
  },

  countActiveInSection(scope: TenantScope, sectionId: string) {
    return withTenant(scope.tenantId, (db) =>
      db.enrollment.count({ where: { tenantId: scope.tenantId, sectionId, status: "ACTIVE" } }),
    );
  },
};
