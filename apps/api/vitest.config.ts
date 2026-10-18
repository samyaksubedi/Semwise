import { defineConfig } from "vitest/config";
import { testDatabaseUrl, testQdrantUrl, testRedisUrl } from "./src/test/database-url.js";

export const TEST_WEB_ORIGIN = "https://app.semwise.test";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    globalSetup: ["./src/test/global-setup.ts"],
    // Test files share one database, so they run one after another.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
    env: {
      NODE_ENV: "test",
      LOG_LEVEL: "silent",
      CORS_ORIGINS: TEST_WEB_ORIGIN,
      WEB_ORIGIN: TEST_WEB_ORIGIN,
      DATABASE_URL: testDatabaseUrl,
      REDIS_URL: testRedisUrl,
      QUEUE_PREFIX: "semwise-test",
      QDRANT_URL: testQdrantUrl,
      QDRANT_COLLECTION: "semwise_test_chunks",
      // Fake keys: OpenAI, R2 and email are mocked in tests, never called for real.
      OPENAI_API_KEY: "test-openai-key",
      OPENAI_BASE_URL: "http://openai.invalid/v1",
      R2_ENDPOINT: "http://s3.invalid",
      R2_ACCESS_KEY_ID: "test",
      R2_SECRET_ACCESS_KEY: "test-secret",
      R2_BUCKET: "semwise-test",
      R2_FORCE_PATH_STYLE: "true",
      MAIL_FROM: "Semwise <no-reply@semwise.test>",
      SMTP_HOST: "smtp.invalid",
      SMTP_PORT: "1025",
      SMTP_SECURITY: "none",
    },
  },
});
