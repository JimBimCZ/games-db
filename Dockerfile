FROM node:24-slim AS deps
WORKDIR /app
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable pnpm
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# unrs-resolver (eslint-only) has an unapproved build script and pnpm exits 1 on it, so
# --ignore-scripts is required. It also suppresses esbuild's approved build, which is
# harmless: next build does not use the native binary.
RUN pnpm install --frozen-lockfile --ignore-scripts

FROM node:24-slim AS builder
WORKDIR /app
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable pnpm
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

# pnpm's node_modules entries are symlinks into the .pnpm store, keyed by a version string
# that includes peer hashes; a plain COPY of the symlink alone leaves a dangling link in the
# runner stage. Dereferencing here into a flat directory keeps the runner COPY independent of
# that store layout.
#
# This list is every runtime import server/ and db/ reach for that Next's standalone trace
# doesn't follow (see the comment by the runner-stage COPY below). It is hand-maintained: if
# a later change adds a new import to those trees, this build still succeeds and every test
# still passes — the job just fails at container runtime with ERR_MODULE_NOT_FOUND. Nothing
# in the test suite catches that; grow this list when it happens.
RUN mkdir -p /app/runtime-modules/@neondatabase && \
  cp -rL /app/node_modules/drizzle-orm /app/runtime-modules/drizzle-orm && \
  cp -rL /app/node_modules/zod /app/runtime-modules/zod && \
  cp -rL /app/node_modules/server-only /app/runtime-modules/server-only && \
  cp -rL /app/node_modules/@neondatabase/serverless /app/runtime-modules/@neondatabase/serverless

FROM node:24-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN apt-get update && apt-get install -y --no-install-recommends curl \
  && rm -rf /var/lib/apt/lists/*

COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static

# The standalone bundle contains only what the server needs at request time. The one-off
# catalogue and hydration jobs run from source under Node's native type stripping.
COPY --from=builder --chown=node:node /app/db ./db
COPY --from=builder --chown=node:node /app/server ./server

# drizzle-orm, zod, server-only and @neondatabase/serverless are reachable only from
# these job sources, not from any traced route, so Next's standalone trace drops them.
COPY --from=builder --chown=node:node /app/runtime-modules ./node_modules

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${PORT}/api/health" || exit 1

CMD ["node", "server.js"]
