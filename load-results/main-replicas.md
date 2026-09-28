# main with replicas: measurement (2026-09-28)

`main` at `b6ae475` (F35–F39 merged plus the hardening round), full stack in Docker Compose on one laptop
(i5-1135G7, 8 threads, 15 GB), `INGEST_REPLICAS=2`, `CONSUMER_REPLICAS=2` (3 for part of the matrix and the
finale), 24 partitions on `votes.raw`, two-device mode off, local generator at localhost:4002.
Test contest: Tally Showcase (`0192f3a0-…c0de`, C1–C10). Nothing in the repo was changed; the only files
written are this one and the k6 report `20260928-100219-steady.md`.

## Summary

| Check | Result |
|---|---|
| Health and wiring | ✓ every replica listed and up; Prometheus finds 2 ingest + 2 consumer targets; group Stable, 2 members, 12/12 partitions |
| k6 smoke / spike (2026-09-26, reused) | ✓ p95 6.6 ms / 12.1 ms at the peak, zero loss, no drift |
| k6 steady, first run (2026-09-26, reused) | ✗ p95 76.1 ms at the peak (p99 734 ms): episodic ~1 s pauses of the ingest→Redpanda publish, not reproduced |
| k6 steady, rerun (today) | ✓ p95 12.4 ms at the peak, p99 23.8 ms, 0 dropped, zero loss, no drift |
| Replica matrix, 2 vs 3 consumers | 2 consumers fall behind (backlog 67k); 3 keep up (peak 2.2k). Intake ~5k/s on a saturated laptop, not 20k |
| Finale with 3 consumers | ✓ confetti once (9.5 s), cue `finale`, beams 7.5/10.0, 3 podium rows, all rows opacity 1. ✗ it began **~2 s before the queue was confirmed empty** |
| Header total vs rows | ✓ all seven stores agree after every run; board header 1,266,102 = row sum 1,266,102 |
| Correctness per run | ✓ generator accepted = ingest counter increase = new votes + new dead letters, every run; `pnpm reconcile`: no drift |
| Cleanup | ✓ Showcase closed and empty (Postgres, Redis, ClickHouse); 2 consumers restored; health ok; user contest unchanged |

## 1. Health and wiring

- `pnpm check:health`: redpanda, postgres, redis, clickhouse; web, ingest (through nginx), gateway,
  analytics-consumer, generator; `ingest 1`, `ingest 2`, `consumer 1`, `consumer 2`: all ok.
- Prometheus targets (all `up`): 2 ingest (`172.19.0.8:4000`, `172.19.0.14:4000`), 2 consumer
  (`172.19.0.16:4003`, `172.19.0.17:4003`), plus web, gateway, generator, analytics-consumer, redpanda.
- `rpk group describe tally-consumer`: Stable, 2 members, total lag 0, 12 partitions each (even/odd split),
  `votes.raw` has 24 partitions.

## 2. k6 through nginx (2 ingest replicas, 2 consumers)

| Run | When | Requests | Dropped | Peak p50 / p95 / p99 / max (ms) | Whole-run p95 | Lag max | Loss | Drift |
|---|---|---|---|---|---|---|---|---|
| smoke | 09-26 13:18 | 3,499 | 0 | 6.1 / **6.6** / 7.0 / 15.1 | 6.9 | 18 | 0 | none |
| steady #1 | 09-26 13:19 | 216,454 | 1,045 | 4.6 / **76.1** / 733.8 / 1,374.4 | 30.9 | 777 | 0 | none |
| spike (3,000/s) | 09-26 13:24 | 282,499 | 0 | 6.0 / **12.1** / 19.4 / 49.0 | 10.7 | 493 | 0 | none |
| steady #2 | 09-28 10:02 | 217,499 | 0 | 5.5 / **12.4** / 23.8 / 97.4 | 11.6 | 273 | 0 | none |

The spike used to measure 70–107 ms p95 with a single ingest; with two replicas behind nginx it meets the
50 ms target. Steady #2 meets it too, so steady #1's 76 ms was a stall, not a steady-state limit.

### What the steady #1 stall was

Prometheus (still retained) over steady #1:

- Ingest request p99 per 15 s window was 7 ms until 13:20:27, then 286–2,166 ms until 13:22:27, then 7 ms again.
- The ingest **publish** p99 (`tally_ingest_publish_duration_seconds`) matches it exactly, so the time was spent
  publishing to Redpanda, not in Fastify or nginx.
- Both replicas were hit equally (p99 717 ms and 716 ms), in the same seconds. The per-request logs show 21
  pauses of 0.2–1.4 s between 13:20:13 and 13:22:26 (for example, 898 requests over 200 ms at 13:21:34, max
  1,374 ms), with each pause split evenly between the two replicas.
- Other signals stayed normal during the pauses:
  - Redpanda's own produce latency: p99 ≤ 0.5 ms, mean ≤ 1.3 ms.
  - Redpanda CPU: 21–29 %.
  - Redpanda disk queue: ≤ 8.
  - Ingest event-loop lag: max 17 ms.
  - Ingest CPU: 45–60 %.
- No warnings in the Redpanda, ingest or nginx logs.

So the delay sat between the ingest's Kafka client and the start of Redpanda's request handling, and it
hit both replicas at once. The cause was something both replicas share: most likely the laptop itself (the
broker's network/reactor or the host was briefly starved), but that isn't confirmed. **Postgres is not on this
path**: ingest doesn't touch it.

In steady #2, Postgres waits were sampled every 200 ms (1,299 samples):

- An active client backend appeared in only 240 of the 1,299 samples.
- Among backend samples: CPU 224, `IO/WalSync` 26, `Lock/transactionid` 6, `Client/ClientRead` 2, `IO/WalWrite` 1.
- Autovacuum: 16.

No stall occurred in steady #2, so none could be attributed through Postgres.

## 3. Replica matrix (2 ingest replicas; 20,000/s asked for 90 s; invalid 0.02, duplicate sender 0.05)

Medians are over the load window (Prometheus, 5 s steps, first 10 s skipped). CPU is the docker stats median,
where 100 % is one core and the host has 800 %.

| Consumers | Partitions/member | Accepted/s median (max) | Counted/s median (max) | Ingest p95 (server) | Generator p95 | Backlog peak | Drain | Docker CPU | Host busy |
|---|---|---|---|---|---|---|---|---|---|
| 2 | 12/12 | 5,274 (9,023) | 4,306 (8,103) | 57.6 ms | 84 ms | 67,356 | 7 s | 567 % | 773 % |
| 3 | 8/8/8 | 4,911 (6,504) | 4,777 (5,480) | 79.2 ms | 105 ms | 2,221 | 3 s | 610 % | 783 % |

CPU per service, median %:

| Service | 2 consumers | 3 consumers |
|---|---|---|
| ingest (both replicas) | 164 | 156 |
| consumer | 87 | 128 |
| postgres | 78 | 95 |
| generator | 77 | 72 |
| redpanda | 56 | 62 |
| ingest-proxy | 47 | 44 |
| analytics-consumer | 26 | 24 |

The laptop is saturated at about 780 % of 800 %, so intake stops near 5,000/s, far below the 20,000/s asked.
Adding a third consumer doesn't raise intake, which ingest and the host limit. It does let counting keep up:
with 2 consumers, counting runs about 1,000/s behind intake and the backlog grows to 67k; with 3, the backlog
stays under 2.3k. The earlier agent's matrix (09-26) showed the same shape:

- 2 consumers: 6,590/s accepted, 5,506/s counted, 142k peak, 25 s drain.
- 3 consumers: 5,703/s accepted, 5,752/s counted, 2.6k peak, 3 s drain.

## 4. Finale with 3 consumers (headless Chrome, GPU, `?view=list`, 1920×1080)

With 3 consumers, 30 s at 20,000/s asked left no backlog (lag 0 at stop). So the fallback path was used:

1. Stop the consumers.
2. Queue 39,997 votes (5,000/s for 8 s).
3. Wait 13 s.
4. Close Showcase (10:15:18).
5. Start the consumers.

The queue drained 29.9 s after the close.

| Check | Result |
|---|---|
| While queued: cue | `live` ✓ |
| While queued: confetti | none ✓ |
| At the close: every row `getComputedStyle(row).opacity` | `'1'` for all 10 rows ✓; effective opacity (row × ancestors) min 1 over the whole run |
| After the drain: confetti | exactly once, 9.47 s ✓ |
| After the drain: cue | `finale` ✓ |
| After the drain: beams `data-period` | 7.5 and 10.0 ✓ |
| After the drain: `.row[data-podium]` | 3 (C6, C8, C10) ✓ |
| Console errors | 0 |
| **Finale timing** | ✗ **started before the queue was confirmed empty** (below) |

### The finale fired early

| Time (UTC) | Event |
|---|---|
| 10:15:45.25 | `tally:backlog` first reads pending 0, with all 24 partitions and 3 rate fields present |
| 10:15:45.47 | cue becomes `finale` and the confetti starts |
| 10:15:45.2 → 47.5 | `rpk group describe` (committed offsets) still reads 1,301 → 428 → 1,216 → 388 queued |
| 10:15:47.7–48.1 | first `rpk` sample at 0 |
| 10:15:47.94 | Redis `meta.lastUpdated` for Showcase: totals were written 2.47 s after the finale began |

So the consumers' self-reported backlog (`consumer.getLag`, which is what the board trusts) reached 0 about
2 s before the broker's committed offsets did. The earlier agent's run on 09-26 shows the same thing
(finale −2.48 s before its drain sample): **2 of 2 runs**.

During this drain the three consumers restarted and joined about 3 s apart. The first one consumed alone
before the rebalance, and 32,829 messages were replayed as duplicates. The non-monotonic `rpk` lag
(428 → 1,216) points the same way. A replay also rewrites the Redis totals and `lastUpdated`, so the evidence
doesn't prove that a *new* vote was counted after the finale. It does show the finale began while the broker
still held uncommitted messages. The end state was right: the header and rows both showed 1,266,102.

Not investigated further, as agreed. A likely lead is the client's per-stream committed-offset map across a
rebalance, together with `parseBacklog` accepting any `lag:` fields that are present.

## 5. Header total against the rows

| After | meta.totalVotes | Σ totals | Σ minutes | Σ contestant-minutes | PG votes | Σ vote_totals | Σ vote_buckets | Agree |
|---|---|---|---|---|---|---|---|---|
| steady #2 | 217,499 | 217,499 | 217,499 | 217,499 | 217,499 | 217,499 | 217,499 | ✓ |
| matrix, 2 consumers | 697,545 | 697,545 | 697,545 | 697,545 | 697,545 | 697,545 | 697,545 | ✓ |
| matrix, 3 consumers | 1,117,614 | 1,117,614 | 1,117,614 | 1,117,614 | 1,117,614 | 1,117,614 | 1,117,614 | ✓ |
| finale | 1,266,102 | 1,266,102 | 1,266,102 | 1,266,102 | 1,266,102 | 1,266,102 | 1,266,102 | ✓ |

After the finale, the board's "votes cast" header (`data-target` and text "1,266,102") equals the sum of the
10 rows' totals, 1,266,102 ✓.

## 6. Correctness per run

| Run | Accepted (generator/k6) | Ingest counter Δ | New PG votes | New dead letters | Votes + dead | OK |
|---|---|---|---|---|---|---|
| steady #2 (k6) | 217,499 | 217,499 | 217,499 | 0 | 217,499 | ✓ |
| matrix, 2 consumers | 489,870 | 489,870 | 480,046 | 9,824 | 489,870 | ✓ |
| matrix, 3 consumers | 428,552 | 428,552 | 420,069 | 8,483 | 428,552 | ✓ |
| finale (two generator bursts) | 151,532 | 151,532 | 148,488 | 3,044 | 151,532 | ✓ |

Dead letters equal the generator's invalid codes exactly (9,824 and 8,483). No request failed or was rejected.

`pnpm reconcile` (no `--repair`) after the finale:
- Showcase: 1,266,102 votes, no drift.
- Ethiopian-got-talents-final: 418,291 votes, no drift.

## Cleanup and the user's contest

- **Showcase data deleted:**
  - Postgres: 1,266,102 votes, 120 `vote_buckets` rows, 10 `vote_totals` rows, 21,351 `dead_letters`.
  - Redis: `DEL` `:totals`, `:minutes` and `:contestant-minutes`; `HDEL` `totalVotes`, `lastMinute` and `lastUpdated` from `:meta`. Only `status=closed` remains.
  - ClickHouse: `votes_raw` 1,287,453 rows and `votes_dead` 22,011 rows, deleted with `mutations_sync = 1`; both now 0.
- **Showcase end state:** closed and empty.
- **Stack restored:** `docker compose --profile app up -d` brought it back to 2 consumers (Stable, 12/12). `pnpm check:health` all ok. `pnpm reconcile` no drift for both contests.
- **Ethiopian-got-talents-final** (`1da02606-…544d774`), before = after:
  - Postgres: 418,291 votes, 21,570 dead letters.
  - Sums of `vote_totals` and `vote_buckets`: both 418,291.
  - Redis: `totalVotes`, and the sums of totals, minutes and contestant-minutes, all 418,291.
  - ClickHouse: `votes_raw` 439,861, `votes_dead` 21,570.
  - Status: closed.

## Caveats

- Everything shares one 8-thread laptop with k6 or the generator. The matrix ran with the host at about 780 % of 800 %, so
  throughput numbers are host limits, not pipeline limits. They vary between runs: the 09-26 matrix
  accepted 5.7–6.6k/s, today's 4.9–5.3k/s.
- Steady #1's stall is attributed to the publish path only by elimination; its root cause is unconfirmed.
- The finale used the "consumers stopped" path, because 3 consumers kept up with the generator on this host.
  That path includes a consumer-group rebalance during the drain, which may be what triggers the early finale.
  A natural backlog with already-running consumers wasn't tested.
- ClickHouse `votes_dead` held 660 more Showcase rows than Postgres `dead_letters` (22,011 vs 21,351). This is
  probably dead events republished by the duplicate replays during the finale drain; Postgres dedupes them.
  `votes_raw` matched exactly (votes + dead = 1,287,453).
