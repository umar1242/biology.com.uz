export type Course = {
  id: number;
  title: string;
  description: string | null;
  subject: "biology" | "chemistry";
  isArchived: boolean;
};

export type Module = {
  id: number;
  courseId: number;
  title: string;
  description: string | null;
  orderIndex: number;
};

export type LessonListItem = {
  id: number;
  moduleId: number;
  title: string;
  description: string | null;
  orderIndex: number;
  lessonType: "live" | "recorded";
  scheduledAt: string;
  isPublished: string | null;
};

export type LessonDetail = {
  id: number;
  title: string;
  description: string | null;
  lesson_type: "live" | "recorded";
  scheduled_at: string;
  live_call_link?: string;
  has_recording: boolean;
  materials: { index: number; material_type: string; text_content?: string; file_name?: string; caption?: string }[];
};

export type HomeworkStatus = "not_submitted" | "pending" | "passed" | "needs_resubmission";

export type HomeworkListItem = {
  id: number;
  course_id: number;
  course_title: string;
  lesson_title: string;
  deadline_at: string;
  status: HomeworkStatus;
  is_late: boolean;
  submitted_at: string | null;
};

export type HomeworkDetail = {
  id: number;
  course_id: number;
  course_title: string;
  lesson_title: string;
  instructions: string | null;
  deadline_at: string;
};

export type Submission = {
  id: number;
  attemptNumber: number;
  photoFileIds: string[];
  submittedAt: string;
  isLate: boolean;
  status: "pending" | "passed" | "needs_resubmission";
  reviewCommentText: string | null;
  reviewCommentVoiceFileId: string | null;
};

export type Profile = {
  telegram_username: string | null;
  first_name: string;
  courses: {
    course_id: number;
    title: string;
    access_status: "pending" | "active" | "expired_pending" | "revoked";
    penalty_points: number;
    is_blacklisted: boolean;
  }[];
};
