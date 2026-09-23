# Build context: repository root.
FROM node:24-alpine AS build
RUN corepack enable
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 npm_config_store_dir=/pnpm/store npm_config_fetch_timeout=600000 npm_config_network_concurrency=4
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/contracts/package.json packages/contracts/
COPY packages/metrics/package.json packages/metrics/
COPY services/ingest/package.json services/ingest/
# Dependency install scripts are skipped: only esbuild has one, and it just validates the binary.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store,sharing=locked pnpm install --frozen-lockfile --ignore-scripts --filter @tally/ingest...
COPY packages/contracts packages/contracts
COPY packages/metrics packages/metrics
COPY services/ingest services/ingest
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store,sharing=locked pnpm --filter @tally/ingest build \
 && pnpm --filter @tally/ingest deploy --prod --legacy /out

FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out .
USER node
EXPOSE 4000
CMD ["node", "dist/index.js"]
