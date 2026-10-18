import { z } from "zod";
import { emailSchema } from "./auth.js";
import { nameSchema } from "./common.js";

/** An IANA timezone the runtime knows, e.g. "Asia/Kathmandu". */
export const timezoneSchema = z
  .string()
  .min(1)
  .max(64)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, "Unknown timezone");

export const tenantSlugSchema = z
  .string()
  .min(2)
  .max(60)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers and single hyphens");

/** Super Admin: create a college and invite its first University Admin. */
export const createTenantSchema = z.object({
  name: nameSchema(160),
  slug: tenantSlugSchema.optional(),
  timezone: timezoneSchema,
  adminEmail: emailSchema,
  adminName: nameSchema(120).optional(),
});
export type CreateTenantInput = z.infer<typeof createTenantSchema>;

export const updateTenantSchema = z
  .object({
    name: nameSchema(160),
    timezone: timezoneSchema,
    status: z.enum(["ACTIVE", "SUSPENDED"]),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, "Nothing to update");
export type UpdateTenantInput = z.infer<typeof updateTenantSchema>;

/** University Admin: their own college's settings. */
export const updateCollegeSchema = z
  .object({ name: nameSchema(160), timezone: timezoneSchema })
  .partial()
  .refine((value) => Object.keys(value).length > 0, "Nothing to update");
export type UpdateCollegeInput = z.infer<typeof updateCollegeSchema>;

export const inviteAdminSchema = z.object({
  email: emailSchema,
  displayName: nameSchema(120).optional(),
});
export type InviteAdminInput = z.infer<typeof inviteAdminSchema>;

export interface TenantView {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  status: "ACTIVE" | "SUSPENDED";
  createdAt: string;
}

/** What the Super Admin sees per college: no college content, only the account itself. */
export interface PlatformTenantView extends TenantView {
  universityAdmins: { email: string; displayName: string; status: string }[];
  pendingAdminInvites: number;
}

/** Turns a college name into a slug suggestion: "St. Xavier's College" -> "st-xaviers-college". */
export function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
}
