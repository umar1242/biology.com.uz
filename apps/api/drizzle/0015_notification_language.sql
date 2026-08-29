-- Language of the staff notification feed, separate from the teacher's own
-- interface language. NULL keeps the previous behaviour (follow the panel).
ALTER TABLE "teachers" ADD COLUMN "notification_language" "language";
