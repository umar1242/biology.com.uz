import { ArrowLeft, Bell, Menu, Search } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { useMobileNav } from "../lib/mobileNav";
import { useI18n } from "../lib/i18n";

export function TopBar({ title, badge, backTo }: { title: string; badge?: number; backTo?: string }) {
  const { auth } = useAuth();
  const navigate = useNavigate();
  const mobileNav = useMobileNav();
  const { t } = useI18n();

  return (
    <header className="flex items-center justify-between gap-3 px-4 pt-5 pb-4 sm:px-8 sm:pt-8 sm:pb-6">
      <div className="flex min-w-0 items-center gap-2 sm:gap-3">
        {/* Below `lg` the sidebar is a drawer, so this is the only way to it. */}
        <button
          type="button"
          onClick={mobileNav.open}
          aria-label={t("openMenu")}
          className="border border-line flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-card text-ink lg:hidden"
        >
          <Menu size={18} />
        </button>
        {backTo && (
          <button
            type="button"
            onClick={() => navigate(backTo)}
            aria-label={t("back")}
            className="border border-line flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-card"
          >
            <ArrowLeft size={16} />
          </button>
        )}
        <h1 className="truncate text-lg font-bold text-ink sm:text-2xl">{title}</h1>
      </div>
      <div className="flex shrink-0 items-center gap-2 sm:gap-3">
        <div className="border border-line hidden items-center gap-2 rounded-full bg-card px-4 py-2.5 text-sm text-muted lg:flex">
          <Search size={16} />
          <span>{t("search")}</span>
        </div>
        <button
          type="button"
          aria-label={t("notifications")}
          className="border border-line relative flex h-9 w-9 items-center justify-center rounded-full bg-card text-muted sm:h-10 sm:w-10"
        >
          <Bell size={18} />
          {!!badge && badge > 0 && (
            <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-neg sm:top-2 sm:right-2" />
          )}
        </button>
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand text-sm font-semibold text-on-brand sm:h-10 sm:w-10">
          {auth?.display_name?.[0]?.toUpperCase() ?? "?"}
        </div>
      </div>
    </header>
  );
}
