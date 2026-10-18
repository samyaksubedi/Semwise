import { z } from "zod";
import { newPasswordSchema, tokenSchema } from "./auth.js";
import { nameSchema } from "./common.js";
import type { Role } from "./roles.js";

export const peekInvitationSchema = z.object({ token: tokenSchema });

/**
 * Accepting an invite. A new person sets a password (and may correct their name); someone who
 * already has a Semwise account in another college keeps their password and only joins.
 */
export const acceptInvitationSchema = z.object({
  token: tokenSchema,
  password: newPasswordSchema.optional(),
  displayName: nameSchema(120).optional(),
});
export type AcceptInvitationInput = z.infer<typeof acceptInvitationSchema>;

export type InvitationStatus = "PENDING" | "ACCEPTED" | "REVOKED" | "EXPIRED";

/** What the accept page shows before the person acts. */
export interface InvitationPreview {
  collegeName: string;
  role: Role;
  roleLabel: string;
  email: string;
  displayName: string | null;
  /** False when the email already has an account with a password. */
  needsPassword: boolean;
}

export interface AcceptInvitationResult {
  /** True when a session was started (the person set a password just now). */
  loggedIn: boolean;
  tenantId: string;
}

export const ROLE_LABELS: Record<Role, string> = {
  SUPER_ADMIN: "Super Admin",
  UNIVERSITY_ADMIN: "University Admin",
  PROGRAM_ADMIN: "Program Admin",
  TEACHER: "Teacher",
  CR: "Class Representative",
  STUDENT: "Student",
};
