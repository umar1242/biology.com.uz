import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { apiFetch } from "./api";
import type { Me } from "./types";

type AuthContextValue = {
  auth: Me | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [auth, setAuth] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem("access_token");
    if (!token) {
      setLoading(false);
      return;
    }
    apiFetch<Me>("/auth/me")
      .then(setAuth)
      .catch(() => localStorage.removeItem("access_token"))
      .finally(() => setLoading(false));
  }, []);

  async function login(username: string, password: string) {
    const res = await apiFetch<{ access_token: string }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
    localStorage.setItem("access_token", res.access_token);
    setAuth(await apiFetch<Me>("/auth/me"));
  }

  function logout() {
    localStorage.removeItem("access_token");
    setAuth(null);
  }

  return <AuthContext.Provider value={{ auth, loading, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
