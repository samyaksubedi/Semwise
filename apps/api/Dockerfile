# syntax=docker/dockerfile:1
# The API and the worker share this image (docs/architecture.md): the API runs the default
# command, the worker overrides it with `node dist/worker.js`. Build from the repo root:
#   docker build -f apps/api/Dockerfile -t semwise-api .

FROM node:24-slim AS base
# Prisma's migration engine needs OpenSSL; CA certificates for OpenAI, R2 and Gmail over TLS.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /repo

# Everything needed to compile the shared package and the API.
FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile --filter "@semwise/api..."
RUN pnpm --filter @semwise/shared build && pnpm --filter @semwise/api build

# Production dependencies only (the Prisma CLI is one: migrations run on start).
FROM base AS prod-deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/prisma.config.ts apps/api/
COPY apps/api/prisma apps/api/prisma
RUN pnpm install --frozen-lockfile --prod --filter "@semwise/api..."

FROM base AS runtime
ENV NODE_ENV=production PORT=4000
COPY --from=prod-deps /repo /repo
COPY --from=build /repo/packages/shared/dist /repo/packages/shared/dist
COPY --from=build /repo/apps/api/dist /repo/apps/api/dist
WORKDIR /repo/apps/api
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/v1/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
# Migrations run as the owner role (MIGRATION_DATABASE_URL); the server connects as the app role
# (DATABASE_URL) and refuses to start if that role could bypass row-level security.
CMD ["sh", "-c", "node_modules/.bin/prisma migrate deploy && exec node dist/server.js"]
