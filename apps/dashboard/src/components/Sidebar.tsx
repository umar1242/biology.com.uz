import { NavLink } from "react-router-dom";
import {
  LayoutDashboard,
  BookOpen,
  ClipboardCheck,
  GraduationCap,
  Library,
  Ruler,
  Users,
  UserMinus,
  UserCog,
  Settings,
  HelpCircle,
  LogOut,
  X,
} from "lucide-react";
import { useAuth } from "../lib/auth";
import { useI18n, type StringKey } from "../lib/i18n";

const navItems: { to: string; labelKey: StringKey; icon: typeof BookOpen; end?: boolean }[] = [
  { to: "/", labelKey: "navDashboard", icon: LayoutDashboard, end: true },
  { to: "/courses", labelKey: "navCourses", icon: BookOpen },
  { to: "/review", labelKey: "navReview", icon: ClipboardCheck },
  { to: "/cert", labelKey: "navCert", icon: GraduationCap },
  { to: "/bank", labelKey: "navBank", icon: Library },
  { to: "/rasch", labelKey: "navRasch", icon: Ruler },
  { to: "/students", labelKey: "navStudents", icon: Users },
  { to: "/removal", labelKey: "navRemoval", icon: UserMinus },
  { to: "/assistants", labelKey: "navAssistants", icon: UserCog },
  { to: "/settings", labelKey: "navSettings", icon: Settings },
];

/**
 * Permanent column from `lg` up; below that a slide-in drawer, because a
 * fixed 240px rail eats two thirds of a phone screen. `open` only matters
 * on small screens — from `lg` the translate is overridden unconditionally.
 */
export function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const { logout } = useAuth();

  return (
    <>
      <div
        role="presentation"
        onClick={onClose}
        className={`fixed inset-0 z-40 bg-black/50 transition-opacity lg:hidden ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-60 shrink-0 flex-col justify-between bg-nav px-4 py-6 lg:border-r lg:border-nav-line transition-transform duration-200 lg:static lg:z-auto lg:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div>
          <div className="mb-8 flex items-center justify-between gap-2.5 px-2">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-nav-active text-sm font-extrabold text-on-nav-active">
                К
              </div>
              <span className="text-sm font-semibold text-nav-active">Course Platform</span>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label={t("closeMenu")}
              className="-mr-1 flex h-8 w-8 items-center justify-center rounded-lg text-nav-ink hover:bg-white/10 hover:text-nav-active lg:hidden"
            >
              <X size={18} />
            </button>
          </div>

          <nav className="flex flex-col gap-1">
            {navItems.map(({ to, labelKey, icon: Icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                    isActive
                      ? "bg-nav-sel text-on-nav-sel"
                      : "text-nav-ink hover:bg-white/10 hover:text-nav-active"
                  }`
                }
              >
                <Icon size={18} strokeWidth={2} />
                {t(labelKey)}
              </NavLink>
            ))}
          </nav>
        </div>

        <div className="flex flex-col gap-1">
          <button
            type="button"
            className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium text-nav-ink transition-colors hover:bg-white/10 hover:text-nav-active"
          >
            <HelpCircle size={18} strokeWidth={2} />
            {t("navSupport")}
          </button>
          <button
            type="button"
            onClick={logout}
            className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium text-nav-ink transition-colors hover:bg-white/10 hover:text-nav-active"
          >
            <LogOut size={18} strokeWidth={2} />
            {t("navLogout")}
          </button>
        </div>
      </aside>
    </>
  );
}
