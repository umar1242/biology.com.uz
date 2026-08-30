import { useEffect, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { MobileNavContext } from "../lib/mobileNav";

export function Layout() {
  const [navOpen, setNavOpen] = useState(false);
  const location = useLocation();

  // Tapping a nav link should navigate AND dismiss the drawer — otherwise it
  // stays open on top of the page the user just asked for.
  useEffect(() => setNavOpen(false), [location.pathname]);

  useEffect(() => {
    if (!navOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setNavOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navOpen]);

  return (
    <MobileNavContext.Provider value={{ open: () => setNavOpen(true) }}>
      <div className="flex h-screen overflow-hidden bg-app">
        <Sidebar open={navOpen} onClose={() => setNavOpen(false)} />
        <div className="bg-dots min-w-0 flex-1 overflow-y-auto">
          <Outlet />
        </div>
      </div>
    </MobileNavContext.Provider>
  );
}
