import { withTenant, type TenantScope } from "../../common/db/scope.js";
import type { Prisma } from "../../generated/prisma/client.js";
import type { StructureStatus } from "../../generated/prisma/enums.js";

const include = {
  subject: { select: { id: true, name: true, code: true } },
  section: { select: { id: true, name: true } },
  teachers: {
    include: { user: { select: { displayName: true } } },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
  },
} satisfies Prisma.ClassInclude;

const order: Prisma.ClassOrderByWithRelationInput[] = [
  { subject: { code: "asc" } },
  { section: { name: "asc" } },
];

export const classesRepository = {
  create(
    scope: TenantScope,
    data: {
      programId: string;
      batchId: string;
      semesterId: string;
      subjectId: string;
      sectionId: string;
    },
    teacherUserIds: string[],
  ) {
    return withTenant(scope.tenantId, (db) =>
      db.class.create({
        data: {
          ...data,
          tenantId: scope.tenantId,
          teachers: {
            // classId and tenantId come from the parent through the composite relation.
            create: teacherUserIds.map((userId, i) => ({ userId, isPrimary: i === 0 })),
          },
        },
        include,
      }),
    );
  },

  find(scope: TenantScope, id: string) {
    return withTenant(scope.tenantId, (db) =>
      db.class.findFirst({ where: { id, tenantId: scope.tenantId }, include }),
    );
  },

  findBySubjectAndSection(scope: TenantScope, subjectId: string, sectionId: string) {
    return withTenant(scope.tenantId, (db) =>
      db.class.findFirst({ where: { tenantId: scope.tenantId, subjectId, sectionId }, include }),
    );
  },

  listBySemester(scope: TenantScope, semesterId: string) {
    return withTenant(scope.tenantId, (db) =>
      db.class.findMany({
        where: { tenantId: scope.tenantId, semesterId },
        include,
        orderBy: order,
      }),
    );
  },

  listBySections(scope: TenantScope, sectionIds: string[]) {
    return withTenant(scope.tenantId, (db) =>
      db.class.findMany({
        where: { tenantId: scope.tenantId, sectionId: { in: sectionIds }, status: "ACTIVE" },
        include,
        orderBy: order,
      }),
    );
  },

  listTaughtBy(scope: TenantScope, userId: string) {
    return withTenant(scope.tenantId, (db) =>
      db.class.findMany({
        where: {
          tenantId: scope.tenantId,
          status: "ACTIVE",
          teachers: { some: { userId } },
        },
        include,
        orderBy: order,
      }),
    );
  },

  /** Replaces the class's teachers; the first one becomes the primary. */
  setTeachers(scope: TenantScope, classId: string, teacherUserIds: string[]) {
    return withTenant(scope.tenantId, async (db) => {
      await db.classTeacher.deleteMany({ where: { tenantId: scope.tenantId, classId } });
      await db.classTeacher.createMany({
        data: teacherUserIds.map((userId, i) => ({
          tenantId: scope.tenantId,
          classId,
          userId,
          isPrimary: i === 0,
        })),
      });
      return db.class.findFirst({ where: { id: classId, tenantId: scope.tenantId }, include });
    });
  },

  updateStatus(scope: TenantScope, id: string, status: StructureStatus) {
    return withTenant(scope.tenantId, (db) =>
      db.class.update({ where: { id, tenantId: scope.tenantId }, data: { status }, include }),
    );
  },
};
