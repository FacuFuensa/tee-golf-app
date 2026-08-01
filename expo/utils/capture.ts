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

/**
 * Captures a view to a PNG file, returning its file:// uri.
 *
 * No `width`/`height` is passed, so view-shot falls back to the view's own
 * bounds on both platforms. This used to pass an explicit size, divided by
 * `PixelRatio.get()` on iOS, to land on the same pixel dimensions regardless
 * of device — but that only worked with iOS's default capture path
 * (`drawViewHierarchyInRect:`), which scales the view into the destination
 * rect. `useRenderInContext: true` below takes a different path
 * (`[layer renderInContext:]`) that draws the layer at its own natural
 * bounds and ignores `size` entirely — combined with an explicit size, that
 * produced a card confined to the top-left corner of an oversized,
 * transparent canvas on every 2x device (iPhone SE/XR/11, every iPad).
 *
 * `useRenderInContext` is kept anyway: iOS's default path is documented by
 * the library itself as unreliable for large views — it can report success
 * while returning a blank image. The capture target here is a card taller
 * than some small-iPhone viewports, sitting in a ScrollView, so it can be
 * partially off-screen exactly when that failure mode triggers. The
 * trade-off is that output resolution now follows the exporting device's own
 * screen scale (roughly 1020px wide on a 3x device, 680px on a 2x one)
 * instead of a fixed pixel count — a smaller-but-correctly-framed image
 * beats a blank or mis-framed one. No-op on Android — its capture path
 * (`View.draw` onto a `Canvas`) doesn't read this option and isn't
 * susceptible to the same blank-image failure.
 */
export async function captureViewToPng(ref: RefObject<View | null>): Promise<CaptureResult> {
  if (captureRef == null) return { uri: null, reason: "unavailable" };
  try {
    const uri = await captureRef(ref, {
      format: "png",
      quality: 1,
      result: "tmpfile",
      useRenderInContext: true,
    });
    return { uri, reason: null };
  } catch {
    return { uri: null, reason: "failed" };
  }
}
