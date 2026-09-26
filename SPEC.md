# Tally — Technical Specification

The system as built on `main`. Why each part is the way it is, and what else was considered, is in `DECISIONS.md`, by feature (F-number).

A real-time voting platform that ingests high-volume vote traffic, counts it through a message queue, and shows live results with animated counters. A portfolio project modelled on a production SMS voting system built for a live televised contest; a controllable Go load generator stands in for the telecom feed.

---

## 1. Goals

**Primary:** show event-driven architecture, real-time data flow and a high-quality animated UI in one coherent, demonstrable project.

**Secondary:** reproducible throughput numbers (1,000 votes/s sustained, bursts to 3,000+); operational and analytical workloads kept apart; a shareable demo video.

**Non-goals:** real SMS integration, multi-tenancy, production-grade auth, mobile apps.

---

## 2. Decisions

| Area | Decision |
|---|---|
| Contest model | Generic: a contest has contestants, each with a code voters send |
| Vote rules | Unlimited votes per voter |
| Surfaces | Public results boards; operator pages (generator panel, admin, analytics, recap) |
| Admin auth | One shared password from the environment, signed session cookie |
| Languages | TypeScript everywhere; the load generator is Go |
| Queue | Redpanda (Kafka API) |
| Stores | Postgres (truth), Redis (live totals), ClickHouse (analytics) |
| Metrics | Every service serves `/metrics`; Prometheus and Grafana in compose |
| Scaling | Ingest and consumer replicas in compose (`INGEST_REPLICAS`, `CONSUMER_REPLICAS`); the generator can run on a second machine |
| Deployment | Docker Compose; a hosted deployment and Kubernetes are optional (`IMPLEMENTATION_PLAN.md`) |

---

## 3. Architecture

```
Write:      Generator (Go) → ingest → Redpanda votes.raw → consumer → Postgres + Redis
                                                                   ↘ Redpanda votes.dead
Read:       Redis → gateway → WebSocket → browser
Analytics:  votes.raw + votes.dead → analytics-consumer → ClickHouse → analytics page
```

The analytics consumer has its own consumer group: if it stalls, live results are unaffected, and it catches up.

**Principles**
1. **The ingest path stays thin.** Validate, hash the sender, publish, return 202. No database access in the request path.
2. **The queue is the shock absorber.** Bursts grow the backlog instead of failing requests.
3. **The log is replayable.** A consumer bug is fixed by correcting the code and replaying.
4. **Postgres is truth, Redis is speed.** Redis is rebuilt from Postgres whenever the consumer starts.
5. **Nothing is silently dropped.** Anything that can't be counted goes to `votes.dead` with a reason.
6. **12-factor.** Config from the environment, no local disk state, `/health` and graceful SIGTERM on every service.

---

## 4. Services

| Service | Stack | Port | Responsibility |
|---|---|---|---|
| `web` | Next.js | 3000 | Results boards, operator pages, the web API |
| `ingest-proxy` | nginx | 4000 | The one entry point for votes: spreads requests over the ingest replicas |
| `ingest` | Fastify | 4000 (inside) | Validate, hash, publish votes; `INGEST_REPLICAS` copies |
| `gateway` | Node | 4001 | Poll Redis, push totals over WebSocket |
| `generator` | Go | 4002 | Synthetic vote load, HTTP control API |
| `consumer` | Node | 4003 inside (`/health`, `/metrics`) | Count into Postgres and Redis, dead-letter the rest; `CONSUMER_REPLICAS` copies share the partitions |
| `analytics-consumer` | Node | 4004 (`/health`, `/metrics`) | Copy both topics into ClickHouse |

Infrastructure: Redpanda (9092 in the compose network, 19092 from the host), Postgres 5432, Redis 6379, ClickHouse 8123, Prometheus 9090 (finds every replica through DNS), Grafana 3001.

**Replicas** publish no host port, so compose can scale them. nginx re-reads the ingest replicas from Docker's DNS every 5 s and keeps connections to them open. Consumers split the partitions of one consumer group; when the partition count changes, compose restarts them so they're assigned the new ones.

**Two-device mode:** with `COMPOSE_FILE=compose.yaml:compose.two-device.yaml` and `GENERATOR_HOST` set, no local generator runs, and web and Prometheus reach the one on that machine as `generator`. `pnpm generator:exe` builds it as a Windows program, which needs neither Docker nor Go there.

---

## 5. Data model

Postgres, via Drizzle (`packages/db`); migrations in `infra/migrations`.

**`contests`**: `id` uuid, `name` (unique ignoring case), `status` (`draft` / `open` / `closed`), `opens_at`, `closes_at`, `created_at`. Opening and closing stamp `opens_at` / `closes_at` from the database clock under a row lock; a vote counts only if ingest accepted it inside that window. Reopening starts a new window; a draft counts nothing.

**`contestants`**: `id`, `contest_id` (FK), `name`, `code` (unique per contest, fixed once created), `image_url`, `accent_from` / `accent_to` (hex, the card gradient), `country_code` (ISO alpha-2, optional flag), `active`, `created_at`. Contestants with votes are deactivated, never deleted.

**`votes`** (append-only): `id` bigserial, `contest_id` and `contestant_id` (FKs), `code_submitted`, `voter_hash` (HMAC-SHA256 of the trimmed sender, keyed by the salt; **raw identifiers are never stored**), `source` (`sms` / `web` / `generator`), `idempotency_key` (unique: the only dedupe), `received_at` (when ingest accepted it). Indexed on `(contest_id, received_at)`.

**`vote_totals`**: `contestant_id` (PK, FK), `total`, `updated_at`.

**`vote_buckets`**: `(contestant_id, bucket_minute)` PK, `count`. The minute is when ingest accepted the vote; buckets are written in the same transaction as the votes, from newly inserted votes only, so they always sum to `vote_totals`.

**`dead_letters`**: `id`, `payload` jsonb (the message as received), `reason` (`unknown_code`, `inactive_contestant`, `contest_closed`, `malformed`), `contest_id` (nullable, no FK), `idempotency_key` (unique, nullable: the vote's key, or `offset:topic/partition/offset` for a malformed message), `received_at`.

**Redis** (key builders in `packages/contracts`, `redisKeys`):
```
tally:{contestId}:totals    hash  contestantId → total
tally:{contestId}:meta      hash  totalVotes, lastUpdated, lastMinute (consumer); status (web)
tally:{contestId}:minutes   hash  minute (epoch ms) → the contest's votes that minute
tally:{contestId}:contestant-minutes   hash  "<minute>:<contestantId>" → that contestant's votes that minute
tally:backlog               hash  lag:<partition>, rate:<instance>, updatedAt; each field expires 10 s after writing
```
The consumer writes per-contestant values, read back from rows its own transaction has locked, so they're exact. A Lua script sets them only if higher, then sums the contest's `totalVotes` and each minute from them, atomically. Sums read in Postgres by concurrent consumers would miss each other's uncommitted votes. Because every value is absolute and only goes up, a redelivered batch can't double-count and a missed write heals on the next one. `tally:backlog` is the consumers' own lag, rewritten every second and summed across consumers by readers.

**ClickHouse** (`services/analytics-consumer/src/schema.ts`, versioned migrations applied at startup): `votes_raw` and `votes_dead`, rows as delivered (at-least-once). Readers count votes as `uniqExact(key_hash)` (`key_hash = cityHash64(idempotency_key)`); counted = accepted − rejected. No rollup tables.

---

## 6. Events

Both topics have `TOPIC_PARTITIONS` partitions (default 24), created, and raised when the setting grows, by a one-shot `rpk` job; services never create topics. Partitions can be added, never removed. Messages are keyed by the vote's idempotency key (Java-compatible murmur2), so votes spread evenly over the partitions whoever is winning, and a retry lands where the first try did. Nothing depends on per-contestant order: totals are sums, Redis only accepts higher values, and closing goes by acceptance time.

```json
{
  "v": 1,
  "event_id": "uuid",
  "contest_id": "uuid",
  "code": "C7",
  "voter_hash": "hmac-sha256 hex",
  "source": "generator",
  "sent_at": "2026-01-01T12:00:00.000Z",
  "idempotency_key": "the Idempotency-Key header, or a generated UUID"
}
```

`code` is trimmed and uppercased at ingest and must match `^[A-Z0-9]{1,16}$`; `sent_at` is when ingest accepted the vote.

`votes.dead` carries `{ "v": 1, "reason", "failed_at", "idempotency_key", "original" }`, where `original` is the message as received (parsed JSON, or `{ "raw": "…" }`). A redelivered batch republishes its dead letters with the same key and `failed_at`. Keyed by the dead letter's idempotency key.

Schemas are Zod, once, in `packages/contracts`. The Go generator mirrors its structs; a contract test compares them with JSON Schemas exported from Zod.

---

## 7. APIs

### Ingest
```
POST /votes    { contestId, code, sender, source }   optional header Idempotency-Key (1–128 visible ASCII)
GET  /health   → { status: "ok" | "degraded", service, redpanda: "connected" | "disconnected" }
GET  /metrics
```
- **202** `{ eventId, idempotencyKey }`, sent only once Redpanda has acknowledged the write (`acks=all`, idempotent producer, 5 ms micro-batches). 202, not 200: the vote is accepted, not yet counted.
- **400** `{ error: "invalid_request", issues: [{ path, message }] }`; **413** over 4 KB; **415** not JSON; **503** when publishing fails or takes over 5 s, and from `/health` while the broker is unreachable.

Every service's `/health` returns the shared `HealthResponse` (`status`, `service`, plus its own dependencies).

### Gateway
```
WS /live?contestId=…
  → { type: "snapshot", … }    on connect and every reconnect
  → { type: "update", … }      when anything changed
  → { type: "heartbeat", ts }  every 15 s
```
Snapshots and updates carry `contestId`, `ts`, `totals` (`[{ contestantId, total }]`, absolute; an update holds only those that changed), `totalVotes`, `status` (or null), `minutes` (`{ minute, count }`: the 30-minute window in a snapshot, changed minutes in an update), `minutesTo`, and `backlog` (`{ pending, perSec, etaSec }` across all contests, or null when no consumer reports). A change in status or backlog alone sends an update.

Redis is polled once per watched contest every 250 ms, however many viewers. Close codes: `4400` invalid `contestId`, `1001` shutdown, `1011` first read failed. Clients treat 35 s of silence as a dead connection and reconnect forever with jittered backoff (0.5 → 10 s). Names and colours come from the web app, not the gateway. `GET /debug` serves a bare inspector page.

### Generator (Go)
```
POST /start   { contestId, codes, ratePerSec, invalidCodeRatio, duplicateSenderRatio }
POST /rate    { ratePerSec }                   change a running generator's rate
POST /burst   { ratePerSec, durationSec }
POST /stop
GET  /status  → running, contestId, baseRate, currentRate, burstEndsAt, startedAt, sentTotal,
                accepted, rejected, failed, invalidSent, duplicateSent, latencyMs
```
Rates are 1–20,000/s. `/start` while running, and `/rate` or `/burst` while stopped, are 409. The generator never reads the database: `/start` is given the codes. Shapes are the `Generator*` schemas in contracts.

### Web API (session-checked, except `/health` and `/metrics`)
```
POST   /api/generator/start | rate | burst | stop,  GET /api/generator/status | backlog
POST   /api/contests                       create a draft (409 when the name is taken)
DELETE /api/contests/:id                   drafts only (results are never deleted)
POST   /api/contests/:id/status            { status: "open" | "closed" }
GET / POST /api/contestants, PATCH /api/contestants/:id, POST /api/contestants/batch (1–20, all or none)
GET    /api/dead-letters, /api/dead-letters/counts
GET    /api/analytics/:contestId           ClickHouse only
```
- Browsers never call the generator: the panel goes through `/api/generator/*`, and `/start` reads the contest's active codes from Postgres.
- Status transitions: draft → open, open → closed, closed → open; anything else 409. Opening needs an active contestant. Closing stamps the cut-off; votes accepted before it still count.
- A contestant's code can't change; `{ active: false }` deactivates. Later votes for it are dead-lettered as `inactive_contestant`.
- Dead letters are keyset-paginated, newest first (`{ items, older, newer }`), filterable by contest and reason.

---

## 8. Non-functional requirements

| Requirement | Target | Measured (laptop, whole stack) |
|---|---|---|
| Sustained throughput | 1,000 votes/s | met: p95 7.0 ms, no loss |
| Bursts | 3,000+ votes/s | met at F19 (p95 14–20 ms); k6 now 70–107 ms with ClickHouse, analytics and metrics on the same laptop (`DECISIONS.md`, F23) |
| Ingest p95 | under 50 ms | as above |
| Vote to screen | under 1 s | met |
| Durability | zero loss | met: every run reconciles |
| Recovery | totals rebuildable from the log | `pnpm reconcile [--repair]`; Redis rebuilt at every consumer start |

Performance targets apply to the data pipeline (ingest → queue → consumer → gateway), not to how the board renders at the generator's maximum rate. `pnpm load <smoke|steady|spike>` runs k6 inside the compose network (through nginx) and checks zero loss and reconciliation; reports in `load-results/`.

**Scaling on one laptop** (4 cores): the whole pipeline tops out near 4,700 votes/s however the replicas are split, since each added consumer takes CPU from intake. What more consumers buy on one machine is a board that keeps up: with 3, no backlog forms. The generator on a second machine over Wi-Fi was capped by its round trip (256 workers at 56–87 ms). Details are in `load-results/`.

---

## 9. Frontend

**Stack:** Next.js, Tailwind, shadcn/ui, Motion, Recharts. Springs and durations come from `apps/web/lib/motion.ts`; only `transform` and `opacity` move on the board.

**Results board** (`/results/:contestId`, `?view=list|grid`):
- **Counters retarget, never restart:** each total is a new target for the same overdamped spring, so four updates a second read as one continuous climb and a count never overshoots.
- **Overtakes glide:** rows reorder through the layout system; an overtaking row lifts, glides and settles, and its rank rolls.
- **One component, two layouts:** the card grid is the list row with a layout flag, so switching never remounts anything.
- **Live details:** "+N" rising as votes land, a LIVE dot beating at the vote rate, votes per minute (Recharts), the counting backlog ("Counting N queued votes · about 8 s"), connection state with automatic reconnect (the last totals stay, dimmed).
- **The stage:** the board sits on a drawn TV-show stage: an LED wall in the leader's colours, rig lamps, two searchlights and a crowd in silhouette. The lights follow the contest (`lib/lighting.ts`): dark before opening; swaying at a tempo set by the vote rate; crossing on a new leader; and, once voting has closed **and every queued vote is counted**, the finale: gold confetti (about 9 s, once, in the winner's colour) while the beams wander. A page loaded after that shows the finale without confetti. The queue is shared by all contests, so this assumes one contest votes at a time.
- **The podium:** the first three places with votes stand out: taller list rows with gold, silver and bronze, and a row of their own in the grid (stacked on phones). Any number of contestants.
- **At the close** the "Final" badge replaces LIVE; the rows keep their look.
- **Reduced motion:** movement becomes fades or jumps; no confetti; the beams hold still.

**Operator pages** (plain look, behind the password): `/control` (generator panel: rate, bursts, delivered vs asked, the backlog draining), `/admin/contests` (create, open, close, reopen, delete drafts), `/admin/contestants` (add, edit, deactivate; "Fill with sample contestants" with invented names), `/admin/dead-letters`, `/admin/analytics` (ClickHouse only), `/admin/recap/:contestId` (the recap video in the browser). Times show in the viewer's zone.

**Recap video:** a closed contest as a 32 s video (bar race, final standings, winner), a Remotion composition in `packages/recap-video`, played in the browser or rendered to MP4 with `pnpm recap`.

**Images:** generated or illustrated avatars only; no photographs of real public figures.

---

## 10. Risks

| Risk | Mitigation |
|---|---|
| Counters stutter under rapid updates | Spring toward each target; never restart |
| Redis and Postgres totals drift | Absolute, upward-only writes; rebuild at start; `pnpm reconcile` |
| A late count changes the winner after the close | The finale waits for the backlog to empty |
| Running costs of a 24/7 multi-container demo | Local-first; the demo video carries the portfolio |
| Scope creep | Every feature ends shippable |
