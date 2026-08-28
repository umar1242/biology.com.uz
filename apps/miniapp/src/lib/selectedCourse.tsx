import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "./api";
import type { Course } from "./types";

const STORAGE_KEY = "selectedCourseId";

type Ctx = {
  courses: Course[];
  isLoading: boolean;
  selectedCourseId: number | null;
  selectedCourse: Course | null;
  setSelectedCourseId: (id: number) => void;
};

const SelectedCourseContext = createContext<Ctx | null>(null);

/**
 * The single source of truth for "which course the student is looking at".
 * Courses used to be a list the student drilled into; now one course is active
 * at a time (picked by the switcher on the Home screen) and every other tab —
 * modules, lessons, homework — scopes to it, so course X's assignments never
 * bleed into course Y's view.
 */
export function SelectedCourseProvider({ children }: { children: ReactNode }) {
  const { data, isLoading } = useQuery({
    queryKey: ["app-courses"],
    queryFn: () => apiFetch<Course[]>("/app/courses"),
  });
  const courses = data ?? [];

  const [selectedCourseId, setSelectedCourseIdState] = useState<number | null>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? Number(raw) : null;
    } catch {
      return null;
    }
  });

  const setSelectedCourseId = useCallback((id: number) => {
    setSelectedCourseIdState(id);
    try {
      localStorage.setItem(STORAGE_KEY, String(id));
    } catch {
      // Not persisting is survivable — the choice still holds for this session.
    }
  }, []);

  // Keep the selection valid: default to the first course, and drop a stale id
  // (course archived, or access revoked) that is no longer in the list.
  useEffect(() => {
    if (courses.length === 0) return;
    const stillValid = selectedCourseId != null && courses.some((c) => c.id === selectedCourseId);
    if (!stillValid) setSelectedCourseId(courses[0].id);
  }, [courses, selectedCourseId, setSelectedCourseId]);

  const value = useMemo<Ctx>(
    () => ({
      courses,
      isLoading,
      selectedCourseId,
      selectedCourse: courses.find((c) => c.id === selectedCourseId) ?? null,
      setSelectedCourseId,
    }),
    [courses, isLoading, selectedCourseId, setSelectedCourseId],
  );

  return <SelectedCourseContext.Provider value={value}>{children}</SelectedCourseContext.Provider>;
}

export function useSelectedCourse(): Ctx {
  const ctx = useContext(SelectedCourseContext);
  if (!ctx) throw new Error("useSelectedCourse must be used within SelectedCourseProvider");
  return ctx;
}
