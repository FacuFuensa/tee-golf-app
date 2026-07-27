import createContextHook from "@nkzw/create-context-hook";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { DistanceUnit } from "@/utils/geo";

const UNIT_KEY = "tee.settings.unit";

export const [SettingsProvider, useSettings] = createContextHook(() => {
  const [unit, setUnitState] = useState<DistanceUnit>("yards");

  useEffect(() => {
    AsyncStorage.getItem(UNIT_KEY)
      .then((stored) => {
        if (stored === "yards" || stored === "meters") setUnitState(stored);
      })
      .catch(() => {
        // ignore — fall back to the default unit
      });
  }, []);

  const setUnit = useCallback((next: DistanceUnit): void => {
    setUnitState(next);
    AsyncStorage.setItem(UNIT_KEY, next).catch(() => {
      // non-fatal: preference simply won't persist this time
    });
  }, []);

  return useMemo(() => ({ unit, setUnit }), [unit, setUnit]);
});
