import express, { type Express } from "express";
import helmet from "helmet";
import { env } from "./config/env.js";
import { corsMiddleware } from "./common/middleware/cors.js";
import { errorHandler } from "./common/middleware/error-handler.js";
import { httpLogger } from "./common/middleware/http-logger.js";
import { notFound } from "./common/middleware/not-found.js";
import { requestContext } from "./common/http/request-context.js";
import { prisma } from "./lib/prisma.js";
import { getQdrant } from "./lib/qdrant.js";
import { getRedis } from "./lib/redis.js";
import { registerReadinessCheck } from "./modules/health/index.js";
import { createV1Router } from "./routes.js";

/** Builds the Express app without listening, so tests can drive it directly. */
export function createApp(): Express {
  registerReadinessCheck("database", async () => {
    await prisma.$queryRaw`SELECT 1`;
  });
  registerReadinessCheck("redis", async () => {
    await getRedis().ping();
  });
  registerReadinessCheck("qdrant", async () => {
    await getQdrant().getCollections();
  });

  const app = express();

  app.disable("x-powered-by");
  app.set("trust proxy", env.TRUST_PROXY_HOPS);

  app.use(httpLogger);
  app.use(requestContext);
  app.use(helmet());
  app.use(corsMiddleware);
  app.use(express.json({ limit: "1mb" }));

  app.use("/v1", createV1Router());

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
