import { QdrantClient } from "@qdrant/js-client-rest";
import { env } from "../config/env.js";

let client: QdrantClient | null = null;

/** The shared Qdrant client. Only knowledge repositories import it. */
export function getQdrant(): QdrantClient {
  client ??= new QdrantClient({
    url: env.QDRANT_URL,
    ...(env.QDRANT_API_KEY ? { apiKey: env.QDRANT_API_KEY } : {}),
    checkCompatibility: false,
  });
  return client;
}
