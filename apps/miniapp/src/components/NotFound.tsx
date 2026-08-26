import { ArrowLeft, SearchX } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useI18n } from "../lib/i18n";

/**
 * Detail screens used to `return null` when the query came back empty — a
 * deleted or inaccessible id rendered a blank page with no explanation and no
 * way back except the tab bar. Say what happened and offer the way out.
 */
export function NotFound({ title, hint }: { title: string; hint?: string }) {
  const navigate = useNavigate();
  const { t } = useI18n();

  return (
    <div className="flex flex-col items-center justify-center px-8 pt-24 text-center">
      <span className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-inset text-muted">
        <SearchX size={24} />
      </span>
      <p className="text-[15px] font-semibold text-ink">{title}</p>
      <p className="mt-1 text-sm text-muted">
        {hint ?? t("notFoundHint")}
      </p>
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="mt-5 flex items-center gap-1.5 rounded-xl bg-brand px-4 py-2.5 text-[13px] font-semibold text-on-brand"
      >
        <ArrowLeft size={14} /> {t("back")}
      </button>
    </div>
  );
}
