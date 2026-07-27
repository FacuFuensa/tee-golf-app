import createContextHook from "@nkzw/create-context-hook";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useAuth } from "@/providers/AuthProvider";

const HIDDEN_KEY_PREFIX = "tee.courses.hidden.";

function storageKeyFor(userId: string | null): string | null {
  return userId ? `${HIDDEN_KEY_PREFIX}${userId}` : null;
}

/**
 * Tracks course ids the player has chosen to hide from their list. Hiding is
 * purely local and non-destructive — the course, its mapped greens, and round
 * history all stay intact in Supabase; the row simply stops appearing here.
 *
 * The storage key is scoped to the signed-in user so one account's hidden
 * courses never leak into another account on a shared device.
 */
export const [HiddenCoursesProvider, useHiddenCourses] = createContextHook(() => {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [hidden, setHidden] = useState<string[]>([]);

  useEffect(() => {
    let active = true;
    const key = storageKeyFor(userId);
    setHidden([]);
    if (!key) return;
    AsyncStorage.getItem(key)
      .then((stored) => {
        if (!active || !stored) return;
        try {
          const parsed = JSON.parse(stored) as unknown;
          if (Array.isArray(parsed)) {
            setHidden(parsed.filter((id): id is string => typeof id === "string"));
          }
        } catch {
          // ignore malformed cache
        }
      })
      .catch(() => {
        // ignore — start with nothing hidden
      });
    return () => {
      active = false;
    };
  }, [userId]);

  const persist = useCallback(
    (next: string[]): void => {
      const key = storageKeyFor(userId);
      if (!key) return;
      AsyncStorage.setItem(key, JSON.stringify(next)).catch(() => {
        // non-fatal: hide simply won't persist this session
      });
    },
    [userId]
  );

  const hideCourse = useCallback(
    (courseId: string): void => {
      setHidden((prev) => {
        if (prev.includes(courseId)) return prev;
        const next = [...prev, courseId];
        persist(next);
        return next;
      });
    },
    [persist]
  );

  const unhideCourse = useCallback(
    (courseId: string): void => {
      setHidden((prev) => {
        const next = prev.filter((id) => id !== courseId);
        persist(next);
        return next;
      });
    },
    [persist]
  );

  return useMemo(
    () => ({ hidden, hideCourse, unhideCourse }),
    [hidden, hideCourse, unhideCourse]
  );
});
