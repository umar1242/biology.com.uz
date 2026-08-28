import cron, { type ScheduledTask } from "node-cron";
import type { FastifyBaseLogger } from "fastify";
import { runMissedHomeworkSweep } from "./missedHomeworkSweep.js";
import { runAccessExpirySweep } from "./accessExpirySweep.js";
import { runHomeworkDeadlineReminder } from "./homeworkDeadlineReminder.js";
import { runLiveLessonReminder } from "./liveLessonReminder.js";
import { runUnreviewedHomeworkDigest } from "./unreviewedHomeworkDigest.js";
import { runTrialExpirySweep } from "./trialExpirySweep.js";

// Handles to every scheduled task, so a graceful shutdown (see index.ts) can
// stop them before closing the DB pool — otherwise a job firing mid-shutdown
// would run its queries against an already-closing connection.
const tasks: ScheduledTask[] = [];

// noOverlap: true — a slow run (e.g. Telegram API hiccups) must not stack a
// second concurrent pass over the same rows.
function scheduleJob(
  log: FastifyBaseLogger,
  name: string,
  expression: string,
  fn: () => Promise<void>,
) {
  const task = cron.schedule(
    expression,
    async () => {
      try {
        await fn();
      } catch (err) {
        // Use the app's pino logger, not console.error, so job failures land
        // in the same structured stream as every other server log.
        log.error({ err, job: name }, `job ${name} failed`);
      }
    },
    { name, noOverlap: true },
  );
  tasks.push(task);
}

export function startJobs(log: FastifyBaseLogger) {
  scheduleJob(log, "missed-homework-sweep", "*/15 * * * *", runMissedHomeworkSweep);
  scheduleJob(log, "access-expiry-sweep", "0 * * * *", runAccessExpirySweep);
  scheduleJob(log, "homework-deadline-reminder", "*/30 * * * *", runHomeworkDeadlineReminder);
  scheduleJob(log, "live-lesson-reminder", "*/5 * * * *", runLiveLessonReminder);
  scheduleJob(log, "unreviewed-homework-digest", "0 9 * * *", runUnreviewedHomeworkDigest);
  scheduleJob(log, "trial-expiry-sweep", "10 * * * *", runTrialExpirySweep);
}

/**
 * Stops the cron schedulers so no new job pass starts during shutdown. A pass
 * already in flight is left to finish on its own — every job is a single
 * short DB sweep, and noOverlap guarantees at most one is running per name.
 */
export async function stopJobs() {
  await Promise.all(tasks.map((task) => task.stop()));
}
