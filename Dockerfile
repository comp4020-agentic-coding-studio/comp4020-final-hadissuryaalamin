# syntax = docker/dockerfile:1

# Node/TypeScript/Fastify app (see epic.md's "Stack" section). Two stages:
# "deps" compiles better-sqlite3's native addon (it's a prod dependency, so
# node-gyp needs python3/make/g++, which only this stage carries); "runtime"
# is a slim image with just the compiled node_modules and the app's source.
#
# Deliberate choice, worth a line in the stack ADR (task 009): there is no
# `tsc` build stage. Node 24 (pinned in mise.toml, matched here) strips
# TypeScript types natively at `node <file>.ts` with no flag and no build
# step, and this repo's tsconfig.json is `noEmit: true` plus
# `allowImportingTsExtensions` (imports already name their `.ts` file, which
# is what Node wants) — it's a typecheck-only config, not meant to produce
# `dist/`. Standing up a second, emit-enabled tsconfig just to satisfy a
# "build stage" would mean fighting `allowImportingTsExtensions` (TS refuses
# to emit with it on) and rewriting every relative import's extension for
# nothing: the source *is* what runs, same as `pnpm check` already proves
# locally. So the runtime stage copies `src/` straight in and runs it with
# plain `node`.
FROM node:24-alpine AS deps
RUN apk add --no-cache python3 make g++
WORKDIR /app
# pnpm-workspace.yaml's `allowBuilds` (better-sqlite3, esbuild) is what lets
# this install run its native build step non-interactively — no
# `pnpm approve-builds` needed, it's already declared in the committed config.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN corepack enable \
    && pnpm install --prod --frozen-lockfile

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
# The only writable, persistent storage is the /data Fly volume (fly.toml's
# [mounts]); resolveDbPath() (src/db/connection.ts) joins DATA_DIR with
# app.db, so this is what lands the SQLite file on the volume instead of an
# ephemeral path.
ENV DATA_DIR=/data
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY public ./public
COPY README.md ./README.md
EXPOSE 8080
CMD ["node", "src/server.ts"]
