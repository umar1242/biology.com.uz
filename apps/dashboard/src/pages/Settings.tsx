import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, Languages, Link2, Monitor, Moon, Palette, Sun, Users } from "lucide-react";
import { TopBar } from "../components/TopBar";
import { apiFetch, ApiError } from "../lib/api";
import { useTheme, type ThemeMode } from "../lib/theme";
import { claimDeepLinkTab } from "../lib/telegramLink";
import { DeepLinkNotice } from "../components/DeepLinkNotice";
import { useI18n } from "../lib/i18n";
import { useAuth } from "../lib/auth";

type Settings = {
  penalty_point_threshold: number;
  notifications_linked: boolean;
  notification_group_linked: boolean;
  notification_group_title: string | null;
  notification_language: "ru" | "uz";
};

const THEME_OPTIONS: { value: ThemeMode; labelKey: "themeSystem" | "themeLight" | "themeDark"; icon: typeof Sun }[] = [
  { value: "system", labelKey: "themeSystem", icon: Monitor },
  { value: "light", labelKey: "themeLight", icon: Sun },
  { value: "dark", labelKey: "themeDark", icon: Moon },
];

const LANGUAGES = [
  { value: "ru" as const, label: "Русский" },
  { value: "uz" as const, label: "O'zbekcha" },
];

export function SettingsPage() {
  const queryClient = useQueryClient();
  const { mode, setMode } = useTheme();
  const { t, lang, setLang } = useI18n();
  const { auth } = useAuth();
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => apiFetch<Settings>("/settings") });

  const [threshold, setThreshold] = useState<number | "">("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [deepLink, setDeepLink] = useState<string | null>(null);
  const [groupDeepLink, setGroupDeepLink] = useState<string | null>(null);

  useEffect(() => {
    if (settings.data) setThreshold(settings.data.penalty_point_threshold);
  }, [settings.data]);

  const save = useMutation({
    mutationFn: () =>
      apiFetch<{ penalty_point_threshold: number }>("/settings", {
        method: "PATCH",
        body: JSON.stringify({ penalty_point_threshold: threshold }),
      }),
    onSuccess: () => {
      setSaved(true);
      queryClient.invalidateQueries({ queryKey: ["settings"] });
      setTimeout(() => setSaved(false), 2000);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : t("saveFailed")),
  });

  const linkNotifications = useMutation({
    mutationFn: () => apiFetch<{ deep_link: string }>("/settings/notifications/link-start", { method: "POST" }),
    onError: (err) => setError(err instanceof ApiError ? err.message : t("linkStartFailed")),
  });

  const linkGroup = useMutation({
    mutationFn: () =>
      apiFetch<{ deep_link: string }>("/settings/notifications/group-link-start", { method: "POST" }),
    onError: (err) => setError(err instanceof ApiError ? err.message : t("linkStartFailed")),
  });

  const setNotificationLanguage = useMutation({
    mutationFn: (value: "ru" | "uz") =>
      apiFetch<{ notification_language: "ru" | "uz" }>("/settings", {
        method: "PATCH",
        body: JSON.stringify({ notification_language: value }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["settings"] }),
    onError: (err) => setError(err instanceof ApiError ? err.message : t("saveFailed")),
  });

  const unlinkGroup = useMutation({
    mutationFn: () => apiFetch<{ ok: true }>("/settings/notifications/group", { method: "DELETE" }),
    onSuccess: () => {
      setGroupDeepLink(null);
      queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : t("saveFailed")),
  });

  function startGroupLink() {
    setError(null);
    const tab = claimDeepLinkTab();
    linkGroup.mutate(undefined, {
      onSuccess: (res) => {
        setGroupDeepLink(res.deep_link);
        tab.navigate(res.deep_link);
      },
      onError: () => tab.cancel(),
    });
  }

  // The tab is claimed before the request so the browser still counts it as
  // opened by this click; the URL only exists once the server answers.
  function startNotificationLink() {
    setError(null);
    const tab = claimDeepLinkTab();
    linkNotifications.mutate(undefined, {
      onSuccess: (res) => {
        setDeepLink(res.deep_link);
        tab.navigate(res.deep_link);
      },
      onError: () => tab.cancel(),
    });
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!threshold || threshold < 1) return;
    save.mutate();
  }

  return (
    <>
      <TopBar title={t("settings")} />
      <main className="flex max-w-md flex-col gap-6 px-4 pb-10 sm:px-8">
        {error && <div className="rounded-xl bg-neg-soft px-4 py-2.5 text-sm text-neg">{error}</div>}

        <div className="rounded-2xl border border-line bg-card p-6">
          <div className="mb-3 flex items-center gap-2">
            <Palette size={16} className="text-muted" />
            <h3 className="text-base font-semibold text-ink">{t("appearance")}</h3>
          </div>
          <p className="mb-4 text-sm text-muted">
            {t("appearanceHint")}
          </p>
          <div className="flex gap-1.5 rounded-xl bg-inset p-1.5">
            {THEME_OPTIONS.map(({ value, labelKey, icon: Icon }) => (
              <button
                key={value}
                type="button"
                onClick={() => setMode(value)}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2.5 text-[13px] font-semibold transition-colors ${
                  mode === value ? "bg-brand text-on-brand" : "text-muted"
                }`}
              >
                <Icon size={15} />
                {t(labelKey)}
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-line bg-card p-6">
          <div className="mb-3 flex items-center gap-2">
            <Languages size={16} className="text-muted" />
            <h3 className="text-base font-semibold text-ink">{t("language")}</h3>
          </div>
          <p className="mb-4 text-sm text-muted">{t("languageHint")}</p>
          <div className="flex gap-1.5 rounded-xl bg-inset p-1.5">
            {LANGUAGES.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                onClick={() => setLang(value)}
                className={`flex-1 rounded-lg py-2.5 text-[13px] font-semibold transition-colors ${
                  lang === value ? "bg-brand text-on-brand" : "text-muted"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="border border-line rounded-2xl bg-card p-6">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Users size={16} className="text-muted" />
              <h3 className="text-base font-semibold text-ink">{t("notificationGroup")}</h3>
            </div>
            {settings.data?.notification_group_linked ? (
              <span className="rounded-full bg-pos-soft px-2.5 py-1 text-xs font-medium text-pos">
                {t("connected")}
              </span>
            ) : (
              <span className="rounded-full bg-inset px-2.5 py-1 text-xs font-medium text-muted">
                {t("notConnected")}
              </span>
            )}
          </div>
          <p className="mb-4 text-sm text-muted">{t("notificationGroupDescription")}</p>

          {settings.data?.notification_group_linked ? (
            <div className="flex items-center justify-between gap-3">
              <span className="truncate text-sm font-medium text-ink">
                {settings.data.notification_group_title ?? "—"}
              </span>
              <button
                type="button"
                onClick={() => unlinkGroup.mutate()}
                disabled={unlinkGroup.isPending || auth?.role !== "teacher"}
                className="shrink-0 rounded-xl border border-line px-4 py-2.5 text-sm font-semibold text-muted hover:text-ink disabled:opacity-50"
              >
                {t("disconnect")}
              </button>
            </div>
          ) : auth?.role === "teacher" ? (
            <button
              type="button"
              onClick={startGroupLink}
              disabled={linkGroup.isPending}
              className="flex items-center gap-1.5 rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-on-brand hover:opacity-90 disabled:opacity-50"
            >
              <Link2 size={15} /> {t("connect")}
            </button>
          ) : (
            <p className="text-sm text-muted">{t("notificationGroupTeacherOnly")}</p>
          )}

          {groupDeepLink && <DeepLinkNotice url={groupDeepLink} hint={t("notificationGroupHint")} />}
          <p className="mt-4 text-xs text-muted">{t("notificationGroupTags")}</p>

          <div className="mt-5 border-t border-line pt-5">
            <h4 className="mb-1 text-sm font-semibold text-ink">{t("notificationLanguage")}</h4>
            <p className="mb-3 text-sm text-muted">{t("notificationLanguageHint")}</p>
            {auth?.role === "teacher" ? (
              <div className="flex gap-1.5 rounded-xl bg-inset p-1.5">
                {LANGUAGES.map(({ value, label }) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setNotificationLanguage.mutate(value)}
                    disabled={setNotificationLanguage.isPending}
                    className={`flex-1 rounded-lg py-2.5 text-[13px] font-semibold transition-colors disabled:opacity-50 ${
                      settings.data?.notification_language === value ? "bg-brand text-on-brand" : "text-muted"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted">{t("notificationLanguageTeacherOnly")}</p>
            )}
          </div>
        </div>

        <div className="border border-line rounded-2xl bg-card p-6">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Bell size={16} className="text-muted" />
              <h3 className="text-base font-semibold text-ink">{t("telegramNotifications")}</h3>
            </div>
            {settings.data?.notifications_linked ? (
              <span className="rounded-full bg-pos-soft px-2.5 py-1 text-xs font-medium text-pos">
                {t("connected")}
              </span>
            ) : (
              <span className="rounded-full bg-inset px-2.5 py-1 text-xs font-medium text-muted">
                {t("notConnected")}
              </span>
            )}
          </div>
          <p className="mb-4 text-sm text-muted">
            {t("notificationsDescription")}
          </p>
          {!settings.data?.notifications_linked && (
            <button
              type="button"
              onClick={startNotificationLink}
              disabled={linkNotifications.isPending}
              className="flex items-center gap-1.5 rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-on-brand hover:opacity-90 disabled:opacity-50"
            >
              <Link2 size={15} /> {t("connect")}
            </button>
          )}
          {deepLink && (
            <DeepLinkNotice
              url={deepLink}
              hint={t("notificationsLinkHint")}
            />
          )}
        </div>

        <form onSubmit={handleSubmit} className="border border-line rounded-2xl bg-card p-6">
          <h3 className="mb-1 text-base font-semibold text-ink">{t("penaltyPoints")}</h3>
          <p className="mb-5 text-sm text-muted">
            {t("penaltyDescription")}
          </p>

          {saved && (
            <div className="mb-4 rounded-xl bg-pos-soft px-4 py-2.5 text-sm text-pos">
              {t("savedOk")}
            </div>
          )}

          <label className="mb-5 block text-sm">
            <span className="mb-1.5 block font-medium text-ink">{t("penaltyThreshold")}</span>
            <input
              type="number"
              min={1}
              value={threshold}
              onChange={(e) => setThreshold(e.target.value ? Number(e.target.value) : "")}
              className="w-32 rounded-xl border border-line px-4 py-2.5 text-sm outline-none focus:border-ink"
            />
          </label>

          <button
            type="submit"
            disabled={save.isPending}
            className="rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-on-brand hover:opacity-90 disabled:opacity-50"
          >
            {t("save")}
          </button>
        </form>
      </main>
    </>
  );
}
