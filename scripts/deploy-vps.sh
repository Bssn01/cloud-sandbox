#!/usr/bin/env bash
# Deploy the shared memory tier to the VPS. Usage: scripts/deploy-vps.sh user@host
# Requires: docker + docker compose on the VPS, and a .env present locally.
set -euo pipefail
cd "$(dirname "$0")/.."

TARGET="${1:?Usage: scripts/deploy-vps.sh user@host}"
REMOTE_DIR="${REMOTE_DIR:-~/autonomous-agent}"

if [[ ! -f .env ]]; then
  echo "ERROR: .env not found locally." >&2
  exit 1
fi

echo "Syncing compose + env to ${TARGET}:${REMOTE_DIR}..."
ssh "$TARGET" "mkdir -p ${REMOTE_DIR}"
scp docker-compose.vps.yml .env "${TARGET}:${REMOTE_DIR}/"

echo "Starting VPS memory stack..."
ssh "$TARGET" "cd ${REMOTE_DIR} && docker compose -f docker-compose.vps.yml up -d && docker compose -f docker-compose.vps.yml ps"
echo "Done. Point HERMES_REMOTE_ENDPOINT in your local .env at this host."
