# Shared plumbing for the e2e suites. Sourced, never executed.
#
# Everything environment-specific lives here, so each suite reads as a plain
# HTTP scenario. Three things differ between a developer's laptop and CI:
# where the API listens, how to reach the database, and which bot token signs
# Mini App initData. All three are answered below and nowhere else.

API=${API_BASE:-http://localhost:3000/api/v1}

# --- database -----------------------------------------------------------
# Two ways in, in priority order:
#   DATABASE_URL — a direct connection (CI runs psql on the runner itself)
#   PG_CONTAINER — docker exec into a running container (the local default)
# PSQL runs one query and prints a bare value; PSQL_STDIN takes a script on
# stdin, for the multi-statement cleanup blocks.
if [ -n "${DATABASE_URL:-}" ]; then
  PSQL() { psql "$DATABASE_URL" -t -A -c "$1"; }
  PSQL_STDIN() { psql "$DATABASE_URL" -q; }
else
  PG_CONTAINER=${PG_CONTAINER:-myproject-postgres-1}
  PG_USER=${PG_USER:-postgres}
  PG_DB=${PG_DB:-course_platform}
  PSQL() { docker exec -i "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" -t -A -c "$1"; }
  PSQL_STDIN() { docker exec -i "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" -q; }
fi

# --- Telegram initData signing ------------------------------------------
# This token only has to MATCH the one the API verifies with — it is an HMAC
# key on both sides, not a credential the suite authenticates with. That is
# why CI can use an obvious fake and still exercise the real signature check.
BOT_TOKEN=${TELEGRAM_BOT_TOKEN:-}
if [ -z "$BOT_TOKEN" ]; then
  _env_file="$(dirname "${BASH_SOURCE[0]}")/../apps/api/.env"
  [ -f "$_env_file" ] && BOT_TOKEN=$(grep -E '^TELEGRAM_BOT_TOKEN=' "$_env_file" | cut -d= -f2-)
fi
if [ -z "$BOT_TOKEN" ]; then
  echo "No bot token: set TELEGRAM_BOT_TOKEN or put it in apps/api/.env" >&2
  exit 1
fi

mint() { # mint <telegram_id> <username> <first_name> [query_id]
  python3 - "$BOT_TOKEN" "$1" "$2" "$3" "${4:-AAEtest}" <<'PY'
import sys,hmac,hashlib,json,time,urllib.parse
tok,uid,uname,fname,qid=sys.argv[1].strip(),int(sys.argv[2]),sys.argv[3],sys.argv[4],sys.argv[5]
user=json.dumps({"id":uid,"first_name":fname,"username":uname},separators=(',',':'),ensure_ascii=False)
d={"user":user,"auth_date":str(int(time.time())),"query_id":qid}
dcs="\n".join(f"{k}={d[k]}" for k in sorted(d))
sk=hmac.new(b"WebAppData",tok.encode(),hashlib.sha256).digest()
d["hash"]=hmac.new(sk,dcs.encode(),hashlib.sha256).hexdigest()
print(urllib.parse.urlencode(d))
PY
}
