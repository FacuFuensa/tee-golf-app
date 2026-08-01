import type { RefObject } from "react";
import { PixelRatio, Platform, type View } from "react-native";

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

// Pixels per logical point in the export, independent of the exporting
// device's own screen scale — chosen to look sharp on a 3x device without
// ballooning the file on a 2x one.
const EXPORT_SCALE = 3;

/**
 * Captures a view to a PNG file, returning its file:// uri.
 *
 * `width`/`height` are the view's logical (React Native) size, e.g.
 * `CARD_WIDTH`. react-native-view-shot has no `pixelRatio` option — its only
 * resize controls are `width`/`height`, and the two platforms interpret them
 * differently. Android takes them as the final bitmap's pixel dimensions (it
 * resizes the already-captured, native-resolution bitmap to match). iOS
 * treats them as points fed to `UIGraphicsBeginImageContextWithOptions`,
 * whose `0` scale argument then multiplies by the device's own screen scale.
 * Dividing the iOS target by `PixelRatio.get()` cancels that multiplication,
 * so both platforms land on the same pixel size regardless of the device's
 * own scale factor.
 */
export async function captureViewToPng(
  ref: RefObject<View | null>,
  width: number,
  height: number
): Promise<CaptureResult> {
  if (captureRef == null) return { uri: null, reason: "unavailable" };
  try {
    const targetWidth = width * EXPORT_SCALE;
    const targetHeight = height * EXPORT_SCALE;
    const size =
      Platform.OS === "ios"
        ? { width: targetWidth / PixelRatio.get(), height: targetHeight / PixelRatio.get() }
        : { width: Math.round(targetWidth), height: Math.round(targetHeight) };
    const uri = await captureRef(ref, {
      format: "png",
      quality: 1,
      result: "tmpfile",
      // iOS's default path (drawViewHierarchyInRect:afterScreenUpdates:) is
      // documented by the library itself as unreliable for large views — it
      // can report success while returning a blank image. The capture target
      // here is a card taller than some small-iPhone viewports, sitting in a
      // ScrollView, so it can be partially off-screen exactly when that
      // failure mode triggers. renderInContext draws the layer directly
      // instead of relying on what's on-screen. Its documented trade-off is
      // losing gradients/scrollview content, which doesn't apply — the cards
      // are solid-colour, non-scrolling views. No-op on Android.
      useRenderInContext: true,
      ...size,
    });
    return { uri, reason: null };
  } catch {
    return { uri: null, reason: "failed" };
  }
}
