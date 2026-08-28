import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { CheckCircle2, GraduationCap } from "lucide-react";
import { apiFetch, ApiError } from "../lib/api";
import type { ApplicationContext } from "../lib/types";
import { useI18n } from "../lib/i18n";
import { useAuth } from "../lib/auth";

/** Mirrors the server's rule in routes/app/applications.ts — at least 7 digits. */
function looksLikePhone(value: string): boolean {
  return (value.match(/\d/g) ?? []).length >= 7;
}

/**
 * The enrolment questionnaire, opened from the bot's button after the student
 * has confirmed their phone. Deliberately lives outside the tab Layout: it is
 * a one-off form for someone who is not a member of the course yet, so the
 * bottom navigation would offer them nothing.
 */
export function ApplyPage() {
  const { t } = useI18n();
  const { markOnboarded } = useAuth();
  const navigate = useNavigate();
  const { courseId } = useParams();
  const [step, setStep] = useState<"intro" | "form" | "done">("intro");
  const [inviteSent, setInviteSent] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const context = useQuery({
    queryKey: ["application-context", courseId],
    queryFn: () => apiFetch<ApplicationContext>(`/app/courses/${courseId}/application-context`),
  });

  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [parentPhone, setParentPhone] = useState("");
  const [parentPhone2, setParentPhone2] = useState("");
  const [about, setAbout] = useState("");

  useEffect(() => {
    if (!context.data) return;
    setFullName((v) => v || context.data.full_name_suggestion);
    setPhone((v) => v || context.data.verified_phone || "");
  }, [context.data]);

  const submit = useMutation({
    mutationFn: () =>
      apiFetch<{ ok: boolean; invite_sent: boolean }>(`/app/courses/${courseId}/application`, {
        method: "POST",
        body: JSON.stringify({
          full_name: fullName.trim(),
          phone: phone.trim(),
          parent_phone_primary: parentPhone.trim(),
          parent_phone_secondary: parentPhone2.trim(),
          about_self: about.trim(),
        }),
      }),
    onSuccess: (res) => {
      setInviteSent(res.invite_sent);
      // Lifts App.tsx's gate straight away — the questionnaire it was waiting
      // for has just been filled.
      markOnboarded();
      setStep("done");
    },
    onError: (err) =>
      setError(
        err instanceof ApiError && err.code === "blacklisted"
          ? t("applyBlocked")
          : err instanceof ApiError
            ? err.message
            : t("applyFailed"),
      ),
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (fullName.trim().length < 3) return setError(t("applyErrName"));
    if (!looksLikePhone(phone)) return setError(t("applyErrPhone"));
    if (!looksLikePhone(parentPhone)) return setError(t("applyErrParent"));
    if (parentPhone2.trim() && !looksLikePhone(parentPhone2)) return setError(t("applyErrPhone"));
    submit.mutate();
  }

  if (context.isLoading) {
    return <div className="px-5 pt-8 text-sm text-muted">{t("loading")}</div>;
  }
  if (context.error) {
    // 403 blacklisted is the one failure worth naming: the student is not
    // looking at a broken app, they have been barred from this course.
    const blocked = context.error instanceof ApiError && context.error.code === "blacklisted";
    return (
      <div className="mx-auto max-w-md px-5 pt-10 text-center text-sm text-muted">
        {blocked ? t("applyBlocked") : t("applyFailed")}
      </div>
    );
  }
  if (!context.data) {
    return <div className="px-5 pt-8 text-sm text-muted">{t("loginFailed")}</div>;
  }

  const { course, verified_phone, already_submitted } = context.data;

  if (already_submitted && step !== "done") {
    return (
      <div className="mx-auto max-w-md px-5 pt-10 text-center">
        <CheckCircle2 size={40} className="mx-auto mb-3 text-pos" />
        <p className="text-[15px] font-semibold text-ink">{t("applyAlready")}</p>
      </div>
    );
  }

  if (step === "done") {
    return (
      <div className="mx-auto max-w-md px-5 pt-10 text-center">
        <CheckCircle2 size={44} className="mx-auto mb-3 text-pos" />
        <h1 className="mb-1.5 text-lg font-bold text-ink">{t("applyDoneTitle")}</h1>
        <p className="mb-6 text-sm text-muted">
          {inviteSent ? t("applyDoneText") : t("applyDoneNoInvite")}
        </p>
        <button
          type="button"
          onClick={() => navigate("/", { replace: true })}
          className="w-full rounded-xl bg-brand py-3 text-[14px] font-semibold text-on-brand"
        >
          {t("applyEnterApp")}
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md px-5 pb-12 pt-6">
      <h1 className="mb-1 text-xl font-bold text-ink">{t("applyTitle")}</h1>
      <p className="mb-5 text-sm text-muted">{course.title}</p>

      {step === "intro" && (
        <>
          <section className="mb-4 rounded-card border border-line bg-card p-5">
            <div className="mb-2.5 flex items-center gap-2">
              <GraduationCap size={17} className="text-muted" />
              <p className="text-sm font-semibold text-ink">{t("applyAboutCourse")}</p>
            </div>
            <p className="whitespace-pre-line text-[14px] leading-relaxed text-ink">
              {course.description || t("applyNoDescription")}
            </p>
          </section>

          {course.trial_lesson_count > 0 && (
            <p className="mb-5 rounded-card border border-line bg-inset p-4 text-[13px] text-muted">
              {t("applyTrialNote", { count: course.trial_lesson_count })}
            </p>
          )}

          <button
            type="button"
            onClick={() => setStep("form")}
            className="w-full rounded-xl bg-brand py-3 text-[14px] font-semibold text-on-brand"
          >
            {t("applyContinue")}
          </button>
        </>
      )}

      {step === "form" && (
        <form onSubmit={handleSubmit} className="rounded-card border border-line bg-card p-5">
          <p className="mb-4 text-sm font-semibold text-ink">{t("applyFormTitle")}</p>

          <label className="mb-4 block text-sm">
            <span className="mb-1.5 block font-medium text-ink">{t("applyFullName")}</span>
            <input
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder={t("applyFullNamePlaceholder")}
              className="w-full rounded-xl border border-line bg-app px-4 py-2.5 text-sm outline-none focus:border-ink"
            />
          </label>

          <label className="mb-4 block text-sm">
            <span className="mb-1.5 block font-medium text-ink">
              {t("applyMyPhone")}
              {verified_phone && (
                <span className="ml-1.5 font-normal text-muted">· {t("applyPhoneVerified")}</span>
              )}
            </span>
            <input
              type="tel"
              inputMode="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+998 90 123 45 67"
              className="w-full rounded-xl border border-line bg-app px-4 py-2.5 text-sm outline-none focus:border-ink"
            />
          </label>

          <label className="mb-4 block text-sm">
            <span className="mb-1.5 block font-medium text-ink">
              {t("applyParentPhone")}
              <span className="ml-1.5 font-normal text-muted">· {t("applyRequired")}</span>
            </span>
            <input
              type="tel"
              inputMode="tel"
              value={parentPhone}
              onChange={(e) => setParentPhone(e.target.value)}
              placeholder="+998 90 123 45 67"
              className="w-full rounded-xl border border-line bg-app px-4 py-2.5 text-sm outline-none focus:border-ink"
            />
          </label>

          <label className="mb-4 block text-sm">
            <span className="mb-1.5 block font-medium text-ink">
              {t("applyParentPhoneSecond")}
              <span className="ml-1.5 font-normal text-muted">· {t("applyRecommended")}</span>
            </span>
            <input
              type="tel"
              inputMode="tel"
              value={parentPhone2}
              onChange={(e) => setParentPhone2(e.target.value)}
              placeholder="+998 90 123 45 67"
              className="w-full rounded-xl border border-line bg-app px-4 py-2.5 text-sm outline-none focus:border-ink"
            />
          </label>

          <label className="mb-5 block text-sm">
            <span className="mb-1.5 block font-medium text-ink">{t("applyAbout")}</span>
            <textarea
              value={about}
              onChange={(e) => setAbout(e.target.value)}
              rows={4}
              placeholder={t("applyAboutPlaceholder")}
              className="w-full rounded-xl border border-line bg-app px-4 py-2.5 text-sm outline-none focus:border-ink"
            />
          </label>

          {error && <p className="mb-3 text-sm text-neg">{error}</p>}

          <button
            type="submit"
            disabled={submit.isPending}
            className="w-full rounded-xl bg-brand py-3 text-[14px] font-semibold text-on-brand disabled:opacity-50"
          >
            {submit.isPending ? t("applySubmitting") : t("applySubmit")}
          </button>
        </form>
      )}
    </div>
  );
}
