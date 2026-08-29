#!/usr/bin/env bash
# End-to-end of the certificate-exam (Milliy Sertifikat) flow, teacher +
# student, following the real scenario: create variant -> attach file ->
# enter key 1-35 -> publish -> student solves -> photos for 36-43 ->
# submit -> teacher grades -> student sees the result.
RUNID=$$
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
PASS=0; FAIL=0; declare -a FAILURES

chk() { if [ "$2" = "$3" ]; then PASS=$((PASS+1)); printf '  ok   %-54s %s\n' "$1" "$3"
  else FAIL=$((FAIL+1)); FAILURES+=("$1 — exp $2 got $3 :: ${4:0:250}"); printf '  FAIL %-54s exp %s got %s\n     %s\n' "$1" "$2" "$3" "${4:0:250}"; fi }
req() { local m=$1 p=$2 d=$3 t=$4
  local a=(-s -o /tmp/_cb -w '%{http_code}' -X "$m" "$API$p")
  [ -n "$t" ] && a+=(-H "Authorization: Bearer $t")
  [ -n "$d" ] && a+=(-H 'Content-Type: application/json' -d "$d")
  RS=$(curl "${a[@]}"); RB=$(cat /tmp/_cb); }


TG=$((770000000 + RUNID % 1000000))
cleanup() {
  PSQL "DELETE FROM bot_pending_actions WHERE target_cert_attempt_id IN (SELECT id FROM cert_exam_attempts WHERE student_id IN (SELECT id FROM students WHERE telegram_id=$TG)) OR target_cert_exam_id=${EXAM:-0};" >/dev/null
  PSQL "DELETE FROM cert_exam_answers WHERE attempt_id IN (SELECT id FROM cert_exam_attempts WHERE student_id IN (SELECT id FROM students WHERE telegram_id=$TG));" >/dev/null
  PSQL "DELETE FROM cert_exam_attempts WHERE student_id IN (SELECT id FROM students WHERE telegram_id=$TG);" >/dev/null
  if [ -n "$EXAM" ]; then
    PSQL "DELETE FROM cert_exam_items WHERE exam_id=$EXAM; DELETE FROM cert_exams WHERE id=$EXAM;" >/dev/null
    PSQL "DELETE FROM cert_items WHERE id NOT IN (SELECT item_id FROM cert_exam_items) AND id NOT IN (SELECT item_id FROM cert_exam_answers WHERE item_id IS NOT NULL);" >/dev/null
  fi
  PSQL "DELETE FROM course_applications WHERE student_id IN (SELECT id FROM students WHERE telegram_id=$TG);" >/dev/null
  PSQL "DELETE FROM course_access WHERE student_id IN (SELECT id FROM students WHERE telegram_id=$TG); DELETE FROM students WHERE telegram_id=$TG;" >/dev/null
  # Only when this run created it — an existing course belongs to the user.
  if [ -n "${OWN_COURSE:-}" ]; then
    PSQL "DELETE FROM course_applications WHERE course_id=$OWN_COURSE; DELETE FROM course_access WHERE course_id=$OWN_COURSE; DELETE FROM courses WHERE id=$OWN_COURSE;" >/dev/null
  fi
}
trap cleanup EXIT

echo "== SETUP =="
req POST /auth/login '{"username":"alice","password":"secret1234"}'
chk "login teacher" 200 "$RS" "$RB"; TT=$(echo "$RB" | jq -r .access_token)
req POST /auth/login '{"username":"bob","password":"secret1234"}'
chk "login other tenant" 200 "$RS" "$RB"; BT=$(echo "$RB" | jq -r .access_token)

req GET /courses "" "$TT"; CID=$(echo "$RB" | jq -r '.[0].id // empty')
# A fresh database has no courses at all, so make one and take it down again
# at exit. Aborting here is what a CI run would otherwise do on every push.
if [ -z "$CID" ] || [ "$CID" = "null" ]; then
  req POST /courses '{"title":"E2E Cert Fixture","subject":"biology"}' "$TT"
  chk "create fixture course" 201 "$RS" "$RB"
  CID=$(echo "$RB" | jq -r .id)
  OWN_COURSE=$CID
fi
echo "  курс: $CID"

echo "== STRUCTURE =="
req GET /cert-exams/structure "" "$TT"
chk "structure endpoint" 200 "$RS" "$RB"
chk "total 115 points" "115" "$(echo "$RB" | jq -r .total_max_points)" "$RB"
chk "task 1 options ABCD" "ABCD" "$(echo "$RB" | jq -r '.tasks[0].options|join("")')" "$RB"
chk "task 33 options ABCDEF" "ABCDEF" "$(echo "$RB" | jq -r '.tasks[32].options|join("")')" "$RB"
chk "task 41 max 30" "30" "$(echo "$RB" | jq -r '.tasks[40].max_points')" "$RB"
chk "task 42 max 35" "35" "$(echo "$RB" | jq -r '.tasks[41].max_points')" "$RB"
chk "task 43 max 10" "10" "$(echo "$RB" | jq -r '.tasks[42].max_points')" "$RB"

echo "== TEACHER: CREATE VARIANT =="
FUTURE=$(date -u -d '+7 days' +%Y-%m-%dT%H:%M:%SZ)
req POST "/courses/$CID/cert-exams" "{\"title\":\"Вариант e2e $RUNID\",\"deadline_at\":\"$FUTURE\"}" "$TT"
chk "create exam" 201 "$RS" "$RB"; EXAM=$(echo "$RB" | jq -r .id)
chk "not published yet" "false" "$(echo "$RB" | jq -r .published)" "$RB"
chk "key empty" "0" "$(echo "$RB" | jq -r .key_filled)" "$RB"

req POST "/courses/$CID/cert-exams" '{"title":"","deadline_at":"2030-01-01T00:00:00Z"}' "$TT"
chk "empty title -> 422" 422 "$RS" "$RB"
req GET "/cert-exams/$EXAM" "" "$BT"
chk "other tenant cannot read -> 404" 404 "$RS" "$RB"

echo "== PUBLISH GUARDS =="
req POST "/cert-exams/$EXAM/publish" "" "$TT"
chk "publish without file -> 409" 409 "$RS" "$RB"

# Attaching the variant normally happens through the bot; simulate its effect.
PSQL "UPDATE cert_exams SET variant_file_id='TEST_FILE_ID', variant_file_name='variant.pdf' WHERE id=$EXAM;" >/dev/null
req POST "/cert-exams/$EXAM/publish" "" "$TT"
chk "publish without key -> 409" 409 "$RS" "$RB"

echo "== ANSWER KEY =="
KEY=$(python3 -c "
import json
opts='ABCD'; out=[]
for n in range(1,33): out.append({'task_number':n,'correct_option':opts[(n-1)%4]})
for n in range(33,36): out.append({'task_number':n,'correct_option':'ABCDEF'[(n-33)%6]})
print(json.dumps({'answers':out}))")
req PUT "/cert-exams/$EXAM/answer-key" "$KEY" "$TT"
chk "set full key" 200 "$RS" "$RB"
chk "key filled 35" "35" "$(echo "$RB" | jq -r .key_filled)" "$RB"

req PUT "/cert-exams/$EXAM/answer-key" '{"answers":[{"task_number":1,"correct_option":"E"}]}' "$TT"
chk "letter E on task 1 -> 422" 422 "$RS" "$RB"
req PUT "/cert-exams/$EXAM/answer-key" '{"answers":[{"task_number":36,"correct_option":"A"}]}' "$TT"
chk "key for task 36 -> 422" 422 "$RS" "$RB"
req PUT "/cert-exams/$EXAM/answer-key" '{"answers":[{"task_number":33,"correct_option":"F"}]}' "$TT"
chk "letter F on task 33 ok" 200 "$RS" "$RB"

req POST "/cert-exams/$EXAM/publish" "" "$TT"
chk "publish now succeeds" 200 "$RS" "$RB"
chk "published=true" "true" "$(echo "$RB" | jq -r .published)" "$RB"

echo "== STUDENT =="
SI=$(mint "$TG" "cert_stu_$RUNID" "Серт")
req POST /app/auth/telegram "$(jq -cn --arg d "$SI" '{init_data:$d}')"
chk "student auth" 200 "$RS" "$RB"
ST=$(echo "$RB" | jq -r .access_token); SID=$(echo "$RB" | jq -r .student_id)
# The Mini App is closed until a student has filled in the questionnaire.
# Written straight to the table on purpose: submitting the form through the
# API would also grant course access, and the next checks are about what a
# student sees *before* access is granted.
PSQL "INSERT INTO course_applications (course_id, student_id, full_name, phone, parent_phone_primary)
      VALUES ($CID, $SID, 'E2E Cert', '+998900000000', '+998900000001');" >/dev/null

req GET /app/cert-exams "" "$ST"
chk "no access -> exam hidden" "0" "$(echo "$RB" | jq -r '[.[]|select(.id=='"$EXAM"')]|length')" "$RB"

PSQL "INSERT INTO course_access (course_id, student_id, teacher_id, access_granted, granted_at, expires_at)
      SELECT $CID, $SID, teacher_id, true, now(), now()+interval '30 days' FROM courses WHERE id=$CID;" >/dev/null

req GET /app/cert-exams "" "$ST"
chk "exam visible after access" "1" "$(echo "$RB" | jq -r '[.[]|select(.id=='"$EXAM"')]|length')" "$RB"
chk "key never exposed in list" "null" "$(echo "$RB" | jq -r '.[0].correct_option // "null"')" "$RB"

req GET "/app/cert-exams/$EXAM" "" "$ST"
chk "exam detail" 200 "$RS" "$RB"
chk "43 tasks" "43" "$(echo "$RB" | jq -r '.tasks|length')" "$RB"
chk "detail hides key" "null" "$(echo "$RB" | jq -r '[.tasks[]|.correct_option//empty]|first//"null"')" "$RB"

req POST "/app/cert-exams/$EXAM/start" "" "$ST"
chk "start attempt" 201 "$RS" "$RB"; ATT=$(echo "$RB" | jq -r .id)
req POST "/app/cert-exams/$EXAM/start" "" "$ST"
chk "start again resumes same attempt" 200 "$RS" "$RB"
chk "same attempt id" "$ATT" "$(echo "$RB" | jq -r .id)" "$RB"

echo "== STUDENT ANSWERS =="
# 20 correct out of 35: tasks 1-20 right, 21-35 deliberately wrong.
ANS=$(python3 -c "
import json
opts='ABCD'; out=[]
for n in range(1,21): out.append({'task_number':n,'chosen_option':opts[(n-1)%4]})
for n in range(21,33): out.append({'task_number':n,'chosen_option':opts[(n)%4]})
for n in range(33,36): out.append({'task_number':n,'chosen_option':'B'})
print(json.dumps({'answers':out}))")
req PUT "/app/cert-exam-attempts/$ATT/answers" "$ANS" "$ST"
chk "save answers" 200 "$RS" "$RB"

req PUT "/app/cert-exam-attempts/$ATT/answers" '{"answers":[{"task_number":1,"chosen_option":"Z"}]}' "$ST"
chk "invalid letter -> 422" 422 "$RS" "$RB"
req PUT "/app/cert-exam-attempts/$ATT/answers" '{"answers":[{"task_number":40,"chosen_option":"A"}]}' "$ST"
chk "option for open task -> 422" 422 "$RS" "$RB"

req GET "/app/cert-exam-attempts/$ATT" "" "$ST"
chk "attempt state" 200 "$RS" "$RB"
chk "score hidden before review" "null" "$(echo "$RB" | jq -r '.total_score//"null"')" "$RB"
chk "correctness hidden" "null" "$(echo "$RB" | jq -r '[.tasks[]|.is_correct//empty]|first//"null"')" "$RB"

req POST "/app/cert-exam-attempts/$ATT/tasks/38/photo-start" "" "$ST"
chk "photo deep link for task 38" 200 "$RS" "$RB"
chk "link points at bot" "true" "$(echo "$RB" | jq -r '.deep_link|startswith("https://t.me/")')" "$RB"
req POST "/app/cert-exam-attempts/$ATT/tasks/10/photo-start" "" "$ST"
chk "photo link for closed task -> 422" 422 "$RS" "$RB"

# Simulate what the bot writes when the student sends photos for 36-43.
for T in 36 37 38 39 40 41 42 43; do
  PSQL "INSERT INTO cert_exam_answers (attempt_id, task_number, photo_file_ids)
        VALUES ($ATT, $T, ARRAY['PH_${T}_a','PH_${T}_b'])
        ON CONFLICT (attempt_id, task_number) DO UPDATE SET photo_file_ids = EXCLUDED.photo_file_ids;" >/dev/null
done

echo "== SUBMIT =="
req POST "/app/cert-exam-attempts/$ATT/submit" "" "$ST"
chk "submit" 200 "$RS" "$RB"
chk "not late" "false" "$(echo "$RB" | jq -r .is_late)" "$RB"
req POST "/app/cert-exam-attempts/$ATT/submit" "" "$ST"
chk "double submit -> 409" 409 "$RS" "$RB"
req PUT "/app/cert-exam-attempts/$ATT/answers" '{"answers":[{"task_number":1,"chosen_option":"A"}]}' "$ST"
chk "edit after submit -> 409" 409 "$RS" "$RB"

# Verified by hand: tasks 1-20 match the key (20). Tasks 21-32 are shifted
# one letter, so all wrong. Of 33-35 the key is F/B/C after the A-F overwrite
# above and the student answered B to all three, so only 34 lands. Total 21.
AUTO=$(PSQL "SELECT auto_score FROM cert_exam_attempts WHERE id=$ATT;" | tr -d ' ')
chk "auto score = 21 correct" "21" "$AUTO" "auto_score=$AUTO"

echo "== TEACHER REVIEW =="
req GET /cert-exam-review-queue "" "$TT"
chk "attempt in review queue" "1" "$(echo "$RB" | jq -r '[.[]|select(.id=='"$ATT"')]|length')" "$RB"

req GET "/cert-exam-attempts/$ATT" "" "$TT"
chk "teacher sees attempt" 200 "$RS" "$RB"
chk "teacher sees key" "A" "$(echo "$RB" | jq -r '.tasks[0].correct_option')" "$RB"
chk "photo count on task 38" "2" "$(echo "$RB" | jq -r '.tasks[37].photo_count')" "$RB"
req GET "/cert-exam-attempts/$ATT" "" "$BT"
chk "other tenant blocked -> 404" 404 "$RS" "$RB"

req POST "/cert-exam-attempts/$ATT/review" '{"points":[{"task_number":41,"awarded_points":31}]}' "$TT"
chk "over max for task 41 -> 422" 422 "$RS" "$RB"
req POST "/cert-exam-attempts/$ATT/review" '{"points":[{"task_number":36,"awarded_points":2}]}' "$TT"
chk "over max for task 36 -> 422" 422 "$RS" "$RB"

REVIEW='{"points":[
 {"task_number":36,"awarded_points":1},{"task_number":37,"awarded_points":1},
 {"task_number":38,"awarded_points":0},{"task_number":39,"awarded_points":1},
 {"task_number":40,"awarded_points":1},{"task_number":41,"awarded_points":25},
 {"task_number":42,"awarded_points":30},{"task_number":43,"awarded_points":8}],
 "comment_text":"Хорошая работа, повтори генетику"}'
req POST "/cert-exam-attempts/$ATT/review" "$REVIEW" "$TT"
chk "review saved" 200 "$RS" "$RB"
chk "manual score 67" "67" "$(echo "$RB" | jq -r .manual_score)" "$RB"
chk "total 88 (21 auto + 67 manual)" "88" "$(echo "$RB" | jq -r .total_score)" "$RB"

echo "== STUDENT SEES RESULT =="
req GET "/app/cert-exam-attempts/$ATT" "" "$ST"
chk "status reviewed" "reviewed" "$(echo "$RB" | jq -r .status)" "$RB"
chk "student sees total 88" "88" "$(echo "$RB" | jq -r .total_score)" "$RB"
chk "student sees auto 21" "21" "$(echo "$RB" | jq -r .auto_score)" "$RB"
chk "student sees comment" "Хорошая работа, повтори генетику" "$(echo "$RB" | jq -r .review_comment_text)" "$RB"
chk "task 1 correct now visible" "true" "$(echo "$RB" | jq -r '.tasks[0].is_correct')" "$RB"
chk "task 21 wrong" "false" "$(echo "$RB" | jq -r '.tasks[20].is_correct')" "$RB"
chk "task 41 points visible" "25" "$(echo "$RB" | jq -r '.tasks[40].awarded_points')" "$RB"

echo "== ISOLATION =="
OTG=$((TG+1))
OI=$(mint "$OTG" "cert_other_$RUNID" "Чужой")
req POST /app/auth/telegram "$(jq -cn --arg d "$OI" '{init_data:$d}')"
OT=$(echo "$RB" | jq -r .access_token); OSID=$(echo "$RB" | jq -r .student_id)
# Onboard them too, otherwise the gate answers 403 first and these checks
# would no longer prove anything about attempt isolation.
PSQL "INSERT INTO course_applications (course_id, student_id, full_name, phone, parent_phone_primary)
      VALUES ($CID, $OSID, 'E2E Other', '+998900000002', '+998900000003');" >/dev/null
req GET "/app/cert-exam-attempts/$ATT" "" "$OT"
chk "other student cannot read attempt -> 404" 404 "$RS" "$RB"
req POST "/app/cert-exam-attempts/$ATT/submit" "" "$OT"
chk "other student cannot submit -> 404" 404 "$RS" "$RB"
PSQL "DELETE FROM course_applications WHERE student_id=$OSID; DELETE FROM students WHERE telegram_id=$OTG;" >/dev/null

req DELETE "/cert-exams/$EXAM" "" "$TT"
chk "delete with attempts -> 409" 409 "$RS" "$RB"


echo "== ITEM BANK =="
req GET /cert-items "" "$TT"
chk "bank readable" 200 "$RS" "$RB"
BANKN=$(echo "$RB" | jq -r "[.[]|select(.used_in_variants>0)]|length")
chk "43 items bound to variants" "true" "$([ "$BANKN" -ge 43 ] && echo true || echo false)" "в банке $BANKN"
chk "task 1 topic from spec" "life_science" "$(echo "$RB" | jq -r '[.[]|select(.task_number==1)][0].topic')" "$RB"
chk "task 5 topic cell" "cell" "$(echo "$RB" | jq -r '[.[]|select(.task_number==5)][0].topic')" "$RB"
chk "task 33 topic logic" "logic" "$(echo "$RB" | jq -r '[.[]|select(.task_number==33)][0].topic')" "$RB"
chk "task 41 topic general" "general_bio" "$(echo "$RB" | jq -r '[.[]|select(.task_number==41)][0].topic')" "$RB"
chk "task 41 max 30 in bank" "30" "$(echo "$RB" | jq -r '[.[]|select(.task_number==41)][0].max_points')" "$RB"
chk "open task has no key" "null" "$(echo "$RB" | jq -r '[.[]|select(.task_number==38)][0].correct_option')" "$RB"

ITEM1=$(echo "$RB" | jq -r "[.[]|select(.task_number==1 and .used_in_variants>0)][0].id")
req PATCH "/cert-items/$ITEM1" '{"source_ref":"Spectrum 2026, вариант 1, №1"}' "$TT"
chk "set source ref" 200 "$RS" "$RB"
req PATCH "/cert-items/$ITEM1" '{"correct_option":"E"}' "$TT"
chk "invalid letter for task 1 -> 422" 422 "$RS" "$RB"
req PATCH "/cert-items/$ITEM1" '{"correct_option":"B"}' "$TT"
chk "fix key on item" 200 "$RS" "$RB"
req PATCH "/cert-items/$ITEM1" '{"correct_option":"A"}' "$TT"
chk "restore key" 200 "$RS" "$RB"

ITEM38=$(echo "$(curl -s -H "Authorization: Bearer $TT" "$API/cert-items")" | jq -r '[.[]|select(.task_number==38 and .used_in_variants>0)][0].id')
req PATCH "/cert-items/$ITEM38" '{"correct_option":"A"}' "$TT"
chk "key on open task -> 422" 422 "$RS" "$RB"

req GET /cert-items "" "$BT"
chk "other tenant sees own bank only" "0" "$(echo "$RB" | jq -r "[.[]|select(.id==$ITEM1)]|length")" "$RB"
req PATCH "/cert-items/$ITEM1" '{"source_ref":"взлом"}' "$BT"
chk "other tenant cannot edit item -> 404" 404 "$RS" "$RB"

echo "== SOURCE REF DEDUP =="
FUT2=$(date -u -d '+8 days' +%Y-%m-%dT%H:%M:%SZ)
req POST "/courses/$CID/cert-exams" "{\"title\":\"Вариант B $RUNID\",\"deadline_at\":\"$FUT2\"}" "$TT"
EXAM2=$(echo "$RB" | jq -r .id)
req PUT "/cert-exams/$EXAM2/answer-key" '{"answers":[{"task_number":1,"correct_option":"A","source_ref":"Spectrum 2026, вариант 1, №1"}]}' "$TT"
chk "reuse item by source ref" 200 "$RS" "$RB"
SAME=$(PSQL "SELECT item_id FROM cert_exam_items WHERE exam_id=$EXAM2 AND task_number=1;" | tr -d ' ')
chk "same bank item in both variants" "$ITEM1" "$SAME" "item=$SAME"
req GET /cert-items "" "$TT"
chk "item now used in 2 variants" "2" "$(echo "$RB" | jq -r "[.[]|select(.id==$ITEM1)][0].used_in_variants")" "$RB"

echo "== ANCHORS =="
req GET "/cert-exams/$EXAM2" "" "$TT"
chk "anchor counted in new variant" "1" "$(echo "$RB" | jq -r .anchor_count)" "$RB"
chk "recommended anchors = 8" "8" "$(echo "$RB" | jq -r .anchor_recommended)" "$RB"
req GET "/cert-exams/$EXAM" "" "$TT"
chk "anchor also counted in origin variant" "1" "$(echo "$RB" | jq -r .anchor_count)" "$RB"

req GET "/cert-exams/$EXAM2/anchor-candidates" "" "$TT"
chk "candidates listed" 200 "$RS" "$RB"
chk "candidates come from the other variant" "true" "$([ "$(echo "$RB" | jq -r 'length')" -ge 34 ] && echo true || echo false)" "кандидатов: $(echo "$RB" | jq -r 'length')"
chk "taken anchor marked" "true" "$(echo "$RB" | jq -r "[.[]|select(.id==$ITEM1)][0].already_in_this_exam")" "$RB"
chk "candidate carries key" "A" "$(echo "$RB" | jq -r "[.[]|select(.id==$ITEM1)][0].correct_option")" "$RB"
chk "candidate carries source" "Spectrum 2026, вариант 1, №1" "$(echo "$RB" | jq -r "[.[]|select(.id==$ITEM1)][0].source_ref")" "$RB"
req GET "/cert-exams/$EXAM2/anchor-candidates" "" "$BT"
chk "other tenant blocked -> 404" 404 "$RS" "$RB"

PSQL "DELETE FROM cert_exam_items WHERE exam_id=$EXAM2; DELETE FROM cert_exams WHERE id=$EXAM2;" >/dev/null
req GET "/cert-exams/$EXAM" "" "$TT"
chk "anchor count drops when other variant goes" "0" "$(echo "$RB" | jq -r .anchor_count)" "$RB"


echo "== ITEM CARD =="
req GET "/cert-items/$ITEM1/card" "" "$TT"
chk "card readable" 200 "$RS" "$RB"
chk "card has code" "true" "$(echo "$RB" | jq -r '.code|test("^[0-9]+-[0-9]{4}$")')" "$RB"
chk "task type Y1 for task 1" "Y1" "$(echo "$RB" | jq -r .task_type)" "$RB"
chk "options listed" "ABCD" "$(echo "$RB" | jq -r '.options|join("")')" "$RB"
chk "option rows present" "4" "$(echo "$RB" | jq -r '.stats.options|length')" "$RB"
chk "key marked among options" "A" "$(echo "$RB" | jq -r '[.stats.options[]|select(.is_key)][0].option')" "$RB"
chk "usage lists the variant" "true" "$(echo "$RB" | jq -r '[.usage[]|select(.exam_id=='"$EXAM"')]|length>0')" "$RB"
chk "entered_by recorded" "true" "$(echo "$RB" | jq -r '.entered_by != null')" "$RB"

req PATCH "/cert-items/$ITEM1" '{"stem_text":"Текст задания для теста","author":"Xolbek Juraqulov","cognitive_level":2,"notes":"проверить формулировку"}' "$TT"
chk "save card content" 200 "$RS" "$RB"
req GET "/cert-items/$ITEM1/card" "" "$TT"
chk "stem persisted" "Текст задания для теста" "$(echo "$RB" | jq -r .stem_text)" "$RB"
chk "author persisted" "Xolbek Juraqulov" "$(echo "$RB" | jq -r .author)" "$RB"
chk "cognitive level persisted" "2" "$(echo "$RB" | jq -r .cognitive_level)" "$RB"
req PATCH "/cert-items/$ITEM1" '{"cognitive_level":3}' "$TT"
chk "invalid cognitive level -> 422" 422 "$RS" "$RB"

req PATCH "/cert-items/$ITEM1" '{"status":"retired"}' "$TT"
chk "retire item" 200 "$RS" "$RB"
req GET "/cert-items/$ITEM1/card" "" "$TT"
chk "status retired" "retired" "$(echo "$RB" | jq -r .status)" "$RB"
req PATCH "/cert-items/$ITEM1" '{"status":"active"}' "$TT"
chk "restore item" 200 "$RS" "$RB"
req PATCH "/cert-items/$ITEM1" '{"status":"deleted"}' "$TT"
chk "invalid status -> 422" 422 "$RS" "$RB"

req GET "/cert-items/$ITEM1/card" "" "$BT"
chk "other tenant cannot read card -> 404" 404 "$RS" "$RB"

echo "== STATISTICS =="
req GET /cert-items "" "$TT"
chk "task 1 has a response" "1" "$(echo "$RB" | jq -r '[.[]|select(.id=='"$ITEM1"')][0].responses')" "$RB"
chk "task 1 p_value = 1 (answered right)" "1" "$(echo "$RB" | jq -r '[.[]|select(.id=='"$ITEM1"')][0].p_value')" "$RB"

echo
echo "==== RESULT: $PASS passed, $FAIL failed ===="
for f in "${FAILURES[@]}"; do echo "  ! $f"; done
[ "$FAIL" -eq 0 ]
