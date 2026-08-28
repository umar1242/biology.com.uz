import type { ReactNode } from "react";
import { Routes, Route, Navigate, useLocation, useNavigate } from "react-router-dom";
import { Layout } from "./components/Layout";
import { HomePage } from "./pages/Home";
import { ModulesPage } from "./pages/Modules";
import { ApplyPage } from "./pages/Apply";
import { LessonsPage } from "./pages/Lessons";
import { LessonDetailPage } from "./pages/LessonDetail";
import { HomeworkListPage } from "./pages/HomeworkList";
import { HomeworkDetailPage } from "./pages/HomeworkDetail";
import { ProfilePage } from "./pages/Profile";
import { CertListPage } from "./pages/CertList";
import { CertExamPage } from "./pages/CertExam";
import { useAuth } from "./lib/auth";
import { SelectedCourseProvider } from "./lib/selectedCourse";
import { useI18n, type StringKey } from "./lib/i18n";
import { ClipboardList } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "./lib/api";

function Gate({ children }: { children: ReactNode }) {
  const { loading, error, studentId } = useAuth();
  const { t } = useI18n();

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center text-sm text-muted">{t("loading")}</div>
    );
  }
  if (error || !studentId) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-2 px-8 text-center">
        <p className="text-sm font-medium text-ink">{t("loginFailed")}</p>
        {/* auth.tsx reports its own failures as string keys; anything else is
            a server message that is already human-readable. */}
        <p className="text-sm text-muted">
          {error === "openFromBot" || error === "loginFailed" ? t(error as StringKey) : error}
        </p>
      </div>
    );
  }
  return <>{children}</>;
}

/**
 * Closes the app to anyone who has not filled the enrolment questionnaire.
 * The form itself lives at /apply/:courseId and must stay reachable, since
 * that is exactly where an un-onboarded student is supposed to go — the API
 * whitelists the same two routes (plugins/studentAuth.ts).
 */
function OnboardingGate({ children }: { children: ReactNode }) {
  const { onboarded } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();
  const onApplyRoute = location.pathname.startsWith("/apply/");

  // Which course to send them to. Only asked for when the gate is actually
  // showing — an onboarded student never needs it.
  const target = useQuery({
    queryKey: ["application-target"],
    queryFn: () =>
      apiFetch<{ target: { course_id: number; title: string } | null }>("/app/application-target"),
    enabled: !onboarded && !onApplyRoute,
  });

  if (onboarded || onApplyRoute) return <>{children}</>;

  const course = target.data?.target ?? null;

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-3 px-8 text-center">
      <ClipboardList size={40} className="text-muted" />
      <p className="text-[15px] font-semibold text-ink">{t("gateTitle")}</p>
      <p className="text-sm text-muted">{t("gateText")}</p>

      {target.isLoading && <p className="text-sm text-muted">{t("loading")}</p>}

      {!target.isLoading &&
        (course ? (
          <>
            <p className="text-sm font-medium text-ink">{course.title}</p>
            <button
              type="button"
              onClick={() => navigate(`/apply/${course.course_id}`)}
              className="mt-1 w-full rounded-xl bg-brand py-3 text-[14px] font-semibold text-on-brand"
            >
              {t("gateFillButton")}
            </button>
          </>
        ) : (
          <p className="text-sm text-muted">{t("gateNoCourse")}</p>
        ))}
    </div>
  );
}

export default function App() {
  return (
    <Gate>
      <OnboardingGate>
        <SelectedCourseProvider>
          <Routes>
            {/* Outside Layout: the enrolment form is for someone who is not a
                member of any course yet, so the tab bar would lead nowhere. */}
            <Route path="/apply/:courseId" element={<ApplyPage />} />
            <Route element={<Layout />}>
              <Route path="/" element={<HomePage />} />
              <Route path="/courses" element={<ModulesPage />} />
              <Route path="/courses/:courseId/modules/:moduleId" element={<LessonsPage />} />
              <Route path="/lessons/:id" element={<LessonDetailPage />} />
              <Route path="/homework" element={<HomeworkListPage />} />
              <Route path="/homework/:id" element={<HomeworkDetailPage />} />
              <Route path="/cert" element={<CertListPage />} />
              <Route path="/cert/:id" element={<CertExamPage />} />
              <Route path="/profile" element={<ProfilePage />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </SelectedCourseProvider>
      </OnboardingGate>
    </Gate>
  );
}
