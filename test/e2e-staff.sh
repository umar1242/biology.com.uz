#!/usr/bin/env bash
RUNID=$$
# End-to-end smoke of every staff-facing endpoint.
API=${API_BASE:-http://localhost:3000/api/v1}   # прод: API_BASE=http://127.0.0.1:8080/api/v1
PASS=0; FAIL=0
declare -a FAILURES

chk() { # chk <label> <expected-status> <actual-status> [body]
  if [ "$2" = "$3" ]; then PASS=$((PASS+1)); printf '  ok   %-52s %s\n' "$1" "$3"
  else FAIL=$((FAIL+1)); FAILURES+=("$1 — expected $2 got $3 :: $4"); printf '  FAIL %-52s exp %s got %s\n     %s\n' "$1" "$2" "$3" "${4:0:300}"; fi
}

req() { # req METHOD path [json] [token] -> sets RS (status) RB (body)
  local m=$1 p=$2 d=$3 t=$4
  local args=(-s -o /tmp/_rb -w '%{http_code}' -X "$m" "$API$p")
  [ -n "$t" ] && args+=(-H "Authorization: Bearer $t")
  [ -n "$d" ] && args+=(-H 'Content-Type: application/json' -d "$d")
  RS=$(curl "${args[@]}"); RB=$(cat /tmp/_rb)
}

echo "== AUTH =="
req POST /auth/login '{"username":"alice","password":"secret1234"}'
chk "login alice" 200 "$RS" "$RB"
TT=$(echo "$RB" | jq -r .access_token)
req POST /auth/login '{"username":"alice","password":"wrongpass"}'
chk "login wrong password -> 401" 401 "$RS" "$RB"
req POST /auth/login '{"username":"nope","password":"secret1234"}'
chk "login unknown user -> 401" 401 "$RS" "$RB"
req POST /auth/login '{"username":"alice"}'
chk "login missing field -> 422" 422 "$RS" "$RB"
req GET /auth/me "" "$TT"
chk "auth/me" 200 "$RS" "$RB"
req GET /auth/me
chk "auth/me no token -> 401" 401 "$RS" "$RB"
req GET /auth/me "" "garbage.token.here"
chk "auth/me bad token -> 401" 401 "$RS" "$RB"

req POST /auth/login '{"username":"helper_carol","password":"secret1234"}'
chk "login assistant carol" 200 "$RS" "$RB"
AT=$(echo "$RB" | jq -r .access_token)
req POST /auth/login '{"username":"bob","password":"secret1234"}'
chk "login bob (other tenant)" 200 "$RS" "$RB"
BT=$(echo "$RB" | jq -r .access_token)

echo "== COURSES =="
req GET /courses "" "$TT"
chk "list courses" 200 "$RS" "$RB"
req POST /courses '{"title":"E2E Курс","description":"проверка","subject":"chemistry"}' "$TT"
chk "create course" 201 "$RS" "$RB"
CID=$(echo "$RB" | jq -r .id)
echo "   courseId=$CID"
req POST /courses '{"title":"x","subject":"physics"}' "$TT"
chk "create course bad subject -> 422" 422 "$RS" "$RB"
req POST /courses '{"subject":"biology"}' "$TT"
chk "create course no title -> 422" 422 "$RS" "$RB"
req GET "/courses/$CID" "" "$TT"
chk "get course" 200 "$RS" "$RB"
req GET "/courses/$CID" "" "$BT"
chk "get course cross-tenant -> 404" 404 "$RS" "$RB"
req GET "/courses/999999" "" "$TT"
chk "get missing course -> 404" 404 "$RS" "$RB"
req PATCH "/courses/$CID" '{"title":"E2E Курс v2"}' "$TT"
chk "patch course" 200 "$RS" "$RB"
req PATCH "/courses/$CID" '{"title":"nope"}' "$BT"
chk "patch course cross-tenant -> 404" 404 "$RS" "$RB"
req GET "/courses/$CID/telegram-group" "" "$TT"
chk "get telegram group (none)" 200 "$RS" "$RB"

echo "== MODULES =="
req GET "/courses/$CID/modules" "" "$TT"
chk "list modules (empty)" 200 "$RS" "$RB"
req POST "/courses/$CID/modules" '{"title":"Модуль 1","description":"первый"}' "$TT"
chk "create module 1" 201 "$RS" "$RB"
M1=$(echo "$RB" | jq -r .id)
req POST "/courses/$CID/modules" '{"title":"Модуль 2"}' "$TT"
chk "create module 2" 201 "$RS" "$RB"
M2=$(echo "$RB" | jq -r .id)
req GET "/courses/$CID/modules" "" "$TT"
chk "list modules (2)" 200 "$RS" "$RB"
echo "   order: $(echo "$RB" | jq -c '[.[]|{id,orderIndex}]')"
req POST "/courses/$CID/modules/reorder" "{\"module_ids\":[$M2,$M1]}" "$TT"
chk "reorder modules" 200 "$RS" "$RB"
req GET "/courses/$CID/modules" "" "$TT"
echo "   after reorder: $(echo "$RB" | jq -c '[.[]|{id,orderIndex}]')"
req POST "/courses/$CID/modules/reorder" "{\"module_ids\":[$M1]}" "$TT"
chk "reorder partial list -> 422" 422 "$RS" "$RB"
req PATCH "/modules/$M1" '{"title":"Модуль 1 upd"}' "$TT"
chk "patch module" 200 "$RS" "$RB"
req PATCH "/modules/$M1" '{"title":"hack"}' "$BT"
chk "patch module cross-tenant -> 404" 404 "$RS" "$RB"

echo "== LESSONS =="
FUT=$(date -u -d '+3 days' +%Y-%m-%dT%H:%M:%SZ)
PAST=$(date -u -d '-3 days' +%Y-%m-%dT%H:%M:%SZ)
req GET "/modules/$M1/lessons" "" "$TT"
chk "list lessons (empty)" 200 "$RS" "$RB"
req POST "/modules/$M1/lessons" "{\"title\":\"Live урок\",\"lesson_type\":\"live\",\"scheduled_at\":\"$FUT\",\"live_call_link\":\"https://meet.example/x\"}" "$TT"
chk "create live lesson" 201 "$RS" "$RB"
L1=$(echo "$RB" | jq -r .id)
req POST "/modules/$M1/lessons" "{\"title\":\"Запись\",\"lesson_type\":\"recorded\",\"scheduled_at\":\"$FUT\"}" "$TT"
chk "create recorded lesson" 201 "$RS" "$RB"
L2=$(echo "$RB" | jq -r .id)
req POST "/modules/$M1/lessons" "{\"title\":\"bad\",\"lesson_type\":\"recorded\",\"scheduled_at\":\"$FUT\",\"live_call_link\":\"https://x\"}" "$TT"
chk "recorded lesson w/ liveCallLink -> 422" 422 "$RS" "$RB"
req POST "/modules/$M1/lessons" "{\"title\":\"bad\",\"lesson_type\":\"live\",\"scheduled_at\":\"not-a-date\"}" "$TT"
chk "lesson bad date -> 422" 422 "$RS" "$RB"
req GET "/lessons/$L1" "" "$TT"
chk "get lesson" 200 "$RS" "$RB"
req GET "/lessons/$L1" "" "$BT"
chk "get lesson cross-tenant -> 404" 404 "$RS" "$RB"
req PATCH "/lessons/$L1" '{"title":"Live урок v2"}' "$TT"
chk "patch lesson" 200 "$RS" "$RB"
req POST "/modules/$M1/lessons/reorder" "{\"lesson_ids\":[$L2,$L1]}" "$TT"
chk "reorder lessons" 200 "$RS" "$RB"
req POST "/lessons/$L1/publish" '{"published":true}' "$TT"
chk "publish lesson" 200 "$RS" "$RB"
req GET "/lessons/$L1" "" "$TT"
echo "   isPublished=$(echo "$RB" | jq -r .isPublished)"
req POST "/lessons/$L2/publish" '{"published":true}' "$TT"
chk "publish lesson 2" 200 "$RS" "$RB"

echo "== HOMEWORK =="
req GET "/lessons/$L1/homework" "" "$TT"
chk "get homework (none)" 200 "$RS" "$RB"
req POST "/lessons/$L1/homework" "{\"instructions\":\"Сделай задачи 1-5\",\"deadline_at\":\"$FUT\"}" "$TT"
chk "create homework" 201 "$RS" "$RB"
H1=$(echo "$RB" | jq -r .id)
req POST "/lessons/$L1/homework" "{\"instructions\":\"dup\",\"deadline_at\":\"$FUT\"}" "$TT"
chk "duplicate homework -> 409" 409 "$RS" "$RB"
req PATCH "/homework/$H1" '{"instructions":"Задачи 1-7"}' "$TT"
chk "patch homework" 200 "$RS" "$RB"
req GET "/homework/$H1/submissions" "" "$TT"
chk "list hw submissions (empty)" 200 "$RS" "$RB"
req PATCH "/homework/$H1" '{"instructions":"hack"}' "$BT"
chk "patch homework cross-tenant -> 404" 404 "$RS" "$RB"

echo "== STUDENTS / ACCESS =="
req GET "/courses/$CID/students" "" "$TT"
chk "list course students (empty)" 200 "$RS" "$RB"
EXP=$(date -u -d '+30 days' +%Y-%m-%dT%H:%M:%SZ)
req POST "/courses/$CID/students/1/access" "{\"expires_at\":\"$EXP\"}" "$TT"
chk "grant access student 1" 200 "$RS" "$RB"
req POST "/courses/$CID/students/2/access" "{\"expires_at\":\"$EXP\"}" "$TT"
chk "grant access student 2" 200 "$RS" "$RB"
req GET "/courses/$CID/students" "" "$TT"
chk "list course students (2)" 200 "$RS" "$RB"
echo "   $(echo "$RB" | jq -c '[.[]|{studentId,accessGranted,revoked,penaltyPoints,isBlacklisted}]')"
req GET /students/1 "" "$TT"
chk "student detail" 200 "$RS" "$RB"
req GET /students/999999 "" "$TT"
chk "student detail missing -> 404" 404 "$RS" "$RB"
NEWEXP=$(date -u -d '+60 days' +%Y-%m-%dT%H:%M:%SZ)
req PATCH "/courses/$CID/students/1/access" "{\"expires_at\":\"$NEWEXP\"}" "$TT"
chk "extend access" 200 "$RS" "$RB"
req GET /access/expiring "" "$TT"
chk "expiring access list" 200 "$RS" "$RB"

echo "== PENALTY / BLACKLIST =="
req GET "/courses/$CID/students/1/penalty" "" "$TT"
chk "penalty detail" 200 "$RS" "$RB"
req POST "/courses/$CID/students/1/blacklist" '{"reason":"e2e тест"}' "$TT"
chk "blacklist student" 200 "$RS" "$RB"
req GET "/courses/$CID/students/1/penalty" "" "$TT"
echo "   after blacklist: $(echo "$RB" | jq -c '{points,isBlacklisted}' 2>/dev/null || echo "$RB" | head -c 200)"
req POST "/courses/$CID/students/1/blacklist/clear" '{}' "$TT"
chk "clear blacklist" 200 "$RS" "$RB"
req POST "/courses/$CID/students/1/penalty/reset" '{}' "$TT"
chk "reset penalty" 200 "$RS" "$RB"
req POST "/courses/$CID/students/2/access/revoke" '{}' "$TT"
chk "revoke access" 200 "$RS" "$RB"
req POST "/courses/$CID/students/1/blacklist" '{"reason":"x"}' "$BT"
chk "blacklist cross-tenant -> 404" 404 "$RS" "$RB"

echo "== ASSISTANTS =="
req GET /assistants "" "$TT"
chk "list assistants" 200 "$RS" "$RB"
req GET /assistants "" "$AT"
chk "assistant listing assistants -> 403" 403 "$RS" "$RB"
req POST /assistants "$(jq -cn --arg u "e2e_helper_$RUNID" '{username:$u,password:"secret1234",display_name:"E2E Помощник"}')" "$TT"
chk "create assistant" 201 "$RS" "$RB"
AID=$(echo "$RB" | jq -r .staff_id)
[ "$AID" = "null" ] && AID=$(docker exec myproject-postgres-1 psql -U postgres -d course_platform -t -A -c "select id from staff_users where username='e2e_helper_'"$RUNID"")
req POST /assistants "$(jq -cn --arg u "e2e_helper_$RUNID" '{username:$u,password:"secret1234",display_name:"dup"}')" "$TT"
chk "duplicate assistant username -> 409" 409 "$RS" "$RB"
req POST /assistants '{"username":"short","password":"123","display_name":"x"}' "$TT"
chk "assistant short password -> 422" 422 "$RS" "$RB"
req GET "/assistants/$AID/permissions" "" "$TT"
chk "get assistant permissions (empty)" 200 "$RS" "$RB"
req PUT "/assistants/$AID/permissions/$CID" '{"can_review_homework":true,"can_manage_access":true,"can_manage_blacklist":false}' "$TT"
chk "grant permissions" 200 "$RS" "$RB"
req GET "/assistants/$AID/permissions" "" "$TT"
chk "get assistant permissions (1)" 200 "$RS" "$RB"
echo "   $(echo "$RB" | jq -c '[.[]|{courseId,canReviewHomework,canManageAccess,canManageBlacklist}]')"
req PATCH "/assistants/$AID" '{"is_active":true}' "$TT"
chk "patch assistant is_active" 200 "$RS" "$RB"
req PATCH "/assistants/$AID" '{"is_active":false}' "$TT"
chk "deactivate assistant" 200 "$RS" "$RB"
req POST /auth/login "$(jq -cn --arg u "e2e_helper_$RUNID" '{username:$u,password:"secret1234"}')"
chk "deactivated assistant login -> 401" 401 "$RS" "$RB"
req PATCH "/assistants/$AID" '{"is_active":true}' "$TT"
chk "reactivate assistant" 200 "$RS" "$RB"
req POST /auth/login "$(jq -cn --arg u "e2e_helper_$RUNID" '{username:$u,password:"secret1234"}')"
chk "reactivated assistant login" 200 "$RS" "$RB"
EAT=$(echo "$RB" | jq -r .access_token)

echo "== ASSISTANT CAPABILITY ENFORCEMENT =="
req GET /courses "" "$EAT"
chk "assistant sees permitted course" 200 "$RS" "$RB"
echo "   courses: $(echo "$RB" | jq -c '[.[]|.id]')"
req POST "/courses/$CID/students/3/access" "{\"expires_at\":\"$EXP\"}" "$EAT"
chk "assistant w/ canManageAccess grants" 200 "$RS" "$RB"
req POST "/courses/$CID/students/3/blacklist" '{"reason":"no perm"}' "$EAT"
chk "assistant w/o canManageBlacklist -> 403" 403 "$RS" "$RB"
req POST /courses '{"title":"assistant course","subject":"biology"}' "$EAT"
chk "assistant creating course -> 403" 403 "$RS" "$RB"
req POST "/courses/$CID/modules" '{"title":"assistant module"}' "$EAT"
chk "assistant creating module -> 403" 403 "$RS" "$RB"
req DELETE "/assistants/$AID/permissions/$CID" "" "$TT"
chk "revoke permissions" 204 "$RS" "$RB"
req GET "/courses/$CID" "" "$EAT"
chk "assistant after revoke -> 404" 404 "$RS" "$RB"

echo "== DASHBOARD / REVIEW / SETTINGS =="
req GET /dashboard/summary "" "$TT"
chk "dashboard summary" 200 "$RS" "$RB"
echo "   $(echo "$RB" | jq -c . | head -c 300)"
req GET /review-queue "" "$TT"
chk "review queue" 200 "$RS" "$RB"
req GET /settings "" "$TT"
chk "get settings" 200 "$RS" "$RB"
req PATCH /settings '{"penalty_point_threshold":4}' "$TT"
chk "patch settings" 200 "$RS" "$RB"
req PATCH /settings '{"penalty_point_threshold":0}' "$TT"
chk "patch settings threshold 0 -> 422" 422 "$RS" "$RB"
req PATCH /settings '{"penalty_point_threshold":3}' "$TT"
chk "restore threshold" 200 "$RS" "$RB"

echo "== SUBMISSIONS =="
req GET /submissions/999999 "" "$TT"
chk "missing submission -> 404" 404 "$RS" "$RB"
# Insert our own submission rather than reusing whatever happens to be in the
# database — these checks used to skip silently whenever there were none, and
# the suite quietly shrank from 97 checks to 94 without failing.
# A placeholder file_id is fine: none of these endpoints fetch the bytes from
# Telegram, they only read the row. (The raw-photo path needs a file_id minted
# by the current bot, so it is verified by hand, not here.)
SUB=$(docker exec myproject-postgres-1 psql -U postgres -d course_platform -t -A -c "
  insert into homework_submissions
    (homework_id, student_id, teacher_id, attempt_number, photo_file_ids, is_late, status)
  values ($H1, 1, 1, 1, ARRAY['E2E_PLACEHOLDER_FILE_ID'], false, 'pending')
  returning id;" | head -1 | tr -d '[:space:]')
req GET "/submissions/$SUB" "" "$TT"
chk "get existing submission" 200 "$RS" "$RB"
req GET "/submissions/$SUB/photos" "" "$TT"
chk "submission photos meta" 200 "$RS" "$RB"
req GET "/submissions/$SUB" "" "$BT"
chk "submission cross-tenant -> 404" 404 "$RS" "$RB"
req POST "/submissions/$SUB/review" '{"status":"passed","comment_text":"e2e"}' "$TT"
chk "review submission" 200 "$RS" "$RB"
req POST "/submissions/$SUB/review" '{"status":"bogus"}' "$TT"
chk "review with bad status -> 422" 422 "$RS" "$RB"
docker exec myproject-postgres-1 psql -U postgres -d course_platform -q -c \
  "delete from bot_pending_actions where target_submission_id=$SUB; delete from homework_submissions where id=$SUB;" >/dev/null 2>&1

echo "== ARCHIVE / DELETE (teardown) =="
req DELETE "/lessons/$L2" "" "$TT"
chk "delete lesson" 204 "$RS" "$RB"
req DELETE "/lessons/$L1" "" "$TT"
chk "delete lesson blocked by homework -> 409" 409 "$RS" "$RB"
req DELETE "/homework/$H1" "" "$TT"
chk "delete homework" 204 "$RS" "$RB"
req DELETE "/homework/$H1" "" "$TT"
chk "delete homework again -> 404" 404 "$RS" "$RB"
req DELETE "/lessons/$L1" "" "$TT"
chk "delete lesson after homework gone" 204 "$RS" "$RB"
req DELETE "/modules/$M2" "" "$TT"
chk "delete empty module" 204 "$RS" "$RB"
req DELETE "/modules/$M1" "" "$TT"
chk "delete module" 204 "$RS" "$RB"
req POST "/courses/$CID/archive" '{"archived":true}' "$TT"
chk "archive course" 200 "$RS" "$RB"
req POST "/courses/$CID/archive" '{"archived":false}' "$TT"
chk "unarchive course" 200 "$RS" "$RB"

# The API has no DELETE /courses (archiving is the product-level answer), so
# the fixture course is removed directly — otherwise every run leaves one
# behind in the dev database.
docker exec -i myproject-postgres-1 psql -U postgres -d course_platform -q >/dev/null 2>&1 <<SQL
BEGIN;
DELETE FROM bot_pending_actions WHERE target_course_id = $CID;
DELETE FROM notifications_log WHERE course_id = $CID;
DELETE FROM course_disciplinary_events WHERE course_id = $CID;
DELETE FROM course_penalty_points WHERE course_id = $CID;
DELETE FROM course_blacklist WHERE course_id = $CID;
DELETE FROM course_access WHERE course_id = $CID;
DELETE FROM assistant_course_permissions WHERE course_id = $CID;
DELETE FROM course_telegram_groups WHERE course_id = $CID;
DELETE FROM courses WHERE id = $CID;
DELETE FROM assistants WHERE staff_user_id = $AID;
DELETE FROM staff_users WHERE id = $AID;
COMMIT;
SQL

echo
echo "==== RESULT: $PASS passed, $FAIL failed ===="
for f in "${FAILURES[@]}"; do echo "  ! $f"; done
