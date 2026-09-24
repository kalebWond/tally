# Decisions

Short entries: what was decided, the alternatives, and why. Newest at the bottom.

---

## Changes to the spec and plan

Where the build departs from `SPEC.md` or `IMPLEMENTATION_PLAN.md`, or pins down something they left open in a way that changes a documented contract. Each row's reasoning is in that feature's entries below. `SPEC.md` and `IMPLEMENTATION_PLAN.md` carry a short inline note at each affected spot.

### Changed: the build does something other than the document says

| Area | Spec / plan said | Now | Feature |
|---|---|---|---|
| Feature list (plan) | F26 deployment, F27 README, optional F28–F30 Kubernetes | new F26 create contests, F27 sample contestants, F28 recap in the browser (plus `pnpm contests`); deployment is now F29, README F30, Kubernetes F31–F33. Earlier entries that mention deployment were updated to F29 | after F25 |
| Contest lifecycle (SPEC §7, F16) | draft → open, open → closed, closed → open; no create or delete in the admin | plus `POST /api/contests` (a draft) and `DELETE /api/contests/:id` (drafts only); opening needs an active contestant; contest names unique ignoring case (migration `0005`) | F26 |
| Recap in the browser (plan F28) | an admin-only API returns the recap data for the page | no API: `/admin/recap/[contestId]` is a server component that calls the same exporter and hands the data to the player; Refresh re-runs it. Layout gains `packages/recap-video` | F28 |
| Feature list (plan), again | F29 deployment, F30 README, optional F31–F33 Kubernetes | new F29 counting backlog; deployment is now F30, README F31, Kubernetes F32–F34. Earlier entries that mention deployment were updated to F30 | after F28 |
| Gateway protocol (SPEC §7) | snapshot and update carry totals, status, minutes | both also carry `backlog` (`{ pending, perSec, etaSec }` or null), system-wide; a backlog change alone sends an update | F29 |
| Redis keys (SPEC §5) | totals, meta, minutes | plus `tally:backlog` (per-partition lag, per-consumer rate, `updatedAt`; per-field 10 s expiry via `HEXPIRE`) | F29 |
| Counting backlog on the panel (plan F29) | the generator status handler adds `backlog` | a separate `GET /api/generator/backlog`, polled with `/status`: `GeneratorStatus` is a contract the Go generator mirrors, so it stays the generator's own | F29 |
| Feature list (plan), third time | F30 deployment, F31 README, optional F32–F34 Kubernetes | new F30 UI polish; deployment is now F31, README F32, Kubernetes F33–F35. Earlier entries that mention deployment were updated to F31 | after F29 |
| Feature list (plan), fourth time | F31 deployment, F32 README, optional F33–F35 Kubernetes | new F31 lively UI; deployment is now F32, README F33, Kubernetes F34–F36. Earlier entries that mention deployment were updated to F32 | after F30 |
| Voter hash (SPEC §5) | `SHA-256` of sender + salt | `HMAC-SHA256`, salt as the key, sender trimmed first | F3 |
| Idempotency key (SPEC §6, plan F3) | ingest generates one (a UUID) | client `Idempotency-Key` header is honoured; ingest generates a UUID only when absent. Keys are 1–128 visible ASCII, not necessarily UUIDs | F3 |
| `votes` constraints (SPEC §5) | FK only on `contestants.contest_id` | FKs also on `votes.contest_id`, `votes.contestant_id`, `vote_totals`, `vote_buckets` (no cascades). Contestants with votes can't be deleted, only deactivated | F2 |
| Ingest `/health` (SPEC §7) | `{ status, redpanda: "connected" }` | `{ status: "ok" \| "degraded", service, redpanda: "connected" \| "disconnected" }`, and **503** while the broker is unreachable | F4 |
| `votes.dead` topic (plan F6) | built in F6 | created in F4 by the `topics` init job, alongside `votes.raw` | F4 |
| F1 done-when (plan F1, CLAUDE.md) | `docker compose up` brings everything up | `docker compose up` = infra only; `docker compose --profile app up` = full stack. CLAUDE.md's definition of done updated | F1 |
| Commits (plan working rules, CLAUDE.md) | commit at each feature boundary, feature number in the message | the user commits, using the project skill `/feature-commit`: `F<n>: subject` plus a what/why body. One exception in history: F3 went in as `a977aca feat(ingest): …`, written with the device-level conventional `commit-msg` skill | F3 |
| Layout (CLAUDE.md) | no package for the database | new `packages/db` (Drizzle schema, client, migrate, seed). Migrations in `infra/migrations`. CLAUDE.md layout updated | F2 |
| Frontend stack (CLAUDE.md, SPEC §9) | Motion **and** react-countup | Motion only: counters retarget a `useSpring`; react-countup dropped because its updates restart the animation (the stutter CLAUDE.md warns about) | F9 |
| Gateway protocol (SPEC §7) | snapshot on connect, then updates | plus `{ type: "heartbeat", ts }` every 15 s; clients treat 35 s of silence as a dead connection | F11 |
| Generator `/start` (SPEC §7) | `{ ratePerSec, contestId, invalidCodeRatio }` | plus required `codes` (the generator never reads the database) and `duplicateSenderRatio`; `/start` while running and `/burst` while stopped → 409; every control call returns the full status | F12 |
| Generator `/status` (SPEC §7) | `{ running, currentRate, sentTotal }` | adds `contestId`, `baseRate`, `burstEndsAt`, `startedAt`, `accepted`, `rejected`, `failed`, `invalidSent`, `duplicateSent`, `latencyMs {p50,p95,p99}` | F12 |
| Generator control API (SPEC §7) | `/start`, `/burst`, `/stop`, `/status` | plus `POST /rate { ratePerSec }`: changes a running generator's base rate without resetting counters (409 when stopped); a burst keeps priority until it ends | F13 |
| Shared-password gate (plan F14) | built in F14 with the admin CRUD | built in F13 for the control panel; F14 reuses it | F13 |
| Dead-letter reasons (SPEC §6) | `unknown_code`, `contest_closed`, `malformed` | plus `inactive_contestant`: a vote for a deactivated contestant. Postgres enum gained the value (migration `0002`) | F14 |
| Consumer code cache (F5 decision) | resolved codes cached for the process lifetime; misses for 5 s | every lookup, hit or miss, is re-checked after 5 s, so (de)activation reaches running consumers | F14 |
| `dead_letters` columns (SPEC §5) | id, raw payload, reason, received_at | plus `contest_id` (nullable uuid, no FK), written by the consumer and backfilled from payloads; indexed with reason and id | F15 |
| Gateway protocol (SPEC §7) | snapshot and update carry totals | both also carry `status` (contest status from the Redis meta hash, or null); a status change alone sends an update with `changed: []` | F16 |
| Redis meta hash (SPEC §5 keys) | written by the consumer | also `status`, written by web on each open/close (web now has `REDIS_URL`) | F16 |
| Minute buckets (plan F17) | consumer increments the **current** minute | the minute **ingest accepted** the vote (`received_at`), from newly inserted votes only; existing votes backfilled by migration `0004` | F17 |
| Redis keys (SPEC §5) | totals, meta | plus `tally:{contestId}:minutes` (minute → contest votes) and meta `lastMinute`; the consumer rebuilds all of Redis's totals and minutes from Postgres at startup | F17 |
| Gateway protocol (SPEC §7) | snapshot / update | both also carry `minutes` (snapshot: the 30-minute window; update: changed minutes only) and `minutesTo` (the window's last minute) | F17 |
| Redis sync (SPEC §5 keys, plan F5) | "increment the Redis counter"; `tally:idem:{key}` string, 1 h TTL, as a redelivery guard | Redis is **set** to absolute totals read back from Postgres (upward only, via Lua). No `tally:idem:*` keys: Postgres's unique `idempotency_key` is the only dedupe | F5 |
| Unresolvable votes (plan F6, SPEC §5 `contestant_id` null = unresolved) | dead-lettering is F6; unresolved votes could sit in `votes` with a null contestant | F5 writes them to `dead_letters` (`unknown_code` / `malformed`); `votes.contestant_id` is never null in practice. F6 adds publishing to `votes.dead` | F5 |
| `dead_letters` columns (SPEC §5) | id, raw payload, reason, received_at | plus a unique, nullable `idempotency_key` (the vote's key, or `offset:topic/partition/offset`) so replays don't duplicate dead letters | F5 |
| `votes.dead` message shape (SPEC §6) | "the original payload plus `reason` and `failed_at`" | envelope `{ v: 1, reason, failed_at, idempotency_key, original }`; `original` is the parsed JSON, or `{ raw }` for non-JSON | F6 |

### Filled in: the document was silent, and the choice is now part of a contract

| Area | Decision | Feature |
|---|---|---|
| Adding several contestants (F27) | `POST /api/contestants/batch`: one insert, all or none; issues point at rows as `contestants.<i>.<field>`; 400 for a code repeated in the batch, 409 for one the contest has | F27 |
| Operator times (F30) | the viewer's zone from a `tz` cookie (UTC if missing or unknown); "x min ago" within a day, else `24 Sept 2026, 17:34` (en-GB); full local time · UTC in the tooltip; dead letters show local clock time with ms | F30 |
| Contest order (F30) | every list and picker: `created_at desc`; pickers grouped Open / Draft / Closed; `/admin/contests?status=open\|draft\|closed` filters | F30 |
| Consumer port (SPEC §4 says —) | `4003`, serving `/health` only (later `/metrics`) | F1 |
| Every service's `/health` | Shared `HealthResponse` in contracts. Web serves it at `/health`, not `/api/health` | F1 |
| Enum value sets (SPEC §5 says `text`) | `contest_status`, `vote_source`, `dead_letter_reason` are Postgres enums built from Zod enums in contracts | F2 |
| `dead_letters` columns | `id bigserial`, `payload jsonb`, `reason` enum, `received_at timestamptz` | F2 |
| Seed | fixed contest ID `0192f3a0-7c1e-7000-8000-00000000c0de`; codes `C1`–`C10`; inserts are `DO NOTHING`, so re-seeding never overwrites edits, status or votes | F2 |
| Code format (SPEC §6) | ingest trims and uppercases; must match `^[A-Z0-9]{1,16}$` or it gets a 400 | F3 |
| `POST /votes` responses (SPEC §7) | 202 `{ eventId, idempotencyKey }`; 4xx `{ error, issues: [{ path, message }] }`; 413 over 4 KB; 415 non-JSON; 503 when publishing fails | F3 |
| `sent_at` (SPEC §6) | set by ingest when it accepts the vote | F3 |
| Partitions (plan F4 says "several") | 6 on both topics; Java-compatible murmur2 so placement matches rpk and other clients | F4 |
| What a 202 means | the broker acknowledged the write (`acks=all`); a publish is capped at 5 s, then 503 | F4 |
| Topic creation | one-shot `rpk` init job; services never create topics (`autocreateTopics: false`) | F4 |
| `votes.received_at` | the event's `sent_at` (when ingest accepted the vote), not the processing time, so replays and minute buckets are deterministic | F5 |
| Unknown contest | dead-lettered as `unknown_code` (the code can't resolve in that contest); no new reason value | F5 |
| Consumer group | `tally-consumer`; new groups start at `earliest`; batches of 500 or 100 ms; offsets committed after both stores | F5 |
| `votes.dead` delivery | at-least-once: every dead letter in a batch is (re)published after the commit, so a redelivery or replay duplicates it with the same `idempotency_key` and `failed_at`; readers dedupe on the key. Keyed by the original `code` when there is one | F6 |
| Gateway frames (SPEC §7) | snapshot `{ type, contestId, totals: [{ contestantId, total }], totalVotes, ts }`; update `{ type, contestId, changed, totalVotes, ts }`, where `changed` holds only differing contestants, as absolute totals. Zod-defined in contracts (`LiveMessage`) | F7 |
| Gateway polling | one Redis read per watched contest every 250 ms (`GATEWAY_POLL_MS`), fanned out to all its viewers; stops when the last viewer leaves | F7 |
| Gateway close codes | `4400` invalid `contestId`, `1001` shutdown, `1011` first read failed; ping every 30 s | F7 |
| Contestant metadata for the UI | loaded by the web app from Postgres and merged by ID; the gateway stays Redis-only | F7 |
| Gateway `/debug` | bare, unauthenticated inspector page for the live protocol (public data only) | F7 |
| Results routes | `/results/[contestId]`; `/` redirects to the most recently opened open contest (404 if none) | F8 |
| Web runtime config | `GATEWAY_PUBLIC_URL` (the gateway as the browser sees it) read per request and passed from the server component; no `NEXT_PUBLIC_*`, so images aren't tied to one host | F8 |
| Ranking | total desc, ties by code in natural order, competition ranks (1, 2, 2, 4) | F8 |
| shadcn/ui timing (stack lists it) | deferred to F13/F14, where forms need it; the results list is custom | F8 |
| Counter behaviour | first snapshot shows instantly (no count-up on load); later totals spring, overdamped so a count never overshoots or goes backwards; reduced motion jumps | F9 |
| Reorder animation | Motion `layout="position"` on ID-keyed rows, no-bounce 0.45 s spring; the overtaking row draws above the rows it passes and its accent edge glows for 0.8 s; instant for reduced motion | F10 |
| Reconnect policy | never gives up; jittered exponential backoff 0.5 s → 10 s cap; `4400` never retries, `1001` retries in < 1 s; backoff resets on snapshot, not on open; pauses while the browser is offline | F11 |
| Connection states | `Connecting` / `Live` (after snapshot) / `Reconnecting` / `Offline` / `Unavailable`; stale totals stay visible, dimmed, with a "reconnecting in Ns" note | F11 |
| Generator traffic | drifting-race popularity (random walk every 2 s); invalid codes are well-formed so they reach dead letters; synthetic `sim:` senders; one Idempotency-Key per vote | F12 |
| Go ↔ TS contract test (SPEC §6) | JSON Schemas exported from Zod (drift-tested in TS); Go test checks structs, types, nullability, enums and validation bounds against them | F12 |
| Admin session | `ADMIN_PASSWORD` (≥ 8 chars; unset = sign-in disabled). httpOnly, SameSite=Lax cookie `tally_admin` = `<expiresAt>.<HMAC>`, 12 h, key scrypt-derived from the password. `/login?next=` (same-site paths only) | F13 |
| Generator control from the browser | only via web route handlers `/api/generator/{status,start,rate,burst,stop}`, which re-check the session, require JSON, validate with the `Generator*` schemas and call `GENERATOR_URL` server-side. `start` takes no codes: the handler reads them from Postgres | F13 |
| Contestant API | `GET /api/contestants?contestId=` (inactive included, with vote counts), `POST` → 201 / 409 `conflict` on a taken code, `PATCH /api/contestants/:id` (strict: `code` and `contestId` → 400). Schemas `ContestantCreate` / `ContestantUpdate` / `Contestant` in contracts | F14 |
| Contestant fields | code as `VoteCode` (trimmed, uppercased) and fixed after creation; name 1–80; `imageUrl` https only; accents `#RRGGBB` stored uppercase; country ISO alpha-2 checked against `Intl.DisplayNames` | F14 |
| Deactivation | `active = false`: later votes dead-lettered as `inactive_contestant`, earlier votes and totals kept, hidden from results pages and from the generator's `/start` codes. Reversible | F14 |
| Dead-letter API | `GET /api/dead-letters?contestId=&reason=&before=\|after=&limit=` → `{ items, older, newer }` (keyset cursors on id, newest first, limit 1–200, default 50); `GET /api/dead-letters/counts?contestId=&since=` → `{ total, byReason, latestId }`. Contracts `DeadLetterQuery` / `DeadLetterPage` / `DeadLetterCounts` | F15 |
| Contest lifecycle | `POST /api/contests/:id/status { status: "open" \| "closed" }` → `{ contest, liveUpdated }`; allowed draft → open, open → closed, closed → open (reopen); anything else 409. Opening stamps `opens_at` and clears `closes_at`; closing stamps `closes_at` | F16 |
| Which votes a contest counts | exactly those ingest accepted (`sent_at`) while it was open: `opens_at ≤ sent_at` and, once closed, `sent_at < closes_at`. Draft counts nothing. Null `opens_at` = open since creation. Everything else → `contest_closed` | F16 |
| Reconciliation command | `pnpm reconcile [--repair] [--contest <uuid>] [--json]` on the host; `docker compose run --rm reconcile …` (profile `tools`, consumer image). Checks `vote_totals`, `vote_buckets`, Redis totals, `totalVotes`, minutes and `lastMinute` against a recount of `votes`. Exit 0 = no drift or all repaired, 1 = drift left, 2 = error | F18 |
| Load test | `pnpm load <smoke\|steady\|spike>`: k6 (`grafana/k6:2.3.0`, `tools/load/votes.js`, open model) in the compose network against `ingest:4000`; steady = ramp to 1,000/s, hold 3 min; spike = 500/s → 3,000/s for 1 min → 500/s. Reports in `load-results/*.md` (raw JSON/CSV gitignored); results published in README | F19 |
| Analytics pipeline | `services/analytics-consumer` (port 4004), consumer group `tally-analytics`, reads **both** `votes.raw` and `votes.dead` into ClickHouse `votes_raw` / `votes_dead`; ClickHouse 26.9 in the default compose profile (port 8123, user/db `tally`); schema created at startup. `HealthResponse` gained optional `clickhouse` | F20 |
| ClickHouse schema | versioned migrations in `services/analytics-consumer/src/schema.ts` (`_migrations` table, applied at startup); `votes_raw` ORDER BY `(contest_id, sent_at, idempotency_key)`; both tables gain `key_hash UInt64 MATERIALIZED cityHash64(idempotency_key)`; `votes_dead.sent_at` = the original vote's; readers count votes as `uniqExact(key_hash)`, counted = accepted − rejected per minute | F21 |
| Analytics page | `/admin/analytics?contest=` (operator, password-protected), data from `GET /api/analytics/:contestId`, ClickHouse only; refreshes every 15 s. Counted = distinct raw keys not in the contest's dead letters | F22 |
| Metrics | `GET /metrics` (Prometheus text) on ingest, consumer, gateway, analytics-consumer, web and generator; shared `@tally/metrics` (prom-client, `service` label, `tally_` prefix); consumer lag from Redpanda's `public_metrics` (high watermark − committed offset); Prometheus (9090, 5 s scrapes) and Grafana (3001, anonymous viewer, dashboard `tally` provisioned from `infra/grafana`) in the `app` profile | F23 |
| Card grid | results page `?view=grid` (default list), toggled on the page without a navigation; `ContestantRow` takes `layout: 'list' \| 'grid'`, sets `data-layout`, and keeps an identical element tree, with CSS grid areas arranging it; flag emoji from the country code | F24 |
| Results recap | `tools/recap` (Remotion 4): `pnpm recap [contestId] [--out file.mp4]`, default the most recently closed contest; 1920×1080 at 30 fps, 32 s (intro 3 s, bar race 16 s, final standings 6 s, winner 7 s); data from Postgres; output in `recaps/` (gitignored); zod pinned to 4.5.4 in this package, Remotion's version | F25 |

### Outstanding: a rule not met yet

| Target | Status |
|---|---|
| SPEC §8 burst: p95 < 50 ms at 3,000/s (F19) | Met at F19 (p95 14–20 ms). With the F20–F23 additions on the same laptop, k6's spike run measures p95 **70–107 ms** at 3,000/s (zero loss, no drift). The Go generator's 3,000/s burst on the same stack stays at p95 about 9 ms. See F23 "Load regression"; to re-measure with k6 on a separate machine. |

None other. *Resolved (F13):* `apps/web`'s exit code 143 on SIGTERM was taken for a missed drain. It isn't: Next's standalone server finishes in-flight requests, then exits with 128 + 15 on purpose. See the F13 entry.

---

## F1 — Compose runs infra by default, the full stack behind a profile

**Decided:** `docker compose up` starts only Redpanda, Postgres and Redis. Services run on the host (`pnpm dev`, `go run`) for fast iteration. `docker compose --profile app up` builds and runs every service in a container for demos, recording, and proving the Dockerfiles.
**Alternatives:** everything in Compose always (slow edit loop through image rebuilds or bind mounts); infra only (Dockerfiles rot until deployment).
**Why:** you get the fast loop day to day, and the containerised path stays exercised. Each service gets its Dockerfile when the service is created, not retrofitted at deployment (F32).

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

## F2 — Schema lives in `packages/db`, migrations in `infra/migrations`

**Decided:** a new `@tally/db` package owns the Drizzle schema, client factory, migrate and seed. drizzle-kit writes SQL migrations to `infra/migrations`, where they're committed and reviewed.
**Alternatives:** schema inside `packages/contracts` (pulls Drizzle into everything that imports contracts, including the browser bundle); owned by the consumer (the web admin would have to import from a service).
**Why:** three things need the schema (consumer, web admin, seed). A package keeps the dependency direction clean. Contracts stays about event and API shapes.

## F2 — Enum values defined once in contracts

**Decided:** `ContestStatus`, `VoteSource` and `DeadLetterReason` are Zod enums in `@tally/contracts`. The Postgres enums are built from `.options`.
**Why:** the same value sets appear in events (`votes.dead` reason), API payloads (ingest `source`) and the database. Adding a value in one place and forgetting another is exactly the drift the contracts package exists to prevent. Adding a value still needs a migration, which drizzle-kit generates.

## F2 — Foreign keys on `votes`, `vote_totals`, `vote_buckets`

**Decided:** FKs from votes to contests and contestants (contestant nullable), and from totals and buckets to contestants. No cascades.
**Alternatives:** keep `votes` a constraint-free raw log (the spec only marks the contestants → contests FK).
**Why:** the consumer writes in batches, so the FK check is noise next to the unique-index check on `idempotency_key`. In exchange, a vote can never point at a contestant that doesn't exist. Consequence: contestants with votes can't be deleted, so F14 deactivates them (`active = false`).

## F2 — Seed inserts only what's missing (`ON CONFLICT DO NOTHING`)

**Decided:** the seed contest has a fixed UUID (`0192f3a0-7c1e-7000-8000-00000000c0de`). Contestants are keyed on `(contest_id, code)`. Every insert is `DO NOTHING` on conflict, never `DO UPDATE`.
**Alternatives:** upsert (`DO UPDATE`) to keep seed data authoritative; truncate and reinsert.
**Why:** "re-running the seed is safe" has to include not undoing things. An upsert would revert admin edits and reopen a closed contest, and truncating would destroy votes. The fixed ID gives the generator and the frontend a known default contest. Seed people are fictional, with DiceBear-generated avatars (external URL, deterministic per name).

## F2 — Local stack runs migrate + seed as a one-shot job

**Decided:** the `app` profile has a `migrate` service (`node dist/migrate.js && node dist/seed.js`). Consumer and web wait for `service_completed_successfully`. On the host: `pnpm db:migrate` and `pnpm db:seed`.
**Alternatives:** each service migrates on boot (races between replicas); migrate by hand.
**Why:** one owner for schema changes, and it's the same shape as a Kubernetes Job or init step later. Seeding runs in the local stack only because it's idempotent and the demo needs data. A production deployment (F32) runs migrate alone.

## F3 — Idempotency key: honour `Idempotency-Key`, else generate

**Decided:** if the client sends an `Idempotency-Key` header (1–128 visible ASCII), it becomes the event's `idempotency_key`. Otherwise ingest generates a UUID. Each request still gets its own `event_id`.
**Alternatives:** always generate (the spec's literal reading).
**Why:** a generated key only protects against the queue redelivering a message. A client that times out and retries would produce a second event with a new key, so the vote would be counted twice. Honouring the header makes the retry dedupe in the consumer (F5) with no extra work, and the generator can exercise it. Ingest itself never checks for duplicates: that would need storage on the hot path.

## F3 — Sender hashing is HMAC-SHA256 keyed by the salt

**Decided:** `voter_hash = HMAC-SHA256(key = VOTER_HASH_SALT, msg = trim(sender))`, as 64 hex characters. The salt is required (min 16 chars), and ingest refuses to start without it.
**Alternatives:** `sha256(sender + salt)`, as the spec is literally worded.
**Why:** same output shape and the same intent, but HMAC is the standard keyed construction, and plain concatenation has well-known weaknesses. Phone numbers are low-entropy, so the secrecy of the key is what stops brute-forcing hashes back to numbers. Rotating the salt changes every hash, which is acceptable because hashes are for analytics, not vote limits (votes are unlimited).

## F3 — Ingest canonicalises `code` (trim + uppercase, `^[A-Z0-9]{1,16}$`)

**Decided:** normalisation lives in the `VoteRequest` Zod schema in contracts. Malformed codes get a 400. Codes that are well-formed but don't exist are still the consumer's call (dead letters, F6).
**Why:** `code` becomes the partition key in F4. Without one canonical form, `c7` and `C7` would land on different partitions and break per-contestant ordering. Only the shape is checked here; whether the contestant exists would need a database lookup.

## F3 — Error shape and what never gets echoed

**Decided:** 202 → `{ eventId, idempotencyKey }`. 4xx → `{ error, issues: [{ path, message }] }`, with one issue per bad field or header. Framework errors (bad JSON 400, 413, 415) get fixed messages. Only error codes are logged, never error messages or bodies. Pino also redacts `sender`. A publish failure returns 503, never 202.
**Why:** "useful" means naming the field and the rule, which Zod's messages do without quoting values. Fixed messages for framework errors mean a library update can't start echoing input. The privacy test captures every log line and response and asserts the raw sender never appears. It was mutation-tested: logging the body past the redaction depth makes it fail.

## F3 — Publisher is an interface; F3 ships a logging stub

**Decided:** `VotePublisher.publish(event)` must throw unless the event was durably handed off. Until F4, the default implementation logs the event (hash only) at debug and drops it.
**Why:** the route, validation and privacy guarantees can be finished and tested now, and F4 swaps the implementation without touching the handler.

## F4 — Kafka client: `@platformatic/kafka`

**Decided:** `@platformatic/kafka` 2.x for producing (and later consuming).
**Alternatives:** kafkajs (last release Feb 2023, unmaintained); `@confluentinc/kafka-javascript` (librdkafka, the most battle-tested engine, but a 14 MB native binary fetched by an install script).
**Why:** pure JS and actively released, so it works with the `--ignore-scripts` Docker installs, alpine, and a slow link. One gotcha: its *default* partitioner is `murmur2 >>> 0`, which is not Java-compatible. We use its `compatibilityPartitioner` (see the partitioning entry).

## F4 — 202 means the broker has it: `acks=all`, idempotent producer, 5 ms micro-batches

**Decided:** each request awaits the broker ack before replying 202. Concurrent requests are coalesced into one produce call (flush at 500 messages or 5 ms), and each caller settles with its batch. The producer is idempotent, so its own retries can't duplicate messages in the log.
**Alternatives:** fire-and-forget buffering (fastest, but a crash between 202 and flush loses votes the client thinks were accepted).
**Why:** "zero loss" and "never drop silently" only hold if a 202 is a durability claim. Batching recovers most of the throughput that per-request acks would cost. F19 will measure it against the p95 < 50 ms target.

## F4 — Partitioning: key = `code`, Java-compatible murmur2, 6 partitions

**Decided:** `votes.raw` and `votes.dead` have 6 partitions (replication 1 locally). Messages are keyed by the canonical code. `compatibilityPartitioner` places keys exactly where the Java client, rpk and franz-go would.
**Why:** per-contestant ordering needs one partition per code. Standard hashing means placement can be verified with independent tooling. rpk producing the same keys gave the identical mapping: C1→3 C2→5 C3→3 C4→2 C5→0 C6→5 C7→2 C8→2 C9→2 C10→4. 6 partitions allows up to 6 consumers for the KEDA demo.
**Observed:** with 10 codes the spread is uneven. Partition 2 holds four codes and partition 1 none. With keyed partitioning, a popular contestant makes a hot partition. That's the price of ordering, and it's worth saying out loud in the load-testing write-up.

## F4 — Topics are created by an rpk init job, not by services

**Decided:** a one-shot `topics` Compose service (default profile) runs `rpk topic create … --if-not-exists`. Ingest waits for it and runs with `autocreateTopics: false`. Topic names live in contracts as `TOPICS`.
**Why:** topic shape (partitions, replication) is infrastructure, like the future Kubernetes Job. Services creating topics would need admin rights on the hot path, and a typo would silently create a new topic.

## F4 — Bounded failure: 5 s publish deadline, broker-aware health

**Decided:** retries back off at 100/200/400/800/1000 ms, with a 1 s connect timeout, and every publish is capped at 5 s, after which the request gets a 503. `/health` does a fresh metadata fetch (`forceUpdate`) and answers 503 `degraded` when the broker is unreachable.
**Why:** found live, not in tests. With the library's defaults, stopping Redpanda held a vote request for **61.5 s** before the 503: a connection refused fails fast, but a stopped container never answers, so each retry waited out a 5 s connect timeout. The test suite now covers both "refuses" and "never answers". `/health` also kept saying 200 during the outage because metadata came from cache.
**Consequence, observed:** a publish that times out may still land once the broker returns. In the outage test the 503'd vote *and* its client retry (same `Idempotency-Key`) both reached `votes.raw`. That's correct at-least-once behaviour, and it's exactly why F5's consumer must dedupe on `idempotency_key`.

## F5 — Postgres is the only dedupe; Redis receives absolute totals

**Decided:** one Postgres transaction per batch. Votes go in with `INSERT … ON CONFLICT (idempotency_key) DO NOTHING RETURNING`, only the returned rows are added to `vote_totals`, and the transaction then reads back absolute totals for *every* contestant in the batch, duplicates included. After the commit, those absolute values are written to Redis by a Lua script that only moves a count upward. No `tally:idem:*` keys.
**Alternatives:** the spec's literal design: `SET NX tally:idem:{key}` with a 1 h TTL, then `HINCRBY`.
**Why:** increments aren't idempotent across two stores. A crash after the Postgres commit but before `HINCRBY` leaves Redis permanently low, because on redelivery the idem key (or the unique index) says "seen" and nothing increments again. Absolute values make the Redis write safe to repeat: redelivery rewrites the right numbers. Reading totals back for duplicates is what makes a *pure* replay heal Redis. The upward-only guard stops a stale writer (a late batch, a consumer mid-rebalance) from dragging a count backwards.
**Tested:** "crash between commit and Redis" and "stale lower total" tests, each mutation-checked: removing the duplicate read-back fails the heal test, and an unconditional `HSET` fails the stale-writer test.
**Limit:** Redis is repaired only for contestants that appear in a later batch. Rebuilding a wiped Redis from Postgres is F18's reconciliation job.

## F5 — Unresolvable votes go to `dead_letters` now; the `votes.dead` topic waits for F6

**Decided:** unknown codes, unknown contests (both reason `unknown_code`) and messages that fail the `VoteEvent` schema or aren't JSON (`malformed`) are written to `dead_letters` in the same transaction and never touch a total. `dead_letters` gained a unique, nullable `idempotency_key` (migration `0001`): the vote's key, or `offset:topic/partition/offset` for a malformed message, so replays never duplicate dead letters. `votes.contestant_id` stays nullable but is never null in practice.
**Why:** "never drop silently" applies from the first consumer, not from F6. An unknown *contest* can't be stored in `votes` at all (FK), so a single path for every unresolvable vote is simpler than splitting between `votes` (null contestant) and `dead_letters`.

## F5 — Consumer mechanics

**Decided:** group `tally-consumer`; batches flush at 500 messages or every 100 ms and are processed strictly in order. Offsets (`last + 1`) are committed only after Postgres and Redis. A failing batch is retried with backoff (250 ms → 10 s) and never skipped. A failed offset commit is only logged, since redelivery is absorbed by the dedupe. A new group starts at `earliest`. `votes.received_at` is the event's `sent_at` (when ingest accepted it), so replays and the F17 minute buckets are deterministic. Code lookups are cached: hits forever (codes are unique and contestants with votes can't be deleted), misses for 5 s, so a contestant added later gets votes within seconds and an invalid-code flood costs one query per code per window.
**Observed live:** the F4 backlog (33 messages, including the retried `outage-test-1` pair) became 32 votes. Rewinding the group to offset 0 (`rpk group seek tally-consumer --to start`) re-read all 233 messages: 0 counted, 233 duplicates, totals unchanged in Postgres and Redis.

## F5 — Bundling gotcha: a workspace package's dependencies belong to the service

**Found live, not in tests:** the consumer image crash-looped with `Dynamic require of "events" is not supported`. tsup bundles `@tally/*` (they ship TS source), and `@tally/db` imports `pg`. The consumer listed `pg` only as a devDependency, so tsup inlined it as well, and CommonJS `pg` breaks when inlined into an ESM bundle. Fix: every runtime dependency of a bundled workspace package must also be a runtime dependency of the service. Noted in each `tsup.config.ts`. Tests run unbundled, so only the container caught it.

## F6 — `votes.dead` mirrors `dead_letters`, published at-least-once after the commit

**Decided:** after each batch's Postgres commit, the consumer reads back that batch's `dead_letters` rows, including ones an earlier delivery already wrote, and publishes every one to `votes.dead` (acks=all, idempotent producer, 5 s cap), then updates Redis. Offsets are committed only after both. A failed publish retries the whole batch.
**Alternatives:** publish only newly inserted rows (no duplicates on the topic, but a crash between commit and publish leaves a dead letter in the table that never reaches the topic); publish inside the transaction (network I/O while holding row locks, and it still duplicates if the commit fails after the publish).
**Why:** the same heal-on-redelivery pattern as Redis in F5, so the topic can't permanently miss a row the table has. The cost is at-least-once on `votes.dead`: a redelivered or replayed batch republishes, with the same `idempotency_key` and `failed_at`, so readers dedupe on the key. Building messages from the read-back rows is what keeps `failed_at` stable and the topic identical to the table.
**Tested:** unit tests cover content, heal after a crash before the publish, and a stable `failed_at` on republish. End to end through Redpanda: unknown code, unknown contest and a malformed message all reach the topic, 3 valid votes count 3, and the table holds 3 dead letters. Live: `ZZ9` via ingest → 202 → `votes.dead` (key `ZZ9`, reason `unknown_code`), with totals unchanged at 232.

## F6 — Dead-letter message is an envelope

**Decided:** `{ v: 1, reason, failed_at, idempotency_key, original }` (`DeadLetterEvent` in contracts). `original` is the message as received: the parsed JSON, or `{ raw }` if it wasn't JSON. Messages are keyed by the original `code` when there is one; malformed messages are keyless and spread across partitions.
**Alternatives:** the spec's literal "original payload plus reason and failed_at", flattened into one object.
**Why:** a malformed message has no fields to flatten, and flattening lets the original's fields collide with the added ones. One schema covers every reason. Keying by code keeps a contestant's dead letters ordered, like `votes.raw`.

## F7 — Gateway protocol: absolute totals, diff-only updates, one poll per watched contest

**Decided:** `WS /live?contestId=…`. On connect the client gets `{ type: "snapshot", contestId, totals: [{ contestantId, total }], totalVotes, ts }`. After that, `{ type: "update", contestId, changed, totalVotes, ts }` is sent only when something changed, and `changed` holds just the contestants whose total differs from the previous read. Values are absolute, never increments. Each contest with at least one viewer has a single Redis poll (default 250 ms, `GATEWAY_POLL_MS`) fanned out to all of its clients. The poll stops when the last viewer leaves. The protocol is Zod-defined in contracts (`LiveMessage`).
**Alternatives:** increments in update frames (smaller, but one missed frame and the screen is wrong until reload); Redis pub/sub from the consumer (push instead of poll, but the consumer would need to know about viewers, and the spec chose polling).
**Why:** absolute values make every frame self-correcting and give F9's counters a target to spring toward. Diffing keeps frames small; with 10 contestants and 3 moving, the live check never sent more than 2 per frame. One poll per contest means Redis load scales with contests being watched, not with viewers.
**Ordering detail:** a joining client gets its snapshot *before* it's added to the broadcast set, synchronously after the room's first read. An update computed around the same moment can't arrive ahead of the snapshot it's relative to.
**Measured live:** two clients got 13 identical update frames, at most 1 ms apart. From a vote's 202 at ingest to the frame arriving, the median was ~147 ms and the max 263 ms (ingest → Redpanda → consumer → Postgres/Redis → gateway), comfortably inside SPEC §8's 1 s target.

## F7 — Contestant metadata comes from the web app, not the gateway

**Decided:** frames carry only IDs and totals. The Next.js page (F8) loads names, codes and colours from Postgres server-side, merges by ID, and refetches if an unknown ID appears.
**Alternatives:** the gateway includes metadata in the snapshot (one connection for the page, but a Postgres dependency and cache invalidation for the gateway).
**Why:** it keeps the spec's read path intact (Redis → Gateway → Browser) and the gateway stateless apart from per-room caches. The web app needs Postgres for admin anyway.

## F7 — Close codes, heartbeat, `/debug`

**Decided:** `4400` when `contestId` is missing or not a UUID (reconnecting won't help); `1001` on shutdown (reconnect with backoff, F11); `1011` if the first Redis read fails. Validation happens *after* the upgrade so the browser receives the code. Ping every 30 s and terminate connections that don't answer. `GET /debug` serves a bare inspector page, unauthenticated since the totals are public, for watching frames in two tabs until F8 exists.
**Testing note:** the gateway's tests use Redis logical DB 14, because the consumer's tests flush DB 15 and Vitest runs packages in parallel.
**Limit:** if Redis is wiped, deleted keys produce no diff, so viewers keep their last values until F18 rebuilds Redis.

## F8 — Results page: server loads who, the browser streams how many

**Decided:** `/results/[contestId]` is a server component that reads the contest and its contestants (name, code, avatar, accents, country) from Postgres. A client component subscribes to the gateway (`useLiveTotals`) and merges totals by contestant ID. `/` redirects to the most recently opened open contest. Frames naming an unknown ID (a contestant added after load) trigger `router.refresh()`, at most once per 5 s, which re-runs the server component while client state survives. Totals show `–`, not `0`, until the first snapshot.
**Why:** it keeps the gateway Redis-only (F7). Merge and rank are pure functions (`lib/standings.ts`) with unit tests, and the refresh path needs no extra API.
**Verified in real Chrome** (DevTools protocol): the page loaded `Live` at 252 votes, 40 votes for C9 via ingest moved it from 9th to 1st at 63, and there were no reloads. A contestant inserted after load appeared on its first vote, also without a reload.

## F8 — Gateway URL is runtime config passed from the server

**Decided:** the server component reads `GATEWAY_PUBLIC_URL` after `await connection()` and passes it as a prop. No `NEXT_PUBLIC_*`.
**Why:** Next inlines `NEXT_PUBLIC_*` at build time, so changing the gateway host would mean rebuilding the image. That breaks "config from the environment" and deployment's (F32) "deploy by configuration only". The value is the gateway as the *browser* sees it, so Compose sets `ws://localhost:4001` even for the containerised web app.

## F8 — Ranking rules

**Decided:** sort by total, highest first. Ties break on code in natural order (`C2` before `C10`, via `Intl.Collator` numeric), and tied totals share a competition rank (1, 2, 2, 4). Rows are keyed by contestant ID.
**Why:** a deterministic tiebreak stops equal rows swapping between frames (the thing F10 must never animate). Stable ID keys are what F10's layout animation and F24's card grid depend on.

## F8 — Look: broadcast scoreboard

**Decided:** a single dark theme built for a projector or a screen recording. Barlow Condensed for display and tabular numbers, Barlow for body text. Each row is edged with the contestant's accent gradient, and the leader row picks up its accent. A pulsing `LIVE` status. shadcn/ui is deferred to F13/F14, where forms need it; the results list is custom display.

## F8 — Shared packages import with `.ts` extensions

**Found in the web image build:** Turbopack, the default bundler in Next 16, couldn't resolve `./client.js`-style imports inside `@tally/contracts` and `@tally/db`. Those ship TypeScript source and used the NodeNext convention of `.js` specifiers, and Turbopack has no equivalent of webpack's `extensionAlias`.
**Decided:** the shared packages import each other with real `.ts` extensions, with `allowImportingTsExtensions` in the base tsconfig (we never emit with `tsc`). Services keep `.js` specifiers, since Next doesn't compile them.
**Alternatives:** `next build --webpack` plus `extensionAlias` (gives up Turbopack); a build step for the packages (rejected in F1).
**Also found:** (1) `pgEnum` needs non-empty tuple types that `ZodEnum.options` doesn't provide under the web tsconfig, so contracts now exports `CONTEST_STATUSES` and friends as `as const` tuples and both Zod and Postgres enums are built from them (drizzle-kit confirms no schema change). (2) `migrate.ts` computed its default path from `import.meta.dirname` at import time, which is undefined in Next's server bundle; it's now computed on call.

## F9 — Counters retarget a Motion spring; react-countup is dropped

**Decided:** `AnimatedNumber` wraps Motion's `useSpring`. Each new total calls `spring.set(value)`, which retargets the running spring and keeps its current velocity. The text renders through a `MotionValue`, so animation frames update the DOM without React re-renders. It mounts at the first value (no count-up on load), and `prefers-reduced-motion` jumps instead of animating. Row totals and the header count both use it.
**Alternatives:** react-countup (listed in the stack). Its `update(newEnd)` starts a new eased run with velocity reset: the restart-per-update pattern CLAUDE.md warns about.
**Why:** retargeting is what keeps updates that arrive faster than the animation settles reading as one continuous climb. F10 uses Motion for layout animation anyway, so dropping react-countup removes a dependency rather than adding one.

## F9 — The spring must never overshoot

**Decided:** `COUNTER_SPRING = { stiffness: 140, damping: 26, mass: 1 }`, slightly overdamped (ratio ≈ 1.1). It settles in about 0.4 s, which keeps up with 250 ms updates.
**Why:** an underdamped spring shows more votes than exist, then counts backwards, which reads as votes being removed. A unit test runs Motion's own `spring` generator with velocity carried across retargets every 250 ms, sampled per frame and rounded like the UI, and asserts the value never decreases and never passes its target. Mutation check: `damping: 8` fails both.

## F9 — How "no stutter or jumping" was measured

Headless Chrome sampled the header counter's displayed value and its target on every animation frame while ~180 votes/s went through ingest (a new target on every 250 ms gateway poll), about 10 s per run:

| | Real (retarget) | Control: restart per update | Control: jump per update |
|---|---|---|---|
| Frames counting backwards / above target | 0 / 0 | 0 / 0 | 0 / 0 |
| Largest single-frame step | 5–6 | 6 | 60 |
| Average step while moving | ~3 | 3.1 | 45 |
| Stall ratio (speed 3 frames after a new target ÷ 3 before) | 0.83–1.0 median | 0.63 | n/a |
| Updates that caused a stall (ratio < 0.35) | 0 | 2 | n/a |

Production build: 60 fps, 40 retargets, 0 stalls, and it settled exactly on the final total. **Honest caveat:** the restart control is only modestly worse, because a spring this stiff recovers speed within a couple of frames, so this metric separates retarget from restart weakly. The jump detector separates clearly (60 vs 5). The real counter passes both.

## F9 — Found on the way: web dev couldn't start on the host

F8 set the web dev script to `node --env-file-if-exists=../../.env …/next dev`. Next forwards `execArgv` into `NODE_OPTIONS` for its workers, where Node rejects `--env-file-if-exists`, so `next dev` exited immediately. F8's checks ran against the production container, which is why it went unnoticed. **Fix:** `next.config.ts` reads the repo-root `.env` with `util.parseEnv` and fills in only missing variables. Real environment variables win, and containers have no such file, so it's a no-op there. The dev script is plain `next dev --port 3000` again.

## F10 — Reorder is Motion layout animation on ID-keyed rows

**Decided:** each row is a `motion.li` with `layout="position"`, keyed by contestant ID. The transition is a no-bounce spring (`bounce: 0`, 0.45 s). `MotionConfig reducedMotion="user"` makes reorders and counters instant for reduced-motion users.
**Why:** the layout system measures where each keyed row was and where it now is, and animates the difference with transforms, so the list is never re-rendered as a sequence of in-between states. `position` rather than `true`: rows never change size, so there's no scale correction to distort text and avatars. No bounce: an overshooting spring would push a row past its slot into its neighbour's and back. Interrupted mid-flight, Motion continues from the row's current on-screen position, so rapid swaps glide rather than snap.

## F10 — Overtake treatment: the riser draws on top and glows

**Decided:** a pure `movements(prevOrder, nextOrder)` marks rows that moved up or down (unit-tested). For 0.8 s a riser gets `z-index: 2` (fallers get 0) and its accent edge flares via a CSS keyframe. Marks carry a token, so an older timer can't clear a newer overtake by the same row, and every mark expires, so a storm can't leave a row stuck "rising".
**Why:** without stacking order, two sliding rows blend as they cross. With the riser on top it visibly *passes*, which is the signature moment.

## F10 — How "slides past, never overlapping or stuck" was measured

Headless Chrome sampled every row's on-screen position every frame.
- **Overtake:** the closest mid-table pair; the lower one gets just enough votes to pass. Production: C3 passed C7 through **18** in-between frames and ended exactly in its new slot.
- **Storm:** two contestants swap every 300 ms, 14 times, faster than the 450 ms slide, so every animation is interrupted. After 2 s: on-screen order matches the totals, **0** overlapping rows, **0** rows left with a transform.
- **Controls on the dev server:** real 19 in-between frames; `layout` removed: **0** (snaps); rows keyed by index: **0** (rows stay put and contents swap, the classic mistake). The storm check passes for controls too, as it should with nothing animating; it guards against animation debris, not the slide itself.

**Observed, not changed:** on a large burst, the row reorders immediately (sorting uses the real totals) while its counter is still springing up, so for about 0.4 s a row can sit above one showing a bigger number (seen mid-overtake: 647 above 931). Sorting by displayed values instead would delay overtakes behind the counter animation. Left as is; revisit if it reads badly on the demo video.

## F11 — Reconnect forever with jittered backoff; close codes decide urgency

**Decided:** a pure policy (`lib/reconnect.ts`, unit-tested). Backoff doubles from 0.5 s to a 10 s cap, with jitter in the upper half of each step. `4400` (invalid contest) never retries. `1001` (gateway restarting) retries in 0.25–0.75 s. Anything else backs off. The attempt counter resets only when a **snapshot** arrives, not when the socket opens. Retries never stop. While the browser is offline the hook waits for the `online` event instead of burning attempts.
**Why:** the jitter matters when a gateway restarts under many viewers: without it every screen reconnects in the same instant. The floor stops a down gateway being hammered by near-zero delays. An unattended projector screen has to heal itself, so it never gives up. Resetting on the snapshot rather than on `open` means a gateway that accepts connections but can't read Redis still backs off.
**Resync:** every connection starts with a snapshot, which replaces totals wholesale (F8's `applyFrame`), so recovery needs no extra protocol. Counters spring to the corrected values (F9).

## F11 — App-level heartbeat and a 35 s stale watchdog

**Decided:** the gateway sends `{ type: "heartbeat", ts }` every 15 s (`HEARTBEAT_MS`) to clients that have their snapshot. The client resets a 35 s watchdog (`STALE_AFTER_MS`) on *any* frame, and on expiry treats the connection as dead (code 1006) and reconnects. `applyFrame` ignores heartbeats.
**Alternatives:** rely on the browser noticing closes.
**Why:** browsers can't see WebSocket pings, and updates only flow when totals change, so a silently dead connection (dropped Wi-Fi, sleeping laptop, frozen process) would show "Live" indefinitely. **Measured:** with the gateway frozen (`docker compose pause`, socket open), the page noticed at 34.0 s. Left idle for 50 s with no votes and a healthy gateway, it stayed `Live` throughout, so the heartbeat prevents false alarms.

## F11 — Disconnected UI: frozen, dimmed, explained

**Decided:** status states are `Connecting`, `Live` (only after a snapshot), `Reconnecting` (amber pulse), `Offline` and `Unavailable`. When not live, the board keeps the last totals but dims them (50% opacity, desaturated), with a note: "Showing last known totals · reconnecting in 4s".
**Why:** a viewer glancing at the numbers must be able to tell they're frozen, and blanking the board would lose information.

## F11 — How "disconnect, reconnect, resync without refresh" was verified

Headless Chrome on the containerised stack. In each case 30 votes were sent while the gateway was down (the consumer kept counting into Postgres and Redis), then the page was compared row by row with Postgres after recovery:

| Gateway | Noticed | Live again after restart | Rows match Postgres |
|---|---|---|---|
| `stop` (1001) | 0.3 s | 2.4 s | ✓ |
| `kill` (no close frame) | 0.2 s | 2.3 s | ✓ |
| `pause` (socket open, silent) | 34.0 s | 1.0 s | ✓ |

One page load across all three (`performance.getEntriesByType("navigation").length === 1`).

## F12 — Go generator: pacer, worker pool, standard library only

**Decided:** one run at a time. A pacer goroutine ticks every 10 ms and releases `rate × elapsed` votes, carried in an integer accumulator (vote·µs), so fractions are never lost and a long run stays exact. It hands votes to a fixed worker pool (`GENERATOR_WORKERS`, default 256) sharing one keep-alive `http.Client`. When workers can't keep up, the pacer blocks rather than dropping votes; `/status` shows the real throughput. Requests already in flight finish on Stop, and nothing new starts. Standard library only.
**Why:** `time.Ticker` can't fire 3,000 times a second, but 30 per 10 ms tick is easy. Backpressure instead of drops keeps "sent" honest.

## F12 — Control API and traffic model

**Decided:** SPEC §7's endpoints, with `/start` taking `codes` (passed in; the generator never reads the database) and `duplicateSenderRatio`. `/start` while running and `/burst` while stopped return **409**. A burst overrides the rate until it expires, then falls back by itself. Each vote gets its own `Idempotency-Key`. Senders are obviously synthetic (`sim:<hex>`). Invalid codes are well-formed (`X` + 6 alphanumerics, never a real code), so ingest accepts them and the consumer dead-letters them, instead of them bouncing as 400s. Duplicates reuse one of the last 1,024 senders. Popularity is a **drifting race**: a multiplicative random walk every 2 s (σ 0.35, weights clamped to [0.05, 20]), so leads build and change hands on their own. The unit test saw ≥3 different leaders over 300 steps.
**Why:** passing codes keeps the generator a pure HTTP client with no second copy of schema knowledge (F13's panel reads them from Postgres). The drifting race produces F10's overtakes without anyone steering.

## F12 — Contract test through JSON Schema exported from Zod

**Decided:** `packages/contracts` exports JSON Schemas (`pnpm --filter @tally/contracts export-schemas`) for the vote request, the generator's start, burst and status bodies, and the error and health responses. A TS test fails if the committed files drift from Zod. The Go test checks each struct against its schema: field names both ways, JSON types, nullability, response fields never `omitempty`, required fields never `omitempty`, the `source` enum, and that the Go validation regexes and bounds are identical to the schema's. The schema files are excluded from Biome (generated).
**Mutation-checked:** renaming `contestId` to `contest_id` in Go, or moving `maxRate` to 25,000, each fails with a precise message.
**Tooling:** Go isn't installed on the dev host. `scripts/go.sh` runs host Go if present, otherwise the `golang:1.27-alpine` image with the repo mounted. `pnpm test:go` runs the 22 Go tests.

## F12 — Measured: 3,000 votes/s for 60 s

Containerised stack on the dev machine; `ratePerSec: 3000`, 5% invalid, 10% duplicate senders:
- **Throughput:** 190,850 sent in 63.6 s (**2,999/s**), 190,850 accepted, **0 rejected, 0 failed**.
- **Ingest latency** (seen by the generator): p50 7.2 ms, p95 8.4 ms, p99 9.6 ms.
- **Dead letters reconcile exactly, not just proportionally:** generator `invalidSent` 9,695 (5.07%) = `votes.dead` +9,695 = `dead_letters` +9,695. `votes` +181,155 = accepted − invalid.
- **Consumer lag** hovered at 270–540 messages without growing, and drained to 0 within seconds of the stop.
- **Caveat:** the per-5 s rates in the run log read 3,100–3,250 because each sample loop also ran `docker exec` calls, stretching its interval past 5 s. The whole-run average is the real figure.

## F13 — Password gate brought forward; session is a signed expiry
**Decided:** the shared-password gate planned for F14 is built now, because F13's panel is the first protected page. `ADMIN_PASSWORD` from the environment; a login page with a server action; on success an httpOnly, SameSite=Lax cookie holding `<expiresAt>.<HMAC-SHA256(expiresAt)>`, valid 12 h. The HMAC key is scrypt-derived from the password, so changing the password signs everyone out and a stolen cookie is expensive to brute-force back into the password. Password comparison is constant-time; a wrong password waits 500 ms. The session is checked twice: `proxy.ts` (Next 16's middleware) redirects or 401s early for `/control` and `/api/generator/*`, and every page and route handler checks it again through `lib/auth.ts`, as Next's docs recommend, so a matcher gap can't expose anything. `Secure` is set when the request arrived over HTTPS (`x-forwarded-proto`).
**Alternatives:** a separate `SESSION_SECRET` (one more required variable, and the password would still be the thing to protect); a server-side session store (state to keep, which the config rule argues against); a random per-process key (every restart and every replica would sign people out); leaving F13 open until F14 (the panel can start 20,000 votes/s, so it shouldn't be public even briefly).
**Not done:** lockout after repeated failures, which would need shared state. The 500 ms delay and scrypt key make guessing slow, and this is a one-operator demo.

## F13 — The browser never talks to the generator
**Decided:** the panel calls web route handlers, which forward to `GENERATOR_URL` server-side with a 3 s timeout. Bodies are validated with the contract schemas on the way in; answers are validated against `GeneratorStatus` / `ErrorResponse` on the way out (502 if the generator answers outside the contract or not at all). Handlers require `Content-Type: application/json`, so a cross-site HTML form can't drive them, on top of SameSite=Lax. `start` takes `{ contestId, ratePerSec, invalidCodeRatio, duplicateSenderRatio }` and the handler reads the contest's codes from Postgres.
**Why:** the generator has no auth and shouldn't need any. Keeping it off the browser's network path is what makes the password mean something (port 4002 is still published for local debugging; a deployment wouldn't publish it).

## F13 — Ramp is `POST /rate`, not stop and start
**Decided:** the generator gained `POST /rate { ratePerSec }`: it swaps the run's base rate (now an atomic) without touching counters, the run's start time or the popularity race. 409 when stopped, like `/burst`. During a burst the burst rate keeps priority; the new base rate applies when it ends. Contract: `GeneratorRateRequest` in contracts, exported to JSON Schema, and checked by the Go contract test.
**Alternatives:** stop and restart at the new rate. That resets the counters and the race, and it leaves a gap in the traffic that shows on the chart and on the results page.

## F13 — Panel: polled status and a delivered-rate chart
**Decided:** `/control` polls `/api/generator/status` every second. It shows target, delivered and run rate; sent, accepted, rejected, no-answer, invalid and repeat-sender counts; and ingest p50/p95/p99. A Recharts line chart plots target (dashed) against delivered votes/s for the last minute. Delivered is computed from `sentTotal` deltas over the real time between polls (`lib/rate-history.ts`), with a gap rather than a spike or negative value when a new run resets the counters. Chart animation is off: points arrive every second, and re-animating each time would jitter. A control call's response updates the panel at once, without waiting for the next poll.
**Also:** shadcn/ui set up here (deferred from F8): radix base, tokens mapped onto the scoreboard's dark palette (no light theme), Barlow instead of the default Geist. The scoreboard's `--muted` became `--ink-dim`, because shadcn uses `--muted` as a surface colour.

## F13 — How "drive the whole demo from the browser" was verified
Headless Chrome against the containerised stack, clicking the panel. Each step was checked against the generator's own `/status` on port 4002 (not through the web app) and Postgres. 23 of 23 checks passed:
- **Protection:** no session → 401; forged cookie → 401; `/control` → `/login?next=%2Fcontrol`; wrong password → error; right password → panel.
- **Start** at 500/s with 5% invalid → running, `baseRate` 500.
- **Ramp** to 2,000/s → same run (`startedAt` unchanged, counters kept); measured 2,010/s.
- **Burst** 3,000/s for 6 s → panel shows Burst with a countdown; the burst ended by itself and the rate went back to 2,000/s.
- **Readout:** matches the generator (within one poll); 0 rejected, 0 failed; chart drawn.
- **Stop** → nothing sent after it.
- **Pipeline:** Postgres gained 35,041 votes = 36,873 accepted − 1,832 invalid, exactly.

**Web SIGTERM, re-checked:** with the generator paused, a `/api/generator/status` request was in flight when `docker compose stop web` sent SIGTERM. Web waited for that request to finish (it answered 502 at 3.2 s), then exited with 143. Next exits with 128 + signal after its cleanup, on purpose. The earlier "exits without draining" note was wrong and is closed.

## F14 — Codes are fixed; the resolver re-checks every 5 s
**Decided:** a contestant's code can't change after creation (`PATCH` with `code` is a 400); everything else can. The consumer's resolver no longer caches hits for ever: every answer, found or not, is trusted for 5 s, then Postgres is asked again. It returns `counted`, `unknown` or `inactive`.
**Why:** consumers cache code → contestant. An editable code would need that cache invalidated in every consumer at once, or old codes would keep resolving and a reused code could count for the wrong person. With the code fixed, the only thing that changes is `active`, and a 5 s expiry is enough for that. Cost: one small query per code per 5 s per consumer, which the test pins at 2 queries for 500 lookups of 2 codes.
**Alternatives:** editable codes with invalidation over Redis pub/sub or a Kafka topic (more moving parts for a typo fix); editable until the first vote (racy at exactly the moment it matters). To fix a typo'd code: deactivate it and add a new contestant.

## F14 — Deactivate, don't delete
**Decided:** no DELETE (SPEC §7 lists none, and the FKs forbid deleting a contestant with votes). Deactivating keeps its votes and totals, dead-letters later votes as `inactive_contestant` (a new reason, so they're never dropped silently and F15 can show why), hides it from results pages and leaves it out of the codes `/api/generator/start` sends. Results pages load inactive contestants too, but `rank` skips them. Otherwise their totals, still in Redis, would look like "a contestant this page doesn't know" and trigger a refresh every 5 s.
**Known limit:** a results page that is already open keeps showing a contestant deactivated after it loaded, until it reloads. The contest total still includes an inactive contestant's earlier votes; they were real.

## F14 — Duplicate codes are Postgres's call
**Decided:** `POST` inserts and maps the unique violation (`23505` on `contestants_contest_code_unique`) to **409** with `{ path: "code", message: "C3 is already used by Ada Lunetti in this contest. …" }`; a missing contest (FK `23503`) is a 400 on `contestId`. No check-then-insert.
**Why:** a pre-check races: two admins adding the same code at once would both pass it. Codes are uppercased before the insert, so `c3` collides with `C3`.

## F14 — Admin UI
**Decided:** `/admin/contestants` (and `/admin` redirects there), behind the F13 gate; the proxy matcher now covers `/admin/*` and `/api/contestants/*`. A table with avatar, code, name, country, accent swatch, vote count, an active switch and edit. Add and edit share one dialog form. Field errors come from the server's `ErrorResponse` and show under the field they name. "Generate" fills a DiceBear illustrated avatar URL from the name: `avatarUrl()` now lives in contracts, and the seed uses it too. A shared top bar links Generator and Contestants and has sign-out. Request checks shared by all admin routes moved to `lib/api.ts`.

## F14 — Found on the way: typecheck was red at the root
`pnpm typecheck` across the workspace failed twice. Both failures were in earlier features' code and hidden because each feature ran its own package's typecheck. `packages/contracts` had no Node types for the F12 schema export script and drift test (TS 7 includes no `@types` by default; fixed with `"types": ["node"]`). `services/consumer` used an instantiation expression on the overloaded `consumer.consume` (F6), which TS 7 rejects; it now uses the library's `MessagesStream` type. The root `pnpm typecheck` is part of the check from now on.

## F14 — How "added through the UI, immediately receives votes; duplicate rejected clearly" was verified
Headless Chrome with two tabs against the containerised stack: a results page left open, and the admin page. 20 of 20 checks passed:
- **Protection:** no session → 401; `/admin/contestants` → login → back.
- **Add through the dialog** (code typed lowercase, generated avatar, colours, `fr`): stored as `CODE|FR|#22D3EE|avatar|active`.
- **Immediately:** a brand-new code counts its first vote **168 ms** after save, measured separately and including the whole pipeline. Worst case: a vote for the code *before* it existed (correctly dead-lettered `unknown_code`) caches a miss, and votes counted **5.2 s** after save, inside the 5 s window plus pipeline time. None of the 10 votes sent while waiting was lost: each was counted or dead-lettered.
- **The results page that was already open** showed the new row (10 → 11) with no reload.
- **Duplicate:** C3 → under the code field: "C3 is already used by Ada Lunetti in this contest. Codes are unique per contest."; still one C3; the API gives 409 for `c3` too.
- **Fixed code:** `PATCH { code }` → 400.
- **Deactivate** with the switch: votes dead-lettered as `inactive_contestant` 1.8 s later, earlier votes still counted, and a fresh results page leaves it out.

## F15 — Keyset pages, not numbered ones
**Decided:** newest first, paged by id (`before` / `after` cursors), never OFFSET. A page is always the same rows, however many new dead letters arrive while someone reads it (they get higher ids), and a deep page costs what page 1 costs. The `older` / `newer` cursors are set only when a row exists on that side (one indexed `exists` each), so there's never an empty last page. Per-reason counts sit on the filter chips instead of a page total.
**Alternatives:** numbered pages with a total. Rows shift between pages while a run is going (150+ new per second at 3,000 votes/s with 5% invalid), and OFFSET gets slower as the table heads for millions in F19.

## F15 — The contest is a column, not a JSON lookup
**Decided:** `dead_letters.contest_id` (nullable uuid). The consumer writes the vote's contest; malformed messages get null. Migration `0003` adds the column, backfills it from payloads (only a well-formed UUID is taken, because malformed payloads can hold anything) and adds indexes on `(contest_id, id)`, `(reason, id)` and `(contest_id, reason, id)`, one per filter combination. No FK: an `unknown_code` vote can name a contest that doesn't exist, and it must still be recorded. The page defaults to the current contest; "All contests" includes malformed messages.
**Alternatives:** filter on `payload->>'contest_id'` (needs an expression index anyway, and is harder to read); reason-only filtering (fine with one contest, wrong once there are two).

## F15 — "N new" banner instead of a moving list
**Decided:** the page polls `/counts?since=<newest id at load>` every 3 s and shows "610 new dead letters since this page loaded · Show newest". The list only changes when asked, so a row being read never scrolls away. The page is server-rendered with the filter and cursor in the URL, so any view can be linked to. Times show in UTC, so the server render and the browser agree.
**Not done:** actions (requeue, delete). The page only views, as the plan says. Requeueing votes dead-lettered while a contestant was inactive raises fairness and idempotency questions; that belongs in its own feature if it's wanted.

## F15 — Test support
`@tally/db/testing` exports `createTestDatabase()`: a throwaway migrated and seeded database, for web's integration test of the keyset query. It walks 120 rows while 30 more arrive, pages back with `after`, and checks filters and counts. Mutation-checked: `<=` instead of `<` in the cursor fails 3 of its 5 tests. The consumer's own test support is older and left as it is.
**Observed:** `services/gateway`'s "two clients receive identical frames within a second" failed once in 6 full-suite runs (it passed 3 of 3 runs on its own), because it's timing-sensitive when the whole suite shares the machine. Not changed in F15; watch it.

## F15 — How "votes rejected during a generator run are visible with accurate reasons" was verified
Headless Chrome on the containerised stack; a real run at 1,000 votes/s with 10% invalid codes, C10 deactivated 3 s in, and two malformed messages produced straight onto `votes.raw` with `rpk`. 13 of 13 checks passed:
- **While the run went on,** the open page showed "610 new dead letters since this page loaded" and didn't move by itself.
- **Unknown code** rose by **868 = the generator's `invalidSent` of 868**, exactly. **Inactive contestant** rose by 111, all C10.
- **Every reason is true of its rows:** no `unknown_code` row's code exists in its contest, every `inactive_contestant` row is C10, malformed rows have no contest, and no dead letter was also counted as a vote (`0|0|0|0`).
- **Malformed:** both injected messages appear under All contests; expanding a row shows `{ "hello": "not a vote" }`.
- **Paging:** 4 pages gave 200 rows, with no repeats, strictly newest first; "Newer" returns exactly the previous page.

## F16 — The cut-off is when ingest accepted the vote, enforced with a lock handshake
**Decided:** a vote counts if and only if ingest accepted it while the contest was open (`acceptsVoteAt` in `@tally/db`). A vote accepted a moment before the close counts even if it's still queued; a vote accepted after doesn't, even if the consumer hasn't heard of the close yet. Closing (`setContestStatus`) locks the contest row `FOR UPDATE` and only then stamps `closes_at = clock_timestamp()`. Each consumer batch reads its contests `FOR SHARE` inside its transaction before deciding. So a close waits for every batch that has already decided, and stamps a time after all of them: every vote those batches counted was accepted before the stamp, and every later batch sees the close. The decision is also deterministic under replay: it depends on `sent_at` and the stamp, not on when the consumer runs.
**Why FOR SHARE, not the FK's lock:** inserting votes already takes `KEY SHARE` on the contest, but only at insert time, after the batch has decided. The explicit lock covers the decision. `clock_timestamp()`, not `now()`, because `now()` is the transaction's start, before the wait.
**Tested with real locks, not timing:** a batch blocks while another transaction holds the contest `FOR NO KEY UPDATE` (which conflicts with `FOR SHARE` but not with the FK's `KEY SHARE`); a close blocks behind a `FOR SHARE` holder and stamps after it lets go. Mutation-checked: removing the lock fails the first; `now()` fails the second. A timing-based test (two batch loops with a close in the middle) could not tell the lock was missing, so it stays only as a no-vote-lost check.
**Assumes** ingest's clock and Postgres's agree (same host in compose; NTP in any real deployment).
**Alternatives:** dead-letter whatever the consumer processes after it sees the close (a voter who sent in time loses out to queue lag, and a replay can decide differently).

## F16 — Draft counts nothing; reopen starts a new window
**Decided:** only an open contest counts. Votes for a draft use the existing `contest_closed` reason, read as "not open", with no new enum value. The admin can open a draft, close an open contest, and reopen a closed one (an accidental close shouldn't be final). Reopening sets a new `opens_at` and clears `closes_at`, so votes sent while the contest was closed stay dead-lettered. A rare edge: a vote from the first window still queued at the moment of a reopen is dead-lettered too, because it predates the new `opens_at`. No scheduler; `opens_at` / `closes_at` record what happened rather than plan it.

## F16 — Results pages learn of a close through the gateway
**Decided:** after the Postgres commit, web writes the status into the contest's Redis meta hash (web got `REDIS_URL` and an ioredis client). The gateway reads it with the totals on each poll and puts `status` in snapshots and updates; a status change alone produces an update. The page shows the gateway's status when it has one, else the one it was rendered with. The pill reads "Final" for a closed contest and "Not open" for a draft, but connection trouble still outranks both, so "Final" never hides a dead connection. The footer says "Voting has closed. These are the final results."
**Why web writes it, not the consumer:** the consumer writes Redis after its own commit. A batch that read "open" and committed just before a close could then overwrite web's "closed". Web writes only after its transaction commits. If that Redis write fails, the response says `liveUpdated: false` and the admin page tells the operator. Postgres has already decided and the consumer enforces it either way. A Redis flush loses the status until the next transition (pages then fall back to their rendered one).

## F16 — Contests admin page
`/admin/contests`: each contest with its status, window times (UTC) and one action (Open voting / Close voting / Reopen) behind a confirm dialog that says what closing does: "Votes ingest accepts from this moment on are dead-lettered… Votes already accepted still count, even if they are still in the queue." After the change, the notice shows the exact cut-off.

## F16 — How "closing mid-run stops totals immediately; every later vote is dead-lettered" was verified
Headless Chrome, two tabs (the contests page and a results page), with a generator run at 1,500 votes/s. The close was clicked mid-run and the generator kept sending for 5 s after it. All checks passed, on two runs:
- **No vote accepted at or after `closes_at` was counted** (0). The last `vote_totals` write came **60 ms** after `closes_at`, from votes accepted before it; totals then stayed still for the remaining 5 s.
- **Nothing lost:** ingest accepted = counted + dead-lettered (**14,144 = 6,089 + 8,055**; the first run was 14,354 = 6,179 + 8,175). Every `contest_closed` dead letter was accepted after the cut-off, none before. All of them appear in the dead-letter browser under Contest closed.
- **The results page, open throughout,** switched to Final without a reload and shows the final total.
- **Reopen:** the page went back to Live, and a new vote counted. Opening an open contest → 409 "The contest is open; it can't be opened from there."

## F17 — Buckets are filed by acceptance minute, written like totals
**Decided:** in the same batch transaction as totals, the consumer adds each *newly inserted* vote to `vote_buckets` under the minute ingest accepted it (`received_at` truncated), and reads back the contest's absolute per-minute counts for the minutes the batch touched. Those go to Redis (`tally:{id}:minutes`) through the same upward-only Lua script as totals, plus `lastMinute` in the meta hash. So duplicates and replays add nothing, a lost Redis write heals on redelivery, and a vote sent at 20:00:59.9 but processed at 20:01:00.3 lands in 20:00, the same on every replay. Migration `0004` backfills buckets from the vote log by recounting (`SET count = excluded.count`), exact and safe to re-run with the consumer stopped, which the compose `migrate` job guarantees.
**Tests:** placement across a minute boundary; 300 votes plus 50 in-batch duplicates plus a full redelivery → buckets 300 = totals 300, and Redis per minute matches Postgres; a deleted Redis minute is repaired by a redelivery. Mutation-checked: bucketing every candidate instead of inserted rows fails 2 tests.

## F17 — Redis is rebuilt from Postgres at consumer startup
**Found by the done-when check:** after deploying, the chart missed the minutes backfilled into Postgres, because nothing had ever copied them to Redis. The same gap existed for totals after any Redis flush; CLAUDE.md says Redis must always be rebuildable from Postgres, and until now nothing rebuilt it.
**Decided:** `resyncRedis` runs when the consumer starts, before it consumes. It writes every contest's absolute totals, total votes, per-minute counts and `lastMinute` through the upward-only store, so it's safe alongside live batches. Contest status is left out: web stays its only writer (F16). Tested by flushing Redis after a batch and checking the resync restores it exactly.

## F17 — Chart window and transport
**Decided:** the gateway reads only the window's 30 fields (`HMGET`), not the whole hash. The window ends at the current minute, or, for a closed contest, at `lastMinute`, so a finished contest's chart doesn't scroll away into empty time. Snapshots carry the window; updates carry changed minutes and `minutesTo`; the page drops minutes that slide out. The chart (Recharts area, animation off, total votes per minute) sits under the standings. It starts at the contest's opening minute when that's inside the window, is rendered only after the first snapshot (so times are always the viewer's clock), and shows zero, not a gap, for quiet minutes.
**Alternatives:** results pages polling a web API (every viewer becomes Postgres load); per-contestant lines (busier on a projector; the list already shows who leads).

## F17 — The gateway test flake, found and fixed
The "two clients receive identical frames" test waited for exactly six frames. Frames per change legitimately vary: a poll can land between the totals write and the meta write (then a second update carries only `totalVotes`), two changes can share one poll, and since F17 a minute rolling over adds an update. Instrumented runs showed the extra `changed: []` frames. The test now waits until both clients have seen the final total, then compares their frames. The F16 status test had a similar assumption: a client joining a room before its next poll gets the room's current state, and that poll then updates it. That test now waits for the poll. The two minute-sensitive tests wait out a minute's last 5 s. After the fixes: 6 of 6 full-suite runs clean.

## F17 — How "the chart fills in live; bucket sums reconcile with the totals" was verified
Headless Chrome with the results page in the foreground; a 135 s generator run at 800 votes/s, then 1,600 votes/s after 70 s. All 8 checks passed:
- **Live:** the chart's total rose at 66 of 67 two-second samples, with no reload, across 4 minutes of buckets.
- **Reconcile:** for every contestant, bucket sum = total = votes (**972,856 = 972,856 = 972,856**, 0 mismatched). The run's buckets = votes the generator got accepted (**162,263 = 162,263**). The chart's total = Postgres's buckets for the minutes it shows (649,740 = 649,740). Redis per minute = Postgres for every minute of the run.

## F18 — Reconcile under the contest lock, repair by overwriting
**Decided:** per contest, `reconcileContest` takes the contest row `FOR UPDATE`, the same handshake as closing (F16). In-flight batches for the contest finish first and new ones wait, so the recount of `votes` and every layer it's compared with describe one instant, with nothing in flight. Counting for the contest pauses meanwhile (291–741 ms at about 1M votes); votes wait in Redpanda and none are lost. Everything is compared: `vote_totals` and `vote_buckets` per contestant (and minute), and in Redis the totals hash (including entries for ids that aren't in the contest), `totalVotes`, the minutes hash and `lastMinute`. With `--repair`, Postgres rows are replaced and the Redis hashes overwritten, all while the lock is held, then compared again. The Redis write is a plain overwrite, not the consumer's upward-only one, so a too-high value comes down. A batch that committed just before the lock may still write Redis afterwards, but its value is committed, so it's at most the recount and its upward-only write can't disturb the repair. Contest status stays web's. A 10 s `lock_timeout` stops the job hanging behind a stuck transaction.
**Why the lock:** without it, a batch committing mid-recount makes the comparison report drift that isn't there, and a repair can overwrite a count a batch just raised. The live-traffic test fails 3 out of 3 times with the lock removed.
**Worth knowing:** a too-*low* Redis value heals by itself as soon as its contestant gets a vote, because live batches write absolute values upward-only. The first version of the live test planted a low value, and traffic repaired it before the reconciler ran. A too-*high* value never heals by itself; that's the case `--repair` exists for.
**Alternatives:** a lock-free comparison confirmed on a second pass (can't repair exactly while votes flow); repairing Redis only (but `vote_totals` / `vote_buckets` are derived too, and the vote log is the only truth).

## F18 — How "a corrupted Redis counter is detected, reported and repaired" was verified
On the running stack, with a results page open. 13 of 13 checks passed:
- **Idle:** C1 set to 5 (truth 126,074) and C2 set 12,345 too high. The open page showed the bad C1. `pnpm reconcile` exited 1 with `redis_totals C1 126,074 5` and `redis_totals C2 83,915 96,260`. `--repair` exited 0, Redis went back to the recount, and the open page showed the true counts again without a reload. A second check found no drift.
- **Mid-run at 1,500 votes/s:** C3 and `totalVotes` set to 99,999,999 survived 2 s of live traffic. `docker compose run --rm reconcile --repair` found and fixed both, with counting paused 741 ms. After the run, no drift in any layer (993,029 votes), and 0 votes rejected or failed.
- **Before any corruption,** a first check on the real dev data (972,856 votes) found no drift.

## F19 — Load test: k6 in a container, one script that also proves zero loss
**Decided:** k6 in the pinned `grafana/k6:2.3.0` image (nothing installed on the host), one script with three profiles taken from SPEC §8: `steady` ramps to 1,000/s over a minute and holds it for 3; `spike` goes from a 500/s baseline to 3,000/s for a minute and back; `smoke` is a 20 s harness check. It's an open model (`ramping-arrival-rate`): votes arrive on schedule whether or not earlier ones were answered, like SMS traffic. So a slow ingest shows up as latency or dropped iterations, never as a quietly lowered rate. Each vote carries `Idempotency-Key: k6-<run>-<vu>-<iter>`, so this run's votes can be found exactly afterwards. Requests on the plateau are tagged `phase=peak`, and latency there is reported separately from the whole run (the ramps and baseline dilute it: the first spike run showed p95 22 ms overall).
`scripts/load.mjs` wraps the run:
- **Before:** checks the contest is open and ingest is healthy, and stops the Go generator so no other traffic mixes in.
- **During:** samples consumer lag from `rpk group describe` every second.
- **After:** waits for lag 0, then compares k6's 202 count with votes in Postgres carrying this run's keys (zero loss means equal, with none dead-lettered), and runs `pnpm reconcile`.
- **Output:** writes `load-results/<run>.md`, exiting non-zero if p95 or error or loss or reconciliation fails.
**Why a wrapper:** k6 alone measures ingest. The claims that matter here are "nothing lost" and "counts stay exact under load", and those need the queue and the database.

## F19 — Found: docker-proxy distorted the spike numbers
The second spike run, with k6 on the host network hitting `localhost:4000`, failed: p95 at the peak 70.7 ms, 929 dropped iterations, and consumer lag rising to 12,069 (nothing lost, no drift). The first identical run had passed. `ps` showed `docker-proxy`, Docker's userspace port forwarder, busy copying every request. k6 now runs in the compose network and calls `ingest:4000` directly, as a load balancer in front of a deployment would. Two spike runs that way both passed: p95 14.4 and 20.1 ms. This machine is a laptop shared with a desktop session, so run-to-run variance is real, and the README shows both runs and says so.

## F19 — How "a reproducible command and a results table good enough to publish" was verified
`pnpm load steady` and `pnpm load spike` (twice) on the containerised stack; reports committed in `load-results/`, table in the README:
- **Steady:** 1,000 votes/s delivered through the hold; p50/p95/p99 **4.1 / 7.0 / 8.2 ms**; 0 errors; max lag 140; 217,499 accepted = 217,499 counted; no drift.
- **Spike:** 3,000 votes/s delivered at the peak; p95 **14.4 ms** (second run 20.1 ms, with 32 of 282,499 iterations dropped by k6); 0 errors; max lag about 1,000, drained in 0.2 s; every accepted vote counted; no drift.

## F20 — Analytics consumer: its own group, both topics, rows as delivered
**Decided:** a new service, `analytics-consumer`, in its own consumer group, `tally-analytics`, so its offsets, pace and outages are its own. It reads `votes.raw` (every vote ingest accepted) *and* `votes.dead` (every rejection, with its reason), so analytics can tell counted votes from rejected ones without asking Postgres, which F22 requires. It works in batches of up to 5,000 messages or 1 s, since ClickHouse prefers large inserts. Offsets are committed only after the insert succeeds, and a failed insert is retried, never skipped: at-least-once, like the totals consumer. A new group starts from the earliest offset, so analytics begins complete: the first start replayed ~2.8M votes in 130 s.
Rows are stored as delivered: a redelivered batch, or a client retry with the same `Idempotency-Key`, adds rows, and readers count `uniqExact(idempotency_key)`. F21 designs the read side. Unparseable `votes.raw` messages are skipped here, because they reach `votes.dead` as `malformed` anyway. The tables are created with `CREATE TABLE IF NOT EXISTS` at startup: analytics is derived data, and resetting the group's offsets rebuilds it from the topics.
**Alternatives:** reading only `votes.raw` and resolving codes against Postgres (the analytics path would then depend on Postgres, and its "counted" could disagree with the consumer's contest window and deactivation rules); ReplacingMergeTree to dedupe on write (it dedupes only rows with equal sort keys, and a retry with the same key has a different `sent_at`).
**Also:** `pnpm test:go` now runs with `-count=1`. Go's test cache didn't notice that `health-response.schema.json`, outside the Go module, had changed, and reported a stale "ok".

## F20 — Replay found three votes Postgres no longer has
Comparing ClickHouse with Postgres after the replay: dead letters matched reason by reason (16,230 / 113 / 15,999 / 2). ClickHouse had 3 more distinct vote keys than Postgres votes plus vote-shaped dead letters. They were the 3 votes F8's refresh check sent to a temporary contest (`…f8f8f`) that I deleted by hand from the dev database afterwards; the topic still has them. So this is a cleanup artefact, not a pipeline bug. It's also a small demonstration that the topic, not Postgres, is the complete record of what arrived.

## F20 — How "two minutes without analytics leaves live results unaffected, and it catches up" was verified
Generator at 1,000 votes/s with a results page open; the live path sampled every second for 30 s with analytics running and for 120 s with `docker compose stop analytics-consumer`. 8 of 8 checks passed:
- **Unaffected:** the page's total moved in 67 of 67 samples. The totals consumer's lag stayed a median of 90 (max 190), the page stayed about 300 votes behind Postgres (400 before), and ingest p95 was 9.1 ms (9.3 before). 184,710 accepted, 0 rejected or failed. Meanwhile the analytics backlog reached 121,154 messages.
- **Caught up:** 121,494 messages in 12.0 s after restart (about 10,000 msg/s), with live traffic still running.
- **Complete:** ClickHouse had every vote of the run exactly once by key: **184,710 = Postgres = accepted**.

## F21 — No rollups: the sorted table plus a key hash is fast enough, and exact
**Decided:** analytics queries scan `votes_raw` directly. Its sort key `(contest_id, sent_at, idempotency_key)` prunes to one contest (the benchmark read exactly the 10M rows of the contest under test, none of the other 10M) and keeps each time range contiguous. Distinct votes are counted as `uniqExact(key_hash)`, a materialized `cityHash64` of the idempotency key: 313 ms against 568 ms for distinct strings over 10M votes. The odds of a hash collision among even 100M keys are about 1 in 3,700 (birthday bound), and on the live data there are none (3,185,053 distinct hashes = distinct keys). "Counted" per minute = distinct accepted − distinct rejected, with each rejection filed under its vote's `sent_at` (a new `votes_dead.sent_at`, derived from the original on insert and materialized for existing rows). Timestamps gained DoubleDelta+ZSTD codecs.
**Tried and dropped:** per-minute rollups (`AggregatingMergeTree` with `uniqExactState` via materialized views). An exact distinct count's state is the set of keys itself, so the "rollup" stored every key again (31 MB for 2M votes) and merging those sets was *slower* than scanning: 89–174 ms against 50 ms at 1M votes. The ways to make a rollup cheap (`count()`, or approximate `uniq`) would count redelivered votes twice or give up exactness. Measured duplicates on the live data: 1 row in 3.2M.
**Also:** the schema is now versioned migrations recorded in `_migrations`, not create-if-missing statements, since the tables had started to change. One analytics consumer runs at a time, so there's no lock, and every statement is safe to repeat if a migration dies part-way.

## F21 — How "a group-by-minute query over several million rows returns fast" was verified
`pnpm bench:clickhouse` (report in `load-results/clickhouse-*.md`) builds a throwaway database with the production migrations. It has 10M synthetic votes for one contest over 3 h, 10M for another, and 5% rejected, and times each query (server-side elapsed, median of 5 warm runs, query cache off):
- **Votes per minute, whole contest (10M), exact:** **313 ms**. The same with `count()`: 133 ms, but not redelivery-proof.
- **Counted per minute (accepted − rejected):** 330 ms. **Per minute per contestant** (lead changes): 393 ms. **By source:** 408 ms.
- **Last 30 minutes:** **56 ms**, reading 1.7M rows; the sort key limits it to the range.
- **Correct, not just fast:** on the live contest, ClickHouse's counted-per-minute equals Postgres's `vote_buckets` in all 83 minutes (**3,152,708 = 3,152,708**, 0 mismatched), computed without asking Postgres.

## F22 — Analytics page: ClickHouse for every number, Postgres for labels only
**Decided:** an operator page, `/admin/analytics`, behind the admin password like the other operator pages (SPEC lists no public analytics surface). All chart data comes from one route, `GET /api/analytics/:contestId` (`lib/analytics.ts`), which talks only to ClickHouse:
- **Turnout:** counted and rejected votes in buckets sized to the contest's span (1–1,440 minutes, at most about 120 bars; 5 minutes for the 6-hour seed contest).
- **Lead-change history:** cumulative lines for the top five, a dashed line at each change of leader, and a table of changes with margins.
- **Breakdown:** counted votes by source, rejected by reason.

"Counted" is distinct raw keys not among the contest's dead letters, and it equals the live Postgres total (3,152,708 = 3,152,708). Lead changes are computed minute by minute from per-code counts (`lib/lead-changes.ts`, tested). A tie doesn't pass the lead, so an incumbent keeps it until someone is strictly ahead. The page takes contest and contestant *names* from Postgres, but only as labels: with Postgres down it says so, labels by code, and picks the contest with the latest votes from ClickHouse. Web's pool now gives up connecting after 2 s (`createDb` gained `connectionTimeoutMillis`), so an outage costs the page 2 s, not an indefinite wait.
**Why this way:** "none of them touch Postgres" is only worth claiming if it survives Postgres being gone, and the check tests exactly that.

## F22 — Found: the proxy never covered `/api/contests`
F16's edit to the proxy matcher was a find-and-replace on the one-line form. The formatter had already split the matcher over several lines, so the replace matched nothing. `/api/contests/:id/status` stayed protected, because every handler also checks the session (F16's check got a 401 without one), but the first filter was missing. Fixed, and `lib/proxy-coverage.test.ts` now fails if any `app/api/*` area is missing from the matcher. Mutation-checked: deleting the entry fails the test.

## F22 — How "every chart is served from ClickHouse and none of them touch Postgres" was verified
Headless Chrome on the containerised stack. 9 of 9 checks passed:
- **Content:** the turnout, history and source charts render. Counted (ClickHouse) **3,152,708** = the live total (Postgres). 9 lead changes listed, the latest to C3. Sources: sms 1,792,029, generator 1,359,796, web 883.
- **Live:** during a 30 s run at 500 votes/s, the counted tile rose by exactly the run's 15,009 accepted votes on its own refresh, with no reload.
- **Postgres stopped:** `GET /api/analytics/:id` still answered 200 with every chart's data (3,182,726 counted, 34 turnout buckets, 533 ms from ClickHouse). The page, reloaded without a contest in the URL, rendered all its charts, labelled by code, and said Postgres was unreachable. The first run of this check failed exactly there: without a contest in the URL, the page needed Postgres to pick one. That's what the ClickHouse fallback fixed.

## F23 — Metrics: each service counts its own work; lag comes from Redpanda
**Decided:** a shared `@tally/metrics` (prom-client) gives each Node service a registry labelled `service`, with process metrics (CPU, memory, event-loop lag) and `GET /metrics`. What each service measures:
- **ingest:** requests by route and status; request duration (from request start to the 202, so it includes the wait for `acks=all`); votes accepted; publish time.
- **consumer:** messages by outcome (counted / duplicate / dead_letter); batch time and size; batch retries.
- **analytics-consumer:** rows per table; insert time; insert retries.
- **gateway:** viewers and rooms (gauges read at scrape time); frames by type; Redis poll time.
- **web:** process metrics only, so its `/metrics` needs no password.
- **generator:** hand-written Prometheus text, to stay standard-library only.

Consumer lag isn't measured by the consumers. It's Redpanda's own `kafka_max_offset` (high watermark) minus `kafka_consumer_group_committed_offset`, joined in PromQL. That's the broker's view, so it keeps working when a consumer is down, which is exactly when lag matters. Prometheus scrapes every 5 s, so a burst of tens of seconds reads as a shape. Prometheus and Grafana join the `app` profile. Grafana is provisioned from files, with anonymous read-only access, and the dashboard is generated by `scripts/grafana-dashboard.py`.
**Dashboard layout, learned from the first screenshot:** one lag panel for both groups was useless. The analytics consumer's 140k catch-up (after I had stopped it) flattened the totals consumer's spike into the floor, and ClickHouse's catch-up rate did the same to throughput. Now each signal has its own panel and scale, the analytics path has its own row, batch time and batch size are separate panels, and stats use one neutral colour (Grafana's default thresholds painted any value over 80 red).

## F23 — Found: ClickHouse's own logging cost 1.6 cores at idle
`docker stats` showed ClickHouse at 78% of a core while Tally was idle. `system.part_log` showed constant merges of its own `metric_log`, `asynchronous_metric_log`, `trace_log` and `text_log`, and `OSUserTimeNormalized` was 0.2 (a fifth of all eight threads). Tally reads none of them, so `infra/clickhouse/low-overhead.xml` removes them, keeping `query_log` (the benchmark uses it) and `part_log`. Idle CPU fell to 6%.

## F23 — Load regression since F19, measured, not solved
Re-running F19's `pnpm load spike` after F20–F23 failed SPEC's p95 target. Bisected on the same laptop (every report is in `load-results/`):

| Setup | p95 at 3,000/s | Max lag |
|---|---|---|
| F19 | 14–20 ms | about 1k |
| Full stack, ClickHouse logging on | 101.5 ms | 34k |
| Analytics consumer, Prometheus and Grafana stopped | 63.8 ms | 33k |
| Full stack, ClickHouse logging off, Postgres `shared_buffers` 512 MB | 106.9 ms | 27k |
| Same, with analytics and metrics stopped | 70.5 ms | 30k |
| Same, after killing my stray headless Chrome | 78.5 ms | 17k |
| The **Go generator's** 3,000/s burst on the full stack | ~9 ms | 480 |

Every run had zero loss and no drift. Steady 1,000/s still passes (p95 8.0 ms), with a worse tail (p99 355 ms).
What I found along the way:
- **ClickHouse's logging:** the idle cost above.
- **Postgres buffers:** the `votes` unique index (316 MB at 4.2M votes) no longer fit in the 128 MB default `shared_buffers`, so I raised it to 512 MB.
- **My own leftovers:** 29 headless Chrome processes from earlier check scripts (`chrome.kill()` left renderers alive), one at 22% CPU.
- **Another session's processes:** 5 more headless Chrome instances belong to another project's session on this machine; I left them.
- **Ingest's ceiling:** one Node process tops out at about 0.95 of a core, near 3,000/s.

The generator reaches 3,000/s cleanly while k6, a JavaScript VM per virtual user competing for the same 8 threads, doesn't, so the likeliest cause is CPU budget on one shared laptop. That's not proven. Next steps: k6 on another machine, and more than one ingest replica (F32).

## F23 — How "a generator burst is clearly visible as a lag spike and recovery" was verified
Generator at 800 votes/s for 90 s, a burst to 3,000/s for 45 s (SPEC's burst target), then 90 s at 800/s. The dashboard's own queries were read back from Prometheus, and Grafana was screenshotted (`load-results/grafana-burst-3000.png`):
- **Spike and recovery:** totals consumer lag rose from a median of 64 to **480** messages during the burst, and was back under 100 within the burst's last seconds (median afterwards 40). The throughput panel shows the plateau (3,000 accepted and counted), ingest p95 rises from 7 to 9 ms, batch size from 80 to 300, and batch time from 25 to 95 ms: all visible on the same timeline.
- **Every panel has data** (14 panels, all queries returned series).
- **Honest note:** the check's "10× baseline and at least 1,000 messages" threshold was set before I'd seen a healthy system at this rate. The consumer absorbs a 3,000/s burst with a 7.5× spike (480 messages), and on its own-scale panel that's unmistakable. An earlier run, before the ClickHouse and Postgres fixes, spiked to 78k and took over a minute and a half to drain. The same panel shows that case even more clearly.

## F24 — One element tree, two arrangements
**Decided:** the card is the list row. `ContestantRow` takes a `layout` flag, which becomes a `data-layout` attribute on the same `motion.li`, with the same children: rank, accent stripe, avatar, name and meta, animated total. CSS grid areas rearrange them into a card: stripe on top, a larger avatar, centred name, rank and total at the foot, and a gradient from the two accent colours. Because nothing in the tree changes, switching layouts can't remount anything. The counter's spring, the overtake treatment and the `layout="position"` reorder carry straight on, and cards glide across the grid on an overtake the way rows do in the list. The toggle keeps its state in `?view=grid` through `history.replaceState`: shareable (a broadcast screen can open in the grid), with no navigation and no server round trip, so the WebSocket stays open. The flag is an emoji built from the country code's regional indicator letters, so no image is fetched and no flag set is licensed.
**Alternatives:** a separate `ContestantCard` (CLAUDE.md forbids forking; it would also remount on every switch and restart every counter); a server navigation for the toggle (a round trip, and a reconnect).
**Not done:** the list-to-grid switch itself isn't animated. Rows jump to their card positions, because `layout="position"` deliberately doesn't animate size (scaling would distort text). Only reorders glide.

## F24 — How "one data path, one component; switching preserves live updates and animation" was verified
Headless Chrome, generator at 800 votes/s. Before switching, every row and counter element was tagged with a JavaScript property. 10 of 10 checks passed:
- **One component:** after switching to the grid (4 columns), all 10 rows and 10 counters were the *same DOM nodes*, and again after switching back.
- **One data path:** the gateway's snapshot frame count didn't change across both switches, so the socket never reconnected; no navigation either (`performance` shows one load).
- **Live and animated in the grid:** the total rose 5,785,911 → 5,788,319 in 3 s, and the counter showed 121 distinct values in 121 frames, never backwards.
- **Overtake in the grid:** in a temporary 4-contestant contest ("F24 Grid Check", left closed), 50 votes took G4 from last to first. Its card moved from (946, 212) to (226, 212) through 25 in-between frames: a glide, not a jump.
- The check's Chrome runs in its own process group, and the whole group is killed at the end: no stray renderers this time.

## F25 — Recap video: Remotion, fed by Postgres, deterministic bar race
**Decided:** a Remotion project in `tools/recap`, 1080p at 30 fps, 32 s in four sequences, using the scoreboard's fonts and colours:
- **Intro (3 s):** the contest name, and the vote count counting up.
- **Bar race (16 s):** the top ten, accent gradients and avatars, with a clock showing the contest's own time.
- **Final standings (6 s):** all contestants with vote share and flags, staggered in.
- **Winner reveal (7 s):** the winner's portrait in an accent ring with a slow glow, name, votes, share, and margin over the runner-up.

`pnpm recap` exports the data from Postgres (`vote_totals` for the standings, the vote log bucketed with `date_bin` for the history), bundles the composition, renders H.264 and prints the file's metadata. By default it picks the most recently closed contest.
**History buckets:** sized to the contest's span (5 s up to 1 h, about 120 buckets), with empty buckets dropped, so a 6-minute final gets about 70 steps and a contest with hours of silence doesn't produce a stalled race. At most 150 steps, the last always kept, and a zero step prepended, so the race starts from nothing and ends exactly on the final totals. First version used `vote_buckets` minutes: far too coarse for a short contest.
**Bar race order:** first version sorted each frame by interpolated totals and averaged ranks over 8 frames. Near-ties then flipped every frame and averaged into bars parked between slots, with overlapping labels (visible in extracted stills). Now the rank history is computed once from frame 0, with hysteresis: a bar passes the one above only when ahead by 0.5% and at least 2 votes, and the order is exact once the race holds. Slots are averaged over 10 frames, so each overtake is one decisive glide. It's computed from frame 0 each time, so every frame is reproducible whichever renders first (Remotion renders frames out of order across its workers).
**Also:** Remotion warned that its zod interop expects zod 4.5.4 (the workspace uses 4.6.5), so `tools/recap` pins 4.5.4. The exporter and composition validate against it; the rest of the repo is unaffected.

## F25 — How "a finished contest renders to a watchable video without manual editing" was verified
A real finished contest: "Tally Finals" (10 contestants, codes F1–F10), 6 minutes of generator traffic at 800 votes/s with the drifting-race popularity and 2% invalid codes, closed through `POST /api/contests/:id/status`. Result: 285,516 counted, and F8, Juno Takamire, won with 62,413.
- **The render:** `pnpm recap`, with no arguments, picked it up and rendered `recaps/tally-finals.mp4`: **1920×1080, 32.0 s, 30 fps, H.264** (2 min 18 s the first time, including Remotion's browser download; 49 s after that).
- **Watchable:** stills extracted with Remotion's ffmpeg at 2, 5, 7, 9, 11, 18, 22 and 29 s were checked by eye. Intro, race, standings and winner all read correctly; the race's last frame matches the final standings exactly; overtakes are single crossings.
- **Test:** `export.test.ts` covers the data against a throwaway database: the race starts at zero, never goes backwards, ends on the final totals, and turns 3 quiet hours into one step.


## Tooling (after F25) — `pnpm reset:votes` wipes vote data, keeps contests
**Decided:** one script (`scripts/reset-votes.sh`) clears every vote and everything derived from one, and keeps contests, contestants and each contest's status. It stops the services that write or serve votes, clears Postgres (`votes`, `vote_totals`, `vote_buckets`, `dead_letters`), Redis (totals, minutes, and the vote fields of the meta hash), ClickHouse (`votes_raw`, `votes_dead`) and the topics, then starts the same services again. It asks for a typed `wipe`, or `--yes`, and refuses to run while services answer on the host (`pnpm dev`), because they would keep writing during the wipe.
**Topics are deleted and recreated, and both consumer groups deleted,** rather than trimmed. Otherwise the old votes are still on the topic: a consumer group reset, or a new group like F20's analytics consumer, would replay them straight back into the empty tables.
**The gateway is restarted too,** because Redis totals only go up and the gateway only sends what changed: a deleted total produces no diff, so open pages would keep showing the old numbers. After a restart, pages reconnect and get a fresh snapshot.
**Alternatives:** `docker compose down -v` (also deletes contests, contestants and metrics history); a `--contest` option (not needed yet: the topics hold every contest together).
**Verified** on a throwaway compose project with no published ports: after 300 votes, it left 0 votes, totals, buckets, dead letters and analytics rows, empty 6-partition topics, and the seed contest with its 10 contestants and `open` status. 100 new votes afterwards counted from zero (96 counted, 4 dead letters, 100 and 4 rows in ClickHouse). Its host-mode check refused to wipe, correctly, while the real stack answered on :4000, and restarted what it had stopped.

## Plan — Three admin features before deployment (F26–F28)
**Decided:** after F25, three features go in ahead of deployment, so the deployed demo can run a whole contest without a terminal: create a contest, fill it with sample contestants, open it, drive the generator, close it, play its recap. The later features were renumbered (F29 deployment, F30 README, F31–F33 Kubernetes), since only CLAUDE.md's "Next up" and four earlier entries here referred to them.
- **F26, create contests:** a name creates a draft. Two guards the old flow never needed: names are unique ignoring case (`pnpm recap` names its file after the contest, so two "Finals" would overwrite each other), and a contest can't open without an active contestant. A draft with no votes can be deleted, so test runs don't leave stray contests. Which contest `/` shows stays as it is (the most recently opened open contest, F8).
- **F27, sample contestants:** a review list rather than filling the existing form, which holds one contestant. Nothing is saved until the admin submits, and all rows are added together or none are. Names come from a hand-written list (CLAUDE.md: no real people); codes follow the contest's initial; colours are spread evenly around the colour wheel so the race and the grid stay readable.
- **F28, recap in the browser:** played by Remotion's player, not rendered on the server. It's instant, needs no job queue or file storage (the no-local-disk rule would need object storage for MP4s), and costs no server CPU next to the live pipeline. The composition moves into a shared package so the page and `pnpm recap` can't drift apart. `pnpm contests` lists contests with their vote counts, so the ID for `pnpm recap` is easy to find and an empty contest is obvious.
**Alternatives:** server-side MP4 rendering from the admin page (a separate worker service using every core for about 50 s per render, plus storage for the files); keeping the old numbers and calling the new features F31–F33 (the numbers would no longer follow build order).
**Not decided yet:** Remotion's licence is free for individuals and companies of up to 3 people; commercial use beyond that would need a company licence.

## F26 — Contests are created as drafts and deleted only as drafts
**Decided:** `/admin/contests` gets a "New contest" form (a name, nothing else) that creates a draft and takes the admin to that contest's contestants page. The list also shows each contest's active contestant count and a Contestants link, and drafts get a Delete button.
- **Names** are trimmed, with runs of spaces collapsed, then unique ignoring case. That's enforced by a unique index on `lower(name)` (migration `0005`), not by checking first, so two admins can't both take a name; the 409 names the contest that holds it. The reason is `pnpm recap`, which names its file after the contest.
- **Opening needs an active contestant,** checked inside `setContestStatus` under the contest's row lock. It applies to reopening as well: a contest nobody can vote for would only fill dead letters. Closing has no such check.
- **Only drafts can be deleted,** along with their contestants. A contest that has opened can never return to draft, so a draft has never counted a vote, and deleting one loses no results. A vote check and the foreign keys from `votes` back that up. Votes sent to a draft stay in dead letters, and in ClickHouse.
- `pgCode` moved from web into `@tally/db`, which now needs it too.
**Alternatives:** checking names with a query before inserting (races); deleting closed contests with their votes (loses results, and the analytics copy in ClickHouse would outlive them); allowing names that differ only in case.

## F26 — How the done-when was verified
Headless Chrome against the running stack, through the pages, signed in with `ADMIN_PASSWORD`. 17 of 17 checks passed:
- **Create:** "New contest", with `  F26 Check ` typed, created the draft "F26 Check" and landed on its contestants page. `/admin/contests` listed it with 0 contestants.
- **Duplicate:** `f26   CHECK` was refused ("“F26 Check” already exists…"); still one contest.
- **Open with none:** refused with a reason; still a draft.
- **Contestants:** two added in the existing contestant form (K1, K2, generated avatars); the list showed 2.
- **Run:** opened from the page, then the generator ran on it through `/api/generator/start` from the browser session at 200 votes/s for 6 s: 1,205 accepted, 1,205 counted. Closed from the page.
- **Delete:** no Delete button on the closed contest, and `DELETE` on it got 409. A second draft, "F26 Throwaway", deleted from the page.
- Tests: `contest-admin.test.ts` (create, the case-insensitive conflict, the open guard with inactive contestants, deleting drafts only and freeing the name) and `contest.test.ts` (name trimming). "F26 Check" is left closed in the dev database, like "F24 Grid Check".

## F27 — Sample contestants: a review list, added all together
**Decided:** "Fill with sample contestants" (on an empty contest's contestants page, and as "Sample contestants" in the toolbar for any contest) opens a dialog with 7 invented contestants. Every field can be edited, rows removed, and the whole set reshuffled. Nothing is saved until "Add N contestants", which sends exactly the rows on screen to `POST /api/contestants/batch`.
- **All or none:** one multi-row `INSERT`, so a failure adds nothing. Code uniqueness is left to the existing unique constraint; on a clash, the rows whose codes are taken are reported with who holds each code, and the dialog marks those rows and keeps everything else as typed.
- **Names:** 40 invented names written by hand into `lib/sample-contestants.ts`: no real people (CLAUDE.md), no name API. A draw skips names the contest already has, ignoring case.
- **Codes:** the first letter of the contest's name ("Spring Heats" gets S1, S2, …; C when the name has no letter), skipping codes already taken, so filling a contest that has contestants still works.
- **Colours:** hues spaced 360/n apart from a random start, a lighter start colour and a deeper end colour 28° further round, like the seed's gradients. Spacing, not randomness, is what keeps 7 bars telling apart.
- **Avatars:** the same generated DiceBear illustrations as the seed and the contestant form, from the final name, so an edited name gets a matching avatar.
- **Generated in the browser:** the draw is a pure function, so Reshuffle needs no round trip and the server only ever validates what it's sent.
**Alternatives:** filling the existing one-contestant form (doesn't fit 7); saving samples straight away with no review (the request was to review first); random colours (neighbours often look alike).

## F27 — How the done-when was verified
Headless Chrome through the pages, on a fresh contest "Spring Heats F27". 16 of 16 checks passed:
- **One click:** its empty contestants page offered "Fill with sample contestants"; one click showed 7 rows, S1–S7, 7 different names with countries, avatars loaded, and nothing in the database yet. Reshuffle drew a different set.
- **Exactly what was on screen:** renamed row 1, removed row 7, set row 3's code to row 2's: refused with the row marked ("S2 is already used by row 2."), nothing added. Changed it to S9 and submitted "Add 6 contestants": the 6 rows in Postgres matched the screen field for field (code, name including the edit, country, both colours, the avatar for the name).
- **Taken code:** a second draw skipped the contest's codes and names (S3, S7, S8, S10–S13). Setting one to `s1` was refused with that row marked ("S1 is already used by Marigold Testwell in this contest."); none of the 7 added.
- The draft was deleted afterwards (204, contestants gone).
- Tests: `sample-contestants.test.ts` (7 valid rows, codes and names skip taken ones, hue gaps ≥ 360/7 − 3°, HSL → hex), `contestant-admin.test.ts` (all or none, which row and who holds the code), and the batch contract (a repeated code points at the second row).
- The check script clicked before the page had hydrated at first, so the click did nothing; it now clicks until the dialog responds.

## F28 — Recap in the browser: one component, played by Remotion's player
**Decided:** the recap composition (`Recap.tsx`), its data type and the Postgres exporter moved from `tools/recap` into `packages/recap-video`, used by both `pnpm recap` (which still renders the MP4) and the web app. `/admin/recap/[contestId]` plays it with `@remotion/player`, and each non-draft contest on `/admin/contests` has a "Recap" link.
- **No API route,** unlike the plan: the page is a server component that calls `exportRecap` itself and passes the data to the player, and Refresh (shown for open contests only) re-runs it with `router.refresh()`. That's the same data with one fewer endpoint to guard; the page is admin-only through the proxy and `requireAdmin`.
- **Browser-safe entry:** the package's main export holds the component, the timing constants and the data *type*, with no zod or database code. The props schema (`/data`, zod 4.5.4 for Remotion's composition) and the exporter (`/export`) are separate entry points, used by the CLI and the server page only.
- **Remotion stays off other pages:** it loads only on the recap route. Checked by fetching every script on a results page: none mention Remotion.
- **Nothing to recap:** a contest with no votes shows a sentence saying so and how to fix it, rather than an empty race, which is what `pnpm recap` produced after `pnpm reset:votes`.
- **`pnpm contests`** (`packages/db`, `listContests`): every contest newest first with ID, name, status, contestants (active of all), counted votes from `vote_totals`, and when it opened and closed.
- `acknowledgeRemotionLicense` is not set on the player: Remotion is free for individuals and companies of up to 3 people; the prop only silences a console notice, and accepting the licence is the owner's call.
**Alternatives:** rendering MP4s on the server (a worker using every core for about 50 s per render, plus file storage the no-local-disk rule would push to object storage); a copy of the composition in the web app (the page and the MP4 would drift).

## F28 — How the done-when was verified
Headless Chrome, signed in, against "Tally Showcase" (closed, 980,508 votes). 12 of 12 checks passed:
- **From /admin/contests:** its Recap link opened `/admin/recap/<id>` with the player paused and its controls; the header showed 980,508 votes and 10 contestants, and no Refresh (closed).
- **Plays:** pressing play, the intro showed the contest's name, the clock advanced every second to 0:29 of 0:32, and the winner reveal showed Postgres's top contestant with their votes (Felix Arnhald, 228,365).
- **Same as the MP4:** `pnpm recap` rendered the same contest (1080p, 32 s, 71 race steps). Its frame at 30 s and the player paused at 0:31 show the same winner screen: portrait, name, 228,365 votes, 23.3%, "41,048 ahead of Eska Morrowdal".
- **Elsewhere:** "Tally Finals" (no votes after the reset) says there's nothing to recap; an invalid ID gives 404; signed out redirects to login; a results page loads no Remotion code.
- `pnpm contests` listed all four contests with their votes, showing at once that "Tally Finals" is empty. The exporter's tests moved with it and pass; `listContests` has one of its own.

## Plan — Counting backlog (F29)
**Why:** after a long generator run is stopped, totals keep rising for a while as the queue drains, and nothing tells the operator or viewers how much is left, so they watch the numbers until they stop.
**Decided:** the consumer measures its own lag every second (`getLag` in `@platformatic/kafka`: high watermark − committed offset per partition) and its rate, and writes them to a Redis hash `tally:backlog` that expires after 10 s. The gateway adds a `backlog` field to its frames, the generator status API adds it for `/control`, and both parse it with one `parseBacklog` in contracts. Shown on the generator panel (waiting, rate, time left) and as a counting line on results pages, per the user.
- **Why lag is the right number:** offsets are committed only after a batch is in Postgres and Redis, so lag is exactly the votes accepted but not yet counted. It includes votes that will become dead letters, so the wording says "being counted".
- **Several consumers:** each writes only its own partitions' fields and its own rate field, and readers sum them, so the figure stays right if the consumer is scaled out (F34–F36). The expiry makes it disappear when no consumer runs, which the panel shows as "Counting paused".
- **Redis rule:** the hash is derived from Redpanda and rewritten every second, so nothing exists only in Redis.
- **Scope, system-wide, and two live contests:** `votes.raw` is partitioned by vote code, not by contest, so lag can't be split by contest without extra bookkeeping. With two contests live at once, both results pages show the same combined number. A contest that has closed can show "counting" while another contest's votes are still draining, even when all of its own votes are in. The results line says "queued votes", and its tooltip says the figure covers all live contests. The user accepted this, with the note.
**Alternatives:** per-contest backlog (the consumer would track each contest's position in the queue; deferred until two simultaneous contests matter); reading Prometheus (optional, and can be stopped); a Kafka client in the gateway or web (the gateway is Redis-only by design, and web would carry a second Kafka client for one number).

## F29 — Counting backlog: the consumer reports its own lag
**Decided,** as planned, with these details settled while building:
- **Measured by the consumer:** `@platformatic/kafka`'s `getLag` = the latest offset per partition − the offset last committed. The consumer commits by hand after each batch, and the library updates its committed offsets on those manual commits too (checked in its source), so the number is exactly "accepted, not yet counted".
- **Per-field expiry (`HEXPIRE`, Redis 7.4+; we run 8.8):** every field (`lag:<p>`, `rate:<instance>`, `updatedAt`) lives 10 s after its last write. A whole-hash expiry would keep a stopped replica's fields alive for as long as any other replica writes; per-field expiry drops exactly the silent one's. Readers also treat anything older than 5 s as unknown.
- **Nothing before partitions:** while a consumer is still joining the group it owns no partitions, and it writes nothing rather than "0 waiting".
- **Rate:** votes committed per second over the last ~5 s, per consumer, summed by readers. Time left = waiting ÷ rate, rounded up so it never says "done" early; no estimate while the rate is 0.
- **One `parseBacklog` in contracts,** used by the gateway (live frames) and web (`/api/generator/backlog`), so the panel and the results page can't disagree.
- **Results page:** the line sits under the vote count ("Counting 41,068 queued votes · about 5 s"), amber, with a dot that pulses (steady under reduced motion), shown only while the connection is live; hidden at 0 and when unknown, so a dead consumer never leaves a frozen number on a public screen. The operator sees "Counting paused" on the panel instead.
- **Two live contests** (recorded in the plan entry above): the figure is the whole queue, the same on both pages.

## F29 — How the done-when was verified
Headless Chrome with two tabs (the panel, signed in, and the Tally Showcase results page), the generator, Redpanda's own numbers and Postgres. 11 of 11 checks passed:
- **Empty queue:** the panel said "All counted"; the results page showed no line.
- **Consumer stopped:** generator at 3,000/s; after 8 s the consumer container was stopped. The panel switched to "Counting paused" and the results line stayed hidden. 20 s later the generator stopped: 80,276 accepted, 56,068 waiting per `rpk group describe tally-consumer`.
- **Draining:** consumer started again. The panel showed 41,068 waiting while `rpk` read 37,568 a moment later, at 8,929 votes/s: within half a second of counting. The results page showed "Counting 41,068 queued votes · about 5 s", falling 41,068 → 35,568 → 29,568 → 23,068 → 16,568 → 10,068 → 3,568, then gone after 6 s. The panel said "All counted", and Postgres held exactly 80,276 more votes.
- **Changed from the plan's wording:** the plan said "after a 60 s run at 3,000/s". With the consumer running, 3,000/s drains within a second of stopping (lag stays under ~1,000), so there'd be almost nothing to watch. Stopping the consumer mid-run builds a real queue, and exercises "Counting paused" in the same run.
- Tests: `backlog.test.ts` in contracts (sums, rounding, stale, unknown) and in the consumer (fields written, per-field expiry, two replicas adding up, nothing before partitions, rate window), the gateway (backlog in the snapshot; a change alone sends an update; unchanged sends nothing; gone → null), and `backlog-text.test.ts` (the wording).

## Plan — UI polish (F30)
**Why:** the user walked through a real contest and found three rough edges: a long contest name pushed the vote count onto its own line; admin times were in UTC; and closing a contest moved its row in the list.
**Decided,** from options the user chose between:
- **Long names:** a two-column header. The name shrinks in steps by length, wraps at most 2 lines and shows in full on hover; the count never leaves the right. Rejected: always putting the name on its own row (costs height for every contest), or only right-aligning the wrapped count (the name would still dwarf everything).
- **Times:** the viewer's local zone, "x min ago" within a day, UTC in the tooltip. The zone travels in a cookie so server-rendered pages already show local time. Otherwise the server (UTC) and the browser (local) would render different text, which is why dead letters used UTC in the first place. Rejected: a time-zone setting (more UI than a single operator needs), and local time without relative times (the user preferred "12 min ago" for recent events).
- **Order:** newest first everywhere, with status filter chips on `/admin/contests` and status headings in pickers. A row's position no longer depends on its status. Rejected: pinning live contests in a separate section (rows would still move, just on the next load), and sortable columns (more than the problem needs).

## F30 — UI polish: what building it turned up
**Built as planned:** the two-column results header with three title sizes; local times through a `tz` cookie, a `TimeProvider` in new `app/admin` and `app/control` layouts, and `<Time>` / `<ClockTime>`; newest-first contests with filter chips and grouped pickers (`ContestOptions`, one component for all three pickers). `pnpm contests` shows the machine's zone.
- **A server component can't import a value from a `'use client'` module.** The cookie name lived next to the client component that writes it, and the server layout imported it from there. On the server that import is a client reference, not the string `"tz"`, so `cookies().get()` found nothing and every time stayed in UTC, with no error. The constant now lives in `lib/time.ts`, which both sides import.
- **`history.replaceState` must be given `null`, not `window.history.state`.** Passing Next's own state object back stopped its router from learning the new URL, so the next `router.refresh()` (after closing a contest) put the old URL back and the `?status=` filter was lost. The F24 List/Grid toggle had the same latent bug: a refresh on the results page, such as when a contestant is added, would have dropped `?view=grid`. Both now pass `null`, as the Next docs show.
- **The cookie is written unencoded** (IANA names are cookie-safe) and decoded defensively on the server; an unknown zone falls back to UTC, and the client doesn't keep refreshing when the server disagrees.
- **Relative times without a hydration mismatch:** the server renders with its own clock, the browser's first render reuses that exact `now`, then switches to its own clock and ticks every 30 s.
- **A filtered list keeps what it matched:** closing a contest while viewing "Open" leaves its row until the filter changes (checked: the row stays; after a reload it's gone).

## F30 — How the done-when was verified
Headless Chrome with its time zone set to `Africa/Addis_Ababa`, signed in, starting with no `tz` cookie. 25 of 25 checks passed:
- **Long names:** a draft named "Ethiopian-got-talents-final-competition" (39 characters, from the user's screenshot): at 1,400 px one line at 36 px, the count on the same row and flush right; at 390 px two lines at 24 px, the count under the name, no sideways scroll. "Tally Showcase" at 56 px and 34 px, same behaviour, full name in the tooltip. The draft was deleted afterwards.
- **Times:** the first page wrote `tz=Africa/Addis_Ababa`. The user's contest read "46 min ago" and "35 min ago", with the tooltip "Thu, 24 Sept 2026, 18:05:59 GMT+3 · 2026-09-24 15:05:59 UTC"; no hydration warning or error in the console; a minute later it read "36 min ago" without a reload.
- **Order:** newest first matched the database; closing and reopening Tally Showcase left every row where it was; chip counts matched; "Open" filtered and set `?status=open`; closing a contest under "Open" kept its row; after a reload the filter held and the closed contest was gone.
- **Also:** the List/Grid toggle still switches without a navigation and holds after a reload; the generator's picker lists Open, Draft, Closed groups.
- Tests: `time.test.ts` (relative boundaries, zones including Asia/Kolkata's half hour, clock time with ms, bad zones → UTC) and `titleSize`.

## Plan — Lively UI (F31)
**Why:** the user wants the app to feel lively, and asked what a redesign guided by the `emilkowalski/skills@apple-design` skill would look like, without copying Apple's look.
**Decided:** use the skill for its motion rules only: critically damped springs, motion that is interruptible and starts from where it is, feedback on pointer-down, translucent materials for floating chrome, type details, and respect for reduced motion and transparency. Tally keeps its scoreboard identity. Every animation comes from the data (votes arriving, an overtake, the backlog draining) or the operator's action, and runs on shared presets in `lib/motion.ts`, so the whole app moves alike. The existing rules still hold: counters retarget, reorders go through the layout system, and list and grid are one component (which gives the List ↔ Grid morph for free).
**Alternatives:** a visual restyle modelled on Apple (system font, light theme; the user said they don't want to mimic Apple); `dickwu/apple-design-skill` as well (a Human Interface Guidelines reference for review, about look more than liveliness); ad-hoc animations per component (inconsistent timing, and the kind of per-update animation that stutters).

