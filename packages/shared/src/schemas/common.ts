import { z } from "zod";

/** Database ids are opaque strings (cuid). */
export const idSchema = z.string().min(1).max(64);

/** Cursor lists: `?limit=20&cursor=…` */
export const cursorQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).max(64).optional(),
});
export type CursorQuery = z.infer<typeof cursorQuerySchema>;

/** Admin tables: `?page=1&pageSize=20` */
export const pageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type PageQuery = z.infer<typeof pageQuerySchema>;

/** A calendar date without time, `YYYY-MM-DD`, interpreted in the college's timezone. */
export const dateOnlySchema = z.iso.date();

/** A single-line name: trimmed, no control characters or line breaks (safe in email headers). */
export function nameSchema(max = 120) {
  return z
    .string()
    .trim()
    .min(1)
    .max(max)
    .regex(/^[^\p{Cc}]*$/u, "Use a single line without control characters");
}
