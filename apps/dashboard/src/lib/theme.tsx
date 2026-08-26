import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

export type ThemeMode = "system" | "light" | "dark";
type Resolved = "light" | "dark";

const STORAGE_KEY = "theme_mode";

function readStoredMode(): ThemeMode {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === "light" || raw === "dark" || raw === "system") return raw;
  } catch {
    // Storage blocked — "system" is a fine answer.
  }
  return "system";
}

function systemTheme(): Resolved {
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
  const [system, setSystem] = useState<Resolved>(systemTheme);

  // Follow the OS while on "system" — someone with macOS/Windows auto-switching
  // at sunset should see the panel follow without a reload.
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!mq) return;
    const update = () => setSystem(systemTheme());
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  const resolved: Resolved = mode === "system" ? system : mode;

  useEffect(() => {
    document.documentElement.dataset.theme = resolved;
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
