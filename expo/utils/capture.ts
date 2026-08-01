import { File, Paths } from "expo-file-system";
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

/** What the exported file should be named after — the round being shared. */
export interface CaptureNameHint {
  courseName: string;
  /** ISO timestamp. */
  date: string;
}

const FALLBACK_NAME = "Scorecard";
/** Generous but well under filesystem name limits (255 bytes on APFS/most others). */
const MAX_NAME_LENGTH = 80;
/** Characters illegal (or reserved) in a filename on iOS/Android/Windows. */
const ILLEGAL_FILENAME_CHARS = /[/\\:*?"<>|]/g;

/**
 * Course names come from a third-party catalog and from user-typed courses,
 * so neither is trustworthy as a filename. Strip anything illegal, collapse
 * the whitespace that leaves behind, and cap the length — an empty or
 * all-illegal name (e.g. "A/B") falls back to something sensible rather than
 * producing a broken or blank path.
 */
function sanitizeFilenamePart(raw: string): string {
  const cleaned = raw.replace(ILLEGAL_FILENAME_CHARS, " ").replace(/\s+/g, " ").trim().slice(0, MAX_NAME_LENGTH).trim();
  return cleaned.length > 0 ? cleaned : FALLBACK_NAME;
}

// Matches the date format shown on the card itself (see `formatCardDate` in
// ScorecardCard.tsx) so the filename and the image agree on the round's date.
function formatFilenameDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function buildFilename({ courseName, date }: CaptureNameHint): string {
  return `${sanitizeFilenamePart(courseName)} - ${formatFilenameDate(date)}.png`;
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
export async function captureViewToPng(
  ref: RefObject<View | null>,
  nameHint: CaptureNameHint
): Promise<CaptureResult> {
  if (captureRef == null) return { uri: null, reason: "unavailable" };
  let tmpUri: string;
  try {
    tmpUri = await captureRef(ref, {
      format: "png",
      quality: 1,
      result: "tmpfile",
      useRenderInContext: true,
    });
  } catch {
    return { uri: null, reason: "failed" };
  }

  // view-shot's tmpfile is named with a bare UUID. On iOS, UIActivityViewController
  // decides which activities to offer (notably "Save Image" / "Save to Photos")
  // largely from the file's extension, and the UUID name is also what the
  // recipient would see in Mail/Files/Messages. Re-home the capture under a
  // human-readable `.png` name built from the round itself before sharing it.
  try {
    const named = new File(Paths.cache, buildFilename(nameHint));
    // Sharing the same round twice in one session would collide on this
    // deterministic name — `copy` refuses to overwrite, so clear it first.
    if (named.exists) named.delete();
    new File(tmpUri).copy(named);
    return { uri: named.uri, reason: null };
  } catch {
    // Renaming is a nicety, not the point of sharing — a share sheet without
    // "Save Image" still beats no share at all.
    return { uri: tmpUri, reason: null };
  }
}
