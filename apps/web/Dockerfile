# Build context: repository root.
FROM node:24-alpine AS build
RUN corepack enable
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 npm_config_store_dir=/pnpm/store npm_config_fetch_timeout=600000 npm_config_network_concurrency=4
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/contracts/package.json packages/contracts/
COPY packages/metrics/package.json packages/metrics/
COPY packages/db/package.json packages/db/
COPY apps/web/package.json apps/web/
# Dependency install scripts are skipped: only esbuild has one, and it just validates the binary.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store,sharing=locked pnpm install --frozen-lockfile --ignore-scripts --filter @tally/web...
COPY packages/contracts packages/contracts
COPY packages/metrics packages/metrics
COPY packages/db packages/db
COPY apps/web apps/web
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @tally/web build

FROM node:24-alpine
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/public ./apps/web/public
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
