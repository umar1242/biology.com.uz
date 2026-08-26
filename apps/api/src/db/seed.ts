// Local-dev-only convenience: creates a teacher account directly, standing
// in for the owner's bot-driven "grant teacher status" flow (not yet built).
// Never run against a production database — production teacher creation
// goes through the Telegram bot, per idea-platforma-kursy.md §2.1.
import "dotenv/config";
import { db, queryClient } from "./client.js";
import { staffUsers, teachers } from "./schema.js";
import { hashPassword } from "../auth/password.js";

const username = process.argv[2] ?? "demo_teacher";
const password = process.argv[3] ?? "demo-password-123";

const passwordHash = await hashPassword(password);

const [staff] = await db
  .insert(staffUsers)
  .values({
    role: "teacher",
    username,
    passwordHash,
    displayName: "Demo Teacher",
  })
  .returning();

await db.insert(teachers).values({ staffUserId: staff.id });

console.log(`Created teacher "${username}" / "${password}" (staff_id=${staff.id})`);
await queryClient.end();
