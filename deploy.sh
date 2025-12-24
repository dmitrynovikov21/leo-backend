#!/usr/bin/env bash
set -Eeuo pipefail

SSH_HOST="${SSH_HOST:-144.124.249.196}"
SSH_USER="${SSH_USER:-root}"
SSH_PORT="${SSH_PORT:-22}"
SSH_IDENTITY="${SSH_IDENTITY:-}"
REMOTE_DIR="${REMOTE_DIR:-/root/leo}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"

SSH_OPTS=(-p "${SSH_PORT}" -o StrictHostKeyChecking=accept-new -o ServerAliveInterval=60 -o ServerAliveCountMax=10)
SCP_OPTS=(-P "${SSH_PORT}" -o StrictHostKeyChecking=accept-new)
[[ -n "${SSH_IDENTITY}" ]] && { SSH_OPTS+=(-i "${SSH_IDENTITY}"); SCP_OPTS+=(-i "${SSH_IDENTITY}"); }

remote() { ssh "${SSH_OPTS[@]}" "${SSH_USER}@${SSH_HOST}" "bash -lc 'unset DOCKER_HOST; $*'"; }

echo "=== Leo AI Platform Deploy ==="
echo "Target: ${SSH_USER}@${SSH_HOST}:${REMOTE_DIR}"
echo ""

echo "[1/5] Syncing files -> ${REMOTE_DIR}"
ssh "${SSH_OPTS[@]}" "${SSH_USER}@${SSH_HOST}" "mkdir -p '${REMOTE_DIR}'"
rsync -az --delete \
  --exclude .git \
  --exclude node_modules \
  --exclude .cache \
  --exclude dist \
  --exclude .idea \
  --exclude .DS_Store \
  --exclude '*.log' \
  -e "ssh ${SSH_OPTS[*]}" \
  ./ "${SSH_USER}@${SSH_HOST}:${REMOTE_DIR}/"

echo "[2/5] Building leo-gateway"
remote "cd '${REMOTE_DIR}' && docker compose -f '${COMPOSE_FILE}' build leo-gateway"

echo "[3/5] Building agent-orchestrator"
remote "cd '${REMOTE_DIR}' && docker compose -f '${COMPOSE_FILE}' build agent-orchestrator"

echo "[4/5] Building agent-runtime image"
remote "cd '${REMOTE_DIR}/services/agent-runtime' && docker build -t leo-agent-runtime:latest ."

echo "[5/5] Starting containers"
remote "cd '${REMOTE_DIR}' && docker compose -f '${COMPOSE_FILE}' up -d"

echo ""
echo "✅ Deploy complete!"
echo "🌐 Gateway:      http://${SSH_HOST}:8080"
echo "🤖 Orchestrator: http://${SSH_HOST}:8081"
echo "📊 LiteLLM UI:   http://${SSH_HOST}:4000"
