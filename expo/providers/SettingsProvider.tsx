import createContextHook from "@nkzw/create-context-hook";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { DistanceUnit } from "@/utils/geo";

const UNIT_KEY = "tee.settings.unit";
const DISCOVERABLE_ROUNDS_KEY = "tee.settings.discoverable_rounds";

export const [SettingsProvider, useSettings] = createContextHook(() => {
  const [unit, setUnitState] = useState<DistanceUnit>("yards");
  // Default true — matches rounds.is_discoverable's own DB default (migration
  // 0014). The owner's call: hosts opt OUT of nearby join, not in.
  const [discoverableRounds, setDiscoverableRoundsState] = useState<boolean>(true);

  useEffect(() => {
    AsyncStorage.getItem(UNIT_KEY)
      .then((stored) => {
        if (stored === "yards" || stored === "meters") setUnitState(stored);
      })
      .catch(() => {
        // ignore — fall back to the default unit
      });
    AsyncStorage.getItem(DISCOVERABLE_ROUNDS_KEY)
      .then((stored) => {
        // Absent key (nothing ever saved) keeps the true default above;
        // only an explicit "false" ever turns it off.
        if (stored === "false") setDiscoverableRoundsState(false);
      })
      .catch(() => {
        // ignore — fall back to the default (on)
      });
  }, []);

  const setUnit = useCallback((next: DistanceUnit): void => {
    setUnitState(next);
    AsyncStorage.setItem(UNIT_KEY, next).catch(() => {
      // non-fatal: preference simply won't persist this time
    });
  }, []);

  const setDiscoverableRounds = useCallback((next: boolean): void => {
    setDiscoverableRoundsState(next);
    AsyncStorage.setItem(DISCOVERABLE_ROUNDS_KEY, next ? "true" : "false").catch(() => {
      // non-fatal: preference simply won't persist this time
    });
  }, []);

  return useMemo(
    () => ({ unit, setUnit, discoverableRounds, setDiscoverableRounds }),
    [unit, setUnit, discoverableRounds, setDiscoverableRounds]
  );
});
