# Semwise

A multi-tenant SaaS for colleges: an academic memory built from official syllabi and from what is actually taught in each class, with an AI assistant that answers students from the content they are allowed to see.

## Stack

Next.js web app, Express 5 API and a BullMQ worker (Node 24, TypeScript), PostgreSQL with Prisma 7, Qdrant, Redis, Cloudflare R2, OpenAI, Nodemailer. A pnpm monorepo: `apps/api`, `apps/web`, `packages/shared`, `infra`.

## Run it

Follow [docs/local-setup.md](docs/local-setup.md). In short: `pnpm install`, `pnpm db:up`, copy `apps/api/.env.example` to `apps/api/.env`, `pnpm db:deploy`, `pnpm dev`. Checks: `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm test`, `pnpm build`.

## Deploy

One VPS with Coolify: [docs/deploy.md](docs/deploy.md).

## Docs

| Doc                                                           | What it holds                                       |
| ------------------------------------------------------------- | --------------------------------------------------- |
| [Semwise_Project_Context.md](docs/Semwise_Project_Context.md) | Product brief: rules, roles, decisions, principles  |
| [architecture.md](docs/architecture.md)                       | Stack, repo layout, conventions, build list, status |
| [data-model.md](docs/data-model.md)                           | Tables and constraints                              |
| [permissions.md](docs/permissions.md)                         | Role x action matrix                                |
| [app-flows.md](docs/app-flows.md)                             | Step-by-step flow of every V1 feature               |
| [ui-ux.md](docs/ui-ux.md)                                     | Web UI and UX rules                                 |
| [local-setup.md](docs/local-setup.md)                         | Running and testing locally                         |
| [deploy.md](docs/deploy.md)                                   | Production deploy, environment, backups             |
| [roadmap-v2.md](docs/roadmap-v2.md)                           | V2 plan (features 10 to 16) and its open questions  |
| [CLAUDE.md](CLAUDE.md)                                        | Instructions for Claude Code                        |
