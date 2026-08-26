import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, ChevronRight } from "lucide-react";
import { apiFetch } from "../lib/api";
import type { Module } from "../lib/types";
import { useI18n } from "../lib/i18n";

export function ModulesPage() {
  const { t, formatDateTime, formatDate } = useI18n();
  const { courseId } = useParams();
  const navigate = useNavigate();
  const modules = useQuery({
    queryKey: ["modules", courseId],
    queryFn: () => apiFetch<Module[]>(`/app/courses/${courseId}/modules`),
  });

  return (
    <div className="px-5 pt-6">
      <div className="mb-5 flex items-center gap-3">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="border border-line flex h-9 w-9 items-center justify-center rounded-full bg-card"
        >
          <ArrowLeft size={16} />
        </button>
        <h1 className="text-lg font-bold text-ink">{t("modules")}</h1>
      </div>
      <div className="flex flex-col gap-2">
        {modules.data?.length === 0 && <p className="text-sm text-muted">{t("noModulesYet")}</p>}
        {modules.data?.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => navigate(`/courses/${courseId}/modules/${m.id}`)}
            className="border border-line flex items-center justify-between rounded-card bg-card p-4 text-left"
          >
            <p className="text-sm font-medium text-ink">{m.title}</p>
            <ChevronRight size={18} className="text-muted" />
          </button>
        ))}
      </div>
    </div>
  );
}
