"""
Turns iPhone screenshots into App Store Connect uploads.

WHY THIS EXISTS
Apple requires the 6.9" iPhone size class and validates the pixel dimensions
exactly: 1320x2868, 1290x2796 or 1260x2736. An iPhone 16 shoots 1179x2556,
which is the 6.3" class and will be rejected at the media-ingest step.

The two aspect ratios differ by 0.02% (2.167939 vs 2.167442), so scaling up to
1290x2796 needs no crop and no letterbox, and the distortion is far below what
an eye can resolve. That is what this does.

It also flattens to RGB. iOS screenshots carry an alpha channel, and alpha in an
uploaded screenshot is a HARD upload failure, not a warning.

USAGE
    1. Put your screenshots in  expo/store/screenshots/raw/
       Name them in the order you want them shown, e.g. 1-distance.png.
    2. python store/prepare-screenshots.py
    3. Upload everything from  expo/store/screenshots/6.9/
"""

from pathlib import Path
import sys

try:
    from PIL import Image
except ImportError:
    sys.exit("Pillow is missing. Run:  python -m pip install Pillow")

HERE = Path(__file__).parent
RAW = HERE / "screenshots" / "raw"
OUT = HERE / "screenshots" / "6.9"

# The 6.9" portrait sizes Apple accepts. We target the middle one because it is
# what the current Pro Max models shoot natively, so it is the best-tested path.
TARGET = (1290, 2796)

# Sizes we recognise, so the script can tell you what it found rather than
# silently rescaling something unexpected.
KNOWN = {
    (1320, 2868): '6.9" (iPhone Air / 17 Pro Max) — already compliant',
    (1290, 2796): '6.9" (16/15 Pro Max, 16/15 Plus) — already compliant',
    (1260, 2736): '6.9" (14 Pro Max) — already compliant',
    (1284, 2778): '6.5" (14 Plus / 13 Pro Max) — compliant only if you skip 6.9"',
    (1242, 2688): '6.5" (11 Pro Max / XS Max)',
    (1206, 2622): '6.3" (17 Pro / 16 Pro) — NOT accepted as 6.9"',
    (1179, 2556): '6.1" (iPhone 16 / 15 / 14 Pro) — NOT accepted as 6.9"',
    (1170, 2532): '6.1" (iPhone 12/13) — NOT accepted as 6.9"',
}


def main() -> int:
    if not RAW.is_dir():
        RAW.mkdir(parents=True, exist_ok=True)
        print(f"Created {RAW}")
        print("Put your screenshots in there and run this again.")
        return 0

    shots = sorted(
        p for p in RAW.iterdir()
        if p.suffix.lower() in {".png", ".jpg", ".jpeg"} and not p.name.startswith(".")
    )
    if not shots:
        print(f"No images found in {RAW}")
        return 1

    OUT.mkdir(parents=True, exist_ok=True)
    print(f"Target: {TARGET[0]} x {TARGET[1]}  (6.9\" portrait)\n")

    written = 0
    for path in shots:
        with Image.open(path) as im:
            src = im.size
            label = KNOWN.get(src, "unrecognised size")
            had_alpha = im.mode in ("RGBA", "LA", "P")

            # Flatten onto the app's cream background rather than black, so any
            # transparent edge blends instead of showing a hard border.
            if had_alpha:
                flat = Image.new("RGB", src, (242, 237, 227))
                rgba = im.convert("RGBA")
                flat.paste(rgba, mask=rgba.split()[-1])
                work = flat
            else:
                work = im.convert("RGB")

            if src == TARGET:
                out = work
                action = "already the right size"
            else:
                out = work.resize(TARGET, Image.LANCZOS)
                action = f"scaled {TARGET[0]/src[0]:.4f}x"

            dest = OUT / (path.stem + ".png")
            # optimize keeps the file well under Apple's limit without touching
            # pixels; PNG is lossless either way.
            out.save(dest, "PNG", optimize=True)
            written += 1

            print(f"  {path.name}")
            print(f"      in : {src[0]} x {src[1]}  ({label}){'  [had alpha]' if had_alpha else ''}")
            print(f"      out: {TARGET[0]} x {TARGET[1]}  {action}  ->  {dest.name}")

    # Verify what we actually wrote, rather than trusting the save calls.
    print(f"\nVerifying {written} file(s)...")
    bad = 0
    for path in sorted(OUT.glob("*.png")):
        with Image.open(path) as im:
            size_ok = im.size == TARGET
            alpha_ok = im.mode == "RGB"
            if not (size_ok and alpha_ok):
                bad += 1
                print(f"  FAIL {path.name}: size={im.size} mode={im.mode}")
    if bad == 0:
        print(f"  All {written} file(s) are exactly {TARGET[0]}x{TARGET[1]}, RGB, no alpha.")
        print(f"\nUpload from: {OUT}")
    else:
        print(f"  {bad} file(s) failed verification.")
        return 1

    if written > 10:
        print(f"\nNote: Apple accepts at most 10 screenshots per size class; you have {written}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
