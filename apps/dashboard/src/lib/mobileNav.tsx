import { createContext, useContext } from "react";

/**
 * Lets TopBar — rendered independently by each page — open the navigation
 * drawer that Layout owns, without threading a callback through every page.
 */
export const MobileNavContext = createContext<{ open: () => void }>({ open: () => {} });

export function useMobileNav() {
  return useContext(MobileNavContext);
}
