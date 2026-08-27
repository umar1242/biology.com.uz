#!/usr/bin/env bash
#
# One-command production deploy for a code update.
#
# Replaces the two-step "compose up -d --build" then "manually remember to run
# migrations" flow from DEPLOY.md — the manual second step is the easy one to
# forget, which silently runs new code against an old schema. This does both,
# in order, and (unlike the boot path in start-stack.sh) treats a migration
# failure as FATAL: an interactive deploy should stop and surface it, not leave
# you guessing.
#
#   ./scripts/deploy.sh
#
# Config via env:
#   COMPOSE_FILE   compose file to target (default: docker-compose.prod.yml)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
COMPOSE=(docker compose -f "$COMPOSE_FILE")

log() { echo "[deploy] $*"; }

log "Building and starting containers"
"${COMPOSE[@]}" up -d --build --remove-orphans

log "Waiting for Postgres to accept connections"
for _ in $(seq 1 45); do
  "${COMPOSE[@]}" exec -T postgres pg_isready -U postgres -d course_platform >/dev/null 2>&1 && break
  sleep 2
done
"${COMPOSE[@]}" exec -T postgres pg_isready -U postgres -d course_platform >/dev/null 2>&1 || {
  log "ERROR: Postgres did not become ready"; exit 1;
}

log "Applying migrations"
"${COMPOSE[@]}" exec -T api npx tsx src/db/migrate.ts

log "Deploy complete"
