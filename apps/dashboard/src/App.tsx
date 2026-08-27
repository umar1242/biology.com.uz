import { Routes, Route, Navigate } from "react-router-dom";
import { LoginPage } from "./pages/Login";
import { DashboardPage } from "./pages/Dashboard";
import { CoursesPage } from "./pages/Courses";
import { CourseDetailPage } from "./pages/CourseDetail";
import { ModuleDetailPage } from "./pages/ModuleDetail";
import { LessonDetailPage } from "./pages/LessonDetail";
import { ReviewPage } from "./pages/Review";
import { CertExamsPage } from "./pages/CertExams";
import { CertExamAttemptsPage } from "./pages/CertExamAttempts";
import { CertAttemptPage } from "./pages/CertAttempt";
import { StudentsPage } from "./pages/Students";
import { AssistantsPage } from "./pages/Assistants";
import { SettingsPage } from "./pages/Settings";
import { Layout } from "./components/Layout";
import { ProtectedRoute } from "./components/ProtectedRoute";

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<Layout />}>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/courses" element={<CoursesPage />} />
          <Route path="/courses/:id" element={<CourseDetailPage />} />
          <Route path="/courses/:courseId/modules/:moduleId" element={<ModuleDetailPage />} />
          <Route path="/lessons/:id" element={<LessonDetailPage />} />
          <Route path="/review" element={<ReviewPage />} />
          <Route path="/cert" element={<CertExamsPage />} />
          <Route path="/cert/:id" element={<CertExamAttemptsPage />} />
          <Route path="/cert/attempts/:id" element={<CertAttemptPage />} />
          <Route path="/students" element={<StudentsPage />} />
          <Route path="/assistants" element={<AssistantsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
