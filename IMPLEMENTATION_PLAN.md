# Tally — Implementation Plan

Build one feature per session. Each has a goal, a build list, and a check that decides when it's done.

**Working rules**
- One feature per session. Don't start the next until the current one passes its check.
- Write the check before the code.
- Commit at every feature boundary, with the feature number in the message. *Changed (F3): the user commits, via the project skill `/feature-commit` (`F<n>: subject` plus a detailed body). F3's commit `a977aca` is the one conventional-format exception.*
- Log every non-obvious choice in `DECISIONS.md` — that file becomes the case study and the interview prep.
- Anything the spec doesn't cover is a question, not a guess.

---

## F1 — Monorepo and local stack

**Build:** pnpm workspaces with `apps/web`, `services/*`, `tools/generator`, `packages/contracts`. Docker Compose for Redpanda, Postgres, Redis. TypeScript config, linting, Vitest. `/health` endpoint scaffolded on each service. All config read from environment variables.

**Done when:** `docker compose up` brings the infrastructure up and every service's `/health` returns 200.

*Changed (F1):* `docker compose up` runs infrastructure only; `docker compose --profile app up` runs the full stack. `scripts/check-health.sh` is the check.

---

## F2 — Database schema and seed

**Build:** Drizzle migrations for `contests`, `contestants`, `votes`, `vote_totals`, `vote_buckets`, `dead_letters`. Seed script creating one open contest with 8–12 contestants and short codes.

*Decided (F2):* schema lives in a new `packages/db`, and migrations in `infra/migrations`. A one-shot `migrate` job (migrate + seed) runs in the `app` profile. FKs were added on `votes`, `vote_totals` and `vote_buckets`.

**Done when:** Migrations run from empty, the seed populates, and re-running the seed is safe.

---

## F3 — Ingest API

**Build:** `POST /votes` with Zod validation from `packages/contracts`. Hash the sender with a salt from the environment. Generate an idempotency key. Return 202. No database access.

*Changed (F3):* the hash is HMAC-SHA256, and a client `Idempotency-Key` header is honoured before generating one.

**Done when:** Valid payloads return 202, malformed ones return 400 with a useful message, and no raw sender identifier appears anywhere in logs or storage.

---

## F4 — Publish to Redpanda

**Build:** Create `votes.raw` with several partitions. Producer keyed on `code`. Retry with backoff. Ingest publishes and returns.

*Decided (F4):* 6 partitions, created (with `votes.dead`) by an `rpk` init job. 202 only after the broker acknowledges (`acks=all`, 5 ms micro-batches). Each publish is capped at 5 s, then 503. `/health` reports Redpanda status.

**Done when:** A posted vote appears on the topic (verify with `rpk topic consume`), and votes for the same code consistently land on the same partition.

---

## F5 — Consumer and totals

**Build:** Batch consumer. Resolve code to contestant. Insert into `votes`. Increment the Redis counter. Upsert `vote_totals`. Skip anything whose idempotency key has already been seen.

*Changed (F5):* Redis is set to absolute totals read back from Postgres rather than incremented, and Postgres's unique index is the only dedupe (no `tally:idem:*` keys). Unresolvable votes are already written to `dead_letters`.

**Done when:** 1,000 votes produce a total of exactly 1,000, and replaying the same messages does not change it.

---

## F6 — Dead-letter handling

**Build:** Unresolvable codes go to `votes.dead` with a reason, and are mirrored into the `dead_letters` table.

*Changed (F4, F5):* the `votes.dead` topic already exists (F4 `topics` job), and the consumer already writes `dead_letters` with reasons, idempotently (F5). F6 remains: publish each dead letter to `votes.dead` with `reason` and `failed_at`, and prove it end to end. *Done (F6):* published as an envelope (`DeadLetterEvent`), at-least-once, read back from the table so topic and table match.

**Done when:** A vote for a nonexistent code lands in the dead-letter topic with a reason and does not affect any total.

---

## F7 — Realtime gateway

**Build:** WebSocket server. Poll Redis on a short interval, diff against the last snapshot, broadcast only changes. Send a full snapshot on connect.

*Decided (F7):* `ws`, one poll per watched contest (250 ms), absolute totals in frames, and a `/debug` inspector page for the two-tab check until F8.

**Done when:** Two browser tabs show the same totals within a second of each other, and only changed contestants appear in update frames.

---

## F8 — Ranked results list

**Build:** Results page. Connect to the gateway. Render rows sorted by count, one component per contestant. No animation yet.

*Decided (F8):* `/results/[contestId]` (+ `/` redirect); contestant details from Postgres server-side, totals from `/live`; gateway URL is runtime config; broadcast-scoreboard look; shadcn/ui deferred to F13/F14.

**Done when:** Totals update live on screen as votes arrive.

---

## F9 — Animated counters

**Build:** A counter hook that springs toward a target value. On each update, retarget the running animation rather than starting a new one.

*Decided (F9):* Motion `useSpring` (react-countup dropped), overdamped spring (stiffness 140, damping 26), instant first paint. Verified by per-frame sampling in headless Chrome at 250 ms updates.

**Done when:** With updates arriving every 250ms, counters climb smoothly with no visible stutter or jumping.

---

## F10 — Reorder animation

**Build:** Layout animation via Motion so rows move to their new positions instead of snapping.

*Decided (F10):* `layout="position"`, no-bounce spring, and an overtake treatment (riser drawn on top, accent glow). Verified by per-frame sampling in headless Chrome, with no-layout and index-key controls.

**Done when:** A contestant overtaking another visibly slides past them, and rapid position changes never leave rows overlapping or stuck.

---

## F11 — Connection handling

**Build:** Connection state indicator. Automatic reconnect with backoff. Request a fresh snapshot on reconnect.

*Decided (F11):* the snapshot-on-connect protocol already gives resync; added an app-level heartbeat (15 s) with a 35 s stale watchdog, jittered backoff that never gives up, and a dimmed "last known totals" state. Verified with gateway stop, kill and pause.

**Done when:** Killing the gateway shows a disconnected state, and restarting it reconnects and resyncs without a page refresh.

---

## F12 — Go vote generator

**Build:** Go service producing votes at a configurable rate. Burst mode. Configurable invalid-code ratio and duplicate-sender ratio. HTTP control API. Graceful stop.

*Decided (F12):* codes passed in `/start`; drifting-race popularity; `/burst` requires a running generator. Measured 2,999 votes/s for 60 s with 0 errors; dead letters equal to invalid votes sent, exactly.

**Done when:** It sustains 3,000 votes/sec against the ingest API without errors, and the invalid-code ratio shows up correctly in the dead-letter topic.

---

## F13 — Generator control panel

**Build:** Protected page with start, stop, rate control, burst trigger, and a live status readout.

*Decided (F13):* the shared-password gate is built here, not in F14; the generator gained `POST /rate` for the ramp; the browser reaches the generator only through web route handlers. Verified by clicking through start → ramp → burst → stop in headless Chrome (23/23 checks).

**Done when:** You can drive the entire demo — ramp, burst, stop — from the browser without touching a terminal.

**This is the end of the demo-critical path.** Everything after this adds depth.

---

## F14 — Admin: contestants

**Build:** Shared-password middleware. CRUD for contestants including code, image URL, accent colours and country. Codes unique per contest.

*Changed (F13):* the shared-password middleware already exists (`proxy.ts`, `lib/auth.ts`); F14 adds its routes to the matcher and calls `requireAdmin` / `isAdmin`.

*Decided (F14):* codes fixed after creation; deactivation (no delete) dead-letters later votes as `inactive_contestant`; the consumer re-checks codes every 5 s; an open results page picks up a new contestant without a reload. Verified in headless Chrome (20/20): a new code counts its first vote 168 ms after save (5.2 s worst case, after a cached miss).

**Done when:** A contestant added through the UI can immediately receive votes, and a duplicate code is rejected with a clear error.

---

## F15 — Admin: dead letters

**Build:** Paginated dead-letter browser with reason filters.

*Decided (F15):* keyset pagination on id (newest first); contest filter via a new `dead_letters.contest_id` column; a "N new" banner instead of a moving list; view only. Verified on a 10%-invalid run: the Unknown-code count rose by exactly the generator's invalid count (868 = 868).

**Done when:** Votes rejected during a generator run are visible with accurate reasons.

---

## F16 — Contest lifecycle

**Build:** Open and close a contest. Votes arriving while closed are dead-lettered with `contest_closed`.

*Decided (F16):* "arriving" = accepted by ingest (`sent_at`), with the cut-off enforced by a lock handshake between the close and consumer batches; reopen allowed; draft counts nothing; open results pages show Final through the gateway. Verified mid-run at 1,500 votes/s: 0 late votes counted, accepted = counted + dead-lettered.

**Done when:** Closing mid-run stops totals immediately and every subsequent vote appears in dead letters.

---

## F17 — Minute buckets and chart

**Build:** Consumer also increments `vote_buckets` for the current minute. Recharts line or area chart of votes per minute on the results page.

*Changed (F17):* the minute is the vote's acceptance minute, not the processing minute; per-minute counts reach the page through Redis and the gateway; the chart shows total votes per minute for the last 30 minutes under the standings. Also added: the consumer rebuilds Redis from Postgres at startup. Verified: buckets = totals = votes (972,856), the run's buckets = accepted (162,263).

**Done when:** The chart fills in live during a run and bucket sums reconcile with the totals.

---

## F18 — Reconciliation job

**Build:** Command that recounts from the `votes` table, compares with Redis and `vote_totals`, and reports drift. Optional repair flag.

**Done when:** Deliberately corrupting a Redis counter is detected and reported, and repair restores it.

---

## F19 — Load testing with k6

**Build:** k6 scripts for a steady ramp and a spike profile. Capture throughput, p95 and p99 latency, and consumer lag.

**Done when:** You have a reproducible command and a results table good enough to publish in the README.

---

## F20 — Analytics consumer

**Build:** Second consumer group. Batched inserts into ClickHouse. Independent offset tracking.

**Done when:** Stopping the analytics consumer for two minutes leaves live results completely unaffected, and it catches up on restart.

---

## F21 — ClickHouse schema

**Build:** Wide events table suited to scans, with a sensible ordering key.

**Done when:** A group-by-minute query over several million rows returns fast.

---

## F22 — Analytics page

**Build:** Turnout over time, lead-change history, breakdown by source.

**Done when:** Every chart is served from ClickHouse and none of them touch Postgres.

---

## F23 — Metrics and dashboards

**Build:** Prometheus metrics on every service. Compose additions for Prometheus and Grafana. Dashboards for throughput, consumer lag, ingest latency, error rate.

**Done when:** A generator burst is clearly visible as a lag spike and recovery on the dashboard.

---

## F24 — Card grid view

**Build:** Card component — portrait, name, optional flag, live count, gradient from accent colours. Layout toggle between list and grid.

**Done when:** Both views share one data path and one component, and switching preserves live updates and animation.

---

## F25 — Remotion results recap

**Build:** Remotion composition reading final contest data: animated bar race, final standings, winner reveal. Render command producing an MP4.

**Done when:** A finished contest renders to a watchable video without manual editing.

---

## F26 — Deployment

**Build:** Production Docker builds. Environment configuration for the chosen host. Deploy and verify.

**Done when:** A public URL runs a live demo, and no code changed to get there — only configuration.

---

## F27 — README and case study

**Build:** Architecture diagrams, setup instructions, published benchmark numbers, decisions and trade-offs drawn from `DECISIONS.md`, demo video embedded.

**Done when:** Someone unfamiliar with the project understands what it does and why it's built this way within about 30 seconds.

---

## Optional: F28–F30 — Kubernetes

**Prerequisites already satisfied:** environment-variable config, no local disk state, health endpoints, graceful SIGTERM.

**Build:** Manifests per stateless service. Local kind or k3d cluster. KEDA scaler on consumer lag.

**Done when:** Ramping the generator visibly scales consumer pods up, drains the backlog, and scales back down — and you have it on video. No application code was modified.

---

## Suggested pace

| Sessions | Covers | Outcome |
|---|---|---|
| 1–6 | F1–F6 | Votes flow end to end |
| 7–13 | F7–F13 | The live demo works |
| 14–19 | F14–F19 | Operational depth and real numbers |
| 20–22 | F20–F22 | Analytics separation |
| 23–27 | F23–F27 | Polished and presentable |

Stopping after session 13 already leaves you with something worth showing.
