# Consumer replicas: the whole pipeline (F37)

2026-09-25, full `app` stack on the laptop (i5-1135G7: 4 cores, 8 threads). Everything was running, including the analytics consumer and ClickHouse. There were 2 ingest replicas behind nginx, 24 partitions, and votes keyed by idempotency key.

**Method:**
- For each count of 1, 2 and 3 consumers (`--scale consumer=N`), wait until the group is stable with every member holding partitions.
- The Go generator asks for 20,000 votes/s (its maximum) for 90 s on Tally Showcase, with 0% invalid codes and 5% repeat senders.
- After each load, wait until the backlog has drained.
- Rates are medians over the load (Prometheus, summed across replicas). CPU is averaged over the load (docker stats; 1.0 = one logical thread).

| Consumers | Partitions each | Accepted/s | Counted/s | Backlog peak | Drain after stop |
|---|---|---|---|---|---|
| 1 | 24 | 7,699 | 3,801 | 368,075 | 69 s (about 4,950/s) |
| 2 | 12 / 12 | 5,120 | 4,708 | 52,273 | 10 s |
| 3 | 8 / 8 / 8 | 4,634 | 4,626 | 0 | 3 s |

CPU during each load:

| Consumers | Ingest ×2 | nginx (included in ingest) | Consumers | Postgres | Generator | Redpanda | Analytics + ClickHouse | Total |
|---|---|---|---|---|---|---|---|---|
| 1 | 2.55 | 0.62 | 0.53 | 0.51 | 1.06 | 0.38 | 0.53 | 5.60 |
| 2 | 2.25 | 0.50 | 0.87 | 0.81 | 0.84 | 0.36 | 0.51 | 5.70 |
| 3 | 2.14 | 0.47 | 1.27 | 0.98 | 0.77 | 0.44 | 0.43 | 6.09 |

**Counts:**
- The 1,631,357 accepted votes were all counted: Postgres held 1,631,357 votes and no dead letters, and ClickHouse 1,631,357 distinct keys.
- `pnpm reconcile` found no drift.
- Batch failures: 0. Deadlocks in the consumers' logs: none.

## Findings
- **Counting keeps up with intake from 2–3 consumers.**
  - With 1 consumer, counting ran at about half the intake, and the backlog reached 368,000 votes. The board would have been over a minute behind.
  - With 2, it counted 92% of the intake.
  - With 3, it counted everything as it arrived, and no backlog formed.
- **Throughput for the whole pipeline barely moved:** 3,801, then 4,708, then 4,626 votes/s counted.
  - The laptop was at its limit throughout: 5.6–6.1 of 8 logical threads on 4 physical cores.
  - Each consumer (with its share of Postgres) took CPU from ingest, so intake fell from 7,699 to 4,634/s while counting rose.
  - On this machine, the whole pipeline runs at about 4,600–4,700 votes/s however the work is split.
- **The shared rows didn't hold anything up.** Batch times stayed at 93–118 ms, and none failed.
- **What more consumers buy here is a board that keeps up,** not more total throughput. On a machine with spare cores, the two should add up. That needs a bigger host, or the generator on another device.
