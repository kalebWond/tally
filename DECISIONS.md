# Decisions

Short entries: what was decided, the alternatives, and why. Newest at the bottom.

---

## F1 — Compose runs infra by default, the full stack behind a profile

**Decided:** `docker compose up` starts only Redpanda, Postgres and Redis. Services run on the host (`pnpm dev`, `go run`) for fast iteration. `docker compose --profile app up` builds and runs every service in a container for demos, recording, and proving the Dockerfiles.
**Alternatives:** everything in Compose always (slow edit loop through image rebuilds or bind mounts); infra only (Dockerfiles rot until deployment).
**Why:** you get the fast loop day to day, and the containerised path stays exercised. Each service gets its Dockerfile when the service is created, not retrofitted at F26.

## F1 — Redpanda advertises two listeners

**Decided:** `internal://redpanda:9092` for containers on the Compose network, `external://localhost:19092` for host-run services.
**Alternatives:** a single listener advertising `localhost` (breaks containers) or `redpanda` (breaks the host unless `/etc/hosts` is edited).
**Why:** Kafka clients connect to whatever address the broker *advertises*, not the one they dialled. A single advertised address can't be right for both network views. `KAFKA_BROKERS` differs per mode: `.env` holds the host value, and `compose.yaml` overrides it for containers.

## F1 — `PORT` per service, defaulting to the spec port

**Decided:** each service reads plain `PORT`, defaulting to its SPEC.md port (web 3000, ingest 4000, gateway 4001, generator 4002, consumer 4003). The shared `.env` never sets `PORT`.
**Alternatives:** service-prefixed vars (`INGEST_PORT`, …) so a single `.env` could set them all.
**Why:** `PORT` is the convention every platform and Kubernetes manifest expects. Defaults avoid port collisions between host-run services without prefixing.

## F1 — Consumer health listener on 4003

**Decided:** the consumer has no API, but it runs a minimal HTTP listener on 4003 for `/health` (and `/metrics` at F23).
**Why:** every service needs a probe target. 4003 continues the 400x sequence.

## F1 — Host services load `.env` through Node's `--env-file-if-exists`

**Decided:** `tsx watch --env-file-if-exists=../../.env`. Application code only ever reads `process.env`.
**Alternatives:** `dotenv` inside the app; exporting variables by hand.
**Why:** the file is a dev convenience outside the app. Containers and Kubernetes inject the same variables directly, and nothing in `src/` knows a file exists.

## F1 — Contracts ship TypeScript source; services bundle them with tsup

**Decided:** `@tally/contracts` exports `src/index.ts` directly, with no build step. Services bundle it in with tsup (`noExternal: [/^@tally\//]`). The web app uses `transpilePackages`. `zod` is a peer dependency of contracts, so each consumer shares one Zod instance.
**Alternatives:** a build step for contracts (watch processes, stale `dist` bugs); TypeScript project references; running `tsx` in production.
**Why:** editing a schema takes effect everywhere immediately in dev, and production images still run plain compiled JS. Runtime images use `pnpm deploy --prod` for a minimal `node_modules`.

## F1 — Biome for lint and format

**Decided:** Biome, one config at the root.
**Alternatives:** ESLint + Prettier.
**Why:** one fast tool, one config, and far fewer dependencies across a monorepo. The loss is Next.js's ESLint plugin rules, which is acceptable here.

## F1 — TypeScript 7 (native compiler)

**Decided:** `typescript@7` for typechecking in every package. Builds go through tsup/esbuild (services) and Next's SWC (web), so `tsc` never emits.
**Alternatives:** stay on the 5.x/6.x JS compiler.
**Why:** much faster typechecks in a monorepo, and nothing here depends on the old compiler API. If Next's build-time type check ever breaks on it, fall back to 6.x for `apps/web` only.

## F1 — Docker builds share one locked pnpm store

**Decided:** every Node Dockerfile mounts one BuildKit cache (`id=pnpm-store, sharing=locked`) as the pnpm store and installs with `--ignore-scripts`.
**Why:** on a slow link, four images installing in parallel timed out. A locked shared store makes the first build download and the rest reuse. `--ignore-scripts` works around two esbuild versions (tsup wants `^0.27`, tsx wants `~0.28`): the 0.28 postinstall check fails in the image, but tsx never runs in a container.
