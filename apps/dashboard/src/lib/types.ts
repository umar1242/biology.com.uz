export type StaffRole = "teacher" | "assistant";

export type Me = {
  staff_id: number;
  role: StaffRole;
  teacher_id: number;
  display_name: string;
};

export type DashboardSummary = {
  active_students: number;
  unreviewed_homework_count: number;
  upcoming_live_lessons: number;
  access_needing_attention_count: number;
  students_near_blacklist_threshold: number;
};

export type Course = {
  id: number;
  title: string;
  description: string | null;
  subject: "biology" | "chemistry";
  isArchived: boolean;
};

export type ReviewQueueItem = {
  id: number;
  homeworkId: number;
  studentId: number;
  attemptNumber: number;
  photoFileIds: string[];
  submittedAt: string;
  isLate: boolean;
  status: "pending" | "passed" | "needs_resubmission";
  course_id: number;
  reviewCommentText: string | null;
  reviewCommentVoiceFileId: string | null;
};

export type RosterStudent = {
  student_id: number;
  telegram_username: string | null;
  first_name: string;
  access_granted: boolean;
  expires_at: string | null;
  revoked: boolean;
  penalty_points: number;
  is_blacklisted: boolean;
  progress_summary: { homework_total: number; homework_passed: number };
};

export type Assistant = {
  staff_id: number;
  username: string;
  display_name: string;
  is_active: boolean;
};

export type AssistantPermission = {
  id: number;
  assistantId: number;
  courseId: number;
  canReviewHomework: boolean;
  canManageAccess: boolean;
  canManageBlacklist: boolean;
};

export type Module = {
  id: number;
  courseId: number;
  title: string;
  description: string | null;
  orderIndex: number;
};

export type Lesson = {
  id: number;
  moduleId: number;
  title: string;
  description: string | null;
  orderIndex: number;
  lessonType: "live" | "recorded";
  scheduledAt: string;
  liveCallLink: string | null;
  liveRecordingFileId: string | null;
  recordedVideoFileId: string | null;
  isPublished: string | null;
};

export type Homework = {
  id: number;
  lessonId: number;
  instructions: string | null;
  deadlineAt: string;
};

export type ExpiringAccess = {
  id: number;
  courseId: number;
  studentId: number;
  expiresAt: string | null;
  status: "expiring_soon" | "expired";
};
