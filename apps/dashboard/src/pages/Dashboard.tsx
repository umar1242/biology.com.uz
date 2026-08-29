import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  Users,
  ClipboardCheck,
  Video,
  Clock,
  ShieldAlert,
  ArrowUpRight,
  Clock3,
} from "lucide-react";
import { TopBar } from "../components/TopBar";
import { apiFetch } from "../lib/api";
import { useAuth } from "../lib/auth";
import type { Course, DashboardSummary, ExpiringAccess, ReviewQueueItem } from "../lib/types";
import { useI18n } from "../lib/i18n";

const dateFormatter = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long" });

/*
 * Пять карточек сводки раньше были одинаково серыми, и глаз не отличал
 * «сколько учеников» от «сколько вот-вот потеряют доступ». Тон идёт по
 * возрастанию срочности слева направо: акцент → информация → норма →
 * внимание → тревога, и он же красит штрих под подписью. Штрих короткий и
 * без дорожки намеренно: полоса на дорожке читалась бы как прогресс, а
 * мерить тут нечего.
 */
type Tone = "accent" | "info" | "pos" | "warn" | "neg";

const TONES: Record<Tone, { chip: string; bar: string }> = {
  accent: { chip: "bg-accent-soft text-accent", bar: "bg-accent" },
  info: { chip: "bg-info-soft text-info", bar: "bg-info" },
  pos: { chip: "bg-pos-soft text-pos", bar: "bg-pos" },
  warn: { chip: "bg-warn-soft text-warn", bar: "bg-warn" },
  neg: { chip: "bg-neg-soft text-neg", bar: "bg-neg" },
};

function StatCard({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof Users;
  label: string;
  value: number | undefined;
  tone: Tone;
}) {
  return (
    <div className="border border-line rounded-2xl bg-card p-5">
      <div className={`mb-3 flex h-9 w-9 items-center justify-center rounded-xl ${TONES[tone].chip}`}>
        <Icon size={18} />
      </div>
      <div className="text-2xl font-bold text-ink tabular-nums">{value ?? "—"}</div>
      <div className="mt-0.5 text-xs text-muted">{label}</div>
      <div className={`mt-3 h-1 w-10 rounded-full ${TONES[tone].bar}`} />
    </div>
  );
}

export function DashboardPage() {
  const { t, formatDate } = useI18n();
  const { auth } = useAuth();

  const summary = useQuery({
    queryKey: ["dashboard-summary"],
    queryFn: () => apiFetch<DashboardSummary>("/dashboard/summary"),
  });

  const courses = useQuery({
    queryKey: ["courses"],
    queryFn: () => apiFetch<Course[]>("/courses"),
  });

  const reviewQueue = useQuery({
    queryKey: ["review-queue", "pending"],
    queryFn: () => apiFetch<ReviewQueueItem[]>("/review-queue?status=pending"),
  });

  const expiring = useQuery({
    queryKey: ["access-expiring"],
    queryFn: () => apiFetch<ExpiringAccess[]>("/access/expiring"),
  });

  return (
    <>
      <TopBar title={t("navDashboard")} badge={summary.data?.access_needing_attention_count} />

      <main className="px-4 pb-10 sm:px-8">
        {/* Hero */}
        <div className="relative mb-6 overflow-hidden rounded-3xl border border-line bg-hero px-5 py-6 text-on-hero sm:px-8 sm:py-7">
          <div
            aria-hidden
            className="pointer-events-none absolute -top-24 -right-16 h-64 w-64 rounded-full bg-accent/25 blur-3xl"
          />
          <p className="relative text-xs font-medium tracking-wide text-hero-muted uppercase">
            {dateFormatter.format(new Date())}
          </p>
          <h2 className="relative mt-2 max-w-md text-xl font-bold">
            {t("welcomeBack", { name: auth?.display_name ?? t("colleague") })}
          </h2>
          <p className="relative mt-1.5 max-w-md text-sm text-hero-muted">
            {t("dashboardIntro")}
          </p>
        </div>

        {/* Stats */}
        <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-5">
          <StatCard icon={Users} label={t("statActiveStudents")} value={summary.data?.active_students} tone="accent" />
          <StatCard
            icon={ClipboardCheck}
            label={t("statUnreviewed")}
            value={summary.data?.unreviewed_homework_count}
            tone="info"
          />
          <StatCard
            icon={Video}
            label={t("statLiveLessons")}
            value={summary.data?.upcoming_live_lessons}
            tone="pos"
          />
          <StatCard
            icon={Clock}
            label={t("statAccessAttention")}
            value={summary.data?.access_needing_attention_count}
            tone="warn"
          />
          <StatCard
            icon={ShieldAlert}
            label={t("statNearBlacklist")}
            value={summary.data?.students_near_blacklist_threshold}
            tone="neg"
          />
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* Left column */}
          <div className="flex flex-col gap-6 lg:col-span-2">
            <section className="border border-line rounded-2xl bg-card p-5">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-base font-semibold text-ink">{t("myCourses")}</h3>
                <Link
                  to="/courses"
                  className="flex items-center gap-1 text-xs font-medium text-muted hover:text-ink"
                >
                  {t("allCourses")} <ArrowUpRight size={14} />
                </Link>
              </div>
              <div className="flex flex-col gap-2">
                {courses.isLoading && <p className="text-sm text-muted">{t("loading")}</p>}
                {courses.data?.length === 0 && (
                  <p className="text-sm text-muted">{t("noCoursesYet")}</p>
                )}
                {courses.data?.slice(0, 5).map((c) => (
                  <div
                    key={c.id}
                    className="flex items-center justify-between rounded-xl bg-inset px-4 py-3"
                  >
                    <div>
                      <p className="text-sm font-medium text-ink">{c.title}</p>
                      <p className="text-xs text-muted">
                        {c.subject === "biology" ? t("subjectBiology") : t("subjectChemistry")}
                        {c.isArchived ? t("archivedSuffix") : ""}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="border border-line rounded-2xl bg-card p-5">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-base font-semibold text-ink">{t("onReview")}</h3>
                <Link
                  to="/review"
                  className="flex items-center gap-1 text-xs font-medium text-muted hover:text-ink"
                >
                  {t("wholeQueue")} <ArrowUpRight size={14} />
                </Link>
              </div>
              <div className="flex flex-col gap-2">
                {reviewQueue.isLoading && <p className="text-sm text-muted">{t("loading")}</p>}
                {reviewQueue.data?.length === 0 && (
                  <p className="text-sm text-muted">{t("noUnreviewed")}</p>
                )}
                {reviewQueue.data?.slice(0, 5).map((item) => (
                  <div key={item.id} className="flex items-center gap-3 rounded-xl bg-inset px-4 py-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-inset text-xs font-semibold text-muted">
                      №{item.studentId}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-ink">
                        {t("attemptHomework", { n: item.attemptNumber, id: item.homeworkId })}
                      </p>
                      <p className="text-xs text-muted">
                        {new Date(item.submittedAt).toLocaleString("ru-RU")}
                      </p>
                    </div>
                    {item.isLate && (
                      <span className="shrink-0 rounded-full bg-warn-soft px-2.5 py-1 text-xs font-medium text-warn">
                        {t("late")}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </section>
          </div>

          {/* Right column */}
          <div className="flex flex-col gap-6">
            <section className="border border-line rounded-2xl bg-card p-5">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-base font-semibold text-ink">{t("accessNeedingAttention")}</h3>
              </div>
              <div className="flex flex-col gap-2">
                {expiring.isLoading && <p className="text-sm text-muted">{t("loading")}</p>}
                {expiring.data?.length === 0 && (
                  <p className="text-sm text-muted">{t("allGood")}</p>
                )}
                {expiring.data?.slice(0, 6).map((row) => (
                  <div
                    key={row.id}
                    className="flex items-center justify-between rounded-xl bg-inset px-4 py-3"
                  >
                    <div className="flex items-center gap-2.5">
                      <Clock3 size={15} className="text-muted" />
                      <span className="text-sm font-medium text-ink">{t("studentNo", { id: row.studentId })}</span>
                    </div>
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                        row.status === "expired"
                          ? "bg-neg-soft text-neg"
                          : "bg-warn-soft text-warn"
                      }`}
                    >
                      {row.status === "expired" ? t("expired") : t("expiringSoon")}
                    </span>
                  </div>
                ))}
              </div>
            </section>

            {/* Заливка стала цветной, поэтому серый text-muted внутри неё
                больше не читается — подписи берут прозрачный белый. */}
            <section className="rounded-3xl bg-brand p-6 text-on-brand">
              <p className="text-xs font-medium tracking-wide text-on-brand/70 uppercase">
                {t("statNearBlacklist")}
              </p>
              <div className="mt-3 text-4xl font-extrabold tabular-nums">
                {summary.data?.students_near_blacklist_threshold ?? "—"}
              </div>
              <p className="mt-2 text-sm text-on-brand/75">
                {t("nearThresholdNote")}
              </p>
            </section>
          </div>
        </div>
      </main>
    </>
  );
}
