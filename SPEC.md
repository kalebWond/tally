# Tally — Technical Specification

> Notes marked *Changed* or *Decided* show where the build has diverged from or pinned down this spec. The full list, with reasons, is in `DECISIONS.md` under "Changes to the spec and plan".

A real-time voting platform that ingests high-volume vote traffic, aggregates it through a message queue, and displays live results with animated counters.

Portfolio project modelled on a production SMS voting system built for a live televised contest. The telecom SMS feed is replaced by a controllable load generator.

---

## 1. Goals

**Primary:** Demonstrate event-driven architecture, real-time data flow, and high-quality animated UI in one coherent, demonstrable project.

**Secondary:**
- Publish reproducible throughput numbers (target: sustained 1,000 votes/sec, bursts to 3,000+)
- Show operational vs. analytical workload separation
- Produce a shareable demo video

**Explicit non-goals for v1:** real SMS integration, multi-tenancy, production-grade auth, mobile apps.

---

## 2. Decisions Made

| Area | Decision |
|---|---|
| Contest model | Generic and configurable — not tied to a theme |
| Vote rules | Unlimited votes per voter |
| Surfaces | Public results, generator control panel, admin |
| Admin auth | Shared password from environment variable |
| Results display | Ranked list in v1; card grid in a later phase |
| Generator language | Go |
| Everything else | TypeScript |
| Queue | Redpanda (Kafka API compatible) |
| Analytics store | ClickHouse — later phase |
| Metrics stack | Prometheus + Grafana — later phase, metrics exposed from day one |
| Deployment | Local Docker Compose first; host chosen later |
| Kubernetes | Optional final phase, additive only |

---

## 3. Architecture

### Write path

```
Generator (Go) → Ingest API → Redpanda (votes.raw) → Consumer → PostgreSQL + Redis
                                                            ↘ Redpanda (votes.dead)
```

### Read path

```
Redis → Gateway → WebSocket → Browser UI
```

### Analytics path (later phase)

```
Redpanda (votes.raw) → Analytics consumer → ClickHouse → Analytics page
```

The analytics consumer runs in a **separate consumer group**, so it reads the same stream independently. If it stalls, live results are unaffected.

### Design principles

1. **The ingest path stays thin.** Validate shape, hash the sender, publish. No database access on the hot path.
2. **The queue is the shock absorber.** Bursts grow the backlog rather than failing requests.
3. **The log is replayable.** A consumer bug is fixed by correcting the code and replaying from offset zero.
4. **Postgres is truth, Redis is speed.** Redis can be rebuilt entirely from the Postgres vote log.
5. **Nothing is silently dropped.** Unresolvable codes go to a dead-letter topic with a reason.
6. **12-factor from day one.** Config via environment variables, no local disk state, `/health` on every service, graceful SIGTERM shutdown. This is what makes the Kubernetes phase purely additive.

---

## 4. Services

| Service | Language | Port | Responsibility |
|---|---|---|---|
| `web` | Next.js / TS | 3000 | Results, admin, generator control UI |
| `ingest` | Fastify / TS | 4000 | Validate and publish votes |
| `consumer` | Node / TS | 4003 | Aggregate into Postgres + Redis. *Decided (F1): port serves `/health` only* |
| `gateway` | Node / TS | 4001 | Poll Redis, broadcast over WebSocket |
| `analytics-consumer` | Node / TS | — | Batch insert into ClickHouse (later) |
| `generator` | Go | 4002 | Produce synthetic vote load, HTTP control API |

Infrastructure: Redpanda 9092, PostgreSQL 5432, Redis 6379, ClickHouse 8123.

---

## 5. Data Model

### `contests`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| name | text | |
| status | enum | `draft` / `open` / `closed` |
| opens_at | timestamptz | nullable |
| closes_at | timestamptz | nullable |
| created_at | timestamptz | |

### `contestants`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| contest_id | uuid FK | |
| name | text | |
| code | text | unique per contest; what voters send |
| image_url | text | nullable — used by card view |
| accent_from | text | hex, nullable — card gradient start |
| accent_to | text | hex, nullable — card gradient end |
| country_code | text | nullable — ISO 3166-1 alpha-2, optional flag |
| active | boolean | |
| created_at | timestamptz | |

### `votes` (append-only)
| Column | Type | Notes |
|---|---|---|
| id | bigserial PK | |
| contest_id | uuid FK | *Changed (F2): FK added* |
| contestant_id | uuid FK | nullable — null means unresolved. *Changed (F2): FK added. Changed (F5): unresolved votes go to `dead_letters` instead, so this is never null in practice* |
| code_submitted | text | raw code as sent |
| voter_hash | text | ~~SHA-256 of sender identifier + salt~~ *Changed (F3):* HMAC-SHA256 of the trimmed sender, keyed by the salt. **Never store raw identifiers.** |
| source | enum | `sms` / `web` / `generator`. *Decided (F2): Postgres enum built from the contracts Zod enum* |
| idempotency_key | text | unique — guards against queue redelivery. *Changed (F3): may come from the client's `Idempotency-Key` header, so not always a UUID* |
| received_at | timestamptz | |

Index on `(contest_id, received_at)` and unique index on `idempotency_key`.

### `vote_totals`
| Column | Type | Notes |
|---|---|---|
| contestant_id | uuid PK, FK | *Changed (F2): FK added* |
| total | bigint | |
| updated_at | timestamptz | |

### `vote_buckets`
| Column | Type | Notes |
|---|---|---|
| contestant_id | uuid | composite PK, FK. *Changed (F2): FK added* |
| bucket_minute | timestamptz | composite PK — truncated to the minute |
| count | integer | |

### `dead_letters`
Mirrors the `votes.dead` topic for the admin view: id, raw payload, reason, received_at.

*Decided (F2):* `id bigserial`, `payload jsonb`, `reason` enum (`dead_letter_reason`), `received_at timestamptz`. *Changed (F5):* plus a unique, nullable `idempotency_key` (the vote's key, or `offset:topic/partition/offset` for malformed messages) so replays never duplicate dead letters. Contestants with votes can't be deleted because of the FKs, so they are deactivated (`active = false`).

### Redis keys
```
tally:{contestId}:totals          hash    contestantId → count
tally:{contestId}:meta            hash    lastUpdated, totalVotes
tally:idem:{key}                  string  TTL 1h, redelivery guard
```

*Changed (F5):* no `tally:idem:*` keys. Postgres's unique `idempotency_key` is the only dedupe, and the consumer **sets** `totals` and `meta.totalVotes` to absolute values read back from Postgres (upward only, via a Lua script) instead of incrementing, so redelivery after a crash heals Redis. Key builders live in contracts (`redisKeys`).

---

## 6. Event Schema

Topic `votes.raw`, partitioned by `code` so all votes for one contestant stay ordered on one partition.

*Decided (F4):* 6 partitions on both topics, Java-compatible murmur2 key hashing, and topics created by a one-shot `rpk` init job (services never auto-create them). *Decided (F3):* `code` is trimmed and uppercased at ingest and must match `^[A-Z0-9]{1,16}$`. `sent_at` is the time ingest accepted the vote. `idempotency_key` is the client's `Idempotency-Key` header when sent, otherwise a generated UUID.

```json
{
  "v": 1,
  "event_id": "uuid",
  "contest_id": "uuid",
  "code": "C7",
  "voter_hash": "sha256...",
  "source": "generator",
  "sent_at": "2026-01-01T12:00:00.000Z",
  "idempotency_key": "uuid"
}
```

Topic `votes.dead` carries the original payload plus `reason` (`unknown_code`, `contest_closed`, `malformed`) and `failed_at`.

*Changed (F6):* the message is an envelope, `{ "v": 1, "reason", "failed_at", "idempotency_key", "original" }`, where `original` is the message as received (the parsed JSON, or `{ "raw": "…" }` if it wasn't JSON). Delivery is at-least-once: a redelivered or replayed batch republishes its dead letters with the same `idempotency_key` and `failed_at`. Keyed by the original `code` when present.

All schemas are defined once as Zod schemas in `packages/contracts` and imported by every TypeScript service. The Go generator has a matching struct, kept in sync manually and covered by a contract test.

---

## 7. API Contracts

### Ingest
```
POST /votes        { contestId, code, sender, source }  → 202 Accepted
GET  /health       → { status, service, redpanda: "connected" }
GET  /metrics      → Prometheus format
```
Returns 202, not 200 — the vote is accepted for processing, not yet counted. Say this out loud in interviews.

*Decided (F3, F4):*
- An optional `Idempotency-Key` header (1–128 visible ASCII) becomes the event's idempotency key.
- 202 → `{ eventId, idempotencyKey }`, sent only after Redpanda acknowledges the write (`acks=all`).
- 400 → `{ error: "invalid_request", issues: [{ path, message }] }`. 413 for bodies over 4 KB, 415 for non-JSON bodies, and 503 when publishing fails or exceeds 5 s.

*Changed (F4):* `/health` returns `{ status: "ok" | "degraded", service, redpanda: "connected" | "disconnected" }`, with **503** while the broker is unreachable. Every service returns the shared `HealthResponse` (`status`, `service`).

### Gateway
```
WS /live?contestId=...
  → { type: "snapshot", totals: [...] }        on connect
  → { type: "update", changed: [...], ts }     on change
```
Only changed contestants are sent after the initial snapshot.

*Decided (F7):* both frames also carry `contestId`, `totalVotes` and `ts`. Totals are `[{ contestantId, total }]` with **absolute** values, and `changed` holds only contestants whose total differs from the previous frame. Close codes: `4400` invalid `contestId`, `1001` shutdown. Redis is polled once per watched contest every 250 ms. Contestant names and colours come from the web app, not the gateway. `GET /debug` serves a dev inspector page.

*Changed (F11):* the gateway also sends `{ "type": "heartbeat", "ts" }` every 15 s; a client that hears nothing for 35 s treats the connection as dead. Clients reconnect forever with jittered backoff (0.5 s → 10 s), and every reconnect starts with a fresh snapshot.

### Generator control (Go)
```
POST /start   { ratePerSec, contestId, invalidCodeRatio }
POST /burst   { ratePerSec, durationSec }
POST /stop
GET  /status  → { running, currentRate, sentTotal }
```

### Admin (web, shared-password protected)
```
GET/POST/PATCH /api/contestants
GET            /api/dead-letters
POST           /api/contests/:id/status
```

---

## 8. Non-Functional Requirements

| Requirement | Target |
|---|---|
| Sustained throughput | 1,000 votes/sec |
| Burst throughput | 3,000+ votes/sec |
| Ingest response time | p95 under 50ms |
| UI update latency | under 1s from vote to screen |
| Vote durability | zero loss under sustained load |
| Recovery | totals rebuildable by replaying the topic |

Verified with k6 against the ingest API; results published in the README.

---

## 9. Frontend Specification

**Stack:** Next.js, TypeScript, Tailwind, shadcn/ui, Motion, react-countup, Recharts. *Changed (F9): react-countup dropped; Motion drives counters.*

**Ranked list (v1)**
- Rows sorted by vote count, reordering with layout animation as positions change
- Numbers animate toward each new value rather than restarting on every update
- Rows visibly glide past each other on an overtake — this is the signature moment
- Connection state indicator; graceful reconnect with a fresh snapshot

**Critical detail:** the gateway pushes far more often than an animation takes to finish. Each incoming total must be treated as a **new target the animation springs toward**, not a new animation to start. Otherwise counters stutter under load.

*Changed (F9):* implemented with Motion's `useSpring` (retarget keeps velocity); react-countup is not used. The spring is overdamped so counts never overshoot or run backwards, and the first snapshot shows instantly.

**Card grid (later phase)**
Portrait, name, optional flag, live count, gradient from the contestant's two accent colours. Same data and component as the list; a layout flag switches arrangement.

Use generated or illustrated avatars. Do not use photographs of real public figures — likeness and IP issues on a public portfolio piece.

---

## 10. Risks

| Risk | Mitigation |
|---|---|
| Counter animation stutters under rapid updates | Spring-toward-target, not restart-on-update |
| Running costs of a 24/7 multi-container demo | Local-first; hosting decided later; demo video carries early portfolio weight |
| Redis and Postgres totals drift | Periodic reconciliation job; Postgres is authoritative |
| Portrait inconsistency makes the grid look cheap | Uniform aspect ratio, background and lighting treatment |
| Scope creep across many phases | Every phase ends shippable; stop at any phase boundary |
