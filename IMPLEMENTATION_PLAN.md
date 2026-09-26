# Tally — Implementation Plan

The build order, one feature (F-number) per session. What each feature decided and how its check was verified is in `DECISIONS.md` under its number.

**Working rules**
- One feature per session. Don't start the next until the current one passes its check.
- Write the check before the code.
- Document a new feature here first; build it on the user's go-ahead.
- Commit at every feature boundary: `F<n>: subject` plus a what/why body (the `/feature-commit` skill), no Co-Authored-By trailer.
- Log every non-obvious choice in `DECISIONS.md`: it's the case study and the interview prep.
- Anything the spec doesn't cover is a question, not a guess.

---

## Built

| F | Feature | What it delivered |
|---|---|---|
| 1 | Monorepo and local stack | pnpm workspaces, Docker Compose (infra by default, full stack with `--profile app`), `/health` everywhere, `check-health.sh` |
| 2 | Database schema and seed | Drizzle schema in `packages/db`, migrations in `infra/migrations`, idempotent seed (Tally Showcase) |
| 3 | Ingest API | `POST /votes`: validation, HMAC sender hash, `Idempotency-Key`, 202 |
| 4 | Publish to Redpanda | `acks=all` before the 202, 5 ms micro-batches, murmur2 keyed by code, topics from an `rpk` job |
| 5 | Consumer and totals | Batches into Postgres (unique key is the only dedupe), absolute upward-only totals into Redis |
| 6 | Dead-letter handling | `votes.dead` with a reason, mirrored in `dead_letters`; nothing dropped |
| 7 | Realtime gateway | WebSocket snapshot then diffs; one Redis poll per watched contest |
| 8 | Ranked results list | The board, ranked live |
| 9 | Animated counters | Motion springs that retarget, never restart |
| 10 | Reorder animation | Rows glide past each other on an overtake |
| 11 | Connection handling | Heartbeats, reconnect with backoff, fresh snapshot, stale totals dimmed |
| 12 | Go vote generator | Rate, invalid codes, repeat senders; contract test against the Zod schemas |
| 13 | Generator control panel | `/control` behind the admin password; browsers never call the generator |
| 14 | Admin: contestants | Add, edit, deactivate (codes are fixed) |
| 15 | Admin: dead letters | Browse rejections by contest and reason |
| 16 | Contest lifecycle | Open, close, reopen; a vote counts by acceptance time, under a lock |
| 17 | Minute buckets and chart | `vote_buckets`, votes per minute on the board |
| 18 | Reconciliation | `pnpm reconcile [--repair]` recounts every derived total from the log |
| 19 | Load testing | `pnpm load <smoke\|steady\|spike>` with k6, zero-loss and reconciliation checks |
| 20 | Analytics consumer | Its own group, both topics into ClickHouse |
| 21 | ClickHouse schema | `votes_raw`, `votes_dead`, exact distinct counts, no rollups |
| 22 | Analytics page | `/admin/analytics`, ClickHouse only |
| 23 | Metrics and dashboards | `/metrics` everywhere, Prometheus, a generated Grafana dashboard |
| 24 | Card grid view | The list row as a card, by a layout flag |
| 25 | Remotion recap | `pnpm recap`: a closed contest as a 32 s video |
| 26 | Create contests | Drafts from the browser, delete drafts |
| 27 | Sample contestants | "Fill with sample contestants", reviewed before saving |
| 28 | Recap in the browser | `/admin/recap/:contestId` with `@remotion/player` |
| 29 | Counting backlog | Consumer lag in Redis, shown on the board and the panel |
| 30 | UI polish | Long names, local times, stable contest order, operator route group |
| 31 | Lively UI | Spring presets, "+N", the overtake lift, LIVE beat, List ↔ Grid morph |
| 32 | Stage look | The TV-show stage, searchlights cued by `lib/lighting.ts`, glass rows |
| 34 | README and case study | The README, demo clip and stills (built before F33) |
| 35 | Partition votes evenly | Keyed by idempotency key over `TOPIC_PARTITIONS` (default 24) |
| 36 | Ingest replicas | `INGEST_REPLICAS` behind nginx (`ingest-proxy`) |
| 37 | Scale out counting | `CONSUMER_REPLICAS`; sorted upserts; contest-wide figures summed in Redis |
| 38 | Generator on a second device | Two-device mode (`compose.two-device.yaml`), the generator as a Windows program |
| 39 | Podium and a true-result finale | Top three stand out; the finale waits for every queued vote to be counted |

F35–F38 were built on a branch, `two-device`, then hardened after a code review and merged: one machine with replicas is the default way to run it, and two-device mode is off unless configured. On the 4-core laptop the whole pipeline tops out near 4,700 votes/s however the replicas are split.

---

## Optional: F33 — Deployment

**Build:** production Docker builds; environment configuration for the chosen host; deploy and verify. Needs a host, a domain and the user's permission.

**Done when:** a public URL runs a live demo, and no code changed to get there, only configuration. The README gains the URL.

## Optional: F40–F42 — Kubernetes

**Already in place:** environment-variable config, no local disk state, health endpoints, graceful SIGTERM.

**Build:** manifests per stateless service; a local kind or k3d cluster; a KEDA scaler on consumer lag.

**Done when:** ramping the generator visibly scales consumer pods up, drains the backlog and scales back down, on video, with no application code changed.
