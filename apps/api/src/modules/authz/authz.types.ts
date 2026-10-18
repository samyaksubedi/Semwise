import type { Role, RoleGrant } from "@semwise/shared";

/** One semester-section a student is (or was) enrolled in. */
export interface ActorEnrollment {
  programId: string;
  batchId: string;
  semesterId: string;
  sectionId: string;
  /** The enrollment of the active semester. */
  current: boolean;
}

/**
 * Who is acting, inside one college. Loaded on the server for every request from the session and
 * the database; nothing here comes from the client.
 */
export interface Actor {
  userId: string;
  /** Null only for the Super Admin's platform area. */
  tenantId: string | null;
  isSuperAdmin: boolean;
  /** Active memberships in this college only; rights never carry across colleges. */
  memberships: RoleGrant[];
  enrollments: ActorEnrollment[];
}

/**
 * What an action is done to, described by its scope as loaded from the database.
 * Services fill in what applies; a missing field never grants access.
 */
export interface Resource {
  tenantId: string;
  programId?: string | null;
  batchId?: string | null;
  semesterId?: string | null;
  sectionId?: string | null;
  classId?: string | null;
  /** Subject teachers of the class (or of the classes) the resource belongs to. */
  teacherUserIds?: string[];
  /** Author or owner (entry author, private data owner). */
  ownerId?: string | null;
  /** Approval setting locked by the Program Admin. */
  locked?: boolean;
}

export type { Role };
