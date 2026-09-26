#!/usr/bin/env bash
# F1 done-when check: infrastructure is healthy and every service's /health returns 200.
# Works for both modes: services on the host (pnpm dev) or in containers (--profile app).
set -euo pipefail
cd "$(dirname "$0")/.."
# F38: the generator may run on another machine (GENERATOR_HOST in the environment or .env).
gen_host="${GENERATOR_HOST:-$( [ -f .env ] && sed -n 's/^GENERATOR_HOST=//p' .env | tail -1 || true)}"
gen_host="${gen_host//[\"\']/}"

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
for target in web:3000 ingest:4000 gateway:4001 analytics-consumer:4004; do
  wait_for "${target%%:*} /health" "curl -fsS http://localhost:${target##*:}/health"
done
wait_for "generator /health${gen_host:+ (on $gen_host)}" "curl -fsS http://${gen_host:-localhost}:4002/health"

# Ingest and consumer replicas publish no host port in containers (F36, F37: they scale), so each
# is checked from inside; on the host (pnpm dev) there is one of each, on its own port. Ingest's
# port 4000 above is nginx, which reaches only one replica per request.
for svc in ingest:4000 consumer:4003; do
  name="${svc%%:*}" port="${svc##*:}"
  replicas=$(docker compose ps -q "$name" 2>/dev/null | wc -l)
  if ((replicas == 0)); then
    [ "$name" = consumer ] && wait_for "consumer /health" "curl -fsS http://localhost:$port/health"
    continue
  fi
  for i in $(seq 1 "$replicas"); do
    wait_for "$name $i /health" \
      "docker compose exec -T --index $i $name node -e \"fetch('http://localhost:$port/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))\""
  done
done

exit "$fail"
