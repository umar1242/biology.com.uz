import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { getTelegramColorScheme, onTelegramThemeChanged, syncTelegramChrome } from "./telegram";

export type ThemeMode = "system" | "light" | "dark";
type Resolved = "light" | "dark";

const STORAGE_KEY = "theme_mode";

function readStoredMode(): ThemeMode {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === "light" || raw === "dark" || raw === "system") return raw;
  } catch {
    // Private mode / storage disabled — "system" is a fine answer.
  }
  return "system";
}

/**
 * "system" means whatever the host says: inside Telegram that is the client's
 * own light/dark setting, in a plain browser it is prefers-color-scheme. A
 * Mini App that ignored this would flash white inside a dark Telegram.
 */
function resolveSystem(): Resolved {
  const fromTelegram = getTelegramColorScheme();
  if (fromTelegram) return fromTelegram;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

type ThemeContextValue = { mode: ThemeMode; resolved: Resolved; setMode: (m: ThemeMode) => void };

const ThemeContext = createContext<ThemeContextValue>({
  mode: "system",
  resolved: "light",
  setMode: () => {},
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(readStoredMode);
  const [systemTheme, setSystemTheme] = useState<Resolved>(resolveSystem);

  // Follow the host while on "system" — Telegram fires themeChanged when the
  // user flips their client theme with the Mini App already open.
  useEffect(() => {
    const update = () => setSystemTheme(resolveSystem());
    const offTelegram = onTelegramThemeChanged(update);
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    mq?.addEventListener("change", update);
    return () => {
      offTelegram();
      mq?.removeEventListener("change", update);
    };
  }, []);

  const resolved: Resolved = mode === "system" ? systemTheme : mode;

  useEffect(() => {
    document.documentElement.dataset.theme = resolved;
    // Keep Telegram's own header/background in step, otherwise the native
    // chrome above the WebView stays the old colour and the seam is obvious.
    syncTelegramChrome(resolved);
  }, [resolved]);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Not persisting is survivable; the session still switches.
    }
  }, []);

  return <ThemeContext.Provider value={{ mode, resolved, setMode }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
