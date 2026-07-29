import createContextHook from "@nkzw/create-context-hook";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useAuth } from "@/providers/AuthProvider";

const BLOCKED_KEY_PREFIX = "tee.players.blocked.";

function storageKeyFor(userId: string | null): string | null {
  return userId ? `${BLOCKED_KEY_PREFIX}${userId}` : null;
}

/**
 * Players this golfer has blocked. Blocking hides that player everywhere their
 * user-authored content would otherwise appear — today that means their display
 * name on a group-round leaderboard.
 *
 * Apple's Guideline 1.2 requires an app showing user-generated content to let
 * people block abusive users. Blocks are stored per signed-in account so they
 * never leak between accounts sharing a device, and are applied on read so a
 * blocked player disappears immediately without needing a round to end.
 */
export const [BlockedPlayersProvider, useBlockedPlayers] = createContextHook(() => {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [blocked, setBlocked] = useState<string[]>([]);

  useEffect(() => {
    let active = true;
    const key = storageKeyFor(userId);
    setBlocked([]);
    if (!key) return;
    AsyncStorage.getItem(key)
      .then((stored) => {
        if (!active || !stored) return;
        try {
          const parsed = JSON.parse(stored) as unknown;
          if (Array.isArray(parsed)) {
            setBlocked(parsed.filter((id): id is string => typeof id === "string"));
          }
        } catch {
          // ignore malformed cache — start with nobody blocked
        }
      })
      .catch(() => {
        // ignore — start with nobody blocked
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
        // non-fatal: the block holds for this session either way
      });
    },
    [userId]
  );

  const blockPlayer = useCallback(
    (profileId: string): void => {
      setBlocked((prev) => {
        if (prev.includes(profileId)) return prev;
        const next = [...prev, profileId];
        persist(next);
        return next;
      });
    },
    [persist]
  );

  const unblockPlayer = useCallback(
    (profileId: string): void => {
      setBlocked((prev) => {
        const next = prev.filter((id) => id !== profileId);
        persist(next);
        return next;
      });
    },
    [persist]
  );

  const isBlocked = useCallback(
    (profileId: string): boolean => blocked.includes(profileId),
    [blocked]
  );

  return useMemo(
    () => ({ blocked, blockPlayer, unblockPlayer, isBlocked }),
    [blocked, blockPlayer, unblockPlayer, isBlocked]
  );
});
