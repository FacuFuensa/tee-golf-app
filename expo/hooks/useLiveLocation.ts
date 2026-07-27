import * as Location from "expo-location";
import { useCallback, useEffect, useRef, useState } from "react";

export type LocationStatus =
  | "idle"
  | "requesting"
  | "granted"
  | "denied"
  | "error";

export interface Coords {
  latitude: number;
  longitude: number;
  accuracy: number | null;
}

export interface LiveLocation {
  status: LocationStatus;
  coords: Coords | null;
  error: string | null;
  retry: () => void;
}

/**
 * Safely removes a location subscription. On web, expo-location's `.remove()`
 * calls `LocationEventEmitter.removeSubscription`, which doesn't exist, so we
 * swallow that error to avoid crashing on unmount.
 */
function safeRemove(sub: Location.LocationSubscription): void {
  try {
    sub.remove();
  } catch {
    // no-op: web bundle lacks removeSubscription
  }
}

/**
 * Streams the device location while `active` is true (mirrors CLLocationManager
 * continuous updates). Requests When-In-Use permission and cleans up the
 * subscription automatically.
 */
export function useLiveLocation(active: boolean): LiveLocation {
  const [status, setStatus] = useState<LocationStatus>("idle");
  const [coords, setCoords] = useState<Coords | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState<number>(0);
  const subRef = useRef<Location.LocationSubscription | null>(null);

  useEffect(() => {
    let cancelled = false;

    const stop = (): void => {
      if (subRef.current) {
        safeRemove(subRef.current);
        subRef.current = null;
      }
    };

    async function start(): Promise<void> {
      if (!active) return;
      try {
        setStatus("requesting");
        setError(null);
        const { status: permission } = await Location.requestForegroundPermissionsAsync();
        if (cancelled) return;
        if (permission !== "granted") {
          setStatus("denied");
          return;
        }
        setStatus("granted");

        const current = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.High,
        }).catch(() => null);
        if (current && !cancelled) {
          setCoords({
            latitude: current.coords.latitude,
            longitude: current.coords.longitude,
            accuracy: current.coords.accuracy,
          });
        }

        const subscription = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.High,
            distanceInterval: 1,
            timeInterval: 1000,
          },
          (loc) => {
            setCoords({
              latitude: loc.coords.latitude,
              longitude: loc.coords.longitude,
              accuracy: loc.coords.accuracy,
            });
          }
        );

        if (cancelled) {
          safeRemove(subscription);
          return;
        }
        subRef.current = subscription;
      } catch (e) {
        if (!cancelled) {
          setStatus("error");
          setError(e instanceof Error ? e.message : "Couldn't read your location.");
        }
      }
    }

    start();
    return () => {
      cancelled = true;
      stop();
    };
  }, [active, attempt]);

  const retry = useCallback((): void => {
    setAttempt((a) => a + 1);
  }, []);

  return { status, coords, error, retry };
}
