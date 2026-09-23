#!/usr/bin/env bash
# F1 done-when check: infrastructure is healthy and every service's /health returns 200.
# Works for both modes: services on the host (pnpm dev) or in containers (--profile app).
set -euo pipefail

TIMEOUT="${TIMEOUT:-90}"
fail=0

wait_for() {
  local name="$1" check="$2" deadline=$((SECONDS + TIMEOUT))
  until eval "$check" >/dev/null 2>&1; do
    if ((SECONDS >= deadline)); then
      printf '  FAIL  %s\n' "$name"
      fail=1
      return
    fi
    sleep 1
  done
  printf '  ok    %s\n' "$name"
}

echo "infrastructure"
for svc in redpanda postgres redis clickhouse; do
  wait_for "$svc" "[ \"\$(docker inspect -f '{{.State.Health.Status}}' \$(docker compose ps -q $svc))\" = healthy ]"
done

echo "services"
for target in web:3000 ingest:4000 gateway:4001 generator:4002 consumer:4003 analytics-consumer:4004; do
  wait_for "${target%%:*} /health" "curl -fsS http://localhost:${target##*:}/health"
done

exit "$fail"
