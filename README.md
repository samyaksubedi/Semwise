# Semwise

A multi-tenant academic workspace for colleges: an academic memory built from official syllabi and from what is actually taught in each class, with an AI assistant that answers students from the content they are allowed to see.

- Product brief: [docs/Semwise_Project_Context.md](docs/Semwise_Project_Context.md)
- Architecture and build progress: [docs/architecture.md](docs/architecture.md)
- Run it locally: [docs/local-setup.md](docs/local-setup.md)

## Layout

| Folder            | What                                                 |
| ----------------- | ---------------------------------------------------- |
| `apps/api`        | Express API and BullMQ worker (TypeScript, Prisma 7) |
| `apps/web`        | Next.js web app (built after the backend core loop)  |
| `packages/shared` | Zod schemas, response envelope and error codes       |
| `infra`           | Docker Compose for local services                    |

## Commands

`pnpm db:up`, `pnpm dev`, `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm test`, `pnpm build`.
