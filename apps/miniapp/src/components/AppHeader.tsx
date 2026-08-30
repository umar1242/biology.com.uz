import { Bell, Search } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { CourseSwitcher } from "./CourseSwitcher";
import { useI18n } from "../lib/i18n";

/**
 * The reference's top strip: identity on the left, quiet icon actions on the
 * right. Sits directly on the page ground (no card) so it reads as chrome
 * rather than content.
 *
 * The avatar carries the name alone — the greeting card right below already
 * says it, and the same word twice within 60px reads as a rendering bug.
 * Between avatar and icons sits the course switcher: context belongs with
 * identity, not in a card of its own.
 */
export function AppHeader({ name }: { name?: string }) {
  const navigate = useNavigate();
  const { t } = useI18n();
  const initial = name?.[0]?.toUpperCase() ?? "?";

  return (
    <header className="relative z-30 mb-5 flex items-center gap-3">
      <button
        type="button"
        onClick={() => navigate("/profile")}
        aria-label={t("tabProfile")}
        className="shrink-0 text-left"
      >
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand text-xs font-bold text-on-brand ring-2 ring-neg/70">
          {initial}
        </span>
      </button>

      <CourseSwitcher />

      <div className="flex shrink-0 items-center gap-4 text-ink">
        <button type="button" aria-label={t("search")}>
          <Search size={20} strokeWidth={1.9} />
        </button>
        <button type="button" aria-label={t("notifications")}>
          <Bell size={20} strokeWidth={1.9} />
        </button>
      </div>
    </header>
  );
}
