/**
 * Pre-submission guard. Run this immediately before `eas build`.
 *
 * WHY THIS EXISTS
 * This project is a Rork workspace, and Rork writes to the same GitHub repo.
 * The single worst App Store problem this app had was `metro.config.js` wrapping
 * the build in `withRorkMetro`, whose Babel transformer rewrote app/_layout.tsx
 * to inject a PostHog analytics provider — in PRODUCTION builds, not just
 * development. That ships undisclosed third-party telemetry to
 * toolkit.rork.com, which is a Guideline 5.1.2(i) rejection and makes the
 * privacy manifest in app.json untrue.
 *
 * It was removed. But if the project is ever regenerated or reopened on
 * rork.com, that wrapper can come back, and the failure is silent: the app works
 * fine and the telemetry is invisible. Worse, the transformer only matches
 * POSIX paths, so on Windows the injection never happens locally — you cannot
 * catch it by testing on this machine.
 *
 * So this checks the source, and optionally the compiled bundle.
 *
 * USAGE, from expo/:
 *     node store/verify-release.mjs           # fast source checks
 *     node store/verify-release.mjs --bundle  # also export and scan the bundle
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const scanBundle = process.argv.includes("--bundle");

let failures = 0;
let warnings = 0;

function pass(label, detail) {
  console.log(`  PASS  ${label}${detail ? " — " + detail : ""}`);
}
function fail(label, detail) {
  console.log(`  FAIL  ${label}${detail ? " — " + detail : ""}`);
  failures += 1;
}
function warn(label, detail) {
  console.log(`  WARN  ${label}${detail ? " — " + detail : ""}`);
  warnings += 1;
}

function read(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

console.log("Source checks\n");

/* 1. The analytics injection ------------------------------------------------ */

/**
 * Comments are stripped before matching. metro.config.js deliberately explains
 * in prose why the Rork wrapper was removed, and naively grepping the file finds
 * that explanation and reports the very problem it documents.
 */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const metro = read("metro.config.js");
if (metro == null) {
  fail("metro.config.js is missing");
} else if (/withRorkMetro|@rork-ai\/toolkit-sdk/.test(stripComments(metro))) {
  fail(
    "metro.config.js wraps the build in the Rork toolkit",
    "its transformer injects PostHog analytics into PRODUCTION builds — remove the wrapper"
  );
} else {
  pass("metro.config.js does not wrap the build");
}

const pkgRaw = read("package.json");
const pkg = pkgRaw ? JSON.parse(pkgRaw) : null;
if (!pkg) {
  fail("package.json unreadable");
} else {
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const banned = ["@rork-ai/toolkit-sdk", "posthog-react-native"];
  const found = banned.filter((d) => d in deps);
  if (found.length) {
    fail("analytics packages are declared", found.join(", "));
  } else {
    pass("no analytics packages declared");
  }

  const unusedNative = ["expo-image-picker", "expo-blur", "expo-symbols", "zustand"];
  const stillThere = unusedNative.filter((d) => d in deps);
  if (stillThere.length) {
    warn("unused native modules are back", stillThere.join(", "));
  } else {
    pass("no unused native modules");
  }
}

if (existsSync(join("node_modules", "@rork-ai"))) {
  warn(
    "@rork-ai is still installed",
    "harmless while metro.config.js ignores it, but reinstall to drop it from the tree"
  );
} else {
  pass("@rork-ai is not installed");
}

/* 2. Identity and store config --------------------------------------------- */

const appRaw = read("app.json");
const app = appRaw ? JSON.parse(appRaw).expo : null;
if (!app) {
  fail("app.json unreadable");
} else {
  const bid = app.ios?.bundleIdentifier ?? "";
  if (/rork/i.test(bid) || bid === "") {
    fail("iOS bundle identifier", `"${bid}" — must be your own reverse-DNS, and it is permanent`);
  } else {
    pass("iOS bundle identifier", bid);
  }

  if (/rork/i.test(app.scheme ?? "")) {
    fail("URL scheme", `"${app.scheme}" collides with every other Rork-generated app`);
  } else {
    pass("URL scheme", app.scheme);
  }

  const routerPlugin = (app.plugins ?? []).find(
    (p) => Array.isArray(p) && p[0] === "expo-router"
  );
  if (routerPlugin && /rork\.com/.test(JSON.stringify(routerPlugin[1] ?? {}))) {
    fail("expo-router origin points at rork.com");
  } else {
    pass("expo-router origin is not a third party");
  }

  if (app.ios?.infoPlist?.ITSAppUsesNonExemptEncryption !== false) {
    warn("ITSAppUsesNonExemptEncryption is not declared false", "you will be asked every build");
  } else {
    pass("export compliance declared");
  }

  const pm = app.ios?.privacyManifests;
  if (!pm || Array.isArray(pm)) {
    fail("ios.privacyManifests", "must be an object, not an array or absent");
  } else {
    const types = (pm.NSPrivacyCollectedDataTypes ?? []).length;
    if (types < 6) {
      warn("privacy manifest declares few data types", `${types} — expected 6`);
    } else {
      pass("privacy manifest", `${types} data types declared`);
    }
  }

  if (!app.extra?.eas?.projectId) {
    fail("no EAS projectId", "run `eas init`");
  } else {
    pass("EAS project linked", app.extra.eas.projectId);
  }
}

/* 3. Lock files ------------------------------------------------------------- */

if (existsSync("bun.lock") && existsSync("package-lock.json")) {
  fail(
    "two lock files present",
    "EAS picks the package manager from whichever it finds; delete the stale one"
  );
} else if (existsSync("bun.lock")) {
  warn("bun.lock is the lock file", "make sure it lists the current dependencies");
} else {
  pass("single lock file", "package-lock.json");
}

/* 4. Secrets must not be committed ----------------------------------------- */

let leaked = 0;
function walk(dir, depth = 0) {
  if (depth > 4) return;
  for (const entry of readdirSync(dir)) {
    if (["node_modules", ".git", ".expo", "dist"].includes(entry)) continue;
    const p = join(dir, entry);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      walk(p, depth + 1);
      continue;
    }
    if (!/\.(json|ts|tsx|js|mjs|md)$/.test(entry)) continue;
    if (entry === "package-lock.json") continue;
    const body = read(p);
    if (!body) continue;
    // eas.json is committed, so a literal key in its env block is public.
    if (entry === "eas.json" && /EXPO_PUBLIC_\w+":\s*"[^"]{8,}"/.test(body)) {
      fail("eas.json contains a literal API key", "use `eas env:set` instead — this file is committed");
      leaked += 1;
    }
  }
}
walk(".");
if (leaked === 0) pass("no API keys in committed config");

/* 5. The compiled bundle --------------------------------------------------- */

if (scanBundle) {
  console.log("\nBundle scan (this exports a production build, ~1 min)\n");
  try {
    execFileSync("npx", ["expo", "export", "--platform", "ios", "--output-dir", ".expo-verify"], {
      stdio: "pipe",
      shell: true,
    });
  } catch (e) {
    fail("expo export failed", String(e.message).slice(0, 200));
  }

  const dir = join(".expo-verify", "_expo", "static", "js", "ios");
  if (!existsSync(dir)) {
    fail("no exported bundle found", dir);
  } else {
    const files = readdirSync(dir).filter((f) => f.endsWith(".js"));
    const body = files.map((f) => read(join(dir, f)) ?? "").join("\n");
    console.log(`  scanned ${files.length} file(s), ${(body.length / 1e6).toFixed(1)} MB\n`);

    for (const term of ["posthog", "toolkit.rork.com", "RorkAnalyticsProvider", "RorkRootLayoutWrapper"]) {
      const n = (body.toLowerCase().match(new RegExp(term.toLowerCase(), "g")) ?? []).length;
      if (n > 0) fail(`"${term}" is in the shipping bundle`, `${n} occurrence(s)`);
      else pass(`"${term}" absent`);
    }

    for (const term of ["EXPO_PUBLIC_GOLF_COURSE_API_KEY=", "Add your catalog key", "Add a weather key"]) {
      if (body.includes(term)) warn(`developer-facing copy present: "${term}"`);
    }

    if (!/Search 30,000\+ courses/.test(body)) {
      warn("app strings not found in the bundle", "the export may be incomplete");
    } else {
      pass("app code is present in the bundle");
    }
  }
}

console.log(
  `\n${failures === 0 ? "No blockers." : failures + " blocker(s)."}` +
    (warnings ? `  ${warnings} warning(s).` : "")
);
if (failures > 0) {
  console.log("\nDo not submit until the failures above are resolved.");
}
process.exit(failures > 0 ? 1 : 0);
