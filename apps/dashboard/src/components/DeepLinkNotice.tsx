import { useState } from "react";
import { Check, Copy, ExternalLink } from "lucide-react";
import { useI18n } from "../lib/i18n";

/**
 * Shown after a bot deep link is minted. The link used to be printed as bare
 * text, so clicking it did nothing and the teacher had to select and copy the
 * URL by hand. Real anchor + copy button, and the raw URL still visible for
 * the case where Telegram has to be opened on another device.
 */
export function DeepLinkNotice({ url, hint }: { url: string; hint: string }) {
  const [copied, setCopied] = useState(false);
  const { t } = useI18n();

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard denied — the URL is printed below either way.
    }
  }

  return (
    <div className="mt-3 rounded-xl border border-line bg-inset p-3">
      <p className="text-xs text-muted">{hint}</p>
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1.5 rounded-lg bg-brand px-3 py-2 text-xs font-semibold text-on-brand hover:opacity-90"
        >
          <ExternalLink size={13} /> {t("openInTelegram")}
        </a>
        <button
          type="button"
          onClick={copy}
          className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-xs font-semibold text-ink hover:bg-card"
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
          {copied ? t("copied") : t("copy")}
        </button>
      </div>
      <p className="mt-2 text-[11px] break-all text-muted">{url}</p>
    </div>
  );
}
