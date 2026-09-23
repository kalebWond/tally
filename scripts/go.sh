#!/usr/bin/env bash
# Run a Go command for tools/generator: host Go if installed, otherwise the same image the
# Dockerfile builds with. Mounts the whole repo so the contract test can read
# packages/contracts/schemas. Usage: scripts/go.sh test ./...
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
if command -v go >/dev/null 2>&1; then
  cd "$root/tools/generator" && exec go "$@"
fi
cache="${XDG_CACHE_HOME:-$HOME/.cache}/tally-go"
mkdir -p "$cache/build" "$cache/mod"
exec docker run --rm --network host -u "$(id -u):$(id -g)" \
  -v "$root:/repo" -v "$cache/build:/gocache" -v "$cache/mod:/gomod" \
  -e GOCACHE=/gocache -e GOMODCACHE=/gomod -e HOME=/tmp \
  -w /repo/tools/generator golang:1.27-alpine go "$@"
