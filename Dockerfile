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
# a later change adds a new import to those trees and this list isn't grown to match, the
# runner stage's smoke-import RUN line below catches it as a failed docker build instead of
# an ERR_MODULE_NOT_FOUND surprise at container runtime.
RUN mkdir -p /app/runtime-modules/@neondatabase && \
  cp -rL /app/node_modules/drizzle-orm /app/runtime-modules/drizzle-orm && \
  cp -rL /app/node_modules/zod /app/runtime-modules/zod && \
  cp -rL /app/node_modules/server-only /app/runtime-modules/server-only && \
  cp -rL /app/node_modules/@neondatabase/serverless /app/runtime-modules/@neondatabase/serverless

# server/catalogue/map-app-details.ts imports isomorphic-dompurify, which unconditionally
# constructs a JSDOM at module load (it has no browser/server branch), so jsdom's own
# dependency tree ships too — a flat cp -rL per name, as done above, is not safe for it: pnpm
# resolves a genuine version split for this tree (jsdom needs whatwg-url 17.x directly, its own
# data-urls dependency needs whatwg-url 16.x) that only pnpm's per-package node_modules nesting
# keeps apart, and several of the ~40 nested store directories are named with a peer-dependency
# hash that cannot be reconstructed by hand and would rot on a lockfile bump. So this walks the
# real symlinks node_modules/.pnpm already resolved at install time and mirrors that slice of
# the store as-is (verified against an isolated copy: both whatwg-url versions present, entity
# decoding in parse5 working, sanitize() stripping <script> and onerror as expected), instead of
# hand-listing package names the way the four packages above are.
RUN node -e "const fs=require('fs'),path=require('path');const store='node_modules/.pnpm';const dest='/app/runtime-modules';const seen=new Set();function walk(dir){if(seen.has(dir))return;seen.add(dir);const nm=path.join(store,dir,'node_modules');if(!fs.existsSync(nm))return;for(const entry of fs.readdirSync(nm,{withFileTypes:true})){const full=path.join(nm,entry.name);if(entry.isSymbolicLink()){const real=fs.realpathSync(full);const m=real.match(/\.pnpm\/([^/]+)\/node_modules\//);if(m)walk(m[1]);}else if(entry.name.startsWith('@')&&entry.isDirectory()){for(const sub of fs.readdirSync(full)){const subfull=path.join(full,sub);if(fs.lstatSync(subfull).isSymbolicLink()){const real=fs.realpathSync(subfull);const m=real.match(/\.pnpm\/([^/]+)\/node_modules\//);if(m)walk(m[1]);}}}}}walk('isomorphic-dompurify@3.23.0');for(const dir of seen){fs.mkdirSync(path.join(dest,'.pnpm',dir,'node_modules'),{recursive:true});fs.cpSync(path.join(store,dir,'node_modules'),path.join(dest,'.pnpm',dir,'node_modules'),{recursive:true});}fs.symlinkSync('.pnpm/isomorphic-dompurify@3.23.0/node_modules/isomorphic-dompurify',path.join(dest,'isomorphic-dompurify'));if(seen.size<20)throw new Error('isomorphic-dompurify dependency walk found suspiciously few packages: '+seen.size);console.log('isomorphic-dompurify runtime deps:',seen.size,'pnpm store dirs copied');"

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

# Smoke-imports the sync and lists jobs against exactly the node_modules this image ships. No
# DATABASE_URL or network needed — this is what catches a package missed from the
# hand-maintained runtime-modules list above (see that comment). sync.ts alone does not reach
# store-search.ts or lists.ts, so importing only it would leave the new sync:lists job unchecked.
RUN node --conditions=react-server -e "await import('./server/catalogue/sync.ts'); await import('./server/catalogue/lists.ts')"

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${PORT}/api/health" || exit 1

CMD ["node", "server.js"]
