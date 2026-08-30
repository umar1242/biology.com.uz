import { useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { useSelectedCourse } from "../lib/selectedCourse";

/**
 * Which course everything below is scoped to, as a line of text in the header
 * rather than a card of its own.
 *
 * It used to be a full-width bordered row under the header — the visual weight
 * of a primary control for something the student changes once and then leaves
 * alone. Here it sits where the eye already goes for context, next to the
 * avatar, and stays quiet until tapped.
 */
export function CourseSwitcher() {
  const { courses, selectedCourse, selectedCourseId, setSelectedCourseId } = useSelectedCourse();
  const [open, setOpen] = useState(false);

  if (courses.length === 0) return null;
  const many = courses.length > 1;

  return (
    <div className="relative min-w-0 flex-1">
      <button
        type="button"
        onClick={() => many && setOpen((v) => !v)}
        className="flex w-full items-center gap-1 text-left"
      >
        <span className="min-w-0 truncate text-[13px] font-medium text-muted">
          {selectedCourse?.title ?? courses[0]?.title}
        </span>
        {many && (
          <ChevronDown
            size={14}
            className={`shrink-0 text-muted transition-transform ${open ? "rotate-180" : ""}`}
          />
        )}
      </button>

      {open && (
        <>
          {/* Click-away layer — a tap anywhere else closes the menu. */}
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-10 cursor-default"
          />
          <div className="absolute inset-x-0 top-full z-20 mt-2 min-w-48 overflow-hidden rounded-xl border border-line bg-card shadow-lg">
            {courses.map((c) => {
              const active = c.id === selectedCourseId;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => {
                    setSelectedCourseId(c.id);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center justify-between gap-2 border-b border-line/60 px-4 py-3 text-left text-[14px] last:border-0 ${
                    active ? "font-semibold text-ink" : "text-muted"
                  }`}
                >
                  <span className="min-w-0 truncate">{c.title}</span>
                  {active && <Check size={16} className="shrink-0 text-ink" />}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
