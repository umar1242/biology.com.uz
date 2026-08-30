import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { ApiError } from "../lib/api";
import { useI18n } from "../lib/i18n";

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const { t } = useI18n();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(username, password);
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("loginFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="bg-dots flex min-h-screen items-center justify-center bg-app px-4">
      <form onSubmit={handleSubmit} className="border border-line w-full max-w-sm rounded-3xl bg-card p-8">
        <div className="mb-6 flex h-10 w-10 items-center justify-center rounded-xl bg-brand text-sm font-extrabold text-on-brand">
          К
        </div>
        <h1 className="mb-1 text-xl font-bold text-ink">{t("loginTitle")}</h1>
        <p className="mb-6 text-sm text-muted">{t("loginSubtitle")}</p>

        {error && (
          <div className="mb-4 rounded-xl bg-neg-soft px-4 py-2.5 text-sm text-neg">{error}</div>
        )}

        <label className="mb-3 block text-sm">
          <span className="mb-1.5 block font-medium text-ink">{t("username")}</span>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="w-full rounded-xl border border-line px-4 py-2.5 text-sm outline-none focus:border-ink"
            autoComplete="username"
            required
          />
        </label>
        <label className="mb-6 block text-sm">
          <span className="mb-1.5 block font-medium text-ink">{t("password")}</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-xl border border-line px-4 py-2.5 text-sm outline-none focus:border-ink"
            autoComplete="current-password"
            required
          />
        </label>

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-xl bg-brand py-2.5 text-sm font-semibold text-on-brand transition hover:opacity-90 disabled:opacity-50"
        >
          {submitting ? t("signingIn") : t("signIn")}
        </button>
      </form>
    </div>
  );
}
