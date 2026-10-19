# syntax=docker/dockerfile:1
# The web app as a standalone Next.js server. Build from the repo root; the API's public URL is
# baked into the browser bundle, so it is a build argument:
#   docker build -f apps/web/Dockerfile --build-arg NEXT_PUBLIC_API_URL=https://api.example.com -t semwise-web .

FROM node:24-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile --filter "@semwise/web..."
ARG NEXT_PUBLIC_API_URL
RUN test -n "$NEXT_PUBLIC_API_URL" || (echo "Set --build-arg NEXT_PUBLIC_API_URL" && exit 1)
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL NEXT_OUTPUT_STANDALONE=1
RUN pnpm --filter @semwise/shared build && pnpm --filter @semwise/web build

FROM node:24-slim AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
# The standalone folder mirrors the repo (tracing starts at the root); static files go beside it.
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/login').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "apps/web/server.js"]
