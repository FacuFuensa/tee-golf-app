import { useEffect, useRef } from "react";

import {
  WATCH_PAYLOAD_VERSION,
  activateWatchLink,
  addWatchMessageListener,
  isWatchLinkAvailable,
  pushWatchContext,
  type WatchContext,
} from "@/modules/tee-watch-bridge";

/**
 * Mirrors the round being played onto the Apple Watch, and applies stroke edits
 * made there.
 *
 * Lives in its own hook rather than inside the round screen for two reasons:
 * the screen is already 2000+ lines, and every one of these effects has to run
 * before that screen's early returns for a missing/loading round — putting them
 * inline would put hooks after conditional returns, which React forbids.
 *
 * Does nothing at all when there is no watch: `isWatchLinkAvailable()` is false
 * on Android, on web, in Expo Go and on any iPhone without a paired watch.
 */
export interface WatchRoundInput {
  /** False while the round is still loading, or once it has been closed out. */
  enabled: boolean;
  roundId: string;
  courseName: string;
  /** Null between holes loading — suppresses the push rather than sending junk. */
  holeId: string | null;
  holeNumber: number | null;
  par: number | null;
  strokes: number;
  /** Already rounded and already in `unit`, exactly as the phone renders it. */
  distance: number | null;
  unit: "yd" | "m";
  status: "ok" | "searching" | "offcourse";
  holeCount: number;
  /**
   * Applies a stroke count that came from the watch. Absolute, not a delta.
   * Called on the JS thread from the native event.
   */
  onSetStrokes: (holeId: string, strokes: number) => void;
}

/** Sent when the round screen goes away, so the watch drops to its idle state. */
function idleContext(roundId: string): WatchContext {
  return {
    v: WATCH_PAYLOAD_VERSION,
    active: false,
    roundId,
    holeId: "",
    holeNumber: 0,
    par: null,
    strokes: 0,
    distance: null,
    unit: "yd",
    status: "searching",
    courseName: "",
    holeCount: 0,
  };
}

export function useWatchRound(input: WatchRoundInput): void {
  const {
    enabled,
    roundId,
    courseName,
    holeId,
    holeNumber,
    par,
    strokes,
    distance,
    unit,
    status,
    holeCount,
    onSetStrokes,
  } = input;

  // The listener is registered once for the life of the screen, but it has to
  // call the *current* handler — which closes over `scores` and so is a new
  // function on every render. A ref is what lets those two facts coexist
  // without tearing down and re-registering the native subscription on every
  // keystroke of the stepper.
  const onSetStrokesRef = useRef(onSetStrokes);
  onSetStrokesRef.current = onSetStrokes;

  const roundIdRef = useRef(roundId);
  roundIdRef.current = roundId;

  // Activation is asynchronous and idempotent, so it is kicked off as early as
  // possible and never awaited.
  useEffect(() => {
    if (!isWatchLinkAvailable()) return;
    activateWatchLink();
  }, []);

  // Stroke edits coming back from the watch.
  useEffect(() => {
    if (!isWatchLinkAvailable()) return;
    const subscription = addWatchMessageListener((message) => {
      // A queued transfer can outlive the round it was made in — iOS holds
      // undelivered user info across app launches. Applying it to whatever
      // round happens to be open now would write a stroke into a stranger's
      // card.
      if (message.roundId !== roundIdRef.current) return;
      if (message.strokes < 0 || message.strokes > 30) return;
      onSetStrokesRef.current(message.holeId, message.strokes);
    });
    return () => subscription?.remove();
  }, []);

  // The last payload actually sent. Comparing serialised strings is what keeps
  // a GPS stream that ticks several times a second from pushing a context that
  // says exactly what the previous one did.
  const lastSentRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isWatchLinkAvailable()) return;
    if (!enabled || !holeId || holeNumber == null) return;

    const context: WatchContext = {
      v: WATCH_PAYLOAD_VERSION,
      active: true,
      roundId,
      holeId,
      holeNumber,
      par,
      strokes,
      distance,
      unit,
      status,
      courseName,
      holeCount,
    };

    const serialised = JSON.stringify(context);
    if (serialised === lastSentRef.current) return;
    lastSentRef.current = serialised;
    pushWatchContext(context);
  }, [
    enabled,
    roundId,
    courseName,
    holeId,
    holeNumber,
    par,
    strokes,
    distance,
    unit,
    status,
    holeCount,
  ]);

  // Leaving the round screen — closing out, finishing, or being unmounted by
  // navigation — has to tell the watch, or it goes on showing a hole the golfer
  // is no longer playing and its `+` button keeps writing to a finished round.
  useEffect(() => {
    if (!isWatchLinkAvailable()) return;
    return () => {
      lastSentRef.current = null;
      pushWatchContext(idleContext(roundIdRef.current));
    };
  }, []);
}
