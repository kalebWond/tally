# Two devices: generator on a second machine (F38)

2026-09-26. The load generator ran on a Windows PC (Ryzen 7 5800H, 192.168.1.2:4002). The whole `app` stack ran on the laptop (i5-1135G7: 4 cores, 8 threads, 192.168.1.11) in two-device mode: `COMPOSE_FILE=compose.yaml:compose.two-device.yaml` and `GENERATOR_HOST=192.168.1.2`. Votes went over the LAN to the laptop's nginx on :4000.

**Replicas running:** ingest ×2 (behind nginx), consumer ×2, analytics-consumer ×1, plus Postgres, Redis, Redpanda, ClickHouse, gateway, web, Prometheus and Grafana. No local generator ran.

## Method
- **Profile, on Tally Showcase (codes C1–C10):** one run, with `invalidCodeRatio` 0.02 and `duplicateSenderRatio` 0.05.
  - 10,000/s asked for 75 s.
  - `POST /burst` to 20,000/s for 30 s.
  - 10,000/s for 75 s.
  - Stop, then wait until `tally-consumer` and `tally-analytics` were both at zero lag.
- **Rates and latencies:** from Prometheus, summed across replicas, using 10 s `rate` windows sampled every 5 s. Each figure is the median over a phase. Only windows that lie wholly inside the phase are counted.
- **Generator latency:** its own `/status` p95, taken over its last few thousand requests and sampled every 5 s. This latency includes the network and nginx.
- **Backlog:** `rpk group describe` TOTAL-LAG, sampled every 2 s. The drain time therefore has a resolution of 2 s.
- **CPU:** from `docker stats`, as the median per container per phase. 100% is one logical thread; the laptop has 800%. "Host busy" comes from `/proc/stat` over the whole machine. It includes dockerd, kernel networking over Wi-Fi, the sampling tools and the desktop.
- Scripts: `two-device.mjs` and `two-device-analyse.mjs` in the session scratchpad (not in the repo).

## Results

The generator was asked for 10,000/s and 20,000/s, but it never sent more than about 4,600/s. See the findings.

| Phase | Length | Asked | Accepted/s | Counted/s (all outcomes) | Ingest p50 / p95 | Publish p95 | Generator p50 / p95 | Consumer lag, median / peak |
|---|---|---|---|---|---|---|---|---|
| steady-1 | 75 s | 10,000 | 4,588 | 4,226 | 18 / 53 ms | 49 ms | 57 / 103 ms | 4,291 / 10,348 |
| burst | 30 s | 20,000 | 3,935 | 3,607 | 26 / 89 ms | 87 ms | 60 / 124 ms | 14,191 / 18,388 |
| steady-2 | 75 s | 10,000 | 4,193 | 4,007 | 24 / 69 ms | 58 ms | 56 / 96 ms | 24,839 / 29,211 |
| drain | ≤4 s | 0 | – | ~5,100 (5 s windows) | – | – | – | 6,893 at the first sample, 0 at the next |

- **Whole run:** 761,669 votes in 180 s, an average of 4,231/s accepted.
- **Backlog:** it peaked at 29,211 at t = 166 s, in steady-2. It rose steadily from the burst onwards, because counting ran about 200–400/s behind intake. The analytics consumer's lag peaked at 5,424.
- **Drain after stop:** under 4 s for both `tally-consumer` and `tally-analytics`. The first sample after stop already read 0.

### Laptop CPU (median per phase, in logical threads)

| Phase | Ingest ×2 | nginx | Consumers ×2 | Postgres | Redpanda | Analytics + ClickHouse | Other (web, gateway, Redis, Prometheus, Grafana) | Containers total | Host busy (of 8) |
|---|---|---|---|---|---|---|---|---|---|
| steady-1 | 1.53 | 0.55 | 0.99 | 0.78 | 0.60 | 0.51 | 0.06 | **5.02** | **7.49** |
| burst | 1.39 | 0.47 | 0.77 | 0.70 | 0.54 | 0.45 | 0.06 | **4.38** | **7.84** |
| steady-2 | 1.52 | 0.55 | 0.81 | 0.80 | 0.56 | 0.47 | 0.06 | **4.76** | **7.62** |
| drain | 0.01 | 0.00 | 0.85 | 0.80 | 0.27 | 0.15 | 0.05 | 2.13 | 6.13 |

### Failures
- **Generator:** 761,669 sent, 761,669 accepted, 0 rejected, 0 failed.
- **Ingest:** every `/votes` response was a 202, and there were no 5xx responses. The nginx logs show no non-202 responses in the run.
- Consumer batch failures: 0. The logs of consumer, ingest, nginx and analytics had no errors or warnings.

### Correctness
Counts are exact counter deltas and table counts. Showcase had 0 votes and 0 dead letters before the run.

| | Count |
|---|---|
| Generator accepted | 761,669 |
| Ingest `tally_ingest_votes_accepted_total` Δ (1,732,451 − 970,782) | 761,669 |
| Postgres `votes` (Showcase) | 746,557 |
| Postgres `dead_letters` (Showcase, all `unknown_code`) | 15,112 (= generator `invalidSent`) |
| Votes + dead letters | **761,669 ✓** |
| `vote_totals` sum / `vote_buckets` sum / Redis totals and `totalVotes` | 746,557 each |
| ClickHouse `votes_raw` / `votes_dead` (distinct `key_hash`) | 761,669 / 15,112 |
| Consumer outcome Δ: counted / dead_letter / duplicate | 746,557 / 15,112 / 0 |

`pnpm reconcile` found no drift for either contest.

## Findings
- **The generator on the PC was the limit on intake, not the rate asked.**
  - Its 256 workers (the default `GENERATOR_WORKERS`, assuming it wasn't changed on the PC) each wait for their response. They send the next vote only after the last one returns.
  - The p50 round trip was about 56 ms, so it could send at most about 256 / 0.056 ≈ 4,600/s. That matches steady-1.
  - The round trip is about 38 ms more than ingest's own p50 of 18 ms. Wi-Fi accounts for some of that (idle ping 4.6–22.7 ms, 7.7 ms average); nginx and the laptop's saturated scheduler account for the rest.
- **The burst to 20,000/s didn't raise intake. Intake fell, to 3,935/s.**
  - The pacer asked for more, but latency rose (generator p95 124 ms), so the fixed worker pool completed fewer requests.
  - This is why the manual run looked calm: intake never exceeded about 4,600/s, so the backlog stayed small.
- **The laptop was saturated anyway.**
  - Host busy was 7.5–7.8 of 8 threads, even with the generator's CPU moved off the laptop.
  - About 2.5 threads of that were outside the containers: dockerd, containerd shims, kernel networking over Wi-Fi, and the sampling tools.
  - More generator workers would mostly add queueing on the laptop rather than throughput. That is an inference; it wasn't tested, since this was a single run with no tuning.
- **Counting nearly kept up.** Two consumers counted 92–96% of intake, so the backlog grew slowly to 29k over about 100 s. It drained in under 4 s once intake stopped, because the consumers had the CPU to themselves. The board lagged the intake by at most about 7 s (29k at about 4k/s).

## Compared with the single-machine baseline (`consumer-replicas.md`)

| | Single machine, 2 ingest + 2 consumers (asked 20k/s) | Two devices, 2 ingest + 2 consumers (asked 10k/20k/10k) |
|---|---|---|
| Accepted/s | 5,120 | 4,588 / 3,935 / 4,193 |
| Counted/s | 4,708 | 4,226 / 3,607 / 4,007 |
| Backlog peak | 52,273 | 29,211 |
| Drain | 10 s | ≤4 s |
| Container CPU | 5.70 (0.84 of it the generator) | 4.4–5.0 (no generator) |

Moving the generator off the laptop did **not** raise throughput. The pipeline still ran at about 4,000–4,600 votes/s, against the baseline's 4,700/s. The laptop stayed CPU-bound (host 7.5–7.8/8), and the remote generator's closed-loop worker pool, paying Wi-Fi and nginx latency, capped intake at about 4,600/s. To measure the pipeline's ceiling rather than the generator's, the next step would be more generator workers or a wired link. The larger step would be a host with spare cores. None of these was tried here.

## Caveats
- **Wi-Fi:** the laptop is on Wi-Fi (`wlp0s20f3`); how the PC is connected wasn't checked. The idle round trip was 4.6–22.7 ms, and that latency sits directly inside the generator's closed loop.
- **Worker count:** the PC's `GENERATOR_WORKERS` couldn't be read remotely. 256 is the default, and it fits Little's law: 4,588/s × about 56 ms ≈ 257 requests in flight.
- **One run only:** no repeats, no variance.
- **The drain phase lasted under 4 s:** its per-phase medians rest on one or two samples, and the lag sampling has a resolution of 2 s.
- **Rpk lag:** it is measured against committed offsets, so it can overstate the true backlog by up to one commit interval.
- **Host CPU includes the sampling itself:** a `docker compose exec rpk` every 2 s for each of two groups, plus `docker stats`.

## Cleanup
- Showcase was closed through the web API.
- Showcase had 0 votes before the run, so this run's data was deleted, filtered to the contest:
  - Postgres: 746,557 rows from `votes`, 40 from `vote_buckets`, 10 from `vote_totals` and 15,112 from `dead_letters`.
  - Redis: `:totals` and `:minutes` deleted, and `totalVotes`, `lastMinute` and `lastUpdated` removed from `:meta`.
  - ClickHouse: `ALTER TABLE votes_raw` / `votes_dead DELETE WHERE contest_id = …`.
- Afterwards, Showcase had 0 votes. Ethiopian-got-talents-final was unchanged: 922,341 votes, 48,441 dead letters, open, 970,782 raw rows in ClickHouse. `pnpm reconcile` found no drift.
- The stack was left running in two-device mode.
