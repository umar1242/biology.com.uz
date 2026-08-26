/**
 * Every "…-start" endpoint mints its deep link on the server, so the URL only
 * exists after a round trip — by which time a plain `window.open` is no longer
 * attached to the click that caused it and browsers block it as a popup.
 *
 * The fix is to claim the tab synchronously inside the click handler, while the
 * user gesture is still live, and point it at the URL once the response lands.
 * Call this FIRST in the handler, then fire the request.
 */
export function claimDeepLinkTab(): {
  blocked: boolean;
  navigate: (url: string) => void;
  cancel: () => void;
} {
  const win = window.open("about:blank", "_blank");
  return {
    // Popup blockers hand back null; the caller then shows the link instead of
    // silently doing nothing.
    blocked: !win,
    navigate(url: string) {
      if (!win) return;
      // The blank tab shares an opener with us until we drop it — don't hand
      // that reference to whatever t.me redirects into.
      win.opener = null;
      win.location.replace(url);
    },
    cancel() {
      win?.close();
    },
  };
}
