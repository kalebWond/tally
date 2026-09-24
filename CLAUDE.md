# CLAUDE.md

Project instructions for Claude Code. Read this before touching anything.

---

## What this is

**Tally** — a real-time voting platform. Votes arrive over HTTP, flow through a Kafka-compatible queue, get aggregated by a consumer, and appear on a live results screen with animated counters.

It's a portfolio project modelled on a production SMS voting system built for a live televised contest. The telecom feed is replaced by a controllable Go load generator.

Full detail lives in `SPEC.md`. Build order lives in `IMPLEMENTATION_PLAN.md`. Don't restate them here — read them.

---

## Working agreement

**One feature per session.** Find the current feature in `IMPLEMENTATION_PLAN.md`, build it, satisfy its "done when" check, stop. Don't start the next feature because there's time left.

**Write the check first.** Every feature has a done-when condition. Make it verifiable before writing the implementation.

**Ask, don't assume.** If the spec doesn't cover something — a field name, an error shape, a library choice — ask. Guessing creates work to undo later.

**Log decisions.** Anything non-obvious goes in `DECISIONS.md` as a short entry: what was decided, what the alternatives were, why. This file becomes the case study and interview prep, so it matters.

**Commit per feature.** Message format: `F7: realtime gateway`, plus a what/why bullet body, no Co-Authored-By trailer (the `/feature-commit` format). Since F18, Claude commits at the end of each feature and takes its recommended option on design questions, logging each in `DECISIONS.md`.

---

## Stack

TypeScript everywhere except the load generator, which is Go.

- Frontend: Next.js, Tailwind, shadcn/ui, Motion, Recharts (react-countup dropped in F9: its updates restart the animation)
- Backend: Fastify (ingest), plain Node services (consumer, gateway)
- Queue: Redpanda, Kafka API
- Data: PostgreSQL with Drizzle, Redis, ClickHouse (later phase)
- Generator: Go
- Local: Docker Compose
- Tests: Vitest

---

## Running locally

- `docker compose up -d` starts infrastructure only (Redpanda, Postgres, Redis, ClickHouse on 8123, user/db `tally`). Run services on the host with `pnpm dev` (TS) and `go run .` in `tools/generator`. Host services read `.env` (copy from `.env.example`).
- `docker compose --profile app up -d --build` runs the full stack in containers. Use it for demos, recordings, and checking the Dockerfiles.
- Redpanda: containers use `redpanda:9092`, the host uses `localhost:19092`. A one-shot `topics` job creates `votes.raw` and `votes.dead` (6 partitions each) on every `docker compose up`. Inspect with `docker compose exec redpanda rpk topic consume votes.raw -o start`.
- `pnpm db:migrate` / `pnpm db:seed` on the host (both idempotent). After a schema change, run `pnpm db:generate` and commit the SQL in `infra/migrations`. The `app` profile runs a one-shot `migrate` job (migrate + seed) before consumer and web.
- `packages/*` import each other with `.ts` extensions (Turbopack can't map `.js` → `.ts`); services use `.js`. A bundled workspace package's runtime deps must also be the app's deps.
- Go (generator): `pnpm test:go` / `scripts/go.sh <go args>` use host Go if installed, otherwise the `golang:1.27-alpine` image. After changing a contract the generator speaks, run `pnpm --filter @tally/contracts export-schemas`.
- `pnpm lint` (Biome), `pnpm typecheck`, `pnpm test` (Vitest), `pnpm check:health`.
- Analytics: `analytics-consumer` (port 4004, group `tally-analytics`) copies votes.raw and votes.dead into ClickHouse `votes_raw` / `votes_dead`, creating the tables at startup. Rows are as delivered: count votes as `uniqExact(key_hash)`; counted = accepted − rejected (`votes_dead.sent_at` is the vote's minute). Schema changes are new entries in `MIGRATIONS` (`src/schema.ts`), never edits to applied ones. `pnpm bench:clickhouse` benchmarks the per-minute queries. Query it: `curl 'http://localhost:8123/?user=tally&password=tally&database=tally' --data-binary 'SELECT …'`.
- Metrics: every service serves `GET /metrics` (`@tally/metrics`; the Go generator writes the text format by hand). Prometheus :9090 and Grafana :3001 (anonymous viewer) run in the `app` profile. The dashboard is generated: edit `scripts/grafana-dashboard.py`, run it, commit the JSON. Consumer lag comes from Redpanda's metrics, not the consumers.
- `pnpm recap [contestId] [--out file.mp4]` renders a contest's recap video (Remotion, `tools/recap`) into `recaps/`; default is the most recently closed contest. `tools/recap` pins zod 4.5.4 for Remotion.
- `pnpm load <smoke|steady|spike>` runs k6 (in a container, in the compose network) against the running `app` stack, then checks zero loss and reconciliation; the report lands in `load-results/`. It stops the Go generator first.
- `pnpm reset:votes [--yes]` wipes every vote and everything derived from votes (Postgres, Redis, ClickHouse, the topics and both consumer groups), keeping contests and contestants. It stops and restarts the compose services that touch votes, and refuses to run while services run on the host.
- `pnpm reconcile [--repair] [--contest <uuid>] [--json]` recounts from `votes` and checks every derived count (Postgres and Redis); in containers, `docker compose run --rm reconcile …`. It pauses each contest's counting briefly while it runs.
- Every new service gets its own Dockerfile and a compose entry under the `app` profile when it's created.

---

## Layout

```
apps/web                    Next.js — results, admin, generator control
services/ingest             Fastify — validate and publish
services/consumer           aggregate into Postgres + Redis
services/gateway            WebSocket fan-out
services/analytics-consumer ClickHouse writer (later)
tools/generator             Go load generator
packages/contracts          Zod schemas and shared types
packages/db                 Drizzle schema, client, migrate and seed
infra/                      migrations (generated by drizzle-kit), k8s (optional, later)
```

---

## Rules that aren't negotiable

**The ingest path stays thin.** Validate, hash, publish, return 202. No database reads or writes in the request path. Adding a query here defeats the architecture.

**Never store raw sender identifiers.** Hash with the salt from the environment, immediately, before anything is persisted or logged.

**Never drop a vote silently.** Anything that can't be resolved goes to `votes.dead` with a reason. No swallowed errors.

**Consumers must be idempotent.** The queue delivers at least once. The same message arriving twice must not change any total.

**Config comes from the environment.** No config files, no hardcoded hosts, no state on local disk. This is what makes the optional Kubernetes phase additive rather than a rewrite. Don't break it.

**Every service needs `/health` and graceful SIGTERM shutdown.** Same reason.

**Schemas live in `packages/contracts`.** Defined once with Zod, imported everywhere. Don't redefine an event shape inside a service. The Go generator mirrors these structs and has a contract test.

**Postgres is truth, Redis is speed.** Redis must always be rebuildable from the Postgres vote log. Don't put anything in Redis that exists nowhere else.

---

## Frontend specifics

**Counter animations retarget, they don't restart.** Updates arrive faster than animations finish. Each new total is a new target the running animation springs toward. Starting a fresh animation per update causes visible stutter. This is the single most common way to get the UI wrong.

**Reordering is animated by the layout system**, not by re-rendering the list. Rows should glide past each other on an overtake — that's the moment the whole project is built around.

**One component, two layouts.** The card grid arriving in a later phase must reuse the list's component and data path with a layout flag. Don't fork them.

**No photographs of real public figures** in seed data or demos. Generated or illustrated avatars only — likeness and IP issues on a public portfolio piece.

---

## Testing

Test the logic that would be embarrassing to get wrong: idempotency, code resolution, dead-letter routing, counter aggregation, the snapshot-delta protocol.

Don't write tests that assert framework behaviour or restate the implementation.

---

## Definition of done

A feature is done when its check in `IMPLEMENTATION_PLAN.md` passes, tests cover the core logic, `docker compose --profile app up` still brings the whole stack up cleanly (and `scripts/check-health.sh` passes), nothing from the rules above was violated, and `DECISIONS.md` has an entry if anything non-obvious was chosen.

---

## Current state

Update this section as you go.

**Last completed:** F27, sample contestants (2026-09-24)
**Next up:** F28, recap in the browser; deployment is F29 (see `IMPLEMENTATION_PLAN.md`). Outstanding: the k6 spike regression (DECISIONS, F23); more than one ingest replica is the obvious next step there.

**Seed contest:** `0192f3a0-7c1e-7000-8000-00000000c0de`, codes `C1`–`C10`. A closed demo contest, "Tally Finals" (F1–F10), exists in the dev database for recaps.

**Operator pages:** `/control` (generator panel), `/admin/contests` (create a draft, open/close/reopen, delete drafts; opening needs an active contestant; names unique ignoring case), `/admin/contestants` (with "Fill with sample contestants": invented names, reviewed before saving), `/admin/dead-letters` and `/admin/analytics` (ClickHouse only), behind `ADMIN_PASSWORD` from `.env`. Contestant codes are fixed once created; deactivate instead of deleting. Checks that close the seed contest must reopen it. Web now talks to Redis for one thing: the contest status in the meta hash. The consumer rebuilds Redis totals and minutes from Postgres every time it starts.

**Known gaps:** Go isn't installed on the dev machine; `scripts/go.sh` runs it in a container. k6 at 3,000/s misses p95 < 50 ms on the full stack (70–107 ms; F23). Check scripts that drive headless Chrome must kill its whole process group, or renderers linger.
