#!/usr/bin/env bash
# Wipes every vote and everything derived from votes, keeping contests and contestants:
#   Postgres   votes, vote_totals, vote_buckets, dead_letters
#   Redis      each contest's totals and minutes, and the vote fields of its meta (status stays)
#   ClickHouse votes_raw, votes_dead
#   Redpanda   votes.raw and votes.dead recreated empty; both consumer groups deleted
# Services that touch votes are stopped first and started again afterwards. Works against the
# compose stack; with services running on the host (pnpm dev), stop them first.
#
# Usage: pnpm reset:votes [--yes]
set -euo pipefail
cd "$(dirname "$0")/.."

WRITERS=(generator ingest consumer analytics-consumer gateway)
CONSUMER_GROUPS=(tally-consumer tally-analytics)

yes=0
for arg in "$@"; do
  case "$arg" in
    --yes | -y) yes=1 ;;
    *) echo "unknown argument: $arg (usage: pnpm reset:votes [--yes])" >&2; exit 2 ;;
  esac
done

for svc in redpanda postgres redis clickhouse; do
  if [ -z "$(docker compose ps -q --status running "$svc")" ]; then
    echo "$svc isn't running. Start the stack first (pnpm stack:up or pnpm infra:up)." >&2
    exit 1
  fi
done

psql() { docker compose exec -T postgres sh -c 'psql -q -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At' ; }
ch() { docker compose exec -T clickhouse sh -c 'clickhouse-client --user "$CLICKHOUSE_USER" --password "$CLICKHOUSE_PASSWORD" -d "$CLICKHOUSE_DB" --multiquery' ; }
rpk() { docker compose exec -T redpanda rpk "$@"; }

votes=$(echo "select count(*) from votes" | psql)
dead=$(echo "select count(*) from dead_letters" | psql)
rows=$(echo "select (select count() from votes_raw) + (select count() from votes_dead)" | ch 2>/dev/null || echo 0)
echo "This deletes $votes votes, $dead dead letters and $rows analytics rows, for every contest."
echo "Contests and contestants are kept."
if ((!yes)); then
  if [ ! -t 0 ]; then
    echo "Not a terminal: pass --yes to confirm." >&2
    exit 1
  fi
  read -r -p 'Type "wipe" to continue: ' answer
  [ "$answer" = wipe ] || { echo "Nothing changed."; exit 1; }
fi

# Stop everything that writes or serves votes, remembering what was running.
running=()
for svc in "${WRITERS[@]}"; do
  [ -n "$(docker compose ps -q --status running "$svc" 2>/dev/null)" ] && running+=("$svc")
done
restart() { ((${#running[@]})) && docker compose --progress quiet --profile app up -d --no-deps --wait "${running[@]}" >/dev/null; }
if ((${#running[@]})); then
  echo "stopping ${running[*]}"
  docker compose --progress quiet stop "${running[@]}"
fi

# Host-mode services (pnpm dev) would keep writing during the wipe.
for target in ingest:4000 consumer:4003 analytics-consumer:4004; do
  if curl -fsS -m 2 "http://localhost:${target##*:}/health" >/dev/null 2>&1; then
    echo "${target%%:*} is still answering on :${target##*:}, so it's running outside Docker." >&2
    echo "Stop pnpm dev and run this again. Nothing was wiped." >&2
    restart
    exit 1
  fi
done

echo "postgres"
echo "truncate votes, vote_totals, vote_buckets, dead_letters restart identity" | psql

echo "redis"
docker compose exec -T redis redis-cli --raw eval "
  for _, k in ipairs(redis.call('KEYS', 'tally:*')) do
    if k:match(':totals\$') or k:match(':minutes\$') then redis.call('DEL', k)
    elseif k:match(':meta\$') then redis.call('HDEL', k, 'totalVotes', 'lastMinute', 'lastUpdated') end
  end
  return 1" 0 >/dev/null

echo "clickhouse"
echo "truncate table if exists votes_raw; truncate table if exists votes_dead" | ch

echo "redpanda"
rpk group delete "${CONSUMER_GROUPS[@]}" >/dev/null 2>&1 || true
rpk topic delete votes.raw votes.dead >/dev/null
for _ in $(seq 1 30); do
  rpk topic list | grep -qE '^votes\.(raw|dead) ' || break
  sleep 1
done
docker compose --progress quiet run --rm --no-deps topics >/dev/null

if ((${#running[@]})); then
  echo "starting ${running[*]}"
  restart
fi
echo "done: every contest is back to zero votes."
