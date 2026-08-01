import createContextHook from "@nkzw/create-context-hook";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useAuth } from "@/providers/AuthProvider";

const ACTIVE_KEY_PREFIX = "tee.round.active.";

function storageKeyFor(userId: string | null): string | null {
  return userId ? `${ACTIVE_KEY_PREFIX}${userId}` : null;
}

/**
 * A round the player has started but not finished. Pressing the close (X)
 * button pauses the round instead of discarding it: the local scores and
 * current hole are kept here so the golfer can resume right where they left
 * off from a "Round in progress" banner. Nothing is written to history or
 * stats until the round is explicitly saved/finished.
 *
 * The storage key is scoped to the signed-in user so a paused round never
 * leaks across accounts on a shared device.
 */
export interface ActiveRound {
  roundId: string;
  courseName: string;
  holeIndex: number;
  scores: Record<string, number>;
  isMultiplayer: boolean;
  updatedAt: number;
}

function parseActiveRound(raw: string): ActiveRound | null {
  try {
    const parsed = JSON.parse(raw) as Partial<ActiveRound> | null;
    if (
      !parsed ||
      typeof parsed.roundId !== "string" ||
      typeof parsed.courseName !== "string"
    ) {
      return null;
    }
    return {
      roundId: parsed.roundId,
      courseName: parsed.courseName,
      holeIndex: typeof parsed.holeIndex === "number" ? parsed.holeIndex : 0,
      scores:
        parsed.scores && typeof parsed.scores === "object"
          ? (parsed.scores as Record<string, number>)
          : {},
      isMultiplayer: parsed.isMultiplayer === true,
      updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : Date.now(),
    };
  } catch {
    return null;
  }
}

export const [ActiveRoundProvider, useActiveRound] = createContextHook(() => {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [activeRound, setActiveRoundState] = useState<ActiveRound | null>(null);

  // Load the active round for the current user. When the user changes (sign
  // out / switch account), drop the in-memory round and load the new user's.
  useEffect(() => {
    let active = true;
    const key = storageKeyFor(userId);
    if (!key) {
      setActiveRoundState(null);
      return;
    }
    setActiveRoundState(null);
    AsyncStorage.getItem(key)
      .then((stored) => {
        if (active && stored) setActiveRoundState(parseActiveRound(stored));
      })
      .catch(() => {
        // ignore — start with no active round
      });
    return () => {
      active = false;
    };
  }, [userId]);

  const saveActiveRound = useCallback(
    (round: ActiveRound): void => {
      const key = storageKeyFor(userId);
      if (!key) return;
      setActiveRoundState(round);
      AsyncStorage.setItem(key, JSON.stringify(round)).catch(() => {
        // non-fatal: resume simply won't survive a restart this session
      });
    },
    [userId]
  );

  const clearActiveRound = useCallback(
    (roundId?: string): void => {
      const key = storageKeyFor(userId);
      setActiveRoundState((prev) => {
        // Only clear if it matches the round being closed out (or no id given).
        // `prev` is null during the provider's initial AsyncStorage.getItem()
        // read — a mismatch must leave storage alone in that window too, or
        // deleting an unrelated historical round wipes a paused round that
        // just hasn't loaded into state yet. `prev?.roundId !== roundId` is
        // true both when prev is null and when it's a different round, so a
        // roundId argument only ever clears its own match.
        if (roundId && prev?.roundId !== roundId) return prev;
        if (key) AsyncStorage.removeItem(key).catch(() => {});
        return null;
      });
    },
    [userId]
  );

  return useMemo(
    () => ({ activeRound, saveActiveRound, clearActiveRound }),
    [activeRound, saveActiveRound, clearActiveRound]
  );
});
