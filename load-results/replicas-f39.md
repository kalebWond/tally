# Replicas + F39 finale measurement (branch `two-device`, 2026-09-26)

Measurement only: no code, config or `.env` changes. Scripts and raw data are in the session
scratchpad (`rf39-common.mjs`, `rf39-run.mjs`, `rf39-partA.mjs`, `rf39-finale.mjs`,
`rf39-partA.json`, `rf39-finale.json`).

## Method

- Stack: `docker compose --profile app` on the laptop (8 threads, 15 GB), single-machine mode,
  2 ingest replicas behind nginx, topics with 24 partitions. Contest "Tally Showcase" (C1–C10).
- Each run: generator asks 20,000/s for 90 s, `invalidCodeRatio` 0.02, `duplicateSenderRatio`
  0.05, then stop and wait for zero lag on `tally-consumer` and `tally-analytics`.
- Consumers scaled with `docker compose --profile app up -d --no-deps --scale consumer=N consumer`,
  waited for `rpk group describe tally-consumer` to show N members, Stable, then 15 s.
- Rates: Prometheus `sum(rate(...[10s]))` sampled every 5 s over the load window (first 10 s
  skipped), median. Ingest p95/p50: `histogram_quantile` over `increase(...{route="/votes"}[90s])`
  (server side). Backlog: `rpk group describe` every 2 s (committed offsets). CPU: `docker stats`
  (800% = all 8 threads), median over the load window, replicas summed per service; host busy from
  `/proc/stat` in the same units.
- Correctness per run: generator `accepted` (status after stop) = increase of
  `sum(tally_ingest_votes_accepted_total)` = Showcase's new Postgres votes + new dead letters.

## Part A: one machine, 2 ingest replicas

| Consumers | Accepted/s (median, avg) | Counted/s (median) | Backlog peak | Drain after stop | Ingest p95 / p50 (server) | Generator p95 | Docker CPU (median) | Host busy | Failures |
|---|---|---|---|---|---|---|---|---|---|
| 2 (12/12 partitions) | 5,008, 5,561 | 4,107 | 77,280 | ~9 s | 54.4 / 23.0 ms | 108 ms | 567% | 768% of 800 | 0 failed, 0 rejected |
| 3 (8/8/8) | 4,124, 4,176 | 4,111 | 2,905 | ~3 s | 88.6 / 31.7 ms | 116 ms | 577% | 787% of 800 | 0 failed, 0 rejected |

CPU per service during load (docker stats, replicas summed):

| Service | 2 consumers | 3 consumers |
|---|---|---|
| ingest (×2) | 168% | 151% |
| consumer | 85% | 120% |
| postgres | 79% | 91% |
| generator | 78% | 66% |
| redpanda | 52% | 59% |
| ingest-proxy (nginx) | 49% | 42% |
| analytics-consumer | 29% | 24% |
| clickhouse | 17% | 16% |
| others | ~4% | ~4% |

Reading:

- The laptop is CPU-bound in both runs (host 96–98% busy), so the replica count moves CPU
  between intake and counting rather than adding capacity. With 2 consumers, intake ran ~5,000/s
  and counting ~4,100/s, so the backlog grew linearly to 77,280 and drained in ~9 s (~10,000/s)
  once the generator stopped and freed CPU. With 3 consumers, counting kept pace (backlog ≤ 2.9k)
  but intake fell to ~4,150/s and ingest p95 rose from 54 to 89 ms.
- The first 15 s of the 2-consumer run reached 8,500–10,500/s accepted before settling at ~5,000/s.

Correctness:

| Run | Generator accepted | Ingest counter increase | Postgres votes added | Dead letters added | Votes + dead | Match |
|---|---|---|---|---|---|---|
| 2 consumers | 501,604 | 501,604 | 491,558 | 10,046 | 501,604 | yes |
| 3 consumers | 376,621 | 376,621 | 368,944 | 7,677 | 376,621 | yes |

Dead letters equal the generator's `invalidSent` exactly (10,046 and 7,677).

## Finale with replicas (3 consumers, 2 ingest)

Board `/results/<showcase>?view=list` in headless Chrome (GPU, 1920×1080), sampled every 100 ms.
The generator asked 20,000/s for 30 s (92,854 accepted, ~3,100/s with Chrome running), but with
3 consumers the backlog was 0 at stop, so the fallback path was used: both consumers stopped,
39,998 more votes queued (5,000/s for 8 s), 13 s wait for the backlog fields to expire, close,
then consumers started 19.6 s after the close.

Timeline (relative to the close):

| When | Cue | Confetti | Beams (`data-period`) | Backlog chip | Podium rows |
|---|---|---|---|---|---|
| +0.3 s to +23.4 s (consumers stopped, then starting) | live | no | 36.0 / 36.0 | none (unknown) | 3 |
| +23.4 s to +34.1 s (counting 39,497 queued) | live | no | 20.5 → 3.3 | "Counting 39,497 … 1,661 queued votes" | 3 |
| +34.2 s | finale | starts (once) | 7.5 / 10.0 | fading out | 3 |
| +43.9 s | finale | ends (9.5 s) | 7.5 / 10.0 | none | 3 |

- While votes were queued after the close: cue `live`, no confetti. PASS.
- Confetti once, 9.5 s. Cue `finale`, beams 7.5 / 10.0. Three `.row[data-podium]` (1: C3, 2: C7,
  3: C6). PASS. 0 console errors.
- The finale fired while the chip still read "Counting 1,661 queued votes": the chip's number is
  an `AnimatedNumber` still springing down, while the board keys off the frame's `pending === 0`.
  It fired ~2 s before `rpk` showed lag 0, because `rpk` reports committed offsets, which trail the
  consumers' own positions. Not a defect as far as this run shows.
- Correctness: generator accepted 132,852 (92,854 + 39,998) = ingest counter increase 132,852 =
  130,369 votes + 2,483 dead letters.

## totalVotes against the rows (the known risk with several consumers)

After everything was counted (Showcase cumulative after Part A and the finale):

| Source | After Part A n=2 | After Part A n=3 | After finale |
|---|---|---|---|
| Postgres `count(*)` votes | 491,558 | 860,502 | 990,871 |
| Postgres sum of `vote_totals` | 491,558 | 860,502 | 990,871 |
| Postgres sum of `vote_buckets` | 491,558 | 860,502 | 990,871 |
| Redis `meta.totalVotes` | 491,558 | 860,502 | 990,871 |
| Redis sum `HVALS totals` | 491,558 | 860,502 | 990,871 |
| Redis sum `HVALS minutes` | 491,558 | 860,502 | 990,871 |
| Board header "votes cast" | — | — | 990,871 |
| Board sum of row totals | — | — | 990,871 |

No deficit reproduced: totalVotes and the per-minute sums matched the rows exactly after all
three multi-consumer runs. `pnpm reconcile` (no `--repair`) after the finale: "no drift" for both
contests. `--repair` was not needed. Caveat: the finale run restarted the consumers mid-run, and
each consumer rebuilds Redis from Postgres at startup, which would hide a deficit from before the
restart. The two Part A runs had no restart and still matched exactly.

ClickHouse cross-check before cleanup: `votes_raw` 1,011,077 rows / 1,011,077 `uniqExact(key_hash)`
= all accepted (501,604 + 376,621 + 132,852). `votes_dead` 20,837 rows / 20,206 unique = Postgres
dead letters (rows are as delivered).

## Part B: two devices (generator on the Windows PC, 192.168.1.4)

First attempt: at 192.168.1.2 the PC refused connections on port 4002 from 12:21 to 12:38 UTC.
It answered ping, but the generator wasn't running. After the PC's address changed to 192.168.1.4
with the generator running, Part B ran at 12:47 UTC. Scripts and raw data: `rf39-partB.mjs`,
`rf39-partB.json`, in the same scratchpad as the others.

Setup: `COMPOSE_FILE=compose.yaml:compose.two-device.yaml GENERATOR_HOST=192.168.1.4
CONSUMER_REPLICAS=3 docker compose --profile app up -d` (variables on the command line only, `.env`
untouched). The local generator was removed. `GENERATOR_HOST=192.168.1.4 pnpm check:health` passed
("generator /health (on 192.168.1.4)"), and Prometheus's `generator` target was up. 2 ingest
replicas, 3 consumers (8/8/8 partitions, Stable). The PC's launcher uses 256 workers and sends to
`http://192.168.1.11:4000`.

Schedule: `/start` 10,000/s asked, `/burst` 20,000/s for 30 s at 90 s, `/stop` at 120 s, then
drain. Same measurements as Part A, plus `ping -i 1 192.168.1.4` for the whole run.

| Phase | Accepted/s (median) | Counted/s (median) | Ingest p95 / p50 (server) | Generator p95 (PC side, whole run) |
|---|---|---|---|---|
| Steady, 10,000/s asked | 2,937 | 2,945 | 29.1 / 9.8 ms | — |
| Burst, 20,000/s asked | 2,915 | 2,910 | 31.7 / 11.1 ms | — |
| Whole run (120 s) | 2,937 (avg 2,931) | 2,943 | 29.7 / 10.1 ms | p50 64, p95 318, p99 380 ms |

- Backlog peak 569 (tally-consumer) and 3,390 (tally-analytics). Both drained within ~3 s of the stop.
- Laptop CPU during load: docker total 390% median (483% max), host busy 594% of 800. Per service:
  consumer 99%, ingest 97%, postgres 61%, redpanda 56%, nginx 36%, analytics-consumer 19%,
  clickhouse 12%. The generator's CPU is on the PC now.
- 0 failed, 0 rejected.

Intake was flat at ~2,900–3,100/s, and the burst didn't raise it. One outlier: a 5 s window at
4,606/s followed by one at 931/s, around 16–21 s in. That is lower than the ~4,600/s cap seen on
the previous two-device run.

### Network (ping RTT to 192.168.1.4, 1/s)

| Window | Samples | Lost | Min | Median | p95 | Max | Avg |
|---|---|---|---|---|---|---|---|
| Before load (14 s) | 14 | 0 | 5.0 | 60.6 | 112 | 112 | 55 ms |
| Steady (90 s) | 90 | 0 | 4.5 | 18.0 | 36.9 | 82.2 | 19 ms |
| Burst (30 s) | 30 | 0 | 5.2 | 14.2 | 44.2 | 45.8 | 19 ms |
| Drain / after (26 s) | 26 | 0 | 6.9 | 53.1 | 204 | 214 | 69 ms |
| Whole run | 160 | 0 | 4.5 | 21.1 | 98.6 | 214 | 30 ms |

Separating Wi-Fi from the pipeline:

- The pipeline wasn't the limit. Ingest answered in p50 10 ms / p95 30 ms server side (lower than
  in Part A, because the laptop wasn't saturated). Counting kept pace with intake (backlog ≤ 569),
  and the laptop had ~200% of CPU headroom.
- The generator saw p50 64 ms / p95 318 ms. So about 55 ms at the median, and ~290 ms at p95, went
  on the Wi-Fi path and the PC's HTTP client, not the pipeline.
- Intake matches the closed-loop limit of the launcher's 256 workers: 256 / 2,930 per s ≈ 87 ms
  average round trip, in line with the generator's latency distribution. More workers, or a wired
  link, is where more intake would come from. That was recorded, not changed.
- ICMP ping during load (median 18 ms) was much better than the ping before and after the load
  (median 53–61 ms, up to 214 ms), and than the coordinator's 4–330 ms spot check. So ICMP RTT
  alone doesn't explain the HTTP round trip. The Wi-Fi link's HTTP latency under load (the TCP
  queues, a p95 around 300 ms) is what limits intake.

### Correctness and totalVotes (Part B)

| Generator accepted | Ingest counter increase | Postgres votes | Dead letters | Votes + dead | Match |
|---|---|---|---|---|---|
| 351,765 | 351,765 | 344,566 | 7,199 (= `invalidSent`) | 351,765 | yes |

- After the drain, all of these were 344,566: Postgres `count(*)`, the `vote_totals` sum and the
  `vote_buckets` sum, and in Redis `totalVotes`, `HVALS totals` and `HVALS minutes`.
- No deficit with 3 consumers, and no consumer restart during this run.
- ClickHouse: `votes_raw` 351,765 rows / 351,765 unique; `votes_dead` 7,199 / 7,199.
- `pnpm reconcile` (no `--repair`): no drift on either contest.

Afterwards, Showcase was closed, and its data was deleted as before: 344,566 votes, 30 bucket rows,
10 total rows and 7,199 dead letters, plus Redis and ClickHouse. `docker compose --profile app up -d`
with no `COMPOSE_FILE`/`GENERATOR_HOST` brought back the local generator and 2 consumers.
`pnpm check:health` passed, and `pnpm reconcile` showed no drift.

## User's contest and cleanup

- "Ethiopian-got-talents-final" was **closed** (not open) at the start. Before and after
  (checked again after Part B):
  132,354 votes, 6,808 dead letters, Redis totalVotes/totals/minutes 132,354, ClickHouse 139,162
  raw / 6,808 dead. Unchanged.
- Showcase: data deleted from Postgres (990,871 votes, 60 bucket rows, 10 total rows, 20,206 dead
  letters), Redis (`totals`, `minutes`, meta `totalVotes`/`lastMinute`/`lastUpdated`) and
  ClickHouse (`votes_raw`, `votes_dead`, `mutations_sync = 1`). It ended closed and empty.
- `docker compose --profile app up -d` brought consumers back to 2 (the `.env` value). The consumer
  group was Stable with 2 members, `pnpm check:health` passed, and the final `pnpm reconcile`
  showed no drift on either contest.
