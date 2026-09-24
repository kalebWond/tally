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

*Decided (F18):* also checks `vote_buckets` and the Redis minutes; runs per contest under the contest lock (counting pauses well under a second), so it's exact during live traffic; `--repair` rewrites Postgres and overwrites Redis, so too-high values come down. `pnpm reconcile` / `docker compose run --rm reconcile`. Verified idle and mid-run at 1,500 votes/s.

**Done when:** Deliberately corrupting a Redis counter is detected and reported, and repair restores it.

---

## F19 — Load testing with k6

**Build:** k6 scripts for a steady ramp and a spike profile. Capture throughput, p95 and p99 latency, and consumer lag.

*Decided (F19):* `pnpm load <smoke|steady|spike>` (k6 in a container, in the compose network) also measures consumer lag and drain, and checks zero loss and reconciliation after each run. Results: README "Performance" and `load-results/`.

**Done when:** You have a reproducible command and a results table good enough to publish in the README.

---

## F20 — Analytics consumer

**Build:** Second consumer group. Batched inserts into ClickHouse. Independent offset tracking.

*Decided (F20):* `services/analytics-consumer`, group `tally-analytics`, reads votes.raw and votes.dead; ClickHouse 26.9 in compose. Verified: 2 min stopped at 1,000 votes/s changed nothing live; 121k backlog caught up in 12 s; ClickHouse = Postgres = accepted (184,710).

**Done when:** Stopping the analytics consumer for two minutes leaves live results completely unaffected, and it catches up on restart.

---

## F21 — ClickHouse schema

**Build:** Wide events table suited to scans, with a sensible ordering key.

*Decided (F21):* `votes_raw` sorted by `(contest_id, sent_at, idempotency_key)`, distinct votes as `uniqExact(key_hash)`, rejections filed under their vote's minute; per-minute rollups tried and dropped (slower when exact). `pnpm bench:clickhouse`: 10M votes per minute in 313 ms, last 30 min in 56 ms; matches Postgres minute for minute.

**Done when:** A group-by-minute query over several million rows returns fast.

---

## F22 — Analytics page

**Build:** Turnout over time, lead-change history, breakdown by source.

*Decided (F22):* `/admin/analytics` (operator) with turnout, lead-change history and source/reason breakdowns from `GET /api/analytics/:contestId` (ClickHouse only); Postgres supplies labels and is optional. Verified with Postgres stopped.

**Done when:** Every chart is served from ClickHouse and none of them touch Postgres.

---

## F23 — Metrics and dashboards

**Build:** Prometheus metrics on every service. Compose additions for Prometheus and Grafana. Dashboards for throughput, consumer lag, ingest latency, error rate.

*Decided (F23):* `@tally/metrics` (prom-client) on every Node service, hand-written metrics in the Go generator, consumer lag from Redpanda's own metrics; Prometheus (9090) and Grafana (3001) in the `app` profile, dashboard generated by `scripts/grafana-dashboard.py`. Found on the way: ClickHouse's own logs cost 1.6 cores idle (turned off); Postgres buffers raised to 512 MB; a k6 load regression since F19, logged as outstanding.

**Done when:** A generator burst is clearly visible as a lag spike and recovery on the dashboard.

---

## F24 — Card grid view

**Build:** Card component — portrait, name, optional flag, live count, gradient from accent colours. Layout toggle between list and grid.

*Decided (F24):* `ContestantRow` with a `layout` flag and an identical element tree (CSS arranges the card); `?view=grid` via `replaceState`; flag emoji from the country code. Verified: the same DOM nodes before and after switching, no reconnect, counters still springing, overtakes glide across the grid.

**Done when:** Both views share one data path and one component, and switching preserves live updates and animation.

---

## F25 — Remotion results recap

**Build:** Remotion composition reading final contest data: animated bar race, final standings, winner reveal. Render command producing an MP4.

*Decided (F25):* `tools/recap`, `pnpm recap [contestId]`; data from Postgres (standings plus the vote log in adaptive buckets); bar race with rank hysteresis. Verified on a 6-minute "Tally Finals": 1080p, 32 s MP4 with no manual steps.

**Done when:** A finished contest renders to a watchable video without manual editing.

---

## F26 — Create contests

*Added (after F25):* F26–F28 were added before deployment, so the deployed demo can run start to finish without a terminal: create a contest, fill it with sample contestants, open it, drive the generator, close it, play its recap. The later features moved from F26–F30 to F29–F33.

**Build:** A "New contest" form on `/admin/contests` that takes a name and creates a **draft**. Contest names are unique, ignoring case (`pnpm recap` names its file after the contest). Opening needs at least one active contestant. A draft with no votes can be deleted. After creating a contest, the admin lands on `/admin/contestants` for it. The contest pickers in `/admin/contestants` and `/control` list it straight away.

*Decided (F26):* `POST /api/contests` and `DELETE /api/contests/:id`; names unique by an index on `lower(name)`; the open guard inside `setContestStatus`, under the row lock. Verified in headless Chrome: create, the case-insensitive duplicate, the open guard, two contestants, a generator run (1,205 accepted = counted), close, delete refused on it and allowed on a draft.

**Done when:** A contest created from the browser can be given contestants, opened, voted on with the generator and closed, with no terminal or SQL. A second contest with the same name (in any case) is refused, opening a contest with no active contestants is refused, and only a draft with no votes can be deleted.

---

## F27 — Sample contestants

**Build:** On a contest with no contestants, `/admin/contestants` offers "Fill with sample contestants". It opens an editable review list of 7 invented contestants: name, code, accent colours, country and generated avatar. Rows can be edited, removed or reshuffled, and nothing is saved until the admin submits. All rows are added together, or none are.
- **Names:** from a hand-written list of invented names, never real people, with no network call.
- **Codes:** start with the first letter of the contest's name ("Spring Heats" gets S1–S7) and skip codes already taken.
- **Colours:** spread evenly around the colour wheel, so bars and cards stay easy to tell apart.

*Decided (F27):* the draw runs in the browser (`lib/sample-contestants.ts`: 40 invented names, hues spaced evenly); `POST /api/contestants/batch` adds the rows in one insert. Also a "Sample contestants" button for contests that already have some. Verified in headless Chrome: 7 rows, reshuffle, an edited and a removed row saved exactly as shown, and duplicate or taken codes adding nothing with the row marked.

**Done when:** One click fills 7 plausible contestants that wait for review, and submitting adds exactly what was on screen. A submission with a taken code adds none of them and points at the row.

---

## F28 — Recap in the browser

**Build:** The recap composition moves from `tools/recap` into a shared package, used by both the command-line render and the web app. `/admin/recap/[contestId]` plays it with Remotion's player, from an admin-only API returning the same data `pnpm recap` renders from. Each contest on `/admin/contests` gets a "Recap" link, and Remotion loads on that page only. An open contest's recap shows the results as of loading, with a Refresh button. Also `pnpm contests`: a table of every contest with ID, name, status, contestant count, votes, and when it opened and closed, so you can find the ID to pass to `pnpm recap`.

*Changed (F28):* no API route: the recap page is a server component calling the same exporter, and Refresh reloads it. The composition, data type and exporter live in `packages/recap-video`. Verified in headless Chrome on "Tally Showcase": the player's winner screen matches the MP4's frame for frame in content (Felix Arnhald, 228,365 votes, 23.3%).

**Done when:** A closed contest's recap plays in the browser from `/admin/contests`, with no terminal, from the same data and component as the MP4. `pnpm contests` lists every contest with its vote count.

---

## F29 — Counting backlog

*Added (after F28):* after a long generator run is stopped, totals keep rising while the queue drains, and nothing says how much is left. The later features moved from F29–F33 to F30–F34.

**Build:** Show how many votes are accepted but not yet counted, and roughly how long until they are.
- **Measure:** the consumer checks its own lag every second (high watermark − committed offset on `votes.raw`, via `@platformatic/kafka`'s `getLag`) and its processing rate. Offsets are committed only after a batch is in Postgres and Redis, so lag is exactly "accepted, not yet counted" (dead letters included, so the wording is "being counted", not "will count").
- **Publish:** a Redis hash `tally:backlog`: one field per assigned partition, a rate field per consumer instance, `updatedAt`, expiring after 10 s. Several consumer replicas each write their own partitions and readers sum them; with no consumer running the key disappears. Derived from Redpanda and rewritten every second, so nothing lives only in Redis.
- **Share:** `LiveBacklog { pending, perSec, etaSec }` (null when unknown or stale) and one `parseBacklog` in contracts, used by the gateway and web. Snapshot and update frames gain `backlog`; a change in it triggers an update.
- **Show:** the generator panel (`/control`) gets a counting-queue tile: waiting, rate, time left, "All counted" at zero, "Counting paused" when no consumer reports. Results pages get a line under the Live/Final badge, "Counting 12,345 queued votes · about 8 s", gone at zero.
- **Scope:** system-wide. The queue is partitioned by vote code, not by contest, so the figure covers every contest. With two live contests, both pages show the combined number, and a closed contest's page can show "counting" while the other contest's votes drain. Documented, and per-contest tracking deferred.

*Decided (F29):* built as planned; the panel reads a separate `GET /api/generator/backlog` (the generator's status contract stays the generator's), and fields expire one by one (`HEXPIRE`). Verified by stopping the consumer during a 3,000/s run instead (a running consumer drains 3,000/s within a second): "Counting paused", then 41,068 waiting matching Redpanda within half a second of counting, the results line falling to zero in 6 s, and all 80,276 accepted votes counted.

**Done when:** After a 60 s run at 3,000 votes/s is stopped, the panel's waiting count matches Redpanda's lag for `tally-consumer` (within a second of drift), results pages show the counting line falling to zero and then hide it, and the final total equals the generator's accepted votes. Stopping the consumer mid-drain shows "Counting paused" on the panel and hides the results line; starting it again resumes the drain.

---

## F30 — UI polish: long names, local times, stable contest order

*Added (after F29):* from a walk-through with a real contest ("Ethiopian-got-talents-final-competition", 1.9M votes). The later features moved from F30–F34 to F31–F35.

**Build:** Three fixes the user asked for, with the options they chose.
- **Long contest names:** a long name took the whole header width and pushed the vote count onto its own line, left-aligned. The results header becomes two columns (name, then count and layout toggle), so the count stays on the right. The name steps down in size with its length (up to 20 characters, 21–32, over 32), wraps at spaces and hyphens onto at most 2 lines, and shows the full name on hover when cut. On phones (under 640 px) the count moves under the name, beside the List/Grid toggle.
- **Local time, relative for the last day:** admin timestamps were UTC. They read in the viewer's time zone instead: "12 min ago" or "3 h ago" within a day, "24 Sep 2026, 17:34" after, and the full local time plus UTC in a tooltip. The browser's zone is kept in a `tz` cookie (written by a small client component in the operator nav, validated on the server, UTC by default), so the server renders local times directly: no UTC flash and no hydration mismatch. Relative times refresh every 30 s. Applies to the contests list, the recap page and dead letters (local clock time with milliseconds, no relative). `pnpm contests` uses the machine's zone.
- **Stable contest order:** contests were sorted open-first, so closing one made its row jump. All contest lists order by creation, newest first. `/admin/contests` gets filter chips (All · Open · Draft · Closed, with counts) kept in `?status=`. A contest that changes status stays where it is until the filter changes. The contest pickers (generator, contestants, dead letters, analytics) use the same order, grouped under Open, Draft and Closed headings. `/` still opens the most recently opened live contest.

**Done when:** At 1,400 px the user's long name fits in at most 2 lines with the count on the same row, right-aligned, and at 390 px the count sits under the name with no sideways scroll. Admin timestamps read in the browser's zone ("x min ago" within a day), with UTC on hover and no hydration warning. Closing or reopening a contest leaves its row where it was, and the filter chips count and filter correctly across a reload.

---

## F31 — Deployment

*Renumbered:* was F26, then F29, then F30.

**Build:** Production Docker builds. Environment configuration for the chosen host. Deploy and verify.

**Done when:** A public URL runs a live demo, and no code changed to get there — only configuration.

---

## F32 — README and case study

*Renumbered:* was F27, then F30, then F31.

**Build:** Architecture diagrams, setup instructions, published benchmark numbers, decisions and trade-offs drawn from `DECISIONS.md`, demo video embedded.

**Done when:** Someone unfamiliar with the project understands what it does and why it's built this way within about 30 seconds.

---

## Optional: F33–F35 — Kubernetes

*Renumbered:* was F28–F30, then F31–F33, then F32–F34.

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
| 23–27 | F23–F25 | Polished and presentable |
| 28–32 | F26–F30 | Run a whole contest from the browser |
| 33–34 | F31–F32 | Deployed and written up |

Stopping after session 13 already leaves you with something worth showing.
