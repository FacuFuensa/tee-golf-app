/**
 * Creates and seeds the App Review demo account.
 *
 * Apple rejects account-gated apps whose reviewer lands in an empty shell
 * (Guideline 2.1(a)), so this builds an account that already looks like a
 * golfer who has been playing: a mapped 18-hole course with every green pinned,
 * a full bag, and three finished rounds so the Stats tab has something to show.
 *
 * It runs entirely through the public anon key, authenticated AS the demo user —
 * no service_role key needed, because every insert it makes is one the app's own
 * RLS policies already allow a golfer to make for themselves.
 *
 * Usage, from expo/:
 *   node store/seed-demo-account.mjs
 *
 * Safe to re-run: it signs in if the account already exists, and skips seeding
 * anything that is already there.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createClient } from "@supabase/supabase-js";

/**
 * Reads the gitignored credentials file. The demo password is kept out of the
 * repository because it is public — a published password would let anyone sign
 * in as the reviewer account and wipe the data seeded below.
 */
function credentialsFromFile() {
  const path = join(dirname(fileURLToPath(import.meta.url)), ".demo-credentials");
  try {
    const out = {};
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
    }
    return out;
  } catch {
    return {};
  }
}

const fileCreds = credentialsFromFile();

const SUPABASE_URL =
  process.env.EXPO_PUBLIC_SUPABASE_URL ?? "https://ilrkgprannppoyjibnrw.supabase.co";
const SUPABASE_ANON_KEY =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlscmtncHJhbm5wcG95amlibnJ3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIwNjE5MjgsImV4cCI6MjA5NzYzNzkyOH0.9JM4yG2E-ulil5obq5Xb_ADHdafQGO_vrxNKyN1jiqI";

/** These values go into App Store Connect → App Review Information. */
export const DEMO_EMAIL =
  process.env.TEE_DEMO_EMAIL ?? fileCreds.TEE_DEMO_EMAIL ?? "appreview@teegolf.app";
export const DEMO_PASSWORD = process.env.TEE_DEMO_PASSWORD ?? fileCreds.TEE_DEMO_PASSWORD;
const DEMO_NAME = "App Review";

if (!DEMO_PASSWORD) {
  console.error(
    "No demo password found.\n" +
      "Expected TEE_DEMO_PASSWORD in the environment, or in expo/store/.demo-credentials.\n" +
      "That file is gitignored on purpose — recreate it if you cloned this repo fresh."
  );
  process.exit(1);
}

/**
 * A fictional course — deliberately not a real club, so no trademark or
 * likeness question can attach to seeded demo data (Guideline 5.2).
 * Greens are laid out on a plausible plot so the satellite map looks sensible.
 */
const COURSE = {
  name: "Riverbend Links",
  city: "Riverbend",
  country: "United States",
  latitude: 36.5687,
  longitude: -121.9501,
};

const PARS = [4, 5, 4, 3, 4, 4, 3, 5, 4, 4, 3, 5, 4, 4, 3, 4, 5, 4];
const YARDAGES = [
  380, 512, 402, 168, 421, 395, 182, 534, 410, 388, 155, 520, 431, 404, 176, 398, 545, 415,
];

/** Spreads 18 greens over roughly a real course footprint around the anchor. */
function greenFor(index) {
  const ring = Math.floor(index / 6);
  const angle = ((index % 6) / 6) * Math.PI * 2 + ring * 0.4;
  const radius = 0.0045 + ring * 0.0032;
  return {
    lat: COURSE.latitude + Math.sin(angle) * radius,
    lng: COURSE.longitude + Math.cos(angle) * radius * 1.24,
  };
}

const STANDARD_BAG = [
  ["Driver", 230], ["3 Wood", 210], ["5 Wood", 195], ["Hybrid", 180],
  ["4 Iron", 170], ["5 Iron", 160], ["6 Iron", 150], ["7 Iron", 140],
  ["8 Iron", 130], ["9 Iron", 120], ["Pitching Wedge", 110],
  ["Gap Wedge", 95], ["Sand Wedge", 80], ["Lob Wedge", 65],
];
const YARDS_PER_METER = 1.0936133;

/** Three rounds of believable amateur scoring, newest last. */
const ROUNDS = [
  { daysAgo: 21, offsets: [1, 1, 0, 1, 2, 0, 1, 1, 1, 0, 1, 2, 1, 1, 0, 1, 1, 2] },
  { daysAgo: 12, offsets: [0, 1, 1, 0, 1, 1, 0, 1, 1, 1, 0, 1, 1, 0, 1, 1, 1, 1] },
  { daysAgo: 4,  offsets: [0, 0, 1, 0, 1, -1, 0, 1, 0, 1, 0, 1, 1, 0, 0, 1, 0, 1] },
];

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function die(step, error) {
  console.error(`\n✗ ${step}:`, error?.message ?? error);
  process.exit(1);
}

async function main() {
  console.log(`Seeding demo account ${DEMO_EMAIL} on ${SUPABASE_URL}\n`);

  // --- 1. Account -----------------------------------------------------------
  let session = null;
  const signIn = await supabase.auth.signInWithPassword({
    email: DEMO_EMAIL,
    password: DEMO_PASSWORD,
  });

  if (signIn.data?.session) {
    session = signIn.data.session;
    console.log("· account already exists — signed in");
  } else {
    const signUp = await supabase.auth.signUp({
      email: DEMO_EMAIL,
      password: DEMO_PASSWORD,
    });
    if (signUp.error) die("creating the account", signUp.error);
    if (!signUp.data.session) {
      die(
        "creating the account",
        "Supabase returned no session — email confirmation is switched on for this project. " +
          "Turn it off (Authentication → Providers → Email → Confirm email) or confirm this " +
          "address manually, then re-run."
      );
    }
    session = signUp.data.session;
    console.log("· account created");
  }

  const uid = session.user.id;

  // --- 2. Profile -----------------------------------------------------------
  const { error: profileErr } = await supabase
    .from("profiles")
    .upsert({ id: uid, display_name: DEMO_NAME, handicap: 14 }, { onConflict: "id" });
  if (profileErr) die("creating the profile", profileErr);
  console.log(`· profile "${DEMO_NAME}" ready`);

  // --- 3. Course + greens ---------------------------------------------------
  const { data: existingLibrary } = await supabase
    .from("user_courses")
    .select("course:courses(id,name)")
    .eq("profile_id", uid);

  const already = (existingLibrary ?? [])
    .map((r) => (Array.isArray(r.course) ? r.course[0] : r.course))
    .find((c) => c?.name === COURSE.name);

  let courseId = already?.id ?? null;

  if (courseId) {
    console.log("· course already seeded");
  } else {
    const { data: course, error: courseErr } = await supabase
      .from("courses")
      .insert({ ...COURSE, created_by: uid, source: "user" })
      .select()
      .single();
    if (courseErr) die("creating the course", courseErr);
    courseId = course.id;

    const holes = PARS.map((par, i) => {
      const g = greenFor(i);
      return {
        course_id: courseId,
        number: i + 1,
        par,
        yardage: YARDAGES[i],
        green_lat: g.lat,
        green_lng: g.lng,
      };
    });
    const { error: holesErr } = await supabase.from("holes").insert(holes);
    if (holesErr) die("creating the holes", holesErr);

    const { error: libErr } = await supabase
      .from("user_courses")
      .upsert({ profile_id: uid, course_id: courseId }, { onConflict: "profile_id,course_id" });
    if (libErr) die("saving the course to the library", libErr);

    console.log(`· course "${COURSE.name}" created with 18 greens pinned`);
  }

  const { data: holeRows, error: holeReadErr } = await supabase
    .from("holes")
    .select("id, number, par")
    .eq("course_id", courseId)
    .order("number");
  if (holeReadErr) die("reading the holes back", holeReadErr);

  // --- 4. Club bag ----------------------------------------------------------
  const { count: clubCount } = await supabase
    .from("clubs")
    .select("id", { count: "exact", head: true })
    .eq("profile_id", uid);

  if ((clubCount ?? 0) > 0) {
    console.log("· bag already seeded");
  } else {
    const clubs = STANDARD_BAG.map(([name, yards], i) => ({
      profile_id: uid,
      name,
      carry_meters: yards / YARDS_PER_METER,
      sort_order: i,
    }));
    const { error: clubErr } = await supabase.from("clubs").insert(clubs);
    if (clubErr) die("creating the bag", clubErr);
    console.log(`· bag seeded with ${clubs.length} clubs`);
  }

  // --- 5. Finished rounds with scores ---------------------------------------
  const { count: roundCount } = await supabase
    .from("rounds")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", uid);

  if ((roundCount ?? 0) > 0) {
    console.log("· rounds already seeded");
  } else {
    for (const spec of ROUNDS) {
      const started = new Date(Date.now() - spec.daysAgo * 86400_000);
      const finished = new Date(started.getTime() + 4 * 3600_000);
      const roundId = crypto.randomUUID();

      const { error: roundErr } = await supabase.from("rounds").insert({
        id: roundId,
        course_id: courseId,
        owner_id: uid,
        format: "stroke",
        is_multiplayer: false,
        started_at: started.toISOString(),
        finished_at: finished.toISOString(),
      });
      if (roundErr) die("creating a round", roundErr);

      const { error: rpErr } = await supabase
        .from("round_players")
        .insert({ round_id: roundId, profile_id: uid });
      if (rpErr) die("seating the player", rpErr);

      const scores = holeRows.map((h, i) => ({
        round_id: roundId,
        profile_id: uid,
        hole_id: h.id,
        strokes: h.par + spec.offsets[i],
        updated_at: finished.toISOString(),
      }));
      const { error: scoreErr } = await supabase.from("scores").insert(scores);
      if (scoreErr) die("recording scores", scoreErr);

      const total = scores.reduce((s, x) => s + x.strokes, 0);
      const par = holeRows.reduce((s, h) => s + h.par, 0);
      console.log(
        `· round ${spec.daysAgo}d ago: ${total} (${total - par > 0 ? "+" : ""}${total - par})`
      );
    }
  }

  console.log(`
────────────────────────────────────────────────
 Put these in App Store Connect → App Review Information

   Username:  ${DEMO_EMAIL}
   Password:  (the value in store/.demo-credentials)

 Sign in on a device once to confirm it works before
 you submit, and re-check it after any rejection.
────────────────────────────────────────────────`);
}

main().catch((e) => die("unexpected failure", e));
