import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { ChevronRight, GraduationCap } from "lucide-react";
import { apiFetch } from "../lib/api";
import { useI18n } from "../lib/i18n";

type CertExamRow = {
  id: number;
  title: string;
  course_title: string;
  deadline_at: string;
  total_max_points: number;
  attempt_id: number | null;
  attempt_status: "in_progress" | "submitted" | "reviewed" | null;
};

export function CertListPage() {
  const navigate = useNavigate();
  const { t, formatDateTime } = useI18n();

  const exams = useQuery({
    queryKey: ["cert-exams"],
    queryFn: () => apiFetch<CertExamRow[]>("/app/cert-exams"),
  });

  function statusLabel(row: CertExamRow) {
    if (row.attempt_status === "reviewed") return t("certViewResult");
    if (row.attempt_status === "submitted") return t("certWaitingReview");
    if (row.attempt_status === "in_progress") return t("certContinue");
    return t("certStart");
  }

  return (
    <div className="px-5 pt-6">
      <h1 className="mb-5 text-lg font-bold text-ink">{t("certListTitle")}</h1>
      <div className="flex flex-col gap-2.5 pb-6">
        {exams.isLoading && <p className="text-sm text-muted">{t("loading")}</p>}
        {exams.data?.length === 0 && <p className="text-sm text-muted">{t("certNone")}</p>}
        {exams.data?.map((e) => (
          <button
            key={e.id}
            type="button"
            onClick={() => navigate(`/cert/${e.id}`)}
            className="flex items-center gap-3 rounded-2xl border border-line bg-card p-4 text-left"
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-inset text-muted">
              <GraduationCap size={20} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-ink">{e.title}</p>
              <p className="truncate text-xs text-muted">{e.course_title}</p>
              <p className="mt-0.5 text-xs text-muted">
                {t("certDeadline")} {formatDateTime(e.deadline_at)} · {e.total_max_points}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <span
                className={`rounded-full px-2 py-1 text-[11px] font-medium ${
                  e.attempt_status === "reviewed"
                    ? "bg-pos-soft text-pos"
                    : e.attempt_status === "submitted"
                      ? "bg-warn-soft text-warn"
                      : "bg-inset text-muted"
                }`}
              >
                {statusLabel(e)}
              </span>
              <ChevronRight size={18} className="text-muted" />
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
