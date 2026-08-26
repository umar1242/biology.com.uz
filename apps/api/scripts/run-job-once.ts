// Dev utility: runs one named job immediately instead of waiting for its
// cron schedule — useful for testing without sitting through a 15-minute
// interval. Usage: npx tsx scripts/run-job-once.ts <job-name>
import "dotenv/config";
import { bot } from "../src/telegram/bot.js";
import { runMissedHomeworkSweep } from "../src/jobs/missedHomeworkSweep.js";
import { runAccessExpirySweep } from "../src/jobs/accessExpirySweep.js";
import { runHomeworkDeadlineReminder } from "../src/jobs/homeworkDeadlineReminder.js";
import { runLiveLessonReminder } from "../src/jobs/liveLessonReminder.js";
import { runUnreviewedHomeworkDigest } from "../src/jobs/unreviewedHomeworkDigest.js";

const jobs: Record<string, () => Promise<void>> = {
  "missed-homework": runMissedHomeworkSweep,
  "access-expiry": runAccessExpirySweep,
  "homework-deadline": runHomeworkDeadlineReminder,
  "live-lesson": runLiveLessonReminder,
  "unreviewed-digest": runUnreviewedHomeworkDigest,
};

const name = process.argv[2];
const job = name && jobs[name];
if (!job) {
  console.error(`Usage: npx tsx scripts/run-job-once.ts <${Object.keys(jobs).join("|")}>`);
  process.exit(1);
}

await bot.init();
await job();
console.log(`Ran job: ${name}`);
process.exit(0);
