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
import { BankItemsPage, ItemBankPage } from "./pages/ItemBank";
import { ItemCardPage } from "./pages/ItemCard";
import { RaschPage } from "./pages/Rasch";
import { StudentsPage } from "./pages/Students";
import { RemovalPage } from "./pages/Removal";
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
          <Route path="/bank" element={<ItemBankPage />} />
          <Route path="/bank/all" element={<BankItemsPage />} />
          <Route path="/bank/unused" element={<BankItemsPage />} />
          <Route path="/bank/variant/:examId" element={<BankItemsPage />} />
          <Route path="/bank/item/:id" element={<ItemCardPage />} />
          <Route path="/rasch" element={<RaschPage />} />
          <Route path="/students" element={<StudentsPage />} />
          <Route path="/removal" element={<RemovalPage />} />
          <Route path="/assistants" element={<AssistantsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
