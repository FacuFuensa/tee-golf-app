import type { EventSubscription } from "expo-modules-core";
import { Platform } from "react-native";

/**
 * The Tee <-> Apple Watch link.
 *
 * The native half only exists in a real iOS build. Expo Go, Android and the web
 * preview all have to keep working — the round screen is the app's main screen
 * and it is where this gets wired in — so every entry point here degrades to a
 * no-op rather than throwing, exactly like `utils/capture.ts` does for
 * react-native-view-shot.
 *
 * One JSON string crosses the bridge in each direction. See the header comment
 * in ios/TeeWatchBridgeModule.swift for why it is a string and not a
 * dictionary. The two payload shapes below are the contract; their Swift
 * mirrors are `WatchContext` and `WatchMessage` in
 * targets/watch/WatchModels.swift, and the field names must stay identical on
 * both sides.
 */

/** Bumped only on a breaking shape change, so an old watch build can bail out. */
export const WATCH_PAYLOAD_VERSION = 1;

/** Phone -> watch. Replaces any previously queued state; latest wins. */
export interface WatchContext {
  v: number;
  /** False when no round is being played — the watch shows its idle screen. */
  active: boolean;
  roundId: string;
  /** Identifies which hole a stroke edit coming back applies to. */
  holeId: string;
  holeNumber: number;
  par: number | null;
  strokes: number;
  /** Already rounded and already converted into `unit`. Null while unknown. */
  distance: number | null;
  unit: "yd" | "m";
  /** Mirrors the three states the phone's own hero number can be in. */
  status: "ok" | "searching" | "offcourse";
  courseName: string;
  holeCount: number;
}

/** Watch -> phone. */
export interface WatchMessage {
  v: number;
  type: "setStrokes";
  roundId: string;
  holeId: string;
  /**
   * ABSOLUTE, never a delta.
   *
   * The watch sends the same edit down two paths (`sendMessage` when the phone
   * is reachable, `transferUserInfo` always) so a tap lands immediately when
   * possible and is still guaranteed to arrive when not. That means the phone
   * can see the same edit twice. Applying an absolute count makes a duplicate a
   * no-op; an increment would silently double the golfer's score.
   */
  strokes: number;
}

export interface WatchLinkState {
  supported: boolean;
  paired: boolean;
  appInstalled: boolean;
  reachable: boolean;
  activated?: boolean;
}

const UNAVAILABLE: WatchLinkState = {
  supported: false,
  paired: false,
  appInstalled: false,
  reachable: false,
  activated: false,
};

interface NativeBridge {
  isAvailable: () => boolean;
  activate: () => void;
  updateContext: (json: string) => void;
  getState: () => WatchLinkState;
  addListener: (
    event: "onMessageFromWatch" | "onWatchStateChange",
    listener: (payload: never) => void
  ) => EventSubscription;
}

/**
 * Resolved once, at module scope, inside try/catch.
 *
 * `requireNativeModule` throws when the native module is absent, and it throws
 * at import time. Doing it here means the failure is contained to this one
 * binding instead of taking down whichever screen happened to import it.
 */
const native: NativeBridge | null = (() => {
  if (Platform.OS !== "ios") return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { requireNativeModule } = require("expo") as {
      requireNativeModule: (name: string) => NativeBridge;
    };
    return requireNativeModule("TeeWatchBridge");
  } catch {
    return null;
  }
})();

/** True only where the link can actually do something. */
export function isWatchLinkAvailable(): boolean {
  if (!native) return false;
  try {
    return native.isAvailable();
  } catch {
    return false;
  }
}

export function activateWatchLink(): void {
  if (!native) return;
  try {
    native.activate();
  } catch {
    // Nothing the golfer can do about it, and nothing here is load-bearing for
    // playing a round on the phone.
  }
}

export function getWatchLinkState(): WatchLinkState {
  if (!native) return UNAVAILABLE;
  try {
    return native.getState();
  } catch {
    return UNAVAILABLE;
  }
}

export function pushWatchContext(context: WatchContext): void {
  if (!native) return;
  try {
    native.updateContext(JSON.stringify(context));
  } catch {
    // A dropped context is self-correcting: the next GPS tick pushes a fresher
    // one, and the watch keeps showing the last good state meanwhile.
  }
}

/**
 * Subscribe to stroke edits made on the watch.
 *
 * Malformed payloads are dropped silently rather than thrown: the sender is a
 * separately-versioned app bundle that a golfer can be running an older copy
 * of, so "a message I don't understand" is an expected condition, not a bug.
 */
export function addWatchMessageListener(
  listener: (message: WatchMessage) => void
): EventSubscription | null {
  if (!native) return null;
  try {
    return native.addListener("onMessageFromWatch", (payload: never) => {
      const json = (payload as { json?: unknown } | null)?.json;
      if (typeof json !== "string") return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(json);
      } catch {
        return;
      }
      if (!isWatchMessage(parsed)) return;
      listener(parsed);
    });
  } catch {
    return null;
  }
}

function isWatchMessage(value: unknown): value is WatchMessage {
  if (!value || typeof value !== "object") return false;
  const m = value as Partial<WatchMessage>;
  return (
    m.type === "setStrokes" &&
    typeof m.roundId === "string" &&
    typeof m.holeId === "string" &&
    typeof m.strokes === "number" &&
    Number.isFinite(m.strokes)
  );
}
