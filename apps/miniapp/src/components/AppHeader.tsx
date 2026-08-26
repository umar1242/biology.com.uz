import { Bell, Search } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useI18n } from "../lib/i18n";

/**
 * The reference's top strip: identity on the left, quiet icon actions on the
 * right. Sits directly on the page ground (no card) so it reads as chrome
 * rather than content.
 */
export function AppHeader({ name }: { name?: string }) {
  const navigate = useNavigate();
  const { t } = useI18n();
  const initial = name?.[0]?.toUpperCase() ?? "?";

  return (
    <header className="mb-5 flex items-center justify-between">
      <button
        type="button"
        onClick={() => navigate("/profile")}
        className="flex items-center gap-2.5 text-left"
      >
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand text-xs font-bold text-on-brand ring-2 ring-neg/70">
          {initial}
        </span>
        <span className="text-[15px] font-semibold text-ink">{name ?? "…"}</span>
      </button>
      <div className="flex items-center gap-4 text-ink">
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
