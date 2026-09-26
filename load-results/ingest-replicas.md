# Ingest replicas behind nginx (F36)

2026-09-25, full `app` stack on the laptop (i5-1135G7: 4 cores, 8 threads). Topics had 24 partitions and votes were keyed by idempotency key.

**Method:**
- Both consumers were stopped during the loads, so only the generator, nginx, ingest and Redpanda did work.
- The Go generator asked for 20,000 votes/s (its maximum) for 90 s against Tally Showcase, with 0% invalid codes and 5% repeat senders. This was done at 1, 2 and 3 replicas (`--scale ingest=N`).
- Afterwards, the consumers were restarted to drain the backlog, and the counts were checked.

| Replicas | Accepted (90 s) | Accepted/s | vs 1 replica | Failed | Generator p95 |
|---|---|---|---|---|---|
| 1 | 590,848 | 6,565 | — | 0 | 39 ms |
| 2 | 649,302 | 7,214 | +10% | 0 | 77 ms |
| 3 | 743,694 | 8,263 | +26% | 0 | 67 ms |

CPU per container, averaged over each load (docker stats; 1.0 = one logical thread):

| Replicas | Each ingest replica | nginx | Generator | Redpanda | Total |
|---|---|---|---|---|---|
| 1 | 1.08 | 0.41 | 0.77 | 0.09 | 2.48 |
| 2 | 0.99, 1.02 | 0.66 | 1.17 | 0.25 | 4.23 |
| 3 | 0.97, 0.92, 0.90 | 0.79 | 1.36 | 0.33 | 5.44 |

**Counts:**
- The 1,983,844 accepted votes were all counted: Postgres held 1,983,844 votes and no dead letters, and ClickHouse 1,983,844 distinct keys.
- `pnpm reconcile` found no drift.
- The backlog of about 2 million votes drained in 293 s with one consumer, about 6,800/s with nothing else loading the laptop.

## Findings
- **nginx spreads the load evenly.** Each replica ran at about one full thread.
- **Intake rises, but the laptop caps it.**
  - At 3 replicas the containers used 5.4 of 8 logical threads on 4 physical cores. Hyperthreads share a core, and a laptop lowers its clock as more cores are busy.
  - So each replica's throughput fell as replicas were added: 6,565/s alone, about 2,750/s each at 3.
  - The generator (1.4 threads) and nginx (0.8) compete for the same cores. Moving the generator to another machine is the next way to see the replicas' real scaling.
- **nginx isn't free.** It costs about 0.1 thread per 1,000 requests/s. In production, the host's load balancer carries that.
- **Stopping the consumers matters on one machine.** One replica accepted 6,565/s here, against about 4,200/s in the peak test with the consumers and Postgres running (`consumer-peak.md`).
- **Nothing was lost.** No failures, and exact counts.

**Also found:** Prometheus reads `prometheus.yml` only at startup. During the runs it still used the old static `ingest:4000` target, so it scraped one replica at a time and its ingest figures undercounted. The figures above come from the generator and from Postgres. After a restart, Prometheus found all three replicas through DNS.
