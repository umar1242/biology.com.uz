#!/usr/bin/env bash
#
# Nightly Postgres backup for the prod deployment.
#
# Dumps the course_platform database out of the running postgres container,
# gzips it, optionally encrypts it, and prunes old copies. Designed to run
# from cron on the host (see DEPLOY.md § Backups).
#
# What it protects against: disk failure / accidental `docker volume rm` /
# a bad migration. It does NOT replace an off-host copy — after this writes
# the local dump you should also sync the backups dir somewhere off the
# machine (rclone/rsync to another disk or object storage).
#
# Config via env (all optional except where noted):
#   BACKUP_DIR            where dumps are written   (default: ./backups)
#   BACKUP_RETENTION_DAYS how many days to keep     (default: 14)
#   BACKUP_GPG_PASSPHRASE if set, dump is symmetrically encrypted with gpg
#   COMPOSE_FILE          compose file to target    (default: docker-compose.prod.yml)
#
# Exit non-zero on any failure so cron/monitoring can catch it.

set -euo pipefail

# Resolve repo root from this script's location, so cron can call it by
# absolute path without caring about the working directory.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

BACKUP_DIR="${BACKUP_DIR:-$REPO_ROOT/backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
DB_NAME="course_platform"
DB_USER="postgres"

mkdir -p "$BACKUP_DIR"

timestamp="$(date +%Y-%m-%d_%H-%M-%S)"
base="$BACKUP_DIR/${DB_NAME}_${timestamp}.sql.gz"

echo "[backup] dumping $DB_NAME -> $base"

# -T: no TTY (required under cron). pg_dump streams to stdout; gzip on the
# host so the dump never lands uncompressed on disk. `set -o pipefail` (above)
# makes a pg_dump failure fail the whole pipeline instead of a truncated file.
docker compose -f "$COMPOSE_FILE" exec -T postgres \
  pg_dump -U "$DB_USER" "$DB_NAME" | gzip > "$base"

# Refuse to keep a suspiciously tiny dump (empty/near-empty => something broke).
min_bytes=1000
actual_bytes="$(stat -c %s "$base")"
if [ "$actual_bytes" -lt "$min_bytes" ]; then
  echo "[backup] ERROR: dump is only ${actual_bytes} bytes — treating as failed" >&2
  rm -f "$base"
  exit 1
fi

final="$base"
if [ -n "${BACKUP_GPG_PASSPHRASE:-}" ]; then
  echo "[backup] encrypting with gpg"
  gpg --batch --yes --symmetric --cipher-algo AES256 \
    --passphrase "$BACKUP_GPG_PASSPHRASE" -o "${base}.gpg" "$base"
  rm -f "$base"
  final="${base}.gpg"
fi

echo "[backup] wrote $final ($(du -h "$final" | cut -f1))"

# Prune dumps older than the retention window.
echo "[backup] pruning dumps older than ${RETENTION_DAYS} days"
find "$BACKUP_DIR" -maxdepth 1 -type f -name "${DB_NAME}_*.sql.gz*" \
  -mtime +"$RETENTION_DAYS" -print -delete

echo "[backup] done"
