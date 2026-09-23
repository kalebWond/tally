# Tally — Features

Grouped by milestone. Each phase ends in something that runs.

---

## Milestone 1 — Working pipeline

The vote makes it end to end. Nothing is pretty yet.

- **F1. Monorepo and local stack** — pnpm workspaces, Docker Compose running Redpanda, Postgres and Redis, shared contracts package
- **F2. Database schema and seed** — migrations for all tables, seed script creating a contest with 8–12 contestants and codes
- **F3. Ingest API** — `POST /votes`, shape validation, sender hashing, idempotency key generation, 202 response
- **F4. Publish to Redpanda** — `votes.raw` topic partitioned by code, producer with retry
- **F5. Consumer and totals** — batch consume, resolve code to contestant, write vote log to Postgres, increment Redis counters, redelivery guard
- **F6. Dead-letter handling** — unresolvable codes routed to `votes.dead` with a reason, never dropped

**At the end of this milestone:** you can curl a vote in and see a Redis counter move.

---

## Milestone 2 — It comes alive

The part that makes people stop scrolling.

- **F7. Realtime gateway** — polls Redis, diffs totals, broadcasts changes over WebSocket, sends a snapshot on connect
- **F8. Ranked results list** — live-sorted rows, one component per contestant
- **F9. Animated counters** — numbers spring toward each new target instead of restarting; no stutter under rapid updates
- **F10. Reorder animation** — rows glide past each other on an overtake
- **F11. Connection handling** — visible connection state, automatic reconnect, fresh snapshot on reconnect
- **F12. Go vote generator** — configurable rate, burst mode, invalid-code ratio, duplicate senders, HTTP control API
- **F13. Generator control panel** — start, stop, set rate, trigger a burst, live status readout

**At the end of this milestone:** you can ramp to 3,000 votes/sec from a control panel and watch the leaderboard fight it out. This is the demo.

---

## Milestone 3 — Operational depth

What separates a demo from something that looks like it was built by someone who has run software in production.

- **F14. Admin: contestants** — create, edit, activate and deactivate contestants; set code, image, accent colours, country
- **F15. Admin: dead letters** — browse rejected votes with reasons, filter by reason
- **F16. Contest lifecycle** — open and close voting; votes arriving while closed are dead-lettered, not counted
- **F17. Minute buckets and chart** — per-minute aggregation written by the consumer, votes-over-time chart on the results page
- **F18. Reconciliation job** — recount from the Postgres vote log, compare against Redis, report drift
- **F19. Load testing with k6** — scripted ramp and burst profiles, published throughput and latency numbers

---

## Milestone 4 — Analytics separation

- **F20. Analytics consumer** — second consumer group, batched inserts into ClickHouse
- **F21. ClickHouse schema** — wide events table suited to scans and grouping
- **F22. Analytics page** — turnout over time, lead-change history, breakdown by source, queries over millions of rows

**Why it matters:** this is the honest version of "separation between operational and reporting workloads." Stalling the analytics consumer on purpose, while live results keep running, is a great thing to show.

---

## Milestone 5 — Polish and presentation

- **F23. Metrics and dashboards** — Prometheus scraping every service, Grafana dashboards for throughput, consumer lag, ingest latency
- **F24. Card grid view** — portrait, name, optional flag, gradient from accent colours; layout toggle shares the list's data and component
- **F25. Remotion results recap** — auto-generated video of the contest: animated bar race, final standings, winner reveal. Doubles as the portfolio demo reel
- **F26. Deployment** — environment-variable swap onto a chosen host, public URL
- **F27. README and case study** — architecture diagrams, published benchmark numbers, decisions and trade-offs

---

## Optional final phase — Kubernetes

Only after everything above. Requires no application code or schema changes.

- **F28. Manifests** — Deployment and Service per stateless service, ConfigMaps and Secrets, readiness and liveness probes, resource requests and limits
- **F29. Local cluster** — kind or k3d, image builds, one-command bring-up
- **F30. KEDA autoscaling on consumer lag** — ramp the generator, watch lag climb, pods scale 1→N, backlog drains, pods scale down. Record it.

---

## Deliberately out of scope

Real SMS or telecom integration. Multi-tenancy. Production-grade auth (shared password is enough here — showcase real auth in a different project). Mobile apps. Payment or monetisation.
