# CLAUDE.md

Project instructions for Claude Code. Read this before touching anything.

## What this is

**Tally**: a real-time voting platform. Votes arrive over HTTP, flow through a Kafka-compatible queue, are counted by a consumer, and appear on a live results board with animated counters. A portfolio project modelled on a production SMS voting system for a live televised contest; a controllable Go load generator stands in for the telecom feed.

- `SPEC.md`: the system as it is (services, data, events, APIs, frontend).
- `IMPLEMENTATION_PLAN.md`: the features (F-numbers), built and still to build.
- `DECISIONS.md`: why, per feature. Long: use its index or `grep -n "^## F16" DECISIONS.md`; don't read it whole.

## Working agreement

- **One feature per session.** Build the current feature, satisfy its "done when" check, stop.
- **Document first.** A new feature goes into `IMPLEMENTATION_PLAN.md` before it's built, and is built on the user's go-ahead.
- **Write the check first.** Make the done-when verifiable before writing the implementation.
- **Take the recommended option and log it.** On design questions, choose, and record anything non-obvious in `DECISIONS.md` (what, the alternatives, why). Ask about anything the spec doesn't cover that would be costly to undo, and always before anything outward-facing or irreversible (deploying, publishing, pushing, deleting data the user made).
- **Commit per feature**, yourself: `F<n>: subject` plus a what/why bullet body, no Co-Authored-By trailer (`/feature-commit`). Don't push.
- **Performance means the data pipeline.** The generator is a mock of the real vote sources; targets apply to ingest → queue → consumer → gateway, not to how the board renders at the generator's maximum rate. When a check fails for environmental reasons (a loaded laptop, headless rendering), report it with the measurement and ask; don't loop on variants.
- **Leave no test data.** Checks that vote in Tally Showcase, or create test contests, delete what they added afterwards (Postgres, Redis and ClickHouse). Never touch the user's own contests.

## Stack

TypeScript everywhere except the Go load generator. Next.js, Tailwind, shadcn/ui, Motion, Recharts (web); Fastify (ingest); plain Node (consumer, gateway, analytics consumer); Redpanda; Postgres with Drizzle; Redis; ClickHouse; Prometheus and Grafana; Docker Compose; Vitest; Biome.

## Running locally

| Command | Does |
|---|---|
| `docker compose --profile app up -d --build` | Full stack in containers (demos, checks, Dockerfiles) |
| `docker compose up -d` | Infrastructure only; then `pnpm dev` and `go run .` in `tools/generator` on the host (reads `.env`) |
| `pnpm check:health` | Every service's `/health` |
| `pnpm lint`, `pnpm typecheck`, `pnpm test` | Biome, TypeScript, Vitest (the Kafka and DB tests need the infrastructure up) |
| `pnpm test:go`, `scripts/go.sh <args>` | Go, in a `golang` container when Go isn't installed (it isn't here) |
| `pnpm db:generate`, `db:migrate`, `db:seed` | After a schema change, generate and commit the SQL in `infra/migrations` |
| `pnpm contests` | Every contest with its ID, status and votes |
| `pnpm reconcile [--repair] [--contest <id>]` | Recount every derived total from the vote log |
| `pnpm reset:votes [--yes]` | Wipe all vote data, keep contests; wipes the user's contests too, so ask first |
| `pnpm load <smoke\|steady\|spike>` | k6 in the compose network, then zero-loss and reconciliation checks; report in `load-results/` |
| `pnpm recap [contestId]` | Render a contest's recap video into `recaps/` |
| `pnpm bench:clickhouse` | Benchmark the analytics queries |

- **Addresses:** containers reach Redpanda at `redpanda:9092`, the host at `localhost:19092`. A one-shot `topics` job creates `votes.raw` and `votes.dead` (6 partitions) on every `docker compose up`. ClickHouse: `curl 'http://localhost:8123/?user=tally&password=tally&database=tally' --data-binary 'SELECT …'`.
- **Imports:** `packages/*` import each other with `.ts` extensions (Turbopack can't map `.js` → `.ts`); services use `.js`. A bundled workspace package's runtime deps must also be the app's deps.
- **Contracts:** after changing one the generator speaks, run `pnpm --filter @tally/contracts export-schemas`.
- **Grafana:** the dashboard is generated: edit `scripts/grafana-dashboard.py`, run it, commit the JSON. Prometheus reads its config only at startup; restart it after editing.
- **ClickHouse schema:** changes are new entries in `MIGRATIONS` (`services/analytics-consumer/src/schema.ts`), never edits to applied ones.
- **Remotion:** keep every `remotion` / `@remotion/*` package on one version; `tools/recap` and `packages/recap-video` pin zod 4.5.4 for it.
- **New services:** every new service gets a Dockerfile and a compose entry under the `app` profile.

## Layout

```
apps/web                    Next.js: results boards, operator pages, web API
services/ingest             Fastify: validate and publish
services/consumer           count into Postgres and Redis
services/gateway            WebSocket fan-out
services/analytics-consumer ClickHouse writer
tools/generator             Go load generator
tools/recap, tools/load     recap renderer (CLI), k6 profiles
packages/contracts          Zod schemas, shared types, Redis key builders
packages/db                 Drizzle schema, client, migrate and seed
packages/recap-video        recap composition and exporter (web + tools/recap)
infra/                      migrations, ClickHouse, Prometheus and Grafana config
```

## Rules that aren't negotiable

- **The ingest path stays thin.** Validate, hash, publish, return 202. No database reads or writes in the request path.
- **Never store raw sender identifiers.** Hash with the salt from the environment before anything is persisted or logged.
- **Never drop a vote silently.** Anything that can't be counted goes to `votes.dead` with a reason. No swallowed errors.
- **Consumers are idempotent.** Delivery is at least once; the same message twice must not change any total.
- **Config comes from the environment.** No config files for services, no hardcoded hosts, no local disk state.
- **Every service has `/health` and graceful SIGTERM shutdown.**
- **Schemas live in `packages/contracts`**, defined once with Zod. The Go generator mirrors them under a contract test.
- **Postgres is truth, Redis is speed.** Redis must be rebuildable from Postgres; nothing lives only in Redis.
- **No photographs of real public figures** in seed data or demos: generated or illustrated avatars only.

## Frontend specifics

- **Counters retarget, they don't restart.** Each new total is a new target for the running spring. A fresh animation per update stutters: the most common way to get the UI wrong.
- **Reordering is the layout system's job**, not re-rendering. Rows glide past each other on an overtake: the moment the project is built around.
- **One component, two layouts.** The card grid is the list row with a layout flag. Never fork them.
- **Motion follows `.claude/skills/apple-design`.** Springs come from `lib/motion.ts` (`SNAPPY`, `SMOOTH`, `GENTLE`, `EXIT`, `APPEAR`; CSS: `--ease-spring`, `--dur-snappy`, `--dur-smooth`). No ad-hoc timings. Motion comes from data or the operator's hand, never decoration, and **only `transform` and `opacity` move on the board**.
- **Reduced motion:** `MotionPreferences` (root layout) sets it app-wide. It jumps transforms rather than skipping them, so a decorative scale checks `useReducedMotion()` itself.
- **Rows' parts** (rank, stripe, avatar, name, score) use the row's `place` (arrangement, index, podium) as their `layoutDependency`. If they measure less often than the row, they can stay a slot away from their panel.
- **Rows that leave** go in a `LayoutGroup` so the rows below glide, and use `PresenceRow` so they're inert while fading.
- **The stage** (`components/stage`, cued by `lib/lighting.ts`) is painted once; only the beams' angles, the walls' opacity and the house-light dim change. The finale waits for the counting backlog to empty after the close, and the backlog is shared by all contests, so this assumes one contest votes at a time.
- **The podium** (the first three places with votes) grows its text with `transform: scale`, never `font-size`, so rows resize smoothly. Nothing assumes a number of contestants.
- **Per-frame work:** the board re-renders four times a second. Memoise what doesn't change; prefer CSS transitions or Web Animations to JavaScript springs where no velocity is needed; never call `toLocaleString` with options per frame (cache a formatter).
- **Next.js pitfalls:**
  - A server component must never import a value from a `'use client'` module; shared constants go in `lib/`.
  - Update the URL with `window.history.replaceState(null, '', url)`.
  - Operator times go through `<Time>` / `<ClockTime>`, never raw ISO strings.
- **Operator pages** live in the `app/(operator)` route group (nav and local-time provider) and keep a plain look. Web talks to Redis for one thing: the contest status in the meta hash.

## Testing and done

- **Test the logic that would be embarrassing to get wrong:** idempotency, code resolution, dead-letter routing, counting, the snapshot-then-diff protocol, the lighting cues. Don't test framework behaviour or restate the implementation.
- **A feature is done when:**
  - its check passes
  - tests cover its core logic
  - `docker compose --profile app up` brings the stack up and `pnpm check:health` passes
  - no rule above was broken
  - `DECISIONS.md` has an entry for anything non-obvious
- **Headless Chrome checks** (`google-chrome --headless=new` over CDP):
  - kill Chrome's whole process group afterwards
  - give each browser a fresh profile
  - wait for hydration before clicking
  - sign in once to warm the server first (the first sign-in after a boot logs React's "Connection closed", #412)

## Current state

Update this section as you go.

- **Branches:** `main` runs everything on one machine. The branch `two-device` (F35–F38: partition key, ingest and consumer replicas, a generator on a second device) isn't merged: a review found a bug there with several consumers (`IMPLEMENTATION_PLAN.md`).
- **Last completed:** F39, podium and a finale on the true result (2026-09-26), with a code-review round on F31–F32 and a clean-up of these docs.
- **Next up:** nothing required. Optional: F33 (deployment: needs a host, a domain and permission) and F40–F42 (Kubernetes).
- **Seed contest:** `0192f3a0-7c1e-7000-8000-00000000c0de` ("Tally Showcase"), codes `C1`–`C10`, closed and empty between checks. The README's media was recorded from it.
- **Known gaps:**
  - k6's 3,000/s spike misses p95 < 50 ms on the full stack (70–107 ms; `DECISIONS.md`, Open).
  - With millions of votes, consumer restarts were slow for minutes (F31). The cause wasn't found, since the startup rebuild reads the aggregate tables, not the vote log. Measure before restarting the consumer under load.
