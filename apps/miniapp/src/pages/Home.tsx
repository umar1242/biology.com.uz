import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { ArrowUpRight, ChevronRight } from "lucide-react";
import { AppHeader } from "../components/AppHeader";
import { apiFetch } from "../lib/api";
import type { HomeworkListItem, Profile } from "../lib/types";
import { homeworkStatusLabel } from "../lib/statusLabels";
import { useSelectedCourse } from "../lib/selectedCourse";
import { useI18n } from "../lib/i18n";

export function HomePage() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const profile = useQuery({ queryKey: ["profile"], queryFn: () => apiFetch<Profile>("/app/profile") });
  const homework = useQuery({
    queryKey: ["homework"],
    queryFn: () => apiFetch<HomeworkListItem[]>("/app/homework"),
  });

  // Which course the header's switcher has selected — everything on this
  // screen is scoped to it.
  const { selectedCourseId } = useSelectedCourse();

  const name = profile.data?.first_name;
  // One course's assignments never show up while another is selected.
  const allItems = homework.data ?? [];
  const items = selectedCourseId ? allItems.filter((h) => h.course_id === selectedCourseId) : allItems;
  const toDo = items.filter((h) => h.status === "not_submitted" || h.status === "needs_resubmission").length;

  return (
    <div className="px-4 pt-5">
      <AppHeader name={name} />

      {/* Greeting, not a dashboard. The counts that stood here said things
          the screen already said: how many assignments are due is the card
          right below, and the two buttons led where the tab bar leads. What
          is left is the one line nothing else carries — who this is, and
          where the rest of the app lives. */}
      <section className="mb-3 flex items-center gap-4 rounded-card bg-brand p-5">
        <div className="min-w-0 flex-1">
          <p className="text-[19px] leading-tight font-bold text-on-brand">
            {name ? t("homeGreeting", { name }) : t("homeGreetingPlain")}
          </p>
          {/* Not `muted`: that token is tuned for the card ground and turns
              to mud on violet. Same ink at 75% keeps the hierarchy without
              inventing a colour. */}
          <p className="mt-1.5 text-[13px] leading-snug text-on-brand/75">{t("homeGreetingHint")}</p>
        </div>
        {/* Fluent Emoji, same set as the landing page. Decorative, so the
            alt is empty: a screen reader reading "waving hand" adds nothing
            to a greeting that already says hello. */}
        <img
          src="/img/wave.webp"
          alt=""
          width={128}
          height={128}
          className="h-16 w-16 shrink-0"
          decoding="async"
        />
      </section>

      {toDo > 0 && (
        <button
          type="button"
          onClick={() => navigate("/homework")}
          className="mb-5 flex w-full items-center gap-3 rounded-card border border-line bg-card p-4 text-left"
        >
          <img
            src="/img/memo.webp"
            alt=""
            width={128}
            height={128}
            className="h-9 w-9 shrink-0"
            loading="lazy"
            decoding="async"
          />
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold text-ink">
              {toDo === 1 ? t("oneUnsubmitted") : t("manyUnsubmitted", { count: toDo })}
            </p>
            <p className="mt-0.5 text-xs text-muted">{t("openToSubmit")}</p>
          </div>
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand text-on-brand">
            <ArrowUpRight size={15} />
          </span>
        </button>
      )}

      <div className="mb-2.5 flex items-center justify-between">
        <h2 className="text-[15px] font-semibold text-ink">{t("recentHomework")}</h2>
        <button
          type="button"
          onClick={() => navigate("/homework")}
          className="text-xs font-medium text-muted"
        >
          {t("all")}
        </button>
      </div>

      <div className="flex flex-col gap-2">
        {homework.isLoading && <p className="text-sm text-muted">{t("loading")}</p>}
        {!homework.isLoading && items.length === 0 && (
          <div className="flex items-center gap-3 rounded-card border border-line bg-card p-4">
            <img
              src="/img/books.webp"
              alt=""
              width={128}
              height={128}
              className="h-9 w-9 shrink-0"
              loading="lazy"
              decoding="async"
            />
            <p className="text-sm text-muted">{t("noHomeworkYet")}</p>
          </div>
        )}
        {items.slice(0, 5).map((hw) => {
          const label = homeworkStatusLabel[hw.status];
          return (
            <button
              key={hw.id}
              type="button"
              onClick={() => navigate(`/homework/${hw.id}`)}
              className="flex items-center gap-3 rounded-card border border-line bg-card p-3.5 text-left"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-inset text-[13px] font-bold text-ink">
                {hw.course_title?.[0]?.toUpperCase() ?? "?"}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-semibold text-ink">
                  {hw.lesson_title}
                </span>
                <span className="block truncate text-xs text-muted">{hw.course_title}</span>
              </span>
              <span className="flex shrink-0 items-center gap-1.5">
                <span className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${label.className}`}>
                  {t(label.key)}
                </span>
                <ChevronRight size={15} className="text-muted" />
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
