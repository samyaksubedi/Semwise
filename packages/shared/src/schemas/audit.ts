import { z } from "zod";
import { idSchema } from "./common.js";

export const auditQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: idSchema.optional(),
  entityType: z.string().min(1).max(64).optional(),
  entityId: idSchema.optional(),
  programId: idSchema.optional(),
});
export type AuditQuery = z.infer<typeof auditQuerySchema>;

export interface AuditEntry {
  id: string;
  tenantId: string | null;
  programId: string | null;
  actorId: string | null;
  actorName: string | null;
  action: string;
  entityType: string;
  entityId: string;
  before: unknown;
  after: unknown;
  createdAt: string;
}
