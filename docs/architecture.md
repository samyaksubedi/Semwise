# Architecture

Product decisions live in [Semwise_Project_Context.md](Semwise_Project_Context.md). This document covers the tech stack, the repo layout and the code conventions. It follows the structure of the Blogs repo (pnpm monorepo, `apps/api`, `apps/web`, `packages/shared`), with multi-tenancy, a vector index and an AI layer added. V1 (features 0 to 9) is built as described here; what is built, verified and still open is under [Status](#status) at the end.

## Stack

| Part            | Choice                                                                                              |
| --------------- | --------------------------------------------------------------------------------------------------- |
| Web             | Next.js (App Router) + React + Tailwind, TypeScript                                                 |
| API             | Node.js 24 LTS + TypeScript, Express 5, modular (kept from the blog for its module pattern)         |
| Database        | PostgreSQL + Prisma (`@prisma/adapter-pg`)                                                          |
| Vector index    | Qdrant (retrieval index only; PostgreSQL stays the source of truth)                                 |
| Queue and cache | Redis: BullMQ for background jobs, rate limits, short-lived caches. Redis is required, not optional |
| Object storage  | Cloudflare R2 (S3-compatible), private bucket, signed URLs                                          |
| Email           | Nodemailer over Gmail SMTP for now, behind a mail-provider interface so it can be swapped           |
| AI              | OpenAI API (models listed under "AI layer")                                                         |
| Validation      | Zod, schemas shared between API and web                                                             |
| Auth            | Cookie sessions stored in Postgres (as in the blog), Argon2 password hashing                        |
| Logging         | Pino                                                                                                |
| Tests           | Vitest + Supertest against a real Postgres test database                                            |
| Tooling         | pnpm workspaces, ESLint, Prettier, TypeScript (strict), GitHub Actions CI                           |
| Local services  | Docker Compose (Postgres, Qdrant, Redis, Mailpit for catching emails, SeaweedFS S3 in place of R2)  |
| Deploy          | Everything on one VPS through Coolify: web, API, worker, Postgres, Qdrant, Redis                    |

## At a glance

| Part                         | Where it runs    | Folder                  |
| ---------------------------- | ---------------- | ----------------------- |
| Web app, all roles (Next.js) | VPS via Coolify  | `apps/web`              |
| API (Express + TypeScript)   | VPS via Coolify  | `apps/api`              |
| Worker (BullMQ jobs)         | VPS via Coolify  | `apps/api` (same image) |
| Database (Postgres + Prisma) | VPS via Coolify  | `apps/api/prisma`       |
| Vector index (Qdrant)        | VPS via Coolify  | `infra/`                |
| Redis                        | VPS via Coolify  | `infra/`                |
| Files (PDFs, audio, images)  | Cloudflare R2    | n/a                     |
| Shared schemas and types     | Imported by both | `packages/shared`       |

## Repo layout

```text
semwise/
├── apps/
│   ├── api/
│   │   ├── prisma/ (schema.prisma, migrations/)
│   │   ├── prisma.config.ts
│   │   ├── Dockerfile
│   │   ├── .env.example
│   │   └── src/
│   │       ├── app.ts            builds the Express app (no listen, so tests can use it)
│   │       ├── server.ts         listens for HTTP, graceful shutdown
│   │       ├── worker.ts         separate process that runs BullMQ job handlers
│   │       ├── routes.ts         mounts every module under /v1
│   │       ├── config/env.ts     Zod-validated environment
│   │       ├── common/           errors, http helpers, middleware, tenant + db helpers
│   │       ├── lib/              prisma, qdrant, openai, r2 storage, mailer, logger, redis, queue
│   │       ├── modules/<name>/   one folder per feature (see below)
│   │       ├── jobs/             queue definitions and job handlers (one file per job type)
│   │       ├── scripts/          create-super-admin, seed-demo
│   │       ├── generated/prisma/ generated client (not edited)
│   │       ├── test/             database setup, helpers, isolation test kit
│   │       └── types/            express.d.ts (req.auth, req.tenant)
│   └── web/
│       ├── next.config.ts, postcss.config.mjs, .env.example
│       ├── public/, assets/
│       └── src/
│           ├── app/              routes (App Router), grouped by role area
│           ├── components/       shared layout and UI pieces
│           ├── features/<area>/  feature code used by the routes
│           ├── lib/              api client, env, format, helpers
│           └── styles/           tokens.css, prose.css
├── packages/
│   └── shared/src/               api/ (envelope, errors), schemas/, content/, utils/
├── CLAUDE.md                     instructions for Claude Code
├── docs/                         Semwise_Project_Context.md, architecture.md, data-model.md, permissions.md, app-flows.md, ui-ux.md, local-setup.md, deploy.md, roadmap-v2.md
├── infra/                        docker-compose.dev.yml, postgres-init.sql, docker-compose.prod.yml, postgres-init-prod.sh
├── scripts/                      dev.mjs (builds shared, starts API, waits, starts web), db-backup.mjs
├── .github/workflows/ci.yml
├── package.json, pnpm-workspace.yaml, tsconfig.base.json
├── eslint.config.js, .prettierrc.json, .editorconfig, .node-version
└── README.md
```

Packages are named `@semwise/api`, `@semwise/web` and `@semwise/shared`.

## API module layout

Every feature is a folder under `apps/api/src/modules/<name>/`, exactly as in the blog:

| File                             | Job                                                                        |
| -------------------------------- | -------------------------------------------------------------------------- |
| `<name>.routes.ts`               | URLs; exports routers that `src/routes.ts` mounts                          |
| `<name>.controller.ts`           | HTTP only: parse the request with Zod, call the service, send the response |
| `<name>.service.ts`              | Business rules, including permission checks through the authz module       |
| `<name>.repository.ts`           | The only place that talks to Prisma (and, for knowledge modules, Qdrant)   |
| `<name>.mapper.ts` (when needed) | Turns database rows into the response types from `packages/shared`         |
| `<name>.test.ts`                 | Tests                                                                      |
| `index.ts`                       | What other modules may import                                              |

Rules (the blog's, plus the multi-tenant ones):

1. Calls go routes, controller, service, repository, never sideways or upward.
2. Prisma is used only in repositories.
3. A module imports another module only through its `index.ts`.
4. Expected failures throw `AppError`; the error handler turns them into the error envelope.
5. Request and response schemas live in `packages/shared/src/schemas`, so the web app validates with the same rules.
6. **Tenant scope is never optional.** The tenant is derived on the server from the session and membership, never from a client-supplied ID. Every repository function for tenant data takes a scope object (`tenantId`, plus program, section or user where relevant) and includes it in the query.
7. **Authorization is centralized.** Services call the `authz` module (`can(auth, action, resource)`), which checks role and scope together. Controllers never decide permissions.
8. **Only repositories talk to Qdrant**, and every vector query carries the tenant filter. Results are re-checked against Postgres before use.
9. **All AI calls go through the `ai` module** so that every call is metered in the usage ledger and checked against quotas.

## API modules

| Module                                                         | What it does                                                                                                         | Feature # |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | --------- |
| `health`                                                       | `/v1/health` (alive) and `/v1/health/ready` (database, Redis, Qdrant)                                                | 0         |
| `auth`                                                         | Login, logout, session, password reset, invite acceptance; sessions are Postgres rows with an HttpOnly cookie        | 1         |
| `tenants`                                                      | Super Admin: create and manage colleges, provision the first University Admin, tenant settings (timezone)            | 1, 2      |
| `users`                                                        | The single User entity                                                                                               | 1         |
| `memberships`                                                  | Roles with scope (tenant, program, section, class), including CR grants                                              | 1, 3      |
| `authz`                                                        | The permission matrix and `can(...)` checks                                                                          | 1         |
| `audit`                                                        | Audit log of admin actions, approvals, takedowns, syllabus and scope changes                                         | 1         |
| `usage`                                                        | AI usage ledger, quotas, budgets, plan limits                                                                        | 1, 15     |
| `structure` (programs, batches, semesters, sections, subjects) | Academic structure, in one module because the five share path loading and authorization; Program Admin invites       | 2         |
| `invitations`                                                  | Student, teacher and admin email invites                                                                             | 3         |
| `enrollments`                                                  | Semester-specific section assignment with history                                                                    | 3         |
| `classes`                                                      | Subject x section x teacher                                                                                          | 4         |
| `files`                                                        | Signed uploads and downloads on Cloudflare R2 for PDFs, audio and images                                             | 5         |
| `syllabus`                                                     | PDF extraction, draft tree, natural-language change requests (as diffs), versions, publish, copy from previous batch | 5         |
| `knowledge`                                                    | Chunking, embeddings, Qdrant sync, live-version handling                                                             | 5, 6      |
| `ai`                                                           | Provider wrapper, prompts, router, model selection, metering                                                         | 5, 8      |
| `sessions`                                                     | Class sessions and CR/teacher entries, versions, topic mapping, duplicate detection                                  | 6         |
| `approvals`                                                    | Approval settings (default, override, lock), queue, reminders, escalation                                            | 6         |
| `media`                                                        | CR voice transcription and photo reading, private readings, retention of media                                       | 7         |
| `notifications`                                                | Email delivery (Nodemailer) through a throttled queue, with the protections listed under Email                       | 3, 6      |
| `chat`                                                         | Student Q&A, conversations, syllabus classification, labeled answers, citations                                      | 8         |
| `catchup`                                                      | Date-range summaries                                                                                                 | 9         |

The modules for features 10 to 16 are planned in [roadmap-v2.md](roadmap-v2.md).

## Request pipeline

`src/routes.ts` mounts routers under `/v1` the way the blog does, with these groups:

- `/v1/health`, `/v1/auth/*`: open or login routes.
- `/v1/platform/*`: Super Admin only (tenant provisioning).
- `/v1/*` (tenant routes): behind the origin check, the session loader and `requireAuth`, then a **tenant resolver** that sets `req.tenant` from the session's active membership. Roles and scopes are then checked per route through `authz`.

Rate limits count in Redis (shared by every API instance). AI routes also pass through per-user and per-tenant quota checks.

## Data layer

- Prisma 7 with the `pg` adapter; client generated into `src/generated/prisma`; migrations in `apps/api/prisma/migrations`.
- Every tenant-owned table has a `tenantId` column with an index. Postgres row-level security is enabled and forced on these tables as a second line of defence (see data-model.md); explicit `tenantId` filtering in repositories is still mandatory. The API and the worker refuse to start if `DATABASE_URL` connects as a superuser or a BYPASSRLS role.
- The conceptual tables, fields and constraints are in [data-model.md](data-model.md); who may do what is in [permissions.md](permissions.md); user flows are in [app-flows.md](app-flows.md).
- A Semester belongs to one batch (no reusable semester definitions), because each batch has its own subjects and syllabus.
- Syllabus, entries and exam scope all use the same pattern: immutable versions plus a pointer to the current live version.

## Vector index (Qdrant)

- One collection filtered by a tenant payload field (indexed), with payload fields for program, batch, semester, section, class, subject, source ID and version, visibility, state, owner (for private notes), and embedding model and version.
- Private student notes use a separate scope keyed by owner; queries always filter on the owner.
- Publishing flow: index new vectors, switch the live pointer in Postgres, delete old vectors. Retrieval re-checks results against Postgres.
- Changing the embedding model requires a full re-index, so the model and version are stored with every vector.

## AI layer

- OpenAI is called only from `modules/ai` (a provider wrapper, like the blog's `ai.provider.ts`), using strict JSON output where the result is structured.
- Prompts live in `ai.prompts.ts`. Model names are environment settings, so any model can be changed without a code change.
- Every call writes a ledger row (tenant, user, feature, model, tokens, cost, price snapshot). Quota checks run before the call.
- All retrieved text and user input are passed as data in clearly delimited sections, never as instructions.
- Prices change and sources disagree, so the price table used by the ledger is stored as data and updated by hand from OpenAI's official pricing page.
- As built: `ai.provider.ts` is an `AiProvider` interface (structured JSON through the Responses API with strict schemas, embeddings, transcription); tests install a fake. Output schemas are Zod, sent as strict JSON schema and validated again on the answer. Scanned syllabus PDFs (little text per page) are sent to the model as a PDF file instead of running local OCR, so no image tooling is needed on the server; such scans are capped at `AI_SCAN_MAX_PAGES` (60). `pnpm --filter @semwise/api smoke:ai` is a manual end-to-end check against the real API (a few cents): it does nothing without `OPENAI_API_KEY`, and is never part of `pnpm test`.

### Default models and prices (October 2026)

Prices are per 1M tokens unless stated, taken from third-party price trackers dated early October 2026 (they disagree slightly with each other). They are not authoritative: confirm on OpenAI's official pricing page before launch, and keep the live prices in the `PriceTable` so the ledger stays accurate.

| Task                                                                                  | Default model          | Input              | Output | Cached input | Notes                                                                                                                               |
| ------------------------------------------------------------------------------------- | ---------------------- | ------------------ | ------ | ------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| Router, classification, date parsing, language detection, summaries                   | GPT-5.6 Luna           | $0.20              | $1.20  | $0.02        | Cheapest current model                                                                                                              |
| Student answers (grounded in retrieved content)                                       | GPT-5.4 Mini           | $0.75              | $4.50  | $0.075       | Escalates to Terra for complex or code questions                                                                                    |
| Hard questions, grading, syllabus extraction, study material, note fact-check, vision | GPT-5.6 Terra          | $2.00              | $12.00 | $0.20        | Confirm image input in testing; fall back to Mini if enough                                                                         |
| Embeddings                                                                            | text-embedding-3-small | $0.02              | n/a    | n/a          | English-first content (the Nepali beta may need -large: [roadmap-v2.md](roadmap-v2.md))                                             |
| Voice dictation                                                                       | gpt-transcribe         | $0.0045 per minute | n/a    | n/a          | Benchmark against gpt-4o-mini-transcribe (about $0.003 per minute) and gpt-4o-transcribe (about $0.006 per minute) on real CR clips |

- Do **not** use GPT-5.4 Nano: it is marked deprecated, with API removal planned for April 1, 2027. GPT-6 Astra and GPT-5.5 Pro cost far more and are not needed.

### Unit costs (assumption-based)

| Operation                                                                 | Tokens assumed                         | Cost             |
| ------------------------------------------------------------------------- | -------------------------------------- | ---------------- |
| Router and syllabus check per question (Luna)                             | 1,500 in, 100 out                      | $0.0004          |
| Answer by Mini                                                            | 4,000 in, 500 out                      | $0.0053          |
| Answer by Terra                                                           | 4,000 in, 500 out                      | $0.014           |
| **Average Q&A question** (80% Mini, 20% Terra, router, +25% chat history) |                                        | **about $0.009** |
| Syllabus extraction plus review requests, per subject (Terra)             | 20k in 4k out, then 5 x (6k in 1k out) | about $0.21      |
| Organizing and summarizing one CR entry (Mini plus Luna)                  | 3k in, 900 out                         | $0.005           |
| Dictation of 2 minutes (gpt-transcribe)                                   | 2 minutes                              | $0.009           |
| Reading a photo (Terra vision)                                            | about 2k in, 400 out                   | about $0.009     |
| Embedding a 40-page syllabus                                              | about 20k tokens                       | $0.0004          |

- The router escalates a question from Mini to Terra when it detects a complex, multi-step or code question.
- Chat answers are produced inside the request, not as a job: a question is interactive and the web app would otherwise have to poll. Streaming (server-sent events) is a later improvement.

## Background jobs (BullMQ on Redis)

Long or failure-prone work runs as retryable jobs: PDF extraction (scans included), transcription, photo reading, embedding, summaries, emails, reminders and escalations.

- The API only enqueues jobs. A separate **worker** process (`src/worker.ts`, same image, different start command) runs them, so slow AI work never blocks web requests.
- One queue per job family, with its own concurrency and rate limit (OpenAI calls, and email sending, are rate-limited).
- Retries with exponential backoff; failed jobs stay visible with their error and can be retried from the admin screens.
- Every job has an idempotency key, so a retry never duplicates a result.
- **Delayed jobs** schedule approval reminders (24 and 48 hours) and escalation; they are cancelled when the teacher acts.
- Job state (queued, running, failed, done) is also written to Postgres where the user needs to see it.
- Redis must run with **persistence on (AOF)**, **`maxmemory-policy noeviction`** and a password, reachable only on the internal network; otherwise queued jobs can be lost.
- Handlers live in `src/jobs`; the worker loads them; the schedulers for recurring jobs (expired sessions daily, file retention hourly) start in the worker.

## File storage (Cloudflare R2)

- One private bucket. Keys are namespaced `tenants/<tenantId>/<area>/<id>`, so a path always shows who owns a file.
- The browser uploads **directly to R2 through a short-lived signed URL** issued by the API after a permission check; the API never streams large files.
- Allow-list of types (PDF, common audio, JPEG and PNG), size limits per type, and a magic-byte check when the upload completes. Anything that fails is deleted.
- Downloads also use short-lived signed URLs, issued only after an authz check.
- Raw audio is deleted after transcription; other files follow the retention policy. Bucket CORS allows only the web origin.
- The S3 client talks to R2's S3-compatible endpoint, so another S3 provider can replace it later. The SDK's default request checksums are switched off for signed URLs (R2 and SeaweedFS reject them).

## Email (Nodemailer + Gmail for now)

Gmail's free tier has small sending limits (about 500 recipients per day on a personal account; confirm the current figure), and mail comes from a gmail.com address, so protections matter:

- **Provider interface:** the app talks to a `Mailer` interface; Nodemailer/Gmail is one implementation. Moving to a transactional provider later changes one file.
- **Credentials:** a Gmail app password (needs 2-step verification) held only in environment variables, never in code or logs; TLS required.
- **Throttled queue:** all email goes through BullMQ with a per-minute rate and a **daily cap below Gmail's limit** (for example 400). A large CSV invite import therefore sends over several days and shows progress. A counter alerts the admin as the cap nears.
- **Retries and failures:** retry with backoff; permanent failures are marked on the invitation so the admin can fix the address. Gmail gives no bounce webhooks, so addresses are also validated on entry.
- **Abuse limits:** per-user, per-tenant and per-IP rate limits on invite, resend and password-reset requests; a cooldown between resends. Invite preview and accept (not signed in, token only) are limited per invite token (20 per hour) and per IP (120 per hour); password-reset requests per email and per IP.
- **Injection safety:** addresses and names are validated and stripped of line breaks (no header injection); templates are fixed and user text is escaped, never inserted as raw HTML.
- **Token safety:** invite and reset tokens are random, single-use, short-lived, stored hashed, and bound to the email; links point only to the configured web origin.
- **No account enumeration:** forgot-password and invite-status responses are identical whether or not the address exists.
- **Privacy:** email bodies and addresses are not written to logs; the log records a message ID and outcome only.
- **Local development:** Mailpit in Docker catches all mail, so tests and development never send real email.

## Response shapes

Same as the blog and defined once in `packages/shared/src/api`:

- Success: `{ "data": ..., "meta": ... }`
- Error: `{ "error": { "code", "message", "details"?, "requestId" } }`

Error codes are shared between API and web.

## Web app layout

Next.js App Router, with route groups and feature code in `src/features`, as in the blog:

```text
apps/web/src/
├── app/
│   ├── (auth)/            login, choose-college, accept-invite, forgot-password, reset-password
│   ├── (app)/             the signed-in shell: chat, catchup (student); today, entries (CR);
│   │                      approvals, classes (teacher); admin/ (overview, structure, students,
│   │                      classes, syllabus, settings); platform/colleges (Super Admin); profile
│   └── layout.tsx, page.tsx, not-found.tsx, globals.css
├── components/            layout/ (app shell), ui/ (buttons, fields, sheets, tabs, states, toasts ...)
├── features/<area>/       admin/, auth/, chat/, entries/, platform/, profile/, syllabus/, teacher/
├── lib/                   api.ts, env.ts, format.ts, nav.ts, session.tsx, strings.ts, upload.ts ...
└── styles/                tokens.css
```

Menus and routes only reflect roles; the API enforces permissions regardless of what the UI shows.

As built (web phase A): the browser calls the API directly at `NEXT_PUBLIC_API_URL` with `credentials: "include"`; the session cookie lives on the API's host, so signed-in data is fetched in client components with TanStack Query (Server Components render the static shell). A 401 anywhere sends the person to `/login?next=...` (same-site paths only). The shell picks an **area** (student, CR, teacher, admin, platform) from the URL, shows that area's tabs, and offers the other areas on the profile page; a URL of an area the person does not have shows a "not in your role" state. Every user-facing string is in `src/lib/strings.ts`. The theme follows the system, with a manual choice stored in `localStorage` and applied by an inline script before the first paint.

## Configuration

`apps/api/src/config/env.ts` validates all environment variables with Zod at startup and exits with a clear message on a bad value (as in the blog). Planned variables, beyond the blog's `DATABASE_URL`, `CORS_ORIGINS`, `ADMIN_ORIGINS`, `TRUST_PROXY_HOPS` and `INTERNAL_API_KEY`:

- `REDIS_URL` (required)
- `QDRANT_URL`, `QDRANT_API_KEY`
- `OPENAI_API_KEY`, and model names for router, answer, deep, vision, embedding and transcription; `AI_SCAN_MAX_PAGES` (longest scanned PDF sent to the model, default 60)
- `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`
- `MAIL_FROM`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_DAILY_CAP`, `MAIL_PER_MINUTE`
- Default quota values and an AI budget cap

Features whose keys are unset answer 503 instead of crashing, as the blog does. The queue and Redis are the exception: the API will not start without Redis.

## Testing

- Vitest with Supertest, a real Postgres database (`semwise_test`) wiped each run, files running one after another, as in the blog.
- A dedicated **tenant-isolation test kit**: for each module, tests prove that another tenant, another section, another student, and an admin cannot reach private or foreign data, including through search and AI retrieval.
- OpenAI, R2 and email are mocked (`test/fakes.ts`); Postgres, Redis and Qdrant are real, locally in Docker and in CI. Jobs run in-process in tests.
- Browser tests (Playwright, `apps/web/e2e`, `pnpm e2e`): a lean set of flows against production builds, the seeded demo college and a fake OpenAI server; one worker, Chromium only. See local-setup.md.

## Local development

- `pnpm db:up` starts Postgres, Qdrant, Redis, Mailpit (catches email) and SeaweedFS (S3-compatible stand-in for R2; MinIO no longer publishes public images) from `infra/docker-compose.dev.yml`.
- `pnpm dev` runs `scripts/dev.mjs`: builds shared, starts the API and the worker, waits for health, then starts the web app (the order matters on Windows).
- Everyday commands match the blog: `pnpm lint`, `pnpm format`, `pnpm typecheck`, `pnpm test`, `pnpm build`, plus `db:migrate`, `db:deploy`, `db:studio` and a `super-admin:create` script.
- The step-by-step checklist is [local-setup.md](local-setup.md).

## Deployment

Everything runs on one VPS, managed by Coolify:

| Service  | Notes                                                                                          |
| -------- | ---------------------------------------------------------------------------------------------- |
| web      | Next.js container                                                                              |
| api      | Express container; on start it runs `prisma migrate deploy`, then the server (as in the blog)  |
| worker   | Same image as the API, started with the worker command                                         |
| postgres | Service in the compose stack; daily `scripts/db-backup.mjs` dumps copied off the VPS           |
| qdrant   | Service in the compose stack with a persistent volume and an API key; periodic snapshots       |
| redis    | Service in the compose stack: AOF persistence, `noeviction`, a password, internal network only |

- Put the web app and the API on subdomains of one domain (for example `app.` and `api.`), so session cookies and origin checks are simple.
- Only the web and API services are public; Postgres, Qdrant and Redis are reachable only on the internal Docker network.
- A single VPS is a single point of failure. Back up Postgres and Qdrant off the machine, and test a restore before launch.
- Plan at least 4 GB RAM for all services together; Next.js builds are heavy, so build images in CI if the VPS struggles.
- Details: [deploy.md](deploy.md) (Dockerfiles, `infra/docker-compose.prod.yml`, environment checklist, backups and restore).

## Build list

One feature at a time, backend first. A feature is finished when its API, worker jobs, validation schemas, migration, audit entries and tests (including the isolation tests) are done and it can be exercised through the API; then its web screens follow. V1 is features 0 to 9: they form the core loop, ending with a student asking about what was taught, so real CRs and teachers can test it before later features pile on.

- [x] 0. **Scaffold:** monorepo, shared package, lint, tests, CI, local Postgres and Qdrant.
- [x] 1. **Foundations:** authentication, tenants, single User, scoped memberships, authorization layer, audit log, tenant-isolation test suite, usage ledger.
- [x] 2. **Tenant provisioning and academic structure:** Super Admin creates tenants and the University Admin; programs, batches, semesters, subjects, sections.
- [x] 3. **Invitations and enrollment:** email invites, verification, semester-specific section assignment with history, CR and teacher assignment.
- [x] 4. **Classes:** subject x section x teacher.
- [x] 5. **Syllabus ingestion:** upload per subject per batch, extraction, draft review with natural-language changes, publish, versions, copy from previous batch, chunking and embedding, job queue and file storage.
- [x] 6. **Class entries (text):** CR and teacher entries, AI organization, topic mapping, `taught_on`, versions, approval workflow, reminders.
- [x] 7. **CR voice and photo input** with review before submit.
- [x] 8. **Student Q&A:** router, retrieval with access re-check, syllabus classification, labeled answers, source references, private chat history.
- [x] 9. **Catch-up and date-based questions.**
- [x] Web screens for features 1 to 9: shell, sign-in, invites, profile; admin structure, people, classes, settings; syllabus review; CR entry (text, voice, photo) and teacher approvals; student chat and catch-up; Super Admin colleges page.
- [x] V1 hardening: forced RLS and startup role check, Playwright browser tests, keyboard and screen-reader pass, Dockerfiles, production compose and backups.
- [ ] 10 to 16. V2: notes, exams and exam scope, study plan, study cards, study room, usage dashboards, Nepali beta. Plan, order and open questions: [roadmap-v2.md](roadmap-v2.md)
- [ ] 17. Deploy: a pilot after V1 ([deploy.md](deploy.md)), then again after V2

## Status

Updated 2026-10-19, at the end of V1. In a long session, record progress here (what is done, what is next, open questions) before the context runs out, so a fresh session can continue.

### Built

Features 0 to 9 with their web screens, and the hardening pass, all committed on `main` (only the scaffold was pushed). The commits use the feature scopes: `feat(scaffold)`, `feat(foundations)`, `feat(structure)`, `feat(enrollments)`, `feat(classes)`, `feat(syllabus)`, `feat(sessions)`, `feat(media)`, `feat(chat)`, `feat(catchup)`, `feat(web): ...`, `feat(db)`, `test(web)`, `feat(deploy)`.

### Verified, and how

- `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm build` pass; `pnpm test`: 229 API, 19 web and 4 shared tests (real Postgres, Redis and Qdrant in Docker; OpenAI, R2 and email mocked).
- `pnpm e2e`: 7 Playwright tests against the compiled API and worker and `next start`, the reseeded demo college and a fake OpenAI server; passed three runs in a row. The flows covered are listed in [local-setup.md](local-setup.md).
- Real OpenAI: `smoke:ai` (about $0.02) confirmed all six configured model names, strict JSON output, PDF file input for scans, image input, embeddings and a price row for every model. One real chat question was asked through the API and its answer (labels, [S1] chips, general explanation) renders correctly.
- Screens: screenshots against production builds with the demo college, 19 pages for 5 roles at 360, 768 and 1280 px in light and dark, plus the Super Admin page; no sideways scroll at 360 px and no page errors. A sample of the images was inspected, not every one.
- Keyboard: a scripted run through sign-in, chat, CR entry, approvals and syllabus review (details in [ui-ux.md](ui-ux.md), "Keyboard pass").
- Role check: a test starts the API and the worker as the owner (superuser) and expects them to exit. Migrations were applied as a non-superuser owner in a scratch database, where FORCE blocked that owner's writes.
- Deployment: both images built; the production compose stack ran locally with throwaway secrets; a backup restored into a scratch database with equal row counts, forced RLS and the app role's grants (details in [deploy.md](deploy.md)).

### Known gaps

- Microphone recording is untested in a real browser (headless has no microphone); the transcription path was checked through the API.
- Rendered but not exercised in a browser (each has API tests): moving and deactivating students, CSV import, inviting teachers and program admins, creating classes and changing teachers, saving settings, teacher "add an entry", the chat subject picker, deleting a chat, the quota meter.
- The invite progress card shows "0 of 3 sent" for seeded invites, because the seed creates invites without the email log the counts read. Real invites are counted.
- No real screen reader run (NVDA, VoiceOver, TalkBack); colour contrast not measured with a tool.
- Coolify itself is untested: the compose file ran under plain Docker Compose, so the bind mount of `infra/postgres-init-prod.sh`, domains, TLS and Coolify's environment UI are unchecked. Real R2, Gmail and OpenAI in production are unchecked.
- There is no command to rebuild the Qdrant index from Postgres, and none to re-index after an embedding model change.
- Later improvements already decided: quotas on the college's own month, chat streaming, a per-CR photo-read quota (photos count toward the college budget only).
- `EntryView.latest` can be a withdrawn version; the web app hides a withdrawn `latest`.

### To test by hand

1. The microphone on real phones (Android Chrome, iOS Safari).
2. `pnpm test` on your machine (real Qdrant in Docker) and `pnpm e2e` once.
3. A real screen reader on the main flows.
4. After the pilot deploy, the checks in [deploy.md](deploy.md) ("After the first deploy"), daily backups off the VPS and one restore.

### Next

1. Deploy to a pilot college ([deploy.md](deploy.md)).
2. V2 (features 10 to 16), each followed by its screens: settle each feature's open questions in [roadmap-v2.md](roadmap-v2.md) first.

### Working notes

- **Migrations:** change `schema.prisma`, then `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script > prisma/migrations/<timestamp>_<name>/migration.sql` (delete the "Loaded Prisma config" first line if it lands in the file), append `ENABLE ROW LEVEL SECURITY`, `FORCE ROW LEVEL SECURITY` and the `tenant_isolation` policy for every new tenant table (`rls-coverage.test.ts` fails otherwise), `npx prisma migrate deploy`, then run the diff again to confirm it is empty. Composite foreign keys go in the schema (`@relation(fields: [xId, tenantId], references: [id, tenantId])`); a one-to-one one also needs `@@unique([xId, tenantId])`.
- `prisma migrate reset` is blocked for AI agents; avoid needing it. `20261018214529_structure_path_integrity` is an empty, harmless migration.
- The Bash tool mangles backslashes and turns `\n` inside patch scripts into real newlines: write source with the file tools, or check the result after a scripted patch.
- `pg` prints "Calling client.query() when the client is already executing a query" during tests. It comes from Prisma 7's query interpreter loading `include` relations in parallel on one transaction connection; `pg@8` queues them safely. Do not upgrade to `pg@9` until Prisma serializes these.
- Cross-module hooks are wired in `apps/api/src/wiring.ts`. Module dependencies run one way: chat → catchup → sessions → media → files/classes; nothing imports chat.
- API test helpers: `test/world.ts` (two colleges; `addTeacher`, `addStudent` with `{ cr: true }`, `addClass`), `test/fakes.ts` (`FakeStorage`, `FakeAi` with `respond(schemaName, ...)`, `transcript`, `failNext`, deterministic `vectorFor`, `makePdf`), `test/syllabus.ts` (`publishSyllabus`), `test/jobs.ts` (`drainQueue`).
- Browser tests: `apps/web/e2e`. `pnpm e2e` needs ports 3000, 4000 and 4010 free and **resets the demo college in the development database**. A new AI schema name needs a fake answer in `e2e/support/fake-openai.ts`.
- Web conventions: client components fetch with TanStack Query (`features/admin/queries.ts`, `features/entries/shared.tsx` hold keys); forms in sheets use `FormSheet`; field errors come from `ApiError.field(path)`; every user-facing string is in `src/lib/strings.ts`; show the API's own message for 409s; uploads go through `lib/upload.ts`.
- Next.js builds a standalone server only with `NEXT_OUTPUT_STANDALONE=1` (the web Dockerfile sets it); locally `next start` is used.
- A real `OPENAI_API_KEY` sits in `apps/api/.env` (git-ignored): never print, log or commit it.
