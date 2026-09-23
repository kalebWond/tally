# Tally

A real-time voting platform. Votes arrive over HTTP, flow through a Kafka-compatible queue, get counted by a consumer, and appear on a live results screen with animated counters. It's modelled on a production SMS voting system built for a live televised contest; a controllable Go load generator stands in for the telecom feed.

```
Go generator / k6 ─► ingest (Fastify) ─► Redpanda votes.raw ─► consumer ─► Postgres (truth)
                                                      │                └─► Redis (live totals)
                                                      └─► votes.dead (dead letters)
Redis ─► gateway (WebSocket, snapshot + diffs) ─► Next.js results page
```

The full write-up (architecture, decisions and trade-offs) comes in F27. Until then, [`SPEC.md`](SPEC.md) describes the system and [`DECISIONS.md`](DECISIONS.md) records every choice along the way.

## Run it

```sh
cp .env.example .env              # then set VOTER_HASH_SALT and ADMIN_PASSWORD
pnpm install
docker compose --profile app up -d --build
pnpm check:health
```

- Results: http://localhost:3000
- Generator control and admin (password from `.env`): http://localhost:3000/control

## Performance

Measured with k6 against `POST /votes`, the whole pipeline running, on a developer laptop (Intel i5-1135G7, 4 cores / 8 threads, 15 GB) that also runs k6, every service and the desktop. After each run, the script waits for the consumer to drain, checks that every vote ingest accepted was counted exactly once, and runs reconciliation.

| Profile | Rate at the peak | p50 / p95 / p99 at the peak | Errors | Max consumer lag | Accepted → counted | Drift |
|---|---|---|---|---|---|---|
| Steady: 1,000/s held 3 min | 1,000 votes/s | 4.1 / **7.0** / 8.2 ms | 0 | 140 messages | 217,499 → 217,499 | none |
| Spike: 500 → 3,000/s for 1 min | 3,000 votes/s | 5.7 / **14.4** / 29.0 ms | 0 | 938 messages | 282,499 → 282,499 | none |
| Spike, second run | 2,999 votes/s | 5.8 / **20.1** / 44.0 ms | 0 | 1,038 messages | 282,467 → 282,467 | none |

SPEC targets: 1,000 votes/s sustained, 3,000+ burst, p95 under 50 ms, zero loss. All met. The consumer drained within a fraction of a second after each run. Every run's full report is in [`load-results/`](load-results).

**Caveats, measured rather than assumed:**
- **Laptop variance:** on a shared laptop, runs vary. The two identical spike runs above differ by 6 ms at p95. In the second, k6 briefly ran short of virtual users and skipped 32 of its 282,499 scheduled requests (dropped iterations); those were never sent, so they aren't counted as lost.
- **The host port hop:** an earlier spike run through Docker's host port forwarding (`docker-proxy`) instead of the compose network had p95 70.7 ms and 12k messages of lag. The published runs call ingest by service name inside the compose network, as a deployment would.

Reproduce:

```sh
docker compose --profile app up -d --build
pnpm load steady      # or: pnpm load spike, pnpm load smoke (20 s harness check)
```

`pnpm reconcile` checks every derived count (Postgres and Redis) against the vote log at any time.
