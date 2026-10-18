export const Role = {
  SUPER_ADMIN: "SUPER_ADMIN",
  UNIVERSITY_ADMIN: "UNIVERSITY_ADMIN",
  PROGRAM_ADMIN: "PROGRAM_ADMIN",
  TEACHER: "TEACHER",
  CR: "CR",
  STUDENT: "STUDENT",
} as const;
export type Role = (typeof Role)[keyof typeof Role];

/** One role the user holds in the active college, with its scope. */
export interface RoleGrant {
  role: Role;
  programId: string | null;
  sectionId: string | null;
}

/** A college the user belongs to, as shown in the college switcher. */
export interface TenantSummary {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  roles: Role[];
}

export interface CurrentUser {
  id: string;
  email: string;
  displayName: string;
  isSuperAdmin: boolean;
}

/** What /v1/auth/me and login return. */
export interface SessionView {
  user: CurrentUser;
  tenants: TenantSummary[];
  activeTenantId: string | null;
  /** Roles in the active college (empty without one). */
  roles: RoleGrant[];
}
