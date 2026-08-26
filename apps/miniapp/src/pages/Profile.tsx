import { useQuery } from "@tanstack/react-query";
import { Moon, Smartphone, Sun } from "lucide-react";
import { apiFetch } from "../lib/api";
import type { Profile } from "../lib/types";
import { accessStatusLabel } from "../lib/statusLabels";
import { useTheme, type ThemeMode } from "../lib/theme";
import { useI18n, type Language } from "../lib/i18n";

// "Как в Telegram" first: it is the default, and the one most people want —
// the Mini App matching the client they opened it from.
const THEME_OPTIONS: { value: ThemeMode; labelKey: "themeSystem" | "themeLight" | "themeDark"; icon: typeof Sun }[] = [
  { value: "system", labelKey: "themeSystem", icon: Smartphone },
  { value: "light", labelKey: "themeLight", icon: Sun },
  { value: "dark", labelKey: "themeDark", icon: Moon },
];

const LANGUAGES: { value: Language; label: string }[] = [
  { value: "ru", label: "Русский" },
  { value: "uz", label: "O'zbekcha" },
];

export function ProfilePage() {
  const profile = useQuery({ queryKey: ["profile"], queryFn: () => apiFetch<Profile>("/app/profile") });
  const { mode, setMode } = useTheme();
  const { t, lang, setLang } = useI18n();

  return (
    <div className="px-5 pt-6">
      <h1 className="mb-5 text-xl font-bold text-ink">{t("profile")}</h1>

      <div className="border border-line mb-5 flex items-center gap-3 rounded-card bg-card p-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand text-base font-semibold text-on-brand">
          {profile.data?.first_name?.[0]?.toUpperCase() ?? "?"}
        </div>
        <div>
          <p className="text-sm font-semibold text-ink">{profile.data?.first_name}</p>
          {profile.data?.telegram_username && (
            <p className="text-xs text-muted">@{profile.data.telegram_username}</p>
          )}
        </div>
      </div>

      <p className="mb-2.5 text-sm font-semibold text-ink">{t("appearance")}</p>
      <div className="mb-5 flex gap-1.5 rounded-card border border-line bg-card p-1.5">
        {THEME_OPTIONS.map(({ value, labelKey, icon: Icon }) => (
          <button
            key={value}
            type="button"
            onClick={() => setMode(value)}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2.5 text-[13px] font-semibold transition-colors ${
              mode === value ? "bg-brand text-on-brand" : "text-muted"
            }`}
          >
            <Icon size={15} />
            {t(labelKey)}
          </button>
        ))}
      </div>

      <p className="mb-2.5 text-sm font-semibold text-ink">{t("language")}</p>
      <div className="mb-1.5 flex gap-1.5 rounded-card border border-line bg-card p-1.5">
        {LANGUAGES.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            onClick={() => setLang(value)}
            className={`flex-1 rounded-xl py-2.5 text-[13px] font-semibold transition-colors ${
              lang === value ? "bg-brand text-on-brand" : "text-muted"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="mb-5 text-xs text-muted">{t("languageHint")}</p>

      <p className="mb-3 text-sm font-semibold text-ink">{t("myCourses")}</p>
      <div className="flex flex-col gap-2">
        {profile.data?.courses.length === 0 && (
          <p className="text-sm text-muted">{t("noCoursesYet")}</p>
        )}
        {profile.data?.courses.map((c) => {
          const label = accessStatusLabel[c.access_status];
          return (
            <div key={c.course_id} className="border border-line rounded-card bg-card p-4">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="min-w-0 truncate text-sm font-medium text-ink">{c.title}</p>
                <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${label.className}`}>
                  {t(label.key)}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs text-muted">
                <span>{t("penaltyPoints", { count: c.penalty_points })}</span>
                {c.is_blacklisted && <span className="font-medium text-neg">{t("blacklisted")}</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
