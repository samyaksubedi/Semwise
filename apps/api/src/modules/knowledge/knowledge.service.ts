import { randomUUID } from "node:crypto";
import type { TenantScope } from "../../common/db/scope.js";
import { aiService, models, type AiContext } from "../ai/index.js";
import type { AiFeature } from "../usage/index.js";
import {
  knowledgeRepository as repo,
  type ChunkPayload,
  type SearchFilter,
} from "./knowledge.repository.js";

export type { ChunkPayload, SearchFilter };

export type ChunkSource = ChunkPayload["sourceType"];

export interface ChunkInput {
  sourceId: string;
  text: string;
  payload: Omit<
    ChunkPayload,
    | "tenantId"
    | "sourceType"
    | "sourceId"
    | "sourceVersionId"
    | "text"
    | "embeddingModel"
    | "embeddingVersion"
  >;
}

export const EMBEDDING_VERSION = 1;

/**
 * Chunking, embeddings and Qdrant sync. Postgres stays the source of truth: every point has an
 * IndexedChunk row, so a superseded version's vectors can always be found and deleted.
 */
export const knowledgeService = {
  /** Embeds and stores the chunks of one source version. Postgres rows are written last. */
  async indexVersion(
    scope: TenantScope,
    ai: AiContext,
    feature: AiFeature,
    sourceType: ChunkSource,
    sourceVersionId: string,
    chunks: ChunkInput[],
  ): Promise<number> {
    if (chunks.length === 0) return 0;
    const vectors = await aiService.embed(
      ai,
      feature,
      chunks.map((c) => c.text),
    );
    const model = models.embedding();
    const points = chunks.map((chunk, i) => ({
      id: randomUUID(),
      vector: vectors[i]!,
      payload: {
        ...chunk.payload,
        tenantId: scope.tenantId,
        sourceType,
        sourceId: chunk.sourceId,
        sourceVersionId,
        text: chunk.text,
        embeddingModel: model,
        embeddingVersion: EMBEDDING_VERSION,
      } satisfies ChunkPayload,
    }));
    await repo.upsertPoints(points);
    await repo.createChunks(
      scope,
      points.map((p) => ({
        sourceType,
        sourceId: p.payload.sourceId,
        sourceVersionId,
        ownerId: p.payload.ownerId,
        qdrantPointId: p.id,
        embeddingModel: model,
      })),
    );
    return points.length;
  },

  /** Deletes every live vector of the given source versions (superseded, rejected, taken down). */
  async removeVersions(
    scope: TenantScope,
    sourceType: ChunkSource,
    versionIds: string[],
  ): Promise<number> {
    if (versionIds.length === 0) return 0;
    const live = await repo.listLiveChunks(scope, sourceType, versionIds);
    await repo.deletePoints(live.map((c) => c.qdrantPointId));
    await repo.markDeleted(
      scope,
      live.map((c) => c.id),
    );
    return live.length;
  },

  /** Vector search inside one college. Callers re-check every hit against Postgres. */
  async search(
    scope: TenantScope,
    ai: AiContext,
    feature: AiFeature,
    query: string,
    filter: SearchFilter,
    limit = 12,
  ) {
    const [vector] = await aiService.embed({ ...ai, countsAsNewRequest: false }, feature, [query]);
    return repo.search(scope, vector!, filter, limit);
  },

  /** One embedding of the query, several filtered searches (say syllabus and class content). */
  async searchEach(
    scope: TenantScope,
    ai: AiContext,
    feature: AiFeature,
    query: string,
    filters: SearchFilter[],
    limit = 8,
  ) {
    const [vector] = await aiService.embed({ ...ai, countsAsNewRequest: false }, feature, [query]);
    return Promise.all(filters.map((filter) => repo.search(scope, vector!, filter, limit)));
  },

  pointsOfVersion: (scope: TenantScope, versionId: string) =>
    repo.scrollByVersion(scope, versionId),
};
