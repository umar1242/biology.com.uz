import { and, eq, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { courseBlacklist, courseDisciplinaryEvents, coursePenaltyPoints, students, teachers } from "../db/schema.js";
import { removeStudentFromCourseGroup } from "../telegram/groupMembership.js";
import { alertStaff } from "../telegram/notify.js";

type MissedRow = {
  homework_id: string;
  teacher_id: string;
  course_id: string;
  student_id: string;
};

/**
 * The automatic side of idea-platforma-kursy.md §7.1: a homework past its
 * deadline with zero submissions from a student costs them +1 point. This
 * was previously only a DB shape (the idempotent unique index) with no
 * process actually walking it — this job is that process.
 */
export async function runMissedHomeworkSweep(): Promise<void> {
  const rows = await db.execute<MissedRow>(sql`
    SELECT h.id AS homework_id, h.teacher_id, m.course_id, ca.student_id
    FROM homeworks h
    JOIN lessons l ON l.id = h.lesson_id AND l.is_published IS NOT NULL
    JOIN modules m ON m.id = l.module_id
    JOIN course_access ca ON ca.course_id = m.course_id AND ca.access_granted = true AND ca.revoked = false
    LEFT JOIN course_blacklist cb ON cb.course_id = m.course_id AND cb.student_id = ca.student_id
    WHERE h.deadline_at < now()
      AND (cb.is_blacklisted IS NULL OR cb.is_blacklisted = false)
      AND NOT EXISTS (
        SELECT 1 FROM homework_submissions hs
        WHERE hs.homework_id = h.id AND hs.student_id = ca.student_id
      )
      AND NOT EXISTS (
        SELECT 1 FROM course_disciplinary_events cde
        WHERE cde.event_type = 'missed_homework_deadline'
          AND cde.related_homework_id = h.id
          AND cde.student_id = ca.student_id
      )
  `);

  for (const row of rows) {
    await processMissedHomework({
      homeworkId: Number(row.homework_id),
      teacherId: Number(row.teacher_id),
      courseId: Number(row.course_id),
      studentId: Number(row.student_id),
    });
  }
}

async function processMissedHomework(params: {
  homeworkId: number;
  teacherId: number;
  courseId: number;
  studentId: number;
}) {
  // The unique index (student_id, related_homework_id) WHERE event_type =
  // 'missed_homework_deadline' is the real idempotency guard — the NOT
  // EXISTS above is just an optimization to avoid re-selecting rows we'd
  // immediately skip; onConflictDoNothing covers a race between two sweep
  // runs (e.g. overlapping schedules).
  const inserted = await db
    .insert(courseDisciplinaryEvents)
    .values({
      courseId: params.courseId,
      studentId: params.studentId,
      teacherId: params.teacherId,
      eventType: "missed_homework_deadline",
      pointsDelta: 1,
      relatedHomeworkId: params.homeworkId,
    })
    .onConflictDoNothing()
    .returning({ id: courseDisciplinaryEvents.id });
  if (inserted.length === 0) return;

  const [points] = await db
    .insert(coursePenaltyPoints)
    .values({ courseId: params.courseId, studentId: params.studentId, currentPoints: 1 })
    .onConflictDoUpdate({
      target: [coursePenaltyPoints.courseId, coursePenaltyPoints.studentId],
      set: { currentPoints: sql`${coursePenaltyPoints.currentPoints} + 1`, updatedAt: new Date() },
    })
    .returning();

  const [teacher] = await db
    .select()
    .from(teachers)
    .where(eq(teachers.staffUserId, params.teacherId))
    .limit(1);
  if (teacher && points.currentPoints >= teacher.penaltyPointThreshold) {
    await autoBlacklist(params.courseId, params.studentId, params.teacherId);
  }
}

async function autoBlacklist(courseId: number, studentId: number, teacherId: number) {
  const [existing] = await db
    .select()
    .from(courseBlacklist)
    .where(and(eq(courseBlacklist.courseId, courseId), eq(courseBlacklist.studentId, studentId)))
    .limit(1);
  if (existing?.isBlacklisted) return; // already blacklisted — nothing new to do

  await db.transaction(async (tx) => {
    await tx
      .insert(courseBlacklist)
      .values({ courseId, studentId, isBlacklisted: true, blacklistedAt: new Date() })
      .onConflictDoUpdate({
        target: [courseBlacklist.courseId, courseBlacklist.studentId],
        set: { isBlacklisted: true, blacklistedAt: new Date(), updatedAt: new Date() },
      });
    await tx.insert(courseDisciplinaryEvents).values({
      courseId,
      studentId,
      teacherId,
      eventType: "auto_blacklist",
      pointsDelta: 0,
    });
  });

  // Awaited, not fire-and-forget: this is a one-shot event with no retry —
  // unlike the periodic reminder sweeps, there's no next run that would
  // pick up a dropped notification for the same blacklist event.
  const [student] = await db.select().from(students).where(eq(students.id, studentId)).limit(1);
  if (student) await removeStudentFromCourseGroup(courseId, student.telegramId);

  await alertStaff({
    staffId: teacherId,
    courseId,
    studentId,
    alert: { kind: "blacklisted", auto: true },
  });
}
