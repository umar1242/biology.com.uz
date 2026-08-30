import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { TopBar } from "../components/TopBar";
import { apiFetch } from "../lib/api";
import { useI18n } from "../lib/i18n";

type AttemptRow = {
  id: number;
  student_id: number;
  student_name: string;
  attempt_number: number;
  status: "in_progress" | "submitted" | "reviewed";
  submitted_at: string | null;
  is_late: boolean | null;
  auto_score: number | null;
  manual_score: number | null;
  total_score: number | null;
  cert_total: number | null;
  equated_total: number | null;
};

export function CertExamAttemptsPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { t, formatDateTime } = useI18n();

  const attempts = useQuery({
    queryKey: ["cert-exam-attempts", id],
    queryFn: () => apiFetch<AttemptRow[]>(`/cert-exams/${id}/attempts`),
  });

  const label = {
    in_progress: t("certStatusInProgress"),
    submitted: t("certStatusSubmitted"),
    reviewed: t("certStatusReviewed"),
  };
  const tone = {
    in_progress: "bg-inset text-muted",
    submitted: "bg-warn-soft text-warn",
    reviewed: "bg-pos-soft text-pos",
  };

  return (
    <>
      <TopBar title={t("certAttempts")} backTo="/cert" />
      <main className="px-4 pb-10 sm:px-8">
        <div className="flex flex-col gap-2">
          {attempts.isLoading && <p className="text-sm text-muted">{t("loading")}</p>}
          {attempts.data?.length === 0 && (
            <p className="text-sm text-muted">{t("certNoAttempts")}</p>
          )}
          {attempts.data?.map((a) => (
            <button
              key={a.id}
              type="button"
              // Only a submitted work can be graded; an in-progress one has
              // nothing final to look at yet.
              disabled={a.status === "in_progress"}
              onClick={() => navigate(`/cert/attempts/${a.id}`)}
              className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-card p-4 text-left disabled:opacity-60"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink">
                  {a.student_name || `№${a.student_id}`}
                </p>
                <p className="text-xs text-muted">
                  {a.submitted_at ? formatDateTime(a.submitted_at) : "—"}
                  {a.is_late && ` · ${t("certLate")}`}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                {a.total_score !== null && (
                  <span className="text-sm font-semibold text-ink">{a.total_score}</span>
                )}
                {/* Балл на сертификатной шкале и он же с поправкой на
                    трудность варианта — по нему и сравнивают потоки. */}
                {a.cert_total !== null && (
                  <span className="text-xs tabular-nums text-muted">
                    {a.cert_total}
                    {a.equated_total !== null && a.equated_total !== a.cert_total && (
                      <span className="ml-1 font-semibold text-brand">
                        → {a.equated_total}
                      </span>
                    )}
                  </span>
                )}
                <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${tone[a.status]}`}>
                  {label[a.status]}
                </span>
                {a.status !== "in_progress" && <ChevronRight size={18} className="text-muted" />}
              </div>
            </button>
          ))}
        </div>
      </main>
    </>
  );
}
