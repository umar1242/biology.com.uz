/**
 * Creates the three staff accounts the e2e suites log in as: two teachers in
 * separate tenants (alice, bob — the pair every cross-tenant isolation check
 * relies on) and one assistant under alice (helper_carol).
 *
 * There is no self-serve signup by design — accounts are created by the owner
 * through the bot — so a fresh CI database has no way to produce these, and
 * before this the suites simply assumed someone had made them by hand.
 *
 * Also creates three students. The suites need students that exist but have
 * no course access yet — granting it is one of the things under test — and a
 * fresh database has none, since students only appear via Telegram.
 *
 * Idempotent: re-running only resets the passwords.
 *
 * Guarded by E2E_SEED=yes. These are accounts with a published password; the
 * guard is there so a mistyped DATABASE_URL cannot quietly open three doors
 * into a real installation.
 */
import { eq } from "drizzle-orm";
import { db, queryClient } from "../db/client.js";
import { assistants, staffUsers, students, teachers } from "../db/schema.js";
import { hashPassword } from "../auth/password.js";

const PASSWORD = "secret1234";

if (process.env.E2E_SEED !== "yes") {
  console.error("Refusing to seed: set E2E_SEED=yes to confirm this is a test database.");
  process.exit(1);
}

async function upsertStaff(username: string, role: "teacher" | "assistant", displayName: string) {
  const passwordHash = await hashPassword(PASSWORD);
  const [row] = await db
    .insert(staffUsers)
    .values({ username, role, passwordHash, displayName })
    .onConflictDoUpdate({
      target: staffUsers.username,
      set: { passwordHash, isActive: true, updatedAt: new Date() },
    })
    .returning({ id: staffUsers.id });
  return row.id;
}

const aliceId = await upsertStaff("alice", "teacher", "Alice E2E");
const bobId = await upsertStaff("bob", "teacher", "Bob E2E");
const carolId = await upsertStaff("helper_carol", "assistant", "Carol Helper");

for (const staffUserId of [aliceId, bobId]) {
  await db.insert(teachers).values({ staffUserId }).onConflictDoNothing();
}
// The assistant's owning teacher is what makes alice/carol one tenant.
await db
  .insert(assistants)
  .values({ staffUserId: carolId, teacherId: aliceId })
  .onConflictDoUpdate({ target: assistants.staffUserId, set: { teacherId: aliceId } });

// Addressed by telegram_id, never by row id: the suites look them up, so
// seeding into a database that already has students still works.
for (const [index, telegramId] of [900000001, 900000002, 900000003].entries()) {
  await db
    .insert(students)
    .values({ telegramId, firstName: `E2E Student ${index + 1}` })
    .onConflictDoNothing({ target: students.telegramId });
}

const roles = await db
  .select({ id: staffUsers.id, username: staffUsers.username, role: staffUsers.role })
  .from(staffUsers)
  .where(eq(staffUsers.isActive, true));
console.log(
  "seeded:",
  roles
    .filter((r) => ["alice", "bob", "helper_carol"].includes(r.username ?? ""))
    .map((r) => `${r.username}(#${r.id}, ${r.role})`)
    .join(" "),
);

await queryClient.end();
