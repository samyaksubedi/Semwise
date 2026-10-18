# Local setup

A step-by-step checklist to run Semwise on your machine (Windows with PowerShell and Docker Desktop, macOS or Linux). Everything runs locally: no real OpenAI, R2 or Gmail account is needed for development or tests.

## 1. Requirements

- Node 24 LTS (`node -v`)
- pnpm 10 through corepack: `corepack enable`
- Docker Desktop, running

## 2. Install

```powershell
pnpm install
```

## 3. Start the local services

```powershell
pnpm db:up
```

This starts, from `infra/docker-compose.dev.yml`:

| Service   | Port(s)    | What for                                                                    |
| --------- | ---------- | --------------------------------------------------------------------------- |
| Postgres  | 5434       | Database `semwise` and the test database `semwise_test`                     |
| Redis     | 6380       | Jobs (BullMQ), rate limits. AOF on, `noeviction`, password `semwise`        |
| Qdrant    | 6333       | Vector index (dashboard: http://localhost:6333/dashboard)                   |
| Mailpit   | 1025, 8025 | Catches every email; read them at http://localhost:8025                     |
| SeaweedFS | 9000       | S3-compatible stand-in for Cloudflare R2 (key `semwise` / `semwise-secret`) |

Postgres has two roles: `semwise` owns the tables and runs migrations; `semwise_app` is what the API, the worker and the tests connect as. `semwise_app` cannot bypass row-level security. The roles are created by `infra/postgres-init.sql` the first time the volume is created. If you created the volume before that file existed, reset it with `pnpm db:down` then `docker volume rm semwise_pgdata` and `pnpm db:up`.

MinIO is named in older notes as the R2 stand-in; it no longer publishes public Docker images, so SeaweedFS's S3 gateway is used instead. The API talks to it through the same S3 client it uses for R2.

## 4. Configure the API

```powershell
Copy-Item apps/api/.env.example apps/api/.env
```

The defaults match the Docker services. Leave `OPENAI_API_KEY` empty: AI features then answer 503 with `NOT_CONFIGURED`, and everything else works.

## 5. Create the database tables

```powershell
pnpm db:deploy
```

(`pnpm db:migrate` when you change `apps/api/prisma/schema.prisma`; it creates a new migration.)

## 6. Create the Super Admin

The platform operator account. The password comes from an environment variable so it stays out of shell history:

```powershell
$env:SUPER_ADMIN_PASSWORD = "a long local password"
pnpm super-admin:create -- --email admin@semwise.local --name "Platform Admin"
Remove-Item Env:SUPER_ADMIN_PASSWORD
```

Running it again for the same email resets that account's password and keeps it Super Admin.

## 7. Run

```powershell
pnpm dev
```

This builds the shared package, starts the API on http://localhost:4000, waits for `/v1/health`, then starts the worker (and the web app once it exists).

Check: http://localhost:4000/v1/health/ready should report `database`, `redis` and `qdrant` as `ok`.

## 8. Try it

- Log in: `POST http://localhost:4000/v1/auth/login` with `{ "email", "password" }` and the header `Origin: http://localhost:3000` (every write must come from an allowed origin). The response sets the session cookie.
- `GET /v1/auth/me` shows the user, their colleges and their roles in the active college.
- Forgot password: `POST /v1/auth/password/forgot`; the worker sends the email and Mailpit shows it at http://localhost:8025. The token is in the link's `#token=` fragment.

## 9. Checks before every commit

```powershell
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
pnpm build
```

`pnpm test` needs the Docker services running. It uses `semwise_test` (wiped on every run), Redis database 1, and the Qdrant collection `semwise_test_chunks`. OpenAI, R2 and email are mocked; tests never make paid calls.

## Troubleshooting

- **Port 5434, 6380, 6333, 8025 or 9000 already in use:** change the left side of the port mapping in `infra/docker-compose.dev.yml` and the matching URL in `apps/api/.env`.
- **`Redis is not reachable` on start:** the API refuses to start without Redis. Run `pnpm db:up`.
- **`permission denied for table ...`:** the app role is missing its grants. Recreate the Postgres volume (step 3).
