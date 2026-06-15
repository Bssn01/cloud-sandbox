#!/usr/bin/env bash
# Tear down the LOCAL stack (keeps named volumes). Usage: scripts/down.sh [--volumes]
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ "${1:-}" == "--volumes" ]]; then
  echo "Stopping local stack and REMOVING volumes..."
  docker compose down -v
else
  echo "Stopping local stack (volumes preserved)..."
  docker compose down
fi
