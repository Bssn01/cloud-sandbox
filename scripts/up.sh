#!/usr/bin/env bash
# Bring up the LOCAL stack. Usage: scripts/up.sh
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ ! -f .env ]]; then
  echo "ERROR: .env not found. Copy .env.example to .env and fill it in." >&2
  exit 1
fi

echo "Validating compose config..."
docker compose config >/dev/null

echo "Starting local stack..."
docker compose up -d

echo "Waiting for services to report healthy..."
docker compose ps
echo "Done. Dashboards:"
echo "  Paperclip:  http://localhost:${PAPERCLIP_DASHBOARD_PORT:-7001}"
echo "  OpenClaw:   http://localhost:${OPENCLAW_GATEWAY_PORT:-8080}"
