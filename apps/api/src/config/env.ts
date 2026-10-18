import { z } from "zod";

const commaList = z
  .string()
  .default("")
  .transform((value) =>
    value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );

const positiveInt = (fallback: number) => z.coerce.number().int().positive().default(fallback);

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal", "silent"]).default("info"),
  /** Exact origins allowed to call the API from a browser with cookies (the web app). */
  CORS_ORIGINS: commaList.pipe(z.array(z.url())),
  /** The web app's public origin; every link in an email points here. */
  WEB_ORIGIN: z.url().default("http://localhost:3000"),
  /** Reverse proxies in front of the API; Coolify's proxy counts as 1. */
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),

  /** The application role. It cannot bypass row-level security. */
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),

  /** Required: background jobs, rate limits and short caches live here. */
  REDIS_URL: z.url({ protocol: /^rediss?$/ }),
  /** Key prefix for BullMQ, so tests and development can share one Redis without mixing jobs. */
  QUEUE_PREFIX: z
    .string()
    .regex(/^[a-z0-9-]+$/)
    .default("semwise"),

  QDRANT_URL: z.url().default("http://localhost:6333"),
  QDRANT_API_KEY: z.string().min(1).optional(),
  QDRANT_COLLECTION: z
    .string()
    .regex(/^[a-z0-9_-]+$/)
    .default("semwise_chunks"),

  /** OpenAI. Unset = AI features answer 503. Server-side only, never logged. */
  OPENAI_API_KEY: z.string().min(1).optional(),
  OPENAI_BASE_URL: z.url().default("https://api.openai.com/v1"),
  /** Model per task; change any of them without a code change. */
  AI_MODEL_ROUTER: z.string().min(1).default("gpt-5.6-luna"),
  AI_MODEL_ANSWER: z.string().min(1).default("gpt-5.4-mini"),
  AI_MODEL_DEEP: z.string().min(1).default("gpt-5.6-terra"),
  AI_MODEL_VISION: z.string().min(1).default("gpt-5.6-terra"),
  AI_MODEL_EMBEDDING: z.string().min(1).default("text-embedding-3-small"),
  AI_MODEL_TRANSCRIBE: z.string().min(1).default("gpt-transcribe"),
  /** Vector size of the embedding model (text-embedding-3-small = 1536). */
  AI_EMBEDDING_DIMENSIONS: positiveInt(1536),

  /** Cloudflare R2 (or any S3-compatible store; MinIO locally). Unset = uploads answer 503. */
  R2_ENDPOINT: z.url().optional(),
  R2_ACCOUNT_ID: z.string().min(1).optional(),
  R2_ACCESS_KEY_ID: z.string().min(1).optional(),
  R2_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  R2_BUCKET: z.string().min(1).optional(),
  /** Path-style URLs; MinIO needs this, R2 works either way. */
  R2_FORCE_PATH_STYLE: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),

  /** Email over SMTP (Gmail app password in production, Mailpit locally). Unset = no email sent. */
  MAIL_FROM: z.string().min(3).optional(),
  SMTP_HOST: z.string().min(1).optional(),
  SMTP_PORT: z.coerce.number().int().min(1).max(65_535).default(587),
  SMTP_USER: z.string().min(1).optional(),
  SMTP_PASSWORD: z.string().min(1).optional(),
  /** true = TLS from the start (port 465); false = STARTTLS required (587). Mailpit: "none". */
  SMTP_SECURITY: z.enum(["tls", "starttls", "none"]).default("starttls"),
  MAIL_DAILY_CAP: positiveInt(400),
  MAIL_PER_MINUTE: positiveInt(20),

  /** Monthly defaults; plans can override them per tenant. */
  QUOTA_STUDENT_CHAT_PER_MONTH: positiveInt(60),
  QUOTA_STUDY_ANSWERS_PER_MONTH: positiveInt(100),
  QUOTA_CR_DICTATIONS_PER_MONTH: positiveInt(60),
  /** Monthly AI spend cap per tenant, in micro-dollars ($50 = 50_000_000). */
  AI_TENANT_MONTHLY_BUDGET_MICROS: positiveInt(50_000_000),

  /** Approval workflow defaults, in hours. */
  APPROVAL_REMINDER_HOURS: z
    .string()
    .default("24,48")
    .transform((value) => value.split(",").map((item) => Number(item.trim())))
    .pipe(z.array(z.number().int().positive()).min(1)),
  APPROVAL_ESCALATE_HOURS: positiveInt(72),
});

export type Env = z.infer<typeof envSchema>;

/** Validates environment variables once at startup; a bad value stops the process with a clear message. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  // Treat empty strings as unset, so `KEY=` in an .env file means "not configured".
  const cleaned = Object.fromEntries(Object.entries(source).filter(([, value]) => value !== ""));
  const result = envSchema.safeParse(cleaned);
  if (!result.success) {
    throw new Error(`Invalid environment variables:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}

export const env = loadEnv();
