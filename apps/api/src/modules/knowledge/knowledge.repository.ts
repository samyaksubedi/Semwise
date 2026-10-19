import { withTenant, type TenantScope } from "../../common/db/scope.js";
import { env } from "../../config/env.js";
import type { ChunkSource } from "../../generated/prisma/enums.js";
import { getQdrant } from "../../lib/qdrant.js";

/** Payload fields with an index: every search filters on tenantId and some of these. */
const INDEXED_FIELDS = [
  "tenantId",
  "sourceType",
  "sourceVersionId",
  "programId",
  "batchId",
  "semesterId",
  "sectionId",
  "subjectId",
  "classId",
  "ownerId",
  "visibility",
] as const;

export interface ChunkPayload {
  tenantId: string;
  sourceType: ChunkSource;
  sourceId: string;
  sourceVersionId: string;
  programId: string | null;
  batchId: string | null;
  semesterId: string | null;
  sectionId: string | null;
  subjectId: string | null;
  classId: string | null;
  /** Private notes only; shared content has none. */
  ownerId: string | null;
  visibility: "SHARED" | "PRIVATE";
  /** Official syllabus, class content reported by CR/teacher, AI enrichment, student private. */
  contentKind: "OFFICIAL_SYLLABUS" | "CLASS_REPORTED" | "AI_ENRICHMENT" | "STUDENT_PRIVATE";
  /** Extra labels for citations (topic key, unit title, taught date ...). */
  meta: Record<string, string | number | null>;
  text: string;
  embeddingModel: string;
  embeddingVersion: number;
}

export interface SearchFilter {
  sourceTypes?: ChunkSource[];
  programId?: string;
  batchId?: string;
  semesterIds?: string[];
  sectionIds?: string[];
  subjectIds?: string[];
  ownerId?: string;
  visibility?: "SHARED" | "PRIVATE";
}

let collectionReady: Promise<void> | null = null;

/** The one collection: created on first use, with payload indexes. */
function ensureCollection(): Promise<void> {
  collectionReady ??= (async () => {
    const qdrant = getQdrant();
    const name = env.QDRANT_COLLECTION;
    const exists = await qdrant.collectionExists(name);
    if (!exists.exists) {
      await qdrant.createCollection(name, {
        vectors: { size: env.AI_EMBEDDING_DIMENSIONS, distance: "Cosine" },
      });
    }
    for (const field of INDEXED_FIELDS) {
      await qdrant
        .createPayloadIndex(name, { field_name: field, field_schema: "keyword", wait: true })
        .catch(() => undefined);
    }
  })().catch((err) => {
    collectionReady = null;
    throw err;
  });
  return collectionReady;
}

/** The Qdrant filter for a search. The tenant condition is always first and never optional. */
function qdrantFilter(scope: TenantScope, filter: SearchFilter) {
  const must: object[] = [{ key: "tenantId", match: { value: scope.tenantId } }];
  const any = (key: string, values?: string[]) => {
    if (values) must.push({ key, match: { any: values.length ? values : ["__none__"] } });
  };
  any("sourceType", filter.sourceTypes);
  if (filter.programId) must.push({ key: "programId", match: { value: filter.programId } });
  if (filter.batchId) must.push({ key: "batchId", match: { value: filter.batchId } });
  any("semesterId", filter.semesterIds);
  any("sectionId", filter.sectionIds);
  any("subjectId", filter.subjectIds);
  if (filter.ownerId) must.push({ key: "ownerId", match: { value: filter.ownerId } });
  if (filter.visibility) must.push({ key: "visibility", match: { value: filter.visibility } });
  return { must };
}

export const knowledgeRepository = {
  async upsertPoints(points: { id: string; vector: number[]; payload: ChunkPayload }[]) {
    if (points.length === 0) return;
    await ensureCollection();
    await getQdrant().upsert(env.QDRANT_COLLECTION, {
      wait: true,
      points: points.map((p) => ({ id: p.id, vector: p.vector, payload: { ...p.payload } })),
    });
  },

  async deletePoints(ids: string[]) {
    if (ids.length === 0) return;
    await ensureCollection();
    await getQdrant().delete(env.QDRANT_COLLECTION, { wait: true, points: ids });
  },

  async search(scope: TenantScope, vector: number[], filter: SearchFilter, limit: number) {
    await ensureCollection();
    const res = await getQdrant().query(env.QDRANT_COLLECTION, {
      query: vector,
      limit,
      filter: qdrantFilter(scope, filter),
      with_payload: true,
    });
    return res.points.map((h) => ({
      id: String(h.id),
      score: h.score,
      payload: h.payload as unknown as ChunkPayload,
    }));
  },

  /** Raw lookup used by tests and audits: every point of a source version in the tenant. */
  async scrollByVersion(scope: TenantScope, sourceVersionId: string) {
    await ensureCollection();
    const res = await getQdrant().scroll(env.QDRANT_COLLECTION, {
      filter: {
        must: [
          { key: "tenantId", match: { value: scope.tenantId } },
          { key: "sourceVersionId", match: { value: sourceVersionId } },
        ],
      },
      limit: 1000,
      with_payload: true,
    });
    return res.points.map((p) => ({
      id: String(p.id),
      payload: p.payload as unknown as ChunkPayload,
    }));
  },

  createChunks(
    scope: TenantScope,
    rows: {
      sourceType: ChunkSource;
      sourceId: string;
      sourceVersionId: string;
      ownerId: string | null;
      qdrantPointId: string;
      embeddingModel: string;
    }[],
  ) {
    return withTenant(scope.tenantId, (db) =>
      db.indexedChunk.createMany({ data: rows.map((r) => ({ ...r, tenantId: scope.tenantId })) }),
    );
  },

  listLiveChunks(scope: TenantScope, sourceType: ChunkSource, sourceVersionIds: string[]) {
    return withTenant(scope.tenantId, (db) =>
      db.indexedChunk.findMany({
        where: {
          tenantId: scope.tenantId,
          sourceType,
          sourceVersionId: { in: sourceVersionIds },
          status: "LIVE",
        },
      }),
    );
  },

  markDeleted(scope: TenantScope, ids: string[]) {
    return withTenant(scope.tenantId, (db) =>
      db.indexedChunk.updateMany({
        where: { tenantId: scope.tenantId, id: { in: ids } },
        data: { status: "DELETED" },
      }),
    );
  },
};
