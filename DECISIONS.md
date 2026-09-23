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
| Redis sync (SPEC §5 keys, plan F5) | "increment the Redis counter"; `tally:idem:{key}` string, 1 h TTL, as a redelivery guard | Redis is **set** to absolute totals read back from Postgres (upward only, via Lua). No `tally:idem:*` keys: Postgres's unique `idempotency_key` is the only dedupe | F5 |
| Unresolvable votes (plan F6, SPEC §5 `contestant_id` null = unresolved) | dead-lettering is F6; unresolved votes could sit in `votes` with a null contestant | F5 writes them to `dead_letters` (`unknown_code` / `malformed`); `votes.contestant_id` is never null in practice. F6 adds publishing to `votes.dead` | F5 |
| `dead_letters` columns (SPEC §5) | id, raw payload, reason, received_at | plus a unique, nullable `idempotency_key` (the vote's key, or `offset:topic/partition/offset`) so replays don't duplicate dead letters | F5 |

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
