# Tally — Skills

What this project proves, what you'll need to learn along the way, and how it maps to roles you're applying for.

---

## 1. Skills demonstrated

### Backend and distributed systems
Event-driven architecture with a Kafka-API queue. Partitioning strategy and why ordering per contestant matters. Consumer groups and independent offsets. At-least-once delivery and idempotent processing. Dead-letter handling. Replay as a recovery mechanism. Batch processing. Backpressure. Graceful shutdown.

### Data
Relational modelling for an append-only log plus derived aggregates. Separation of operational and analytical stores. Redis as a hot counter layer with Postgres as the source of truth. Columnar analytics with ClickHouse. Reconciliation between two stores.

### Real-time
WebSocket fan-out. Snapshot-then-delta protocol. Reconnection and resync. Diffing so only what changed goes over the wire.

### Frontend
React and Next.js with TypeScript. High-frequency UI updates without jank. Animation that retargets rather than restarts. Layout animation for reordering. Component design where one unit serves two layouts. Design system usage via Tailwind and shadcn/ui.

### Polyglot
Go for the load generator, TypeScript everywhere else, with a shared event contract kept in sync across both.

### Operations
Docker Compose for local orchestration. Health checks and probes. Prometheus metrics and Grafana dashboards. Load testing with k6 and published numbers. Optionally Kubernetes with lag-based autoscaling.

---

## 2. What you'll need to learn

Honest list — these are the parts that are new rather than a reapplication of what you already do.

| Topic | Why it's new | Where it lands |
|---|---|---|
| Redpanda and `rpk` | You used Kafka at Tiltek, but not this tooling | F4 |
| Partitioning strategy | Choosing keys deliberately rather than by default | F4 |
| Idempotent consumers | At-least-once delivery handling | F5 |
| Motion layout animation | New library, and the retarget pattern is subtle | F9, F10 |
| Go services | Concurrency, rate limiting, `net/http` | F12 |
| ClickHouse | New engine, different modelling instincts | F20, F21 |
| k6 | Scripting and reading the results honestly | F19 |
| Prometheus and Grafana | Instrumentation and dashboard design | F23 |
| Remotion | React that renders to video | F25 |
| KEDA | Scaling on a queue metric rather than CPU | F30, optional |

Everything else — Next.js, TypeScript, Node, Postgres, Redis, Docker — is territory you already work in.

---

## 3. How this maps to roles you've been applying to

| Requirement seen in job posts | Covered by |
|---|---|
| Kafka and event-driven architecture | F4, F5, F20 |
| WebSockets and real-time functionality | F7, F11 |
| PostgreSQL and query optimisation | F2, F17, F18 |
| Redis caching and counters | F5 |
| Operational vs. reporting workload separation | F20–F22 |
| Monitoring, alerting and observability | F23 |
| Docker and container-based development | F1, F26 |
| Kubernetes | F28–F30 |
| Golang | F12 |
| Data visualisation | F17, F22 |
| Debugging complex production-style systems | F18, F19 |
| Performance engineering and profiling | F19, F23 |
| Design systems and polished UI | F8–F10, F24 |

---

## 4. Interview talking points

Have a crisp answer ready for each of these. They come up.

- Why a queue instead of writing straight to the database, and what actually happens during a burst
- Why the ingest endpoint returns 202 rather than 200
- How you handle the same message being delivered twice
- Why votes are partitioned by code, and what breaks if they aren't
- Why Redis and Postgres hold overlapping data, and how you'd rebuild Redis if it vanished
- What happens to a vote with an unknown code, and why it isn't dropped
- Why the analytics consumer is in a separate consumer group
- Why counter animations retarget instead of restarting, and what it looks like when they don't
- What your measured throughput was, how you measured it, and where the bottleneck was

Answer from what you actually built and measured, not from theory. `DECISIONS.md` is where you keep the raw material for this.

---

## 5. Portfolio framing

Lead with the demo video rather than the repository. The 30-second clip is a generator ramping to 3,000 votes per second while the leaderboard reshuffles live.

Pair it with published benchmark numbers. "Sustained 1,000 votes/sec with p95 ingest latency under X ms" is a concrete claim you can defend, and it also backs the throughput figure already on your resume with something public.

Position it as a system, not a CRUD app: "real-time vote processing pipeline handling 3,000+ events/sec with live animated results," not "a voting website."
