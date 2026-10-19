import { z } from "zod";

/**
 * Output shapes the models must return. They double as the strict JSON schema sent to the API
 * (every field present; "nullable" instead of optional) and as the validator for the answer.
 */

const page = z.number().int().min(1).max(2000).nullable();
const confidence = z.number().int().min(0).max(100);
const title = z.string().min(1).max(300);

export const syllabusExtractionSchema = z.strictObject({
  subjectName: z.string().max(200).nullable(),
  subjectCode: z.string().max(40).nullable(),
  credits: z.number().int().min(0).max(30).nullable(),
  units: z
    .array(
      z.strictObject({
        title,
        description: z.string().max(2000).nullable(),
        hours: z.number().int().min(0).max(500).nullable(),
        sourcePage: page,
        confidence,
        topics: z
          .array(
            z.strictObject({
              title,
              description: z.string().max(2000).nullable(),
              sourcePage: page,
              confidence,
              subtopics: z.array(z.strictObject({ title, sourcePage: page, confidence })).max(60),
            }),
          )
          .max(80),
      }),
    )
    .max(40),
  references: z
    .array(
      z.strictObject({
        title: z.string().min(1).max(400),
        author: z.string().max(300).nullable(),
        sourcePage: page,
      }),
    )
    .max(50),
});
export type SyllabusExtraction = z.infer<typeof syllabusExtractionSchema>;

export const syllabusChangeSchema = z.strictObject({
  ops: z
    .array(
      z.strictObject({
        op: z.enum(["add", "rename", "move", "delete"]),
        targetKey: z.string().max(20).nullable(),
        parentKey: z.string().max(20).nullable(),
        kind: z.enum(["UNIT", "TOPIC", "SUBTOPIC"]).nullable(),
        title: z.string().max(300).nullable(),
        position: z.number().int().min(0).max(500).nullable(),
        reason: z.string().max(300),
      }),
    )
    .max(40),
  note: z.string().max(1000).nullable(),
});
export type SyllabusChange = z.infer<typeof syllabusChangeSchema>;

/** Keywords strict structured outputs may reject; Zod still checks them on the answer. */
const UNSUPPORTED = new Set(["$schema", "minLength", "maxLength"]);

function strip(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(strip);
  if (node && typeof node === "object") {
    return Object.fromEntries(
      Object.entries(node)
        .filter(([key]) => !UNSUPPORTED.has(key))
        .map(([key, value]) => [key, strip(value)]),
    );
  }
  return node;
}

/** The JSON schema for OpenAI structured outputs. */
export function toStrictJsonSchema(schema: z.ZodType): Record<string, unknown> {
  return strip(z.toJSONSchema(schema, { target: "draft-7" })) as Record<string, unknown>;
}

export const entryOrganizeSchema = z.strictObject({
  topics: z
    .array(
      z.strictObject({
        title: z.string().min(1).max(300),
        subtopics: z.array(z.string().min(1).max(300)).max(30),
        /** Key of the matching syllabus topic (K1, K2 ...) or null. */
        syllabusKey: z.string().max(20).nullable(),
        confidence: z.number().int().min(0).max(100),
      }),
    )
    .max(40),
  summary: z.string().max(1500),
});
export type EntryOrganized = z.infer<typeof entryOrganizeSchema>;

export const photoReadingSchema = z.strictObject({
  text: z.string().max(8000),
  unreadable: z.boolean(),
});
export type PhotoReading = z.infer<typeof photoReadingSchema>;
