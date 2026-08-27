#!/usr/bin/env bash
#
# Restore a Postgres backup produced by scripts/backup-db.sh.
#
# Usage:
#   scripts/restore-db.sh backups/course_platform_2026-08-28_03-00-00.sql.gz
#   scripts/restore-db.sh backups/course_platform_....sql.gz.gpg   # gpg-encrypted
#
# THIS IS DESTRUCTIVE: it drops and recreates the target database before
# loading the dump. It asks for confirmation unless RESTORE_YES=1 is set.
#
# A backup you have never restored is not a backup. Test this at least once
# against a throwaway database (set DB_NAME to something else) so you know it
# actually works before you ever need it for real.
#
# Config via env:
#   COMPOSE_FILE          compose file to target (default: docker-compose.prod.yml)
#   BACKUP_GPG_PASSPHRASE required if the file ends in .gpg
#   RESTORE_YES=1         skip the interactive confirmation

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
DB_NAME="course_platform"
DB_USER="postgres"

archive="${1:-}"
if [ -z "$archive" ] || [ ! -f "$archive" ]; then
  echo "Usage: $0 <path-to-backup.sql.gz[.gpg]>" >&2
  exit 1
fi

if [ "${RESTORE_YES:-}" != "1" ]; then
  echo "About to DROP and recreate database '$DB_NAME' and load: $archive"
  read -r -p "Type 'yes' to continue: " confirm
  [ "$confirm" = "yes" ] || { echo "Aborted."; exit 1; }
fi

# Decrypt+decompress or just decompress, streaming into psql. Recreate the
# database first so the restore starts from a clean schema.
decode() {
  case "$archive" in
    *.gpg)
      : "${BACKUP_GPG_PASSPHRASE:?BACKUP_GPG_PASSPHRASE required for a .gpg file}"
      gpg --batch --quiet --decrypt --passphrase "$BACKUP_GPG_PASSPHRASE" "$archive" | gunzip
      ;;
    *.gz) gunzip -c "$archive" ;;
    *) cat "$archive" ;;
  esac
}

echo "[restore] recreating database $DB_NAME"
docker compose -f "$COMPOSE_FILE" exec -T postgres \
  psql -U "$DB_USER" -d postgres -v ON_ERROR_STOP=1 \
  -c "DROP DATABASE IF EXISTS $DB_NAME WITH (FORCE);" \
  -c "CREATE DATABASE $DB_NAME;"

echo "[restore] loading dump"
decode | docker compose -f "$COMPOSE_FILE" exec -T postgres \
  psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -q

echo "[restore] done — restart the api so it reconnects cleanly:"
echo "  docker compose -f $COMPOSE_FILE restart api"
