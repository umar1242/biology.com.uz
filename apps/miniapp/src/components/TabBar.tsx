import { NavLink } from "react-router-dom";
import { Home, LibraryBig, ClipboardList, GraduationCap, User } from "lucide-react";
import { useI18n, type StringKey } from "../lib/i18n";

const tabs: { to: string; icon: typeof Home; labelKey: StringKey; end: boolean }[] = [
  { to: "/", icon: Home, labelKey: "tabHome", end: true },
  { to: "/courses", icon: LibraryBig, labelKey: "lessons", end: false },
  { to: "/homework", icon: ClipboardList, labelKey: "tabHomework", end: false },
  { to: "/cert", icon: GraduationCap, labelKey: "tabCert", end: false },
  { to: "/profile", icon: User, labelKey: "tabProfile", end: false },
];

/**
 * Full-width bar rather than a floating pill: labels make the destinations
 * readable at a glance, and anchoring to the edge leaves the safe-area inset
 * to the bar itself instead of a gap the page shows through.
 */
export function TabBar() {
  const { t } = useI18n();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-card">
      <div className="mx-auto flex max-w-md items-stretch pt-2 pb-[calc(env(safe-area-inset-bottom)+10px)]">
        {tabs.map(({ to, icon: Icon, labelKey, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              `flex flex-1 flex-col items-center gap-1 py-1 text-[11px] font-medium transition-colors ${
                isActive ? "text-ink" : "text-muted"
              }`
            }
          >
            {({ isActive }) => (
              <>
                <Icon size={21} strokeWidth={isActive ? 2.4 : 1.9} />
                {t(labelKey)}
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
