import cron from "node-cron";
import { runMissedHomeworkSweep } from "./missedHomeworkSweep.js";
import { runAccessExpirySweep } from "./accessExpirySweep.js";
import { runHomeworkDeadlineReminder } from "./homeworkDeadlineReminder.js";
import { runLiveLessonReminder } from "./liveLessonReminder.js";
import { runUnreviewedHomeworkDigest } from "./unreviewedHomeworkDigest.js";

// noOverlap: true — a slow run (e.g. Telegram API hiccups) must not stack a
// second concurrent pass over the same rows.
function scheduleJob(name: string, expression: string, fn: () => Promise<void>) {
  cron.schedule(
    expression,
    async () => {
      try {
        await fn();
      } catch (err) {
        console.error(`[job:${name}] failed`, err);
      }
    },
    { name, noOverlap: true },
  );
}

export function startJobs() {
  scheduleJob("missed-homework-sweep", "*/15 * * * *", runMissedHomeworkSweep);
  scheduleJob("access-expiry-sweep", "0 * * * *", runAccessExpirySweep);
  scheduleJob("homework-deadline-reminder", "*/30 * * * *", runHomeworkDeadlineReminder);
  scheduleJob("live-lesson-reminder", "*/5 * * * *", runLiveLessonReminder);
  scheduleJob("unreviewed-homework-digest", "0 9 * * *", runUnreviewedHomeworkDigest);
}
