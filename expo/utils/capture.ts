import type { RefObject } from "react";
import type { View } from "react-native";

/**
 * react-native-view-shot is a native module, so it does not exist in Expo Go.
 * Isolating it here means the share sheet, the previews and all three cards
 * stay ordinary React Native views that render fine in Expo Go — only the
 * export reports that it needs a real build, and it says so rather than
 * crashing.
 */

export type CaptureFailure = "unavailable" | "failed";

export interface CaptureResult {
  uri: string | null;
  reason: CaptureFailure | null;
}

type CaptureFn = (ref: RefObject<View | null>, options: object) => Promise<string>;

let captureRef: CaptureFn | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  captureRef = require("react-native-view-shot").captureRef as CaptureFn;
} catch {
  captureRef = null;
}

export function isCaptureAvailable(): boolean {
  return captureRef != null;
}

/** Captures a view to a PNG file at 3x, returning its file:// uri. */
export async function captureViewToPng(ref: RefObject<View | null>): Promise<CaptureResult> {
  if (captureRef == null) return { uri: null, reason: "unavailable" };
  try {
    const uri = await captureRef(ref, { format: "png", quality: 1, result: "tmpfile", pixelRatio: 3 });
    return { uri, reason: null };
  } catch {
    return { uri: null, reason: "failed" };
  }
}
