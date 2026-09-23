# Build context: repository root.
FROM node:24-alpine AS build
RUN corepack enable
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 npm_config_store_dir=/pnpm/store npm_config_fetch_timeout=600000 npm_config_network_concurrency=4
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/contracts/package.json packages/contracts/
COPY packages/db/package.json packages/db/
# Dependency install scripts are skipped: only esbuild has one, and it just validates the binary.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store,sharing=locked pnpm install --frozen-lockfile --ignore-scripts --filter @tally/db...
COPY packages/contracts packages/contracts
COPY packages/db packages/db
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store,sharing=locked pnpm --filter @tally/db build \
 && pnpm --filter @tally/db deploy --prod --legacy /out

# One-shot job image: applies migrations, then (in the local stack) seeds.
FROM node:24-alpine
ENV NODE_ENV=production MIGRATIONS_DIR=/app/migrations
WORKDIR /app
COPY --from=build /out .
COPY infra/migrations ./migrations
USER node
CMD ["node", "dist/migrate.js"]
