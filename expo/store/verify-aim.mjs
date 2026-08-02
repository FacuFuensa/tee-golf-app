/**
 * Tests the aim-point distance maths in isolation from React/GPS/the map UI —
 * none of which this script can exercise (see the report). The two numbers
 * that matter are computed independently of each other (see computeAimShot's
 * own comment), so the interesting cases are: each leg working on its own
 * when the other input is missing, and an aim point placed beyond the green
 * still producing a real "what's left" distance instead of something that
 * looks like an error.
 *
 *   node store/verify-aim.mjs
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "aim-"));

// Both files are copied as-is: geo.ts has no imports at all, and aim.ts only
// imports "./geo" (a plain relative import, no @/ alias to strip).
writeFileSync(join(dir, "geo.ts"), readFileSync("utils/geo.ts", "utf8"));
writeFileSync(join(dir, "aim.ts"), readFileSync("utils/aim.ts", "utf8"));
execFileSync(
  "npx",
  ["tsc", join(dir, "geo.ts"), join(dir, "aim.ts"), "--target", "es2020", "--module", "es2020", "--moduleResolution", "node", "--outDir", dir],
  { stdio: "pipe", shell: true }
);
writeFileSync(join(dir, "package.json"), JSON.stringify({ type: "module" }));
writeFileSync(
  join(dir, "aim.js"),
  readFileSync(join(dir, "aim.js"), "utf8").replace(/from "\.\/geo"/g, 'from "./geo.js"')
);

const { computeAimShot } = await import("file://" + join(dir, "aim.js").replace(/\\/g, "/"));

let failures = 0;
function check(label, ok, detail) {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? " — " + detail : ""}`);
  if (!ok) failures++;
}

/** Meters per degree of latitude — exact for a pure north/south offset (same
 *  longitude), because the haversine formula's asin(sin(x)) collapses to x
 *  for these small angles. Used to compute an independent expected distance
 *  rather than re-deriving it from the code under test. */
const R = 6371000;
const METERS_PER_DEG_LAT = R * (Math.PI / 180);
function degLat(meters) {
  return meters / METERS_PER_DEG_LAT;
}
function closeEnough(actual, expected, tolerance = 0.05) {
  return Math.abs(actual - expected) <= tolerance;
}

const LNG = -121.9501; // fixed — every fixture below moves in latitude only

console.log("Distance to the aim point (player -> aim):");
{
  const player = { latitude: 36.5600, longitude: LNG };
  const aim = { latitude: 36.5600 + degLat(150), longitude: LNG }; // 150 m north
  const shot = computeAimShot(player, aim, null);
  check(
    "150 m north comes back as ~150 m",
    closeEnough(shot.toAimMeters, 150),
    `${shot.toAimMeters}`
  );
}

console.log("\nDistance remaining, aim -> green:");
{
  const aim = { latitude: 36.5600, longitude: LNG };
  const green = { latitude: 36.5600 + degLat(120), longitude: LNG }; // 120 m further north
  const shot = computeAimShot(null, aim, green);
  check(
    "left-to-green is ~120 m, independent of the player",
    closeEnough(shot.aimToGreenMeters, 120),
    `${shot.aimToGreenMeters}`
  );
  check("toAimMeters is null with no player fix, not 0", shot.toAimMeters === null, String(shot.toAimMeters));
}

console.log("\nAim point beyond the green (aiming through a dogleg) — must not be treated as an error:");
{
  const player = { latitude: 36.5600, longitude: LNG };
  const green = { latitude: 36.5600 + degLat(400), longitude: LNG }; // green 400 m out
  const aim = { latitude: 36.5600 + degLat(430), longitude: LNG }; // aim 430 m out — 30 m PAST the green
  const shot = computeAimShot(player, aim, green);
  check("shot to the (overshot) aim point is ~430 m", closeEnough(shot.toAimMeters, 430), `${shot.toAimMeters}`);
  check(
    "what's-left is a real positive ~30 m, not zero or negative",
    shot.aimToGreenMeters != null && shot.aimToGreenMeters > 0 && closeEnough(shot.aimToGreenMeters, 30),
    `${shot.aimToGreenMeters}`
  );
}

console.log("\nNo pinned green — what's-left must be unknowable, never a wrong number:");
{
  const player = { latitude: 36.5600, longitude: LNG };
  const aim = { latitude: 36.5600 + degLat(200), longitude: LNG };
  const shot = computeAimShot(player, aim, null);
  check("toAimMeters still computes", closeEnough(shot.toAimMeters, 200), `${shot.toAimMeters}`);
  check("aimToGreenMeters is null, not 0 or a stale number", shot.aimToGreenMeters === null, String(shot.aimToGreenMeters));
}

console.log(`\n${failures === 0 ? "All checks passed." : failures + " check(s) failed."}`);
process.exit(failures > 0 ? 1 : 0);
