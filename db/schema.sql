-- Database schema for the biology/chemistry course platform.
-- PostgreSQL. Derived from idea-platforma-kursy.md and the DB-design
-- planning session (see /home/umariko/.claude/plans/adaptive-mixing-leaf.md
-- for full rationale).

CREATE EXTENSION IF NOT EXISTS citext;

-- ========================================================================
-- 1. Enums
-- ========================================================================

CREATE TYPE staff_role AS ENUM ('owner', 'teacher', 'assistant');
CREATE TYPE course_subject AS ENUM ('biology', 'chemistry');
CREATE TYPE lesson_type AS ENUM ('live', 'recorded');
CREATE TYPE lesson_material_type AS ENUM ('video', 'text', 'file');
CREATE TYPE submission_status AS ENUM ('pending', 'passed', 'needs_resubmission');

CREATE TYPE disciplinary_event_type AS ENUM (
  'missed_homework_deadline',   -- the only automatic trigger, +1
  'manual_point_adjustment',    -- teacher-initiated manual point change
  'points_reset',                -- teacher clears the counter
  'auto_blacklist',               -- system-triggered on reaching threshold
  'manual_blacklist',             -- teacher-triggered, independent of points
  'manual_blacklist_clear'        -- teacher lifts a blacklist
);

CREATE TYPE notification_recipient_type AS ENUM ('student', 'staff');
CREATE TYPE notification_channel AS ENUM ('private_chat', 'group_chat');
CREATE TYPE notification_type AS ENUM (
  'live_lesson_reminder',
  'homework_deadline_reminder',
  'new_material_published',
  'access_expiring_soon',
  'access_expired',
  'blacklist_event',
  'unreviewed_homework_summary'
);

-- ========================================================================
-- 2. Identity & roles
-- ========================================================================

-- Base identity for all staff (owner/teacher/assistant). Two auth methods:
-- owner authenticates via their own Telegram identity through the bot's
-- admin section (idea-platforma-kursy.md §3), never via the website; teacher
-- and assistant authenticate via username+password on the website. Hence
-- exactly one of (telegram_id) / (username, password_hash) is populated,
-- enforced below rather than requiring both columns on every row.
CREATE TABLE staff_users (
  id             BIGSERIAL PRIMARY KEY,
  role           staff_role NOT NULL,
  telegram_id    BIGINT UNIQUE,             -- owner only (auth identity)
  username       CITEXT UNIQUE,             -- teacher/assistant only
  password_hash  TEXT,                      -- teacher/assistant only
  -- Separate from `telegram_id` above: teachers/assistants authenticate by
  -- password, but can optionally link their own Telegram account here just
  -- to receive push notifications (blacklist events, access expiry, unread
  -- ДЗ digest) — the CHECK constraint on telegram_id is about auth method
  -- exclusivity and doesn't apply to this column.
  notification_telegram_id BIGINT UNIQUE,
  display_name   TEXT NOT NULL,
  is_active      BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT staff_auth_method_matches_role CHECK (
    (role = 'owner' AND telegram_id IS NOT NULL AND username IS NULL AND password_hash IS NULL)
    OR
    (role IN ('teacher', 'assistant') AND telegram_id IS NULL AND username IS NOT NULL AND password_hash IS NOT NULL)
  )
);

-- 1:1 extension for role='teacher' rows. A teacher IS a tenant root.
CREATE TABLE teachers (
  staff_user_id           BIGINT PRIMARY KEY REFERENCES staff_users(id),
  penalty_point_threshold INT NOT NULL DEFAULT 3 CHECK (penalty_point_threshold > 0),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 1:1 extension for role='assistant' rows. Belongs to exactly one teacher.
CREATE TABLE assistants (
  staff_user_id  BIGINT PRIMARY KEY REFERENCES staff_users(id),
  teacher_id     BIGINT NOT NULL REFERENCES teachers(staff_user_id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_assistants_teacher ON assistants(teacher_id);
-- role='owner' rows in staff_users need no extension table.

-- Students: Telegram-authenticated, tenant-agnostic identity. Tenancy lives
-- on course_access rows, not on the student row itself — the same student
-- can hold access under multiple teachers.
CREATE TABLE students (
  id                BIGSERIAL PRIMARY KEY,
  telegram_id       BIGINT NOT NULL UNIQUE,
  telegram_username TEXT,
  first_name        TEXT NOT NULL,
  last_name         TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ========================================================================
-- 3. Courses & Telegram group linkage
-- ========================================================================

CREATE TABLE courses (
  id           BIGSERIAL PRIMARY KEY,
  teacher_id   BIGINT NOT NULL REFERENCES teachers(staff_user_id),
  title        TEXT NOT NULL,
  description  TEXT,
  subject      course_subject NOT NULL,
  is_archived  BOOLEAN NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_courses_teacher ON courses(teacher_id);

-- Assistant permissions, scoped per course. Existence of a row grants the
-- default (homework review); can_manage_access/can_manage_blacklist are
-- explicit opt-in grants a teacher can add per idea-platforma-kursy.md §2.3.
CREATE TABLE assistant_course_permissions (
  id                    BIGSERIAL PRIMARY KEY,
  assistant_id          BIGINT NOT NULL REFERENCES assistants(staff_user_id),
  course_id             BIGINT NOT NULL REFERENCES courses(id),
  can_review_homework   BOOLEAN NOT NULL DEFAULT true,
  can_manage_access     BOOLEAN NOT NULL DEFAULT false,
  can_manage_blacklist  BOOLEAN NOT NULL DEFAULT false,
  granted_by            BIGINT NOT NULL REFERENCES staff_users(id),
  granted_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (assistant_id, course_id)
);
CREATE INDEX idx_assistant_perms_course ON assistant_course_permissions(course_id);

-- One Telegram group per course. The bot is a member and can add/remove
-- students programmatically (access revocation, auto-blacklist removal).
CREATE TABLE course_telegram_groups (
  course_id         BIGINT PRIMARY KEY REFERENCES courses(id),
  telegram_chat_id  BIGINT NOT NULL UNIQUE,
  invite_link       TEXT,
  bot_is_member     BOOLEAN NOT NULL DEFAULT true,
  linked_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ========================================================================
-- 4. Modules / Lessons / Materials
-- ========================================================================

CREATE TABLE modules (
  id          BIGSERIAL PRIMARY KEY,
  course_id   BIGINT NOT NULL REFERENCES courses(id),
  teacher_id  BIGINT NOT NULL REFERENCES teachers(staff_user_id),  -- denormalized, see §8 rationale
  title       TEXT NOT NULL,
  description TEXT,
  order_index INT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (course_id, order_index)
);
CREATE INDEX idx_modules_course ON modules(course_id);

CREATE TABLE lessons (
  id           BIGSERIAL PRIMARY KEY,
  module_id    BIGINT NOT NULL REFERENCES modules(id),
  teacher_id   BIGINT NOT NULL REFERENCES teachers(staff_user_id),
  title        TEXT NOT NULL,
  description  TEXT,
  order_index  INT NOT NULL,
  lesson_type  lesson_type NOT NULL,
  scheduled_at TIMESTAMPTZ NOT NULL,  -- live: mandatory fixed start time; recorded: planned release time

  -- live-only fields
  live_call_link          TEXT,        -- teacher-pasted URL: Telegram group video chat or Google Meet
  live_recording_file_id  TEXT,        -- OPTIONAL post-hoc recording; stays NULL if the teacher never attaches one

  -- recorded-only field
  recorded_video_file_id  TEXT,        -- the lesson's video

  is_published TIMESTAMPTZ,            -- NULL = draft, not visible to students
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (module_id, order_index),
  CONSTRAINT lesson_type_fields_consistent CHECK (
    (lesson_type = 'live'     AND recorded_video_file_id IS NULL)
    OR
    (lesson_type = 'recorded' AND live_call_link IS NULL AND live_recording_file_id IS NULL)
  )
);
CREATE INDEX idx_lessons_module ON lessons(module_id);
CREATE INDEX idx_lessons_live_schedule ON lessons(scheduled_at) WHERE lesson_type = 'live';

-- Generic attachments beyond the lesson's primary video field above.
CREATE TABLE lesson_materials (
  id                BIGSERIAL PRIMARY KEY,
  lesson_id         BIGINT NOT NULL REFERENCES lessons(id),
  material_type     lesson_material_type NOT NULL,
  order_index       INT NOT NULL,
  text_content      TEXT,
  telegram_file_id  TEXT,
  file_name         TEXT,
  caption           TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT material_fields_consistent CHECK (
    (material_type = 'text'  AND text_content IS NOT NULL AND telegram_file_id IS NULL)
    OR
    (material_type IN ('video','file') AND telegram_file_id IS NOT NULL AND text_content IS NULL)
  )
);
CREATE INDEX idx_lesson_materials_lesson ON lesson_materials(lesson_id, order_index);

-- ========================================================================
-- 5. Homework & submissions
-- ========================================================================

CREATE TABLE homeworks (
  id           BIGSERIAL PRIMARY KEY,
  lesson_id    BIGINT NOT NULL UNIQUE REFERENCES lessons(id),  -- exactly one homework per lesson
  teacher_id   BIGINT NOT NULL REFERENCES teachers(staff_user_id),
  instructions TEXT,
  deadline_at  TIMESTAMPTZ NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_homeworks_deadline ON homeworks(deadline_at);  -- for the missed-deadline sweep job

CREATE TABLE homework_submissions (
  id              BIGSERIAL PRIMARY KEY,
  homework_id     BIGINT NOT NULL REFERENCES homeworks(id),
  student_id      BIGINT NOT NULL REFERENCES students(id),
  teacher_id      BIGINT NOT NULL REFERENCES teachers(staff_user_id),

  attempt_number  INT NOT NULL,          -- 1, 2, 3... per (homework, student)
  photo_file_ids  TEXT[] NOT NULL,       -- ordered array of Telegram file_ids, 1..N
  submitted_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_late         BOOLEAN NOT NULL,      -- computed once at insert time vs. deadline_at at that moment

  status                        submission_status NOT NULL DEFAULT 'pending',
  reviewed_by                   BIGINT REFERENCES staff_users(id),
  reviewed_at                   TIMESTAMPTZ,
  review_comment_text           TEXT,
  review_comment_voice_file_id  TEXT,

  CONSTRAINT photo_array_nonempty CHECK (array_length(photo_file_ids, 1) >= 1),
  CONSTRAINT review_comment_single_form CHECK (
    NOT (review_comment_text IS NOT NULL AND review_comment_voice_file_id IS NOT NULL)
  ),
  CONSTRAINT reviewed_fields_consistent CHECK (
    (status = 'pending' AND reviewed_by IS NULL AND reviewed_at IS NULL)
    OR
    (status IN ('passed','needs_resubmission') AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)
  ),
  UNIQUE (homework_id, student_id, attempt_number)
);
CREATE INDEX idx_submissions_homework_student ON homework_submissions(homework_id, student_id);
CREATE INDEX idx_submissions_pending ON homework_submissions(homework_id) WHERE status = 'pending';

-- The latest attempt per (homework, student) — what the review queue and
-- student progress screens actually want.
CREATE VIEW latest_homework_submissions AS
SELECT DISTINCT ON (homework_id, student_id) *
FROM homework_submissions
ORDER BY homework_id, student_id, attempt_number DESC;

-- ========================================================================
-- 6. Course access (payment/enrollment toggle)
-- ========================================================================

CREATE TABLE course_access (
  id             BIGSERIAL PRIMARY KEY,
  course_id      BIGINT NOT NULL REFERENCES courses(id),
  student_id     BIGINT NOT NULL REFERENCES students(id),
  teacher_id     BIGINT NOT NULL REFERENCES teachers(staff_user_id),

  access_granted BOOLEAN NOT NULL DEFAULT false,   -- manual grant/deny toggle
  granted_at     TIMESTAMPTZ,
  granted_by     BIGINT REFERENCES staff_users(id),
  expires_at     TIMESTAMPTZ,   -- set by teacher at grant time; NOT auto-enforced

  revoked        BOOLEAN NOT NULL DEFAULT false,   -- explicit teacher action, independent of expiry
  revoked_at     TIMESTAMPTZ,
  revoked_by     BIGINT REFERENCES staff_users(id),

  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (course_id, student_id),
  CONSTRAINT expiry_required_when_granted CHECK (
    access_granted = false OR expires_at IS NOT NULL
  )
);
CREATE INDEX idx_course_access_student ON course_access(student_id);
-- For the expiry-reminder sweep (both "expiring soon" and "expired, awaiting teacher action"):
CREATE INDEX idx_course_access_expiry_watch ON course_access(expires_at)
  WHERE access_granted = true AND revoked = false;

-- Effective "can this student see this course" =
--   access_granted AND NOT revoked AND NOT course_blacklist.is_blacklisted
-- (computed via join; deliberately not a single "banned" flag — access and
-- blacklist are independent teacher actions per the spec.)

-- ========================================================================
-- 7. Penalty points, blacklist, disciplinary event log
-- ========================================================================
-- Single automatic trigger only: a fully unsubmitted homework past its
-- deadline. There is no automatic "missed live lesson" trigger — Telegram's
-- Bot API cannot detect participation in a group video chat or Google Meet,
-- so attendance is not tracked at all. Mandatory live attendance remains a
-- policy the teacher can enforce via manual_blacklist if needed.

CREATE TABLE course_penalty_points (
  course_id      BIGINT NOT NULL REFERENCES courses(id),
  student_id     BIGINT NOT NULL REFERENCES students(id),
  current_points INT NOT NULL DEFAULT 0,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (course_id, student_id)
);

CREATE TABLE course_blacklist (
  course_id       BIGINT NOT NULL REFERENCES courses(id),
  student_id      BIGINT NOT NULL REFERENCES students(id),
  is_blacklisted  BOOLEAN NOT NULL DEFAULT false,
  blacklisted_at  TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (course_id, student_id)
);

CREATE TABLE course_disciplinary_events (
  id                  BIGSERIAL PRIMARY KEY,
  course_id           BIGINT NOT NULL REFERENCES courses(id),
  student_id          BIGINT NOT NULL REFERENCES students(id),
  teacher_id          BIGINT NOT NULL REFERENCES teachers(staff_user_id),
  event_type          disciplinary_event_type NOT NULL,
  points_delta        INT NOT NULL DEFAULT 0,
  reason              TEXT,                                  -- esp. for manual_blacklist
  related_homework_id BIGINT REFERENCES homeworks(id),        -- set for missed_homework_deadline
  actor_staff_id      BIGINT REFERENCES staff_users(id),      -- NULL for system/automatic events
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_disc_events_student_course ON course_disciplinary_events(course_id, student_id, created_at);

-- Idempotency guard: a given homework can only ever generate one automatic
-- penalty event per student, even if the sweep job runs more than once.
CREATE UNIQUE INDEX uq_missed_homework_once
  ON course_disciplinary_events(student_id, related_homework_id)
  WHERE event_type = 'missed_homework_deadline';

-- course_penalty_points.current_points and course_blacklist.is_blacklisted
-- are a cache of what course_disciplinary_events already proves — updated in
-- the same transaction as the event insert, rebuildable from the log if they
-- ever drift.

-- ========================================================================
-- 8. Tenant scoping note
-- ========================================================================
-- teacher_id is denormalized directly onto every teacher-scoped table
-- (modules, lessons, homeworks, homework_submissions, course_access,
-- course_disciplinary_events) even though it's derivable via joins through
-- courses. At this scale (1-5 teachers, 50-200 users) the extra column costs
-- nothing and enables a flat `WHERE teacher_id = ?` instead of a join chain
-- in every query. `students` is intentionally NOT teacher-scoped (see §2).
--
-- Recommended for later hardening (not required for v1): Postgres Row-Level
-- Security policies on the teacher-scoped tables, keyed off a session
-- variable for the current teacher, with a bypass for the project owner
-- (who needs cross-tenant visibility per the spec).

-- ========================================================================
-- 9. Bot pending-action correlation
-- ========================================================================
-- Both video ingestion (teacher attaches a lesson recording) and homework
-- submission (student sends photos) rely on the same pattern: the user is
-- sent to a private chat with the bot via a deep link carrying an opaque
-- token, and the NEXT media message(s) they send are what get attached.
-- Telegram's Bot API gives no other way to correlate an incoming DM with
-- "what dashboard/Mini-App action triggered this" — hence this small
-- short-lived state table.
--
-- Two-phase lifecycle, because the row is created by a dashboard/Mini-App
-- API call BEFORE we know the actor's Telegram identity — teachers log in
-- with username/password, not Telegram, so at creation time we only know
-- *what* action is pending, not *who* (in Telegram terms) will fulfil it:
--   1. created:  token set, telegram_id/claimed_at NULL — the deep link was
--      just issued; nobody has opened it yet.
--   2. claimed:  the user opened https://t.me/<bot>?start=<token> — the
--      bot's own /start handler fills in telegram_id from that very
--      message and stamps claimed_at. From here on the row behaves like a
--      normal per-user pending action.
--   3. consumed: the expected media arrived from that telegram_id — the
--      bot writes the file_id/submission where it belongs and stamps
--      consumed_at.
-- A token is only ever usable by whoever taps it first (claiming sets
-- telegram_id), and only unclaimed/unexpired rows can still be claimed.

CREATE TYPE bot_pending_action_type AS ENUM (
  'attach_lesson_recording',
  'submit_homework',
  'link_course_group',  -- teacher adds the bot to the course's Telegram
                         -- group and sends /link_<token> there; telegram_id
                         -- is then the GROUP's chat_id (negative), not a
                         -- user id — same claim mechanism, different actor
  'link_staff_notifications', -- teacher/assistant opts in to Telegram push
                         -- notifications; unlike the other three, this
                         -- finishes the moment /start is opened — there's
                         -- no follow-up media message to wait for
  'attach_review_voice' -- teacher/assistant records a voice comment for a
                         -- homework submission they're reviewing, instead
                         -- of typing review_comment_text
);

CREATE TABLE bot_pending_actions (
  id                   BIGSERIAL PRIMARY KEY,
  token                TEXT NOT NULL UNIQUE,   -- carried in the deep link; claims the row
  telegram_id          BIGINT,                 -- set on claim (step 2) — NULL until then
  action_type          bot_pending_action_type NOT NULL,
  target_lesson_id     BIGINT REFERENCES lessons(id),      -- set for attach_lesson_recording
  target_homework_id   BIGINT REFERENCES homeworks(id),    -- set for submit_homework
  target_course_id     BIGINT REFERENCES courses(id),      -- set for link_course_group
  target_staff_id      BIGINT REFERENCES staff_users(id),  -- set for link_staff_notifications
  target_submission_id BIGINT REFERENCES homework_submissions(id), -- set for attach_review_voice
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at           TIMESTAMPTZ NOT NULL,
  claimed_at           TIMESTAMPTZ,
  consumed_at          TIMESTAMPTZ
);
CREATE INDEX idx_pending_actions_lookup ON bot_pending_actions(telegram_id, action_type)
  WHERE consumed_at IS NULL;

-- ========================================================================
-- 10. Notifications log
-- ========================================================================

CREATE TABLE notifications_log (
  id                     BIGSERIAL PRIMARY KEY,
  notification_type      notification_type NOT NULL,
  recipient_type         notification_recipient_type NOT NULL,
  recipient_student_id   BIGINT REFERENCES students(id),
  recipient_staff_id     BIGINT REFERENCES staff_users(id),
  course_id              BIGINT REFERENCES courses(id),
  channel                notification_channel NOT NULL,
  telegram_message_id    BIGINT,
  payload                JSONB,
  sent_at                TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT exactly_one_recipient CHECK (
    (recipient_type = 'student' AND recipient_student_id IS NOT NULL AND recipient_staff_id IS NULL)
    OR
    (recipient_type = 'staff'   AND recipient_staff_id IS NOT NULL AND recipient_student_id IS NULL)
  )
);
CREATE INDEX idx_notifications_student ON notifications_log(recipient_student_id, sent_at);
CREATE INDEX idx_notifications_staff   ON notifications_log(recipient_staff_id, sent_at);
CREATE INDEX idx_notifications_course_type ON notifications_log(course_id, notification_type, sent_at);
