import type { ReactNode } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { Layout } from "./components/Layout";
import { HomePage } from "./pages/Home";
import { CoursesPage } from "./pages/Courses";
import { ModulesPage } from "./pages/Modules";
import { LessonsPage } from "./pages/Lessons";
import { LessonDetailPage } from "./pages/LessonDetail";
import { HomeworkListPage } from "./pages/HomeworkList";
import { HomeworkDetailPage } from "./pages/HomeworkDetail";
import { ProfilePage } from "./pages/Profile";
import { useAuth } from "./lib/auth";
import { useI18n, type StringKey } from "./lib/i18n";

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

export default function App() {
  return (
    <Gate>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/courses" element={<CoursesPage />} />
          <Route path="/courses/:courseId" element={<ModulesPage />} />
          <Route path="/courses/:courseId/modules/:moduleId" element={<LessonsPage />} />
          <Route path="/lessons/:id" element={<LessonDetailPage />} />
          <Route path="/homework" element={<HomeworkListPage />} />
          <Route path="/homework/:id" element={<HomeworkDetailPage />} />
          <Route path="/profile" element={<ProfilePage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Gate>
  );
}
