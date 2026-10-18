import { AppError } from "../../common/errors/app-error.js";
import { membershipsService } from "../memberships/index.js";
import { rules, type Action } from "./authz.rules.js";
import type { Actor, ActorClass, ActorEnrollment, Resource } from "./authz.types.js";

/**
 * Extra facts about the actor that later features contribute (enrollments, for example), kept
 * as loaders so authz does not depend on those modules directly.
 */
type EnrollmentLoader = (tenantId: string, userId: string) => Promise<ActorEnrollment[]>;
let enrollmentLoader: EnrollmentLoader = async () => [];

export function registerEnrollmentLoader(loader: EnrollmentLoader): void {
  enrollmentLoader = loader;
}

type TeachingLoader = (tenantId: string, userId: string) => Promise<ActorClass[]>;
let teachingLoader: TeachingLoader = async () => [];

export function registerTeachingLoader(loader: TeachingLoader): void {
  teachingLoader = loader;
}

/** True when the actor may perform the action on the resource. Deny by default. */
export function can(actor: Actor, action: Action, resource: Resource): boolean {
  const rule = rules[action];
  return rule ? rule(actor, resource) : false;
}

/** Throws 403 unless allowed. Callers load the resource scoped by tenant first, so a foreign
 *  resource has already answered 404. */
export function authorize(actor: Actor, action: Action, resource: Resource): void {
  if (!can(actor, action, resource)) throw AppError.forbidden();
}

/** True when the actor holds the role anywhere in this college. */
export function hasRole(actor: Actor, role: Actor["memberships"][number]["role"]): boolean {
  return actor.memberships.some((m) => m.role === role);
}

/** Program ids the actor administers. */
export function adminProgramIds(actor: Actor): string[] {
  return actor.memberships
    .filter((m) => m.role === "PROGRAM_ADMIN" && m.programId)
    .map((m) => m.programId as string);
}

export const authzService = {
  /** Builds the actor for one college from the database. */
  async loadActor(tenantId: string, userId: string): Promise<Actor> {
    const [memberships, enrollments] = await Promise.all([
      membershipsService.grantsInTenant({ tenantId }, userId),
      enrollmentLoader(tenantId, userId),
    ]);
    const teaching = await teachingLoader(tenantId, userId);
    return { userId, tenantId, isSuperAdmin: false, memberships, enrollments, teaching };
  },

  /** The Super Admin outside any college. */
  platformActor(userId: string): Actor {
    return {
      userId,
      tenantId: null,
      isSuperAdmin: true,
      memberships: [],
      enrollments: [],
      teaching: [],
    };
  },
};
