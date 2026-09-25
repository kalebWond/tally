# Peak counting rate, one consumer (after F35)

2026-09-25, full `app` stack on the laptop (i5-1135G7, 4 cores / 8 threads). The topics had 24 partitions and votes were keyed by idempotency key (F35). The Go generator asked for 20,000 votes/s, its maximum, on Tally Showcase.

| Run | Asked | Accepted by ingest | Counted while loading | Backlog peak | Drain after stop |
|---|---|---|---|---|---|
| 1: 3 min, 0% invalid | 20,000/s | 4,000–4,300/s (719,825) | 3,700–4,300/s | 47,660 | 15 s |
| 2: 90 s, 3% invalid | 20,000/s | 3,800–7,300/s (471,102) | 1,200–5,300/s | 194,301 | 35 s, at 5,400–6,000/s |

**Totals:** ingest accepted 1,191,999. That's 1,177,658 counted plus 14,341 dead letters, and `pnpm reconcile` found no drift. The generator's own figures were read just before it stopped, so they fall 1,072 short.

## Where the limits were

**Ingest: one full core.** Ingest ran at 1.03 cores throughout run 1. Its publish p95 was in the 25–50 ms histogram bucket, and request p95 was 49–91 ms. That capped what reached the queue at about 4,200/s. Generator latency p95 was 2.2 s, because its requests queued behind ingest.

**Consumer: never idle, but only half a core.**
- **Under load:** busy 100% of the time, batches of about 470 votes in about 113 ms, so roughly 4,200/s.
- **In the drain, with ingest idle:** batches of 500 in about 82 ms, so 6,000/s.
- **CPU:** the consumer used about 0.5 cores and its Postgres backend about 0.55. The two take turns, so together they're one serial chain of about 1 core.
- **The laptop wasn't saturated:** about 3.2 of 8 threads were in use in run 1:

  | ingest | generator | Postgres | consumer | Redpanda | analytics | ClickHouse |
  |---|---|---|---|---|---|---|
  | 1.03 | 0.58 | 0.55 | 0.51 | 0.23 | 0.15 | 0.12 |

**Where a batch's time goes.** The consumer's Postgres connection was sampled every 50 ms (2,984 samples in run 1):

| Share | What |
|---|---|
| 44.8% | `insert into votes` (unique idempotency key) |
| 43.1% | Node work between statements, inside the transaction |
| 6.7% | outside the transaction: parse, resolve, Redis, dead-letter publish, fetch |
| 1.8% | read the totals back |
| 1.5% | COMMIT |
| 1.2% | upsert `vote_totals` |
| 0.9% | upsert `vote_buckets` |

The shared rows (the upserts, the read-back and the commit) are locked for about 5% of a batch, roughly 6 ms. With more consumers that part runs one at a time. At 6 ms per 500 votes it would limit counting only at around 80,000/s.

**Stalls.** Twice, counting nearly stopped for 10–20 s, with batches of 564 ms and 830 ms. Each time, COMMIT was waiting on `IO:WalSync`: the disk was slow to flush Postgres's log. Postgres, Redpanda and ClickHouse all write to the same laptop SSD. These stalls, not the counting rate, are what built run 2's 194,000 backlog.

**Dead letters** took about 2% of the transaction, plus a share of the time outside it. They don't explain the earlier 2.7× gap in cost per vote.

## 6 partitions against 24 (same key, same load)
The comparison below was run to check a lead from a single earlier sample, taken at 12:17 before F35. That sample suggested ingest used 2.4× more CPU per vote after F35, and that consumer batches took 1.6× longer. This test doesn't bear that out.

Method: `TOPIC_PARTITIONS=6 pnpm reset:votes --yes`, then an identical run 1: 3 min at 20,000/s asked, 0% invalid codes, 5% repeat senders. Votes stayed keyed by idempotency key, so the partition count is the only difference. Figures are medians over the load, except where a row says otherwise.

| | 24 partitions | 6 partitions |
|---|---|---|
| Accepted, whole run | 719,825 (4,000/s) | 868,567 (4,825/s) |
| Accepted/s, median | 4,161 | 4,501 |
| Ingest CPU | 1.01 cores | 1.00 cores |
| Ingest CPU per 1,000 votes | 243 ms | 222 ms |
| Ingest request p95 | 54 ms | 49 ms |
| Generator p95 | 2,207 ms | 61 ms |
| Counted/s | 4,051 | 4,050 |
| Consumer batch | 467 votes in 114 ms | 466 votes in 116 ms |
| Consumer CPU per 1,000 votes | 128 ms | 121 ms |
| Postgres / Redpanda CPU | 0.57 / 0.24 | 0.48 / 0.15 |
| Backlog peak | 47,660 | 180,373 |
| Share of samples with COMMIT waiting on `WalSync` | 6% | 13% |

**Counts:** 868,567 accepted = 868,567 counted, and `pnpm reconcile` found no drift.

**Conclusions:**
- **The consumer doesn't care about the partition count.** Rate, batch time and CPU per vote are the same.
- **Ingest is about 9% cheaper per vote at 6 partitions,** and Redpanda uses less CPU, so it accepted about 8% more (median). That's a small effect, within the run-to-run spread seen before: two identical F19 spike runs differed by 6 ms at p95.
- **The generator p95 gap (2.2 s against 61 ms)** comes from its own request queue once ingest is saturated. It isn't a partition effect.
- **The bigger backlog at 6 partitions comes from the disk,** not the partitions: more votes arrived, and COMMIT waited on the disk twice as often.
- **The earlier "2.4× per vote" came from comparing unmatched samples.** It was a single 30 s window during a ramp. F35's cost is at most around 10% of ingest CPU, and 24 stays the default.
