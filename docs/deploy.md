# Deploying Semwise (Coolify, one VPS)

Nothing has been deployed yet. This is the checklist for the first pilot deploy. The plan itself is in [architecture.md](architecture.md) ("Deployment").

## What is in the repo

| File                            | What it is                                                                                                         |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `apps/api/Dockerfile`           | API image. The **worker uses the same image** with the command `node dist/worker.js` (one build, two services).    |
| `apps/web/Dockerfile`           | Web image: a standalone Next.js server. `NEXT_PUBLIC_API_URL` is a build argument (baked into the browser bundle). |
| `infra/docker-compose.prod.yml` | The whole stack for Coolify: web, api, worker, postgres, redis, qdrant.                                            |
| `infra/postgres-init-prod.sh`   | Creates the app role (`semwise_app`) when the database volume is first created.                                    |
| `scripts/db-backup.mjs`         | Database backup with a read-back check and rotation (`pnpm db:backup -- ...`).                                     |

Both images were built and the whole compose stack was started locally on 2026-10-19 with throwaway secrets: migrations ran as the owner on a fresh volume, the app role was created without superuser or BYPASSRLS, `/v1/health/ready` reported database, Redis and Qdrant ok, the worker started, the web server answered, Redis ran with AOF and `noeviction`, and Qdrant refused requests without its key. A backup of the development database was restored into a scratch database with the same row counts, forced RLS and the app role's grants.

## 1. Before you start

- A VPS with at least 4 GB RAM (8 GB is more comfortable while images build) with Coolify installed.
- A domain. Use two subdomains of **one** registrable domain, for example `app.example.com` (web) and `api.example.com` (API). The session cookie lives on the API host with `SameSite=Lax`; the browser only sends it on the web app's calls because both hosts are the same site. Different registrable domains (`example.com` and `example-api.net`) will not work.
- DNS: `A` records for both subdomains pointing to the VPS.
- Accounts: Cloudflare (R2), a Gmail account with 2-step verification, an OpenAI API key with a monthly spend limit set in the OpenAI dashboard.

## 2. Coolify

1. New resource, **Docker Compose**, from this Git repository. Base directory `/`, compose file `infra/docker-compose.prod.yml`.
2. Fill in the environment variables (section 3). Coolify lists every `${...}` in the compose file; the ones marked `:?` stop the deploy when empty.
3. Domains: `web` → `https://app.example.com` on port 3000; `api` → `https://api.example.com` on port 4000. Coolify's proxy terminates TLS. Give no domain to postgres, redis, qdrant or worker; the compose file publishes no ports for them.
4. Deploy. The API container runs `prisma migrate deploy` (as the owner role) and then starts; the worker waits for the API's health check, so migrations always run first. The web image is built with `NEXT_PUBLIC_API_URL=${API_ORIGIN}`: **rebuild web whenever the API domain changes**.
5. If the init script mount does not work on your Coolify version (the role is missing and the API logs a database login error), create the role once by hand with the SQL in section 5.
6. Create the Super Admin. Interactively (email, name, then the password hidden and typed twice): `docker exec -it <api container> node dist/scripts/create-super-admin.js`. Or without prompts (the password is read silently, so it stays out of shell history and the process list):

   ```sh
   read -rs SUPER_ADMIN_PASSWORD && export SUPER_ADMIN_PASSWORD
   docker exec -e SUPER_ADMIN_PASSWORD <api container> node dist/scripts/create-super-admin.js --email you@example.com --name "Your Name"
   unset SUPER_ADMIN_PASSWORD
   ```

7. Sign in at `https://app.example.com`, create the pilot college on the Colleges page, and check the University Admin invite arrives.

## 3. Environment variables

Set these in Coolify. Never commit them. Values in `apps/api/.env.example` are for local development only.

### Domains, cookies and origins

| Variable           | Example                   | Notes                                                                                                                                                         |
| ------------------ | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `WEB_ORIGIN`       | `https://app.example.com` | Required. Becomes the API's `WEB_ORIGIN` (links in emails) and `CORS_ORIGINS` (the only origin allowed to send cookies and writes). Exact, no trailing slash. |
| `API_ORIGIN`       | `https://api.example.com` | Required. Build argument `NEXT_PUBLIC_API_URL` of the web image.                                                                                              |
| `TRUST_PROXY_HOPS` | `1`                       | Default 1 (Coolify's proxy). Needed for real client IPs in rate limits. Do not raise it unless another proxy (Cloudflare proxying) sits in front.             |

The API sets the session cookie itself: in production it is `__Host-semwise_sid`, `Secure`, `HttpOnly`, `SameSite=Lax`, host-only on the API domain, so HTTPS is mandatory (Coolify provides it). There is no cookie-domain setting to get wrong.

### Database (the app role)

| Variable            | Notes                                                                                                                                                                                                                        |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POSTGRES_PASSWORD` | Required. Password of `semwise`, the owner: it creates the tables and runs migrations (`MIGRATION_DATABASE_URL`). Postgres makes it a superuser inside its container. Used only for migrations and backups.                  |
| `APP_DB_PASSWORD`   | Required. Password of `semwise_app`, what the API and worker connect as (`DATABASE_URL`). It has no superuser and no BYPASSRLS, so row-level security applies; **the API and worker refuse to start** if it has either flag. |

Long random values (for example `openssl rand -base64 32`, without `/`, `@` or `:` since they go into URLs).

### Redis and Qdrant

| Variable         | Notes                                                           |
| ---------------- | --------------------------------------------------------------- |
| `REDIS_PASSWORD` | Required. Redis runs with AOF, `noeviction` and this password.  |
| `QDRANT_API_KEY` | Required. Qdrant refuses requests without it; the API sends it. |

### OpenAI

| Variable                                                                                                              | Notes                                                                                                                                                                                          |
| --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OPENAI_API_KEY`                                                                                                      | Without it the AI features answer 503 and everything else works. Set a hard monthly limit in the OpenAI dashboard as well.                                                                     |
| `AI_MODEL_ROUTER`, `AI_MODEL_ANSWER`, `AI_MODEL_DEEP`, `AI_MODEL_VISION`, `AI_MODEL_EMBEDDING`, `AI_MODEL_TRANSCRIBE` | Optional; defaults are in the compose file. Changing the embedding model needs a full re-index (no tool for that yet).                                                                         |
| `AI_TENANT_MONTHLY_BUDGET_MICROS`                                                                                     | Optional, default 50 000 000 ($50) per college per month. The price table used by the ledger is data in Postgres: confirm the prices on OpenAI's pricing page before launch (architecture.md). |

### Cloudflare R2 (files)

| Variable               | Notes                                                                                    |
| ---------------------- | ---------------------------------------------------------------------------------------- |
| `R2_ACCOUNT_ID`        | The Cloudflare account id; the endpoint becomes `https://<id>.r2.cloudflarestorage.com`. |
| `R2_ACCESS_KEY_ID`     | From an R2 API token with **Object Read & Write** on this bucket only.                   |
| `R2_SECRET_ACCESS_KEY` | Same token.                                                                              |
| `R2_BUCKET`            | A **private** bucket (no public access, no custom public domain).                        |

Without them uploads answer 503. The browser uploads straight to R2 through signed URLs, so the bucket needs a CORS rule for the web origin (R2 bucket settings, CORS policy):

```json
[
  {
    "AllowedOrigins": ["https://app.example.com"],
    "AllowedMethods": ["PUT", "GET"],
    "AllowedHeaders": ["Content-Type"],
    "MaxAgeSeconds": 600
  }
]
```

### Email (Gmail app password)

| Variable          | Value                                                                                                                                                   |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SMTP_HOST`       | `smtp.gmail.com` (default)                                                                                                                              |
| `SMTP_PORT`       | `587` (default)                                                                                                                                         |
| `SMTP_SECURITY`   | `starttls` (default; TLS is required)                                                                                                                   |
| `SMTP_USER`       | The Gmail address                                                                                                                                       |
| `SMTP_PASSWORD`   | A Gmail **app password** (Google account, Security, 2-Step Verification on, App passwords). Not the account password. 16 letters; spaces do not matter. |
| `MAIL_FROM`       | `Semwise <the same gmail address>`: Gmail rewrites any other sender.                                                                                    |
| `MAIL_DAILY_CAP`  | Default 400, below Gmail's limit of about 500 recipients a day for a personal account (confirm the current figure).                                     |
| `MAIL_PER_MINUTE` | Default 20.                                                                                                                                             |

Without `SMTP_HOST`/`MAIL_FROM` no email is sent (invites stay queued).

### Optional

`LOG_LEVEL` (default `info`). The quota and approval defaults in `apps/api/src/config/env.ts` (`QUOTA_*`, `APPROVAL_REMINDER_HOURS`, `APPROVAL_ESCALATE_HOURS`) are not passed by the compose file; add them to the `x-api-env` block if a pilot needs other values.

## 4. Backups

### Postgres

`scripts/db-backup.mjs` runs `pg_dump` (custom format) inside the Postgres container, checks the file with `pg_restore --list`, and deletes backups older than `--keep-days` (default 14). It needs Node 24 on the machine that runs it.

```sh
node scripts/db-backup.mjs --container <postgres container> --out /var/backups/semwise --keep-days 14
```

Without Node on the VPS, the same dump in one line: `docker exec <postgres container> pg_dump -U semwise -d semwise --format=custom --no-owner > semwise-$(date -u +%Y%m%d-%H%M).dump`.

- Run it daily from cron (or a Coolify scheduled task) and **copy the files off the VPS**, for example to a separate private R2 bucket with `rclone`. A backup on the same disk does not survive the VPS.
- Dumps are taken as the owner, which is a superuser inside the container. A role bound by row-level security cannot dump the tenant tables (they force RLS).
- Backups contain everything, including student chats and notes: keep them private and encrypted at rest.

### Restore

1. Stop `api`, `worker` and `web` in Coolify (keep `postgres` running).
2. Into a fresh database (the init script has created `semwise_app`):

   ```sh
   docker exec -i <postgres container> psql -U semwise -d postgres -c "DROP DATABASE IF EXISTS semwise_restore" -c "CREATE DATABASE semwise_restore"
   docker exec -i <postgres container> pg_restore -U semwise -d semwise_restore --no-owner --exit-on-error < semwise-....dump
   ```

3. Check it: `docker exec -i <postgres container> psql -U semwise -d semwise_restore -c "select count(*) from tenants"`.
4. Swap it in: `ALTER DATABASE semwise RENAME TO semwise_old; ALTER DATABASE semwise_restore RENAME TO semwise;` (as `semwise`, connected to the `postgres` database, with the app stopped).
5. Start `api` (it applies any newer migrations), then `worker` and `web`. Drop `semwise_old` once the app works.

The dump carries the grants for `semwise_app`. Restoring into a database where that role does not exist yet: create it first (section 5).

**Test a restore before launch**, then again every few months.

### Qdrant and Redis

- Qdrant is a search index; Postgres is the source of truth. Take snapshots (`POST /collections/semwise_chunks/snapshots` with the API key, from inside the stack) and copy them off the VPS. There is no command yet to rebuild the index from Postgres: until there is one, a lost Qdrant volume means re-publishing syllabi and entries, so keep the snapshots.
- Redis holds queued jobs (AOF on its volume). Losing it loses queued emails and reminders, not data.

## 5. The app database role by hand

Only if `infra/postgres-init-prod.sh` did not run (an existing volume, or a Coolify version without the bind mount). As `semwise`:

```sql
CREATE ROLE semwise_app LOGIN PASSWORD '<APP_DB_PASSWORD>' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
GRANT USAGE ON SCHEMA public TO semwise_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO semwise_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO semwise_app;
ALTER DEFAULT PRIVILEGES FOR ROLE semwise IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO semwise_app;
ALTER DEFAULT PRIVILEGES FOR ROLE semwise IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO semwise_app;
```

Type it in `psql` interactively rather than passing it on the command line, so the password stays out of shell history.

## 6. After the first deploy

- `https://api.example.com/v1/health/ready` reports `database`, `redis` and `qdrant` as `ok`.
- Sign in, create a college, accept its invite in a private window, upload a syllabus, publish it, add an entry as a CR, ask a question as a student.
- Check the microphone on a real phone (Android Chrome and iOS Safari): this has not been tested anywhere yet.
- Set up the daily backup and test one restore.
