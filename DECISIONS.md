# Decisions

Short entries: what was decided, the alternatives, and why. Newest at the bottom.

---

## Changes to the spec and plan

Where the build departs from `SPEC.md` or `IMPLEMENTATION_PLAN.md`, or pins down something they left open in a way that changes a documented contract. Each row's reasoning is in that feature's entries below. `SPEC.md` and `IMPLEMENTATION_PLAN.md` carry a short inline note at each affected spot.

### Changed: the build does something other than the document says

| Area | Spec / plan said | Now | Feature |
|---|---|---|---|
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
| Redis sync (SPEC §5 keys, plan F5) | "increment the Redis counter"; `tally:idem:{key}` string, 1 h TTL, as a redelivery guard | Redis is **set** to absolute totals read back from Postgres (upward only, via Lua). No `tally:idem:*` keys: Postgres's unique `idempotency_key` is the only dedupe | F5 |
| Unresolvable votes (plan F6, SPEC §5 `contestant_id` null = unresolved) | dead-lettering is F6; unresolved votes could sit in `votes` with a null contestant | F5 writes them to `dead_letters` (`unknown_code` / `malformed`); `votes.contestant_id` is never null in practice. F6 adds publishing to `votes.dead` | F5 |
| `dead_letters` columns (SPEC §5) | id, raw payload, reason, received_at | plus a unique, nullable `idempotency_key` (the vote's key, or `offset:topic/partition/offset`) so replays don't duplicate dead letters | F5 |
| `votes.dead` message shape (SPEC §6) | "the original payload plus `reason` and `failed_at`" | envelope `{ v: 1, reason, failed_at, idempotency_key, original }`; `original` is the parsed JSON, or `{ raw }` for non-JSON | F6 |

### Filled in: the document was silent, and the choice is now part of a contract

| Area | Decision | Feature |
|---|---|---|
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

### Outstanding: a rule not met yet

| Rule | Status |
|---|---|
| Graceful SIGTERM on every service (CLAUDE.md) | `apps/web` (Next.js standalone) exits 143 without draining. Revisit when web gets API routes (F13/F14) |

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
**Why:** one owner for schema changes, and it's the same shape as a Kubernetes Job or init step later. Seeding runs in the local stack only because it's idempotent and the demo needs data. A production deployment (F26) runs migrate alone.

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
**Why:** Next inlines `NEXT_PUBLIC_*` at build time, so changing the gateway host would mean rebuilding the image. That breaks "config from the environment" and F26's "deploy by configuration only". The value is the gateway as the *browser* sees it, so Compose sets `ws://localhost:4001` even for the containerised web app.

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
