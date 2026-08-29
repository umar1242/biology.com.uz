#!/usr/bin/env bash
# End-to-end smoke of the Mini App (student) surface + isolation checks.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
PASS=0; FAIL=0; declare -a FAILURES
chk() { if [ "$2" = "$3" ]; then PASS=$((PASS+1)); printf '  ok   %-52s %s\n' "$1" "$3"
  else FAIL=$((FAIL+1)); FAILURES+=("$1 — exp $2 got $3 :: ${4:0:250}"); printf '  FAIL %-52s exp %s got %s\n     %s\n' "$1" "$2" "$3" "${4:0:250}"; fi }
req() { local m=$1 p=$2 d=$3 t=$4
  local a=(-s -o /tmp/_sb -w '%{http_code}' -X "$m" "$API$p")
  [ -n "$t" ] && a+=(-H "Authorization: Bearer $t")
  [ -n "$d" ] && a+=(-H 'Content-Type: application/json' -d "$d")
  RS=$(curl "${a[@]}"); RB=$(cat /tmp/_sb); }


echo "== STUDENT AUTH =="
ID1=$(mint 555000111 test_student "Тест")
req POST /app/auth/telegram "$(jq -cn --arg d "$ID1" '{init_data:$d}')"
chk "student auth (valid initData)" 200 "$RS" "$RB"
S1=$(echo "$RB" | jq -r .access_token)
req POST /app/auth/telegram '{"init_data":"user=%7B%22id%22%3A1%7D&hash=deadbeef"}'
chk "student auth (forged hash) -> 401" 401 "$RS" "$RB"
req POST /app/auth/telegram '{"init_data":""}'
chk "student auth (empty) -> 422" 422 "$RS" "$RB"
STALE="user=%7B%22id%22%3A555000111%2C%22first_name%22%3A%22T%22%7D&auth_date=1000000000&query_id=AAEtest"
req POST /app/auth/telegram "$(jq -cn --arg d "$STALE" '{init_data:$d}')"
chk "student auth (no hash) -> 401" 401 "$RS" "$RB"

IDO=$(mint 444000999 outsider "Чужак")
req POST /app/auth/telegram "$(jq -cn --arg d "$IDO" '{init_data:$d}')"
chk "outsider auth (auto-created student)" 200 "$RS" "$RB"
SO=$(echo "$RB" | jq -r .access_token)

# Both test identities start from a clean slate: a leftover application from
# an earlier run would make the "not onboarded" checks below pass by accident.
PSQL_STDIN >/dev/null 2>&1 <<SQL
DELETE FROM course_applications WHERE student_id IN (SELECT id FROM students WHERE telegram_id IN (555000111, 444000999));
DELETE FROM course_access WHERE student_id IN (SELECT id FROM students WHERE telegram_id IN (555000111, 444000999));
SQL

echo "== ONBOARDING GATE =="
# Filling in the questionnaire is now the first thing a student does, and the
# app is closed until they have. Nothing below this line worked before the
# suite was taught about it — the gate shipped and the suite never noticed.
req GET /app/profile "" "$S1"
chk "no application -> profile 403" 403 "$RS" "$RB"
req GET /app/courses "" "$S1"
chk "no application -> courses 403" 403 "$RS" "$RB"
chk "403 says why" "not_onboarded" "$(echo "$RB" | jq -r .error.code)" "$RB"
# The two routes the gate must let through, or a new student could never
# reach the form that opens it.
req GET /app/application-target "" "$S1"
chk "application target reachable while locked" 200 "$RS" "$RB"

TT=$(curl -s -X POST "$API/auth/login" -H 'Content-Type: application/json' -d '{"username":"alice","password":"secret1234"}' | jq -r .access_token)

# Provision a course the test student can actually see. Without this the
# suite silently shrinks to the auth/isolation checks whenever the dev
# database happens to have no granted course for this student.
echo "== SETUP =="
T() { curl -s -H "Authorization: Bearer $TT" -H 'Content-Type: application/json' "$@"; }
S1ID=$(curl -s -X POST "$API/app/auth/telegram" -H 'Content-Type: application/json' \
  -d "$(jq -cn --arg d "$ID1" '{init_data:$d}')" | jq -r .student_id)
SETUP_C=$(T -X POST "$API/courses" -d '{"title":"E2E Student Fixture","subject":"biology"}' | jq -r .id)
SETUP_M=$(T -X POST "$API/courses/$SETUP_C/modules" -d '{"title":"Модуль"}' | jq -r .id)
SFUT=$(date -u -d '+5 days' +%Y-%m-%dT%H:%M:%SZ)
SETUP_L=$(T -X POST "$API/modules/$SETUP_M/lessons" -d "{\"title\":\"Урок\",\"lesson_type\":\"recorded\",\"scheduled_at\":\"$SFUT\"}" | jq -r .id)
T -o /dev/null -X POST "$API/lessons/$SETUP_L/publish" -d '{"published":true}' >/dev/null
SETUP_H=$(T -X POST "$API/lessons/$SETUP_L/homework" -d "{\"instructions\":\"Фикстура\",\"deadline_at\":\"$SFUT\"}" | jq -r .id)
# A course of the outsider's own. Without it the isolation checks below
# could not run at all: an outsider with no application is stopped by the
# gate (403) long before any 404 could prove the courses are separated.
SETUP_C2=$(T -X POST "$API/courses" -d '{"title":"E2E Outsider Fixture","subject":"biology"}' | jq -r .id)

APPLY='{"full_name":"Тест Тестов","phone":"+998901234567","parent_phone_primary":"+998901112233","about_self":"e2e"}'
req POST "/app/courses/$SETUP_C/application" "$APPLY" "$S1"
chk "submit application" 201 "$RS" "$RB"
req POST "/app/courses/$SETUP_C/application" "$APPLY" "$S1"
chk "second application -> 409" 409 "$RS" "$RB"
req GET /app/profile "" "$S1"
chk "profile opens after application" 200 "$RS" "$RB"
req POST "/app/courses/$SETUP_C2/application" "$APPLY" "$SO"
chk "outsider applies to own course" 201 "$RS" "$RB"

SEXP=$(date -u -d '+30 days' +%Y-%m-%dT%H:%M:%SZ)
T -o /dev/null -X POST "$API/courses/$SETUP_C/students/$S1ID/access" -d "{\"expires_at\":\"$SEXP\"}" >/dev/null
echo "   fixture: course=$SETUP_C module=$SETUP_M lesson=$SETUP_L homework=$SETUP_H student=$S1ID"

# Removes everything this run created, so repeated runs don't pile up courses.
cleanup_fixture() {
  PSQL_STDIN >/dev/null 2>&1 <<SQL
BEGIN;
DELETE FROM bot_pending_actions WHERE target_homework_id = $SETUP_H OR target_lesson_id = $SETUP_L OR target_course_id IN ($SETUP_C, $SETUP_C2);
DELETE FROM notifications_log WHERE course_id IN ($SETUP_C, $SETUP_C2);
DELETE FROM course_disciplinary_events WHERE course_id = $SETUP_C;
DELETE FROM course_penalty_points WHERE course_id = $SETUP_C;
DELETE FROM course_blacklist WHERE course_id = $SETUP_C;
DELETE FROM course_access WHERE course_id IN ($SETUP_C, $SETUP_C2);
DELETE FROM course_applications WHERE course_id IN ($SETUP_C, $SETUP_C2);
DELETE FROM homework_submissions WHERE homework_id = $SETUP_H;
DELETE FROM homeworks WHERE id = $SETUP_H;
DELETE FROM lesson_materials WHERE lesson_id = $SETUP_L;
DELETE FROM lessons WHERE id = $SETUP_L;
DELETE FROM modules WHERE id = $SETUP_M;
DELETE FROM courses WHERE id IN ($SETUP_C, $SETUP_C2);
-- Ученик «Чужак» заводится автоматически при первом /app/auth/telegram —
-- без этого он оставался в базе после каждого прогона.
DELETE FROM course_access WHERE student_id IN (SELECT id FROM students WHERE telegram_id = 444000999);
DELETE FROM students WHERE telegram_id = 444000999;
COMMIT;
SQL
}
trap cleanup_fixture EXIT

echo "== CROSS-TOKEN ISOLATION =="
req GET /app/courses "" "$TT"
chk "staff token on student route -> 401" 401 "$RS" "$RB"
req GET /courses "" "$S1"
chk "student token on staff route -> 401" 401 "$RS" "$RB"
req GET /app/courses
chk "no token on student route -> 401" 401 "$RS" "$RB"

echo "== STUDENT DATA =="
req GET /app/profile "" "$S1"
chk "profile" 200 "$RS" "$RB"
echo "   $(echo "$RB" | jq -c . | head -c 250)"
req GET /app/courses "" "$S1"
chk "my courses" 200 "$RS" "$RB"
echo "   $(echo "$RB" | jq -c '[.[]|{id,title}]')"
CID=$SETUP_C  # pin to the fixture, not whatever happens to be first
req GET /app/courses "" "$SO"
chk "outsider course list" 200 "$RS" "$RB"
chk "fixture course hidden from outsider" "0" "$(echo "$RB" | jq '[.[]|select(.id=='"$SETUP_C"')]|length')" "$RB"
echo "   outsider courses: $(echo "$RB" | jq -c '[.[]|{id,title}]')"

if [ -n "$CID" ]; then
  req GET "/app/courses/$CID/modules" "" "$S1"
  chk "course modules" 200 "$RS" "$RB"
  MID=$(echo "$RB" | jq -r '.[0].id // empty')
  req GET "/app/courses/$CID/modules" "" "$SO"
  chk "outsider on course modules -> 404" 404 "$RS" "$RB"
  if [ -n "$MID" ]; then
    req GET "/app/modules/$MID/lessons" "" "$S1"
    chk "module lessons" 200 "$RS" "$RB"
    echo "   lessons: $(echo "$RB" | jq -c '[.[]|{id,title}]' 2>/dev/null | head -c 200)"
    LID=$(echo "$RB" | jq -r '.[0].id // empty')
    req GET "/app/modules/$MID/lessons" "" "$SO"
    chk "outsider on module lessons -> 404" 404 "$RS" "$RB"
    if [ -n "$LID" ]; then
      req GET "/app/lessons/$LID" "" "$S1"
      chk "lesson detail" 200 "$RS" "$RB"
      req GET "/app/lessons/$LID" "" "$SO"
      chk "outsider on lesson -> 404" 404 "$RS" "$RB"
      # No recording is attached to the fixture lesson, so 404 is the correct
      # answer here — it proves the endpoint checks for a video, not that it
      # is broken.
      req POST "/app/lessons/$LID/request-video" '{}' "$S1"
      chk "request video without recording -> 404" 404 "$RS" "$RB"
      req POST "/app/lessons/$LID/request-video" '{}' "$SO"
      chk "outsider request video -> 404" 404 "$RS" "$RB"
    fi
  fi
fi

echo "== STUDENT HOMEWORK =="
req GET /app/homework "" "$S1"
chk "homework list" 200 "$RS" "$RB"
echo "   $(echo "$RB" | jq -c '[.[]|{id,status,course_title}]' | head -c 300)"
HID=$SETUP_H
req GET /app/homework "" "$SO"
chk "outsider homework list (empty)" 200 "$RS" "$RB"
echo "   outsider hw: $(echo "$RB" | jq -c .)"
if [ -n "$HID" ]; then
  req GET "/app/homework/$HID" "" "$S1"
  chk "homework detail" 200 "$RS" "$RB"
  req GET "/app/homework/$HID/submissions" "" "$S1"
  chk "my submissions" 200 "$RS" "$RB"
  req GET "/app/homework/$HID" "" "$SO"
  chk "outsider homework detail -> 404" 404 "$RS" "$RB"
  req GET "/app/homework/$HID/submissions" "" "$SO"
  chk "outsider submissions -> 404" 404 "$RS" "$RB"
  req POST "/app/homework/$HID/submit-start" '{}' "$S1"
  chk "submit-start" 200 "$RS" "$RB"
  echo "   $(echo "$RB" | jq -c .)"
  req POST "/app/homework/$HID/submit-start" '{}' "$SO"
  chk "outsider submit-start -> 404" 404 "$RS" "$RB"
fi

echo "== BLACKLIST HIDES COURSE =="
if [ -n "$CID" ]; then
  curl -s -o /dev/null -X POST "$API/courses/$CID/students/$S1ID/blacklist" -H "Authorization: Bearer $TT" -H 'Content-Type: application/json' -d '{"reason":"e2e"}'
  req GET /app/courses "" "$S1"
  chk "blacklisted student course list" 200 "$RS" "$RB"
  echo "   after blacklist: $(echo "$RB" | jq -c '[.[]|.id]')"
  req GET "/app/courses/$CID/modules" "" "$S1"
  chk "blacklisted -> course 404" 404 "$RS" "$RB"
  req GET /app/homework "" "$S1"
  echo "   hw after blacklist: $(echo "$RB" | jq -c '[.[]|.id]')"
  curl -s -o /dev/null -X POST "$API/courses/$CID/students/$S1ID/blacklist/clear" -H "Authorization: Bearer $TT" -H 'Content-Type: application/json' -d '{}'
  req GET "/app/courses/$CID/modules" "" "$S1"
  chk "after clear -> course visible" 200 "$RS" "$RB"

  echo "== REVOKED ACCESS HIDES COURSE =="
  curl -s -o /dev/null -X POST "$API/courses/$CID/students/$S1ID/access/revoke" -H "Authorization: Bearer $TT" -H 'Content-Type: application/json' -d '{}'
  req GET "/app/courses/$CID/modules" "" "$S1"
  chk "revoked -> course 404" 404 "$RS" "$RB"
  req GET /app/homework "" "$S1"
  echo "   hw after revoke: $(echo "$RB" | jq -c '[.[]|.id]')"
  EXPD=$(date -u -d '+30 days' +%Y-%m-%dT%H:%M:%SZ)
  curl -s -o /dev/null -X POST "$API/courses/$CID/students/$S1ID/access" -H "Authorization: Bearer $TT" -H 'Content-Type: application/json' -d "{\"expires_at\":\"$EXPD\"}"
  req GET "/app/courses/$CID/modules" "" "$S1"
  chk "re-granted -> course visible" 200 "$RS" "$RB"
fi

echo
echo "==== RESULT: $PASS passed, $FAIL failed ===="
for f in "${FAILURES[@]}"; do echo "  ! $f"; done

# See e2e-staff.sh: the tally alone would let CI go green on a failure.
[ "$FAIL" -eq 0 ]
