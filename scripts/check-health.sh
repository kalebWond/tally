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
for target in web:3000 ingest:4000 gateway:4001 generator:4002 analytics-consumer:4004; do
  wait_for "${target%%:*} /health" "curl -fsS http://localhost:${target##*:}/health"
done

# Consumers publish no host port in containers (F37: they scale), so each replica is checked from
# inside; on the host (pnpm dev) there is one, on localhost:4003.
replicas=$(docker compose ps -q consumer 2>/dev/null | wc -l)
if ((replicas == 0)); then
  wait_for "consumer /health" "curl -fsS http://localhost:4003/health"
else
  for i in $(seq 1 "$replicas"); do
    wait_for "consumer $i /health" \
      "docker compose exec -T --index $i consumer node -e \"fetch('http://localhost:4003/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))\""
  done
fi

exit "$fail"
