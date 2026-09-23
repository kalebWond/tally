#!/usr/bin/env python3
"""Generates infra/grafana/dashboards/tally.json (F23). Edit here, then run it:
python3 scripts/grafana-dashboard.py"""
import json, pathlib

DS = {"type": "prometheus", "uid": "prometheus"}
LAG = """clamp_min(sum by (redpanda_group) (
  max by (redpanda_topic, redpanda_partition) (redpanda_kafka_max_offset{redpanda_namespace="kafka", redpanda_topic=~"votes.raw|votes.dead"})
  - on (redpanda_topic, redpanda_partition) group_right
  max by (redpanda_group, redpanda_topic, redpanda_partition) (redpanda_kafka_consumer_group_committed_offset{redpanda_topic=~"votes.raw|votes.dead"})
), 0)"""
Q = lambda q: f'histogram_quantile({q}, sum by (le) (rate(tally_ingest_request_duration_seconds_bucket{{route="/votes"}}[30s])))'

panels, y = [], 0
def target(expr, legend, ref):
    return {"datasource": DS, "expr": expr, "legendFormat": legend, "refId": ref}
def panel(kind, title, targets, w, h, unit="short", desc="", extra=None):
    global y
    p = {"type": kind, "title": title, "description": desc, "datasource": DS,
         "gridPos": {"x": panel.x, "y": y, "w": w, "h": h},
         "targets": [target(e, l, chr(65 + i)) for i, (e, l) in enumerate(targets)],
         "fieldConfig": {"defaults": {"unit": unit}, "overrides": []}, "options": {}}
    if kind == "timeseries":
        p["fieldConfig"]["defaults"]["custom"] = {"lineWidth": 2, "fillOpacity": 12, "showPoints": "never", "spanNulls": True}
        p["options"] = {"legend": {"displayMode": "list", "placement": "bottom"}, "tooltip": {"mode": "multi"}}
    if kind == "stat":
        p["options"] = {"reduceOptions": {"calcs": ["lastNotNull"]}, "colorMode": "value", "graphMode": "area"}
        # One neutral colour: Grafana's default thresholds paint any value over 80 red.
        p["fieldConfig"]["defaults"]["color"] = {"mode": "fixed", "fixedColor": "#4cc2ff"}
    if extra: p.update(extra)
    panel.x += w
    if panel.x >= 24: panel.x, y = 0, y + h
    panels.append(p)
panel.x = 0

# Headline
panel("stat", "Votes accepted /s", [("sum(rate(tally_ingest_votes_accepted_total[30s]))", "")], 5, 4, "short")
panel("stat", "Ingest p95", [(Q(0.95), "")], 5, 4, "s")
TOTALS_LAG = """clamp_min(sum(
  max by (redpanda_topic, redpanda_partition) (redpanda_kafka_max_offset{redpanda_namespace="kafka", redpanda_topic="votes.raw"})
  - on (redpanda_topic, redpanda_partition) group_right
  max by (redpanda_group, redpanda_topic, redpanda_partition) (redpanda_kafka_consumer_group_committed_offset{redpanda_group="tally-consumer", redpanda_topic="votes.raw"})
), 0)"""
panel("stat", "Totals consumer lag", [(TOTALS_LAG, "")], 5, 4, "short", "Votes on votes.raw not yet counted")
panel("stat", "Ingest errors /s", [('sum(rate(tally_ingest_requests_total{route="/votes", status=~"5.."}[30s])) or vector(0)', "")], 5, 4, "short")
panel("stat", "Viewers", [("sum(tally_gateway_clients)", "")], 4, 4, "short")

def group_lag(group, topic="votes.raw"):
    return f"""clamp_min(sum(
  max by (redpanda_topic, redpanda_partition) (redpanda_kafka_max_offset{{redpanda_namespace="kafka", redpanda_topic=~"votes.raw|votes.dead"}})
  - on (redpanda_topic, redpanda_partition) group_right
  max by (redpanda_group, redpanda_topic, redpanda_partition) (redpanda_kafka_consumer_group_committed_offset{{redpanda_group="{group}"}})
), 0)"""

# The live path: each panel on its own scale, so a burst reads as a shape.
panel("timeseries", "Throughput (votes/s)", [
    ("sum(tally_generator_target_rate)", "generator target"),
    ("sum(rate(tally_ingest_votes_accepted_total[30s]))", "accepted by ingest"),
    ('sum(rate(tally_consumer_messages_total{outcome="counted"}[30s]))', "counted by consumer"),
    ('sum(rate(tally_consumer_messages_total{outcome="dead_letter"}[30s]))', "dead-lettered"),
], 12, 9, "short", "Each stage's rate on the live path: when they separate, a stage is falling behind.")
panel("timeseries", "Totals consumer lag (messages)", [(group_lag("tally-consumer"), "tally-consumer")], 12, 9, "short",
      "votes.raw high watermark minus the totals consumer's committed offset (Redpanda's own metrics). A burst the consumer can't absorb at once shows here as a spike, then a drain.")
panel("timeseries", "Ingest latency, POST /votes", [(Q(0.5), "p50"), (Q(0.95), "p95"), (Q(0.99), "p99")], 12, 8, "s",
      "From request start to the 202, including the wait for acks=all.")
panel("timeseries", "Errors and rejections (/s)", [
    ('sum by (status) (rate(tally_ingest_requests_total{route="/votes", status!="202"}[30s]))', "ingest {{status}}"),
    ("sum(rate(tally_generator_failed_total[30s]))", "generator: no answer"),
    ("sum(rate(tally_consumer_batch_failures_total[30s]))", "consumer batch retries"),
    ("sum(rate(tally_analytics_insert_failures_total[30s]))", "ClickHouse insert retries"),
], 12, 8, "short")
panel("timeseries", "Consumer batch time, p95", [
    ("histogram_quantile(0.95, sum by (le) (rate(tally_consumer_batch_duration_seconds_bucket[30s])))", "p95"),
], 8, 7, "s", "One batch: Postgres transaction, dead-letter publish, Redis update.")
panel("timeseries", "Consumer batch size", [
    ("sum(rate(tally_consumer_batch_size_sum[30s])) / sum(rate(tally_consumer_batch_size_count[30s]))", "avg messages per batch"),
], 8, 7, "short", "Batches grow under load: the consumer keeps up by doing more per transaction.")
panel("timeseries", "Viewers", [("sum(tally_gateway_clients)", "connected"), ("sum(rate(tally_gateway_frames_total{type=\"update\"}[30s]))", "update frames/s")], 8, 7, "short")

# The analytics path: its own row, because a catch-up after downtime dwarfs live numbers.
panel("timeseries", "Analytics consumer lag (messages)", [(group_lag("tally-analytics"), "tally-analytics")], 12, 8, "short",
      "Separate consumer group: this can grow (e.g. ClickHouse down) while live results carry on.")
panel("timeseries", "Into ClickHouse (rows/s)", [
    ('sum by (table) (rate(tally_analytics_rows_total[30s]))', "{{table}}"),
], 12, 8, "short")

dashboard = {
    "uid": "tally", "title": "Tally", "tags": ["tally"], "timezone": "browser", "schemaVersion": 41,
    "refresh": "5s", "time": {"from": "now-15m", "to": "now"}, "editable": False,
    "panels": panels,
}
out = pathlib.Path(__file__).resolve().parent.parent / "infra/grafana/dashboards/tally.json"
out.write_text(json.dumps(dashboard, indent=2) + "\n")
print(f"wrote {out} ({len(panels)} panels)")
