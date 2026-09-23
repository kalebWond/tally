# Build context: repository root.
FROM node:24-alpine AS build
RUN corepack enable
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 npm_config_store_dir=/pnpm/store npm_config_fetch_timeout=600000 npm_config_network_concurrency=4
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/contracts/package.json packages/contracts/
COPY services/analytics-consumer/package.json services/analytics-consumer/
# Dependency install scripts are skipped: only esbuild has one, and it just validates the binary.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store,sharing=locked pnpm install --frozen-lockfile --ignore-scripts --filter @tally/analytics-consumer...
COPY packages/contracts packages/contracts
COPY services/analytics-consumer services/analytics-consumer
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store,sharing=locked pnpm --filter @tally/analytics-consumer build \
 && pnpm --filter @tally/analytics-consumer deploy --prod --legacy /out

FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out .
USER node
EXPOSE 4004
CMD ["node", "dist/index.js"]
