import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { apiFetch, ApiError } from "./api";
import { getInitData, initTelegram } from "./telegram";
import { setToken } from "./tokenStore";

type AuthContextValue = {
  studentId: number | null;
  loading: boolean;
  error: string | null;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [studentId, setStudentId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    initTelegram();
    const initData = getInitData();
    if (!initData) {
      setError("openFromBot");
      setLoading(false);
      return;
    }

    apiFetch<{ access_token: string; student_id: number }>("/app/auth/telegram", {
      method: "POST",
      body: JSON.stringify({ init_data: initData }),
      skipAuth: true,
    })
      .then((res) => {
        setToken(res.access_token);
        setStudentId(res.student_id);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "loginFailed"))
      .finally(() => setLoading(false));
  }, []);

  return <AuthContext.Provider value={{ studentId, loading, error }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
