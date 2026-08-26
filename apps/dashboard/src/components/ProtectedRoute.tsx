import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { useI18n } from "../lib/i18n";

export function ProtectedRoute() {
  const { auth, loading } = useAuth();
  const { t } = useI18n();

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-inset text-sm text-muted">
        {t("loading")}
      </div>
    );
  }
  if (!auth) return <Navigate to="/login" replace />;
  return <Outlet />;
}
