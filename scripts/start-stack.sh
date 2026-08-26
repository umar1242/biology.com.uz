#!/usr/bin/env bash
#
# Boot entrypoint for the production stack, invoked by the
# course-platform.service systemd unit (see DEPLOY.md).
#
# `restart: unless-stopped` alone already survives a plain reboot, but it only
# resurrects containers that still exist. This script also covers the cases it
# does not: the stack was torn down with `compose down`, the compose file
# changed since last boot, or a new migration landed with a code update.
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE=(docker compose -f "$PROJECT_DIR/docker-compose.prod.yml")

cd "$PROJECT_DIR"

log() { echo "[start-stack] $*"; }

# systemd orders us after docker.service, but the daemon reports "active"
# slightly before its socket answers. A few seconds of patience here is
# cheaper than a failed boot that needs a human.
for _ in $(seq 1 30); do
  docker info >/dev/null 2>&1 && break
  sleep 2
done
docker info >/dev/null 2>&1 || { log "Docker daemon unavailable"; exit 1; }

log "Starting containers"
"${COMPOSE[@]}" up -d --remove-orphans

# Migrations are applied here rather than inside the API image: doing it at
# boot keeps a code update from silently running against an older schema, and
# drizzle's journal makes re-running a no-op.
log "Waiting for Postgres"
for _ in $(seq 1 45); do
  "${COMPOSE[@]}" exec -T postgres pg_isready -U postgres -d course_platform >/dev/null 2>&1 && break
  sleep 2
done

log "Applying migrations"
if "${COMPOSE[@]}" exec -T api npx tsx src/db/migrate.ts; then
  log "Migrations applied"
else
  # Don't fail the unit: the stack is already up and serving. A migration
  # problem needs a human, but taking the site down would not help.
  log "WARNING: migrations failed — site is up, but check the schema"
fi

log "Stack is up"
