#!/usr/bin/env bash
# F38: builds the generator as a Windows program for a second device without Docker or Go, plus a
# launcher that points it at this machine's ingest. Copy both files from tools/generator/bin/.
# Usage: pnpm generator:exe [app-host]   (default: this machine's first LAN address)
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
host="${1:-$(hostname -I | awk '{print $1}')}"
out="$root/tools/generator/bin"
mkdir -p "$out"

GOOS=windows GOARCH=amd64 CGO_ENABLED=0 "$root/scripts/go.sh" \
  build -trimpath -ldflags="-s -w" -o bin/generator.exe .

# Windows line endings, so Notepad and cmd.exe read it cleanly.
sed 's/$/\r/' >"$out/run-generator.cmd" <<EOF
@echo off
rem Tally load generator (F38). Sends votes to the app machine's ingest; controlled from its /control page.
rem If the app machine's address changes, edit INGEST_URL below.
set INGEST_URL=http://$host:4000
rem Each worker waits for its own request, so the rate is capped at workers / latency. Over Wi-Fi to
rem a busy laptop a round trip took ~56 ms, so 256 capped it near 4,600 votes/s (F38); raise it to go higher.
set GENERATOR_WORKERS=256
set PORT=4002
echo Tally generator on port %PORT%, sending to %INGEST_URL%. Ctrl+C to stop.
"%~dp0generator.exe"
pause
EOF

ls -la "$out/generator.exe" "$out/run-generator.cmd"
echo "Copy both to the second device and run run-generator.cmd (ingest: http://$host:4000)."
