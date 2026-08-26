type TelegramWebApp = {
  initData: string;
  ready: () => void;
  expand: () => void;
  colorScheme: "light" | "dark";
  openTelegramLink: (url: string) => void;
  onEvent?: (event: string, handler: () => void) => void;
  offEvent?: (event: string, handler: () => void) => void;
  setHeaderColor?: (color: string) => void;
  setBackgroundColor?: (color: string) => void;
  HapticFeedback?: { impactOccurred: (style: string) => void };
};

declare global {
  interface Window {
    Telegram?: { WebApp: TelegramWebApp };
  }
}

export function getInitData(): string {
  const real = window.Telegram?.WebApp?.initData;
  if (real) return real;
  // Fallback so the app can be iterated on in a normal browser tab without the
  // Telegram WebView wrapper. Gated on import.meta.env.DEV, which Vite compiles
  // to a literal `false` in a production build so the branch — and the baked
  // initData string with it — is dropped entirely.
  //
  // This guard is load-bearing, not belt-and-braces: a stray .env.local in the
  // build context previously shipped a signed initData to production, which
  // logged anyone opening the public URL in a browser straight in as that test
  // student, no Telegram required. .dockerignore now keeps env files out of the
  // image too; either alone would have prevented it.
  if (import.meta.env.DEV) return import.meta.env.VITE_DEV_INIT_DATA ?? "";
  return "";
}

export function initTelegram() {
  const webApp = window.Telegram?.WebApp;
  if (webApp) {
    webApp.ready();
    webApp.expand();
  }
}

/** Null outside Telegram, so the caller can fall back to prefers-color-scheme. */
export function getTelegramColorScheme(): "light" | "dark" | null {
  return window.Telegram?.WebApp?.colorScheme ?? null;
}

/** Subscribes to the client's own theme switch; returns an unsubscribe. */
export function onTelegramThemeChanged(handler: () => void): () => void {
  const webApp = window.Telegram?.WebApp;
  if (!webApp?.onEvent) return () => {};
  webApp.onEvent("themeChanged", handler);
  return () => webApp.offEvent?.("themeChanged", handler);
}

const CHROME_COLORS = {
  light: { header: "#f2f0f0", background: "#f2f0f0" },
  dark: { header: "#000000", background: "#000000" },
} as const;

/**
 * Paints the native strip above the WebView to match the app. Without this the
 * Telegram header keeps its old colour and there is a visible seam between the
 * client chrome and the page.
 */
export function syncTelegramChrome(theme: "light" | "dark") {
  const webApp = window.Telegram?.WebApp;
  if (!webApp) return;
  const colors = CHROME_COLORS[theme];
  webApp.setHeaderColor?.(colors.header);
  webApp.setBackgroundColor?.(colors.background);
}

/** Opens a bot deep link (e.g. from submit-start/attach-video-start) inside Telegram. */
export function openBotChat(deepLink: string) {
  const webApp = window.Telegram?.WebApp;
  if (webApp) {
    webApp.openTelegramLink(deepLink);
  } else {
    window.open(deepLink, "_blank");
  }
}
