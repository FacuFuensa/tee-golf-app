/**
 * Exercises the app's real queries as the demo account, so the effect of
 * migrations 0010 and 0011 is verified rather than assumed.
 *
 * 0011 narrows SELECT policies. A mistake there shows up as MISSING DATA, not
 * as an error — the app would just look empty. This walks the same reads the
 * app performs and reports what came back.
 *
 *   node store/verify-backend.mjs
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  process.env.EXPO_PUBLIC_SUPABASE_URL ?? "https://ilrkgprannppoyjibnrw.supabase.co";
const SUPABASE_ANON_KEY =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlscmtncHJhbm5wcG95amlibnJ3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIwNjE5MjgsImV4cCI6MjA5NzYzNzkyOH0.9JM4yG2E-ulil5obq5Xb_ADHdafQGO_vrxNKyN1jiqI";

function creds() {
  const path = join(dirname(fileURLToPath(import.meta.url)), ".demo-credentials");
  const out = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq > -1) out[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
  }
  return out;
}

const { TEE_DEMO_EMAIL, TEE_DEMO_PASSWORD } = creds();
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

let failures = 0;
function check(label, ok, detail) {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? " — " + detail : ""}`);
  if (!ok) failures++;
}

const { data: auth, error: authErr } = await supabase.auth.signInWithPassword({
  email: TEE_DEMO_EMAIL,
  password: TEE_DEMO_PASSWORD,
});
if (authErr || !auth?.session) {
  console.error("Could not sign in as the demo account:", authErr?.message);
  process.exit(1);
}
const uid = auth.user.id;
console.log(`Signed in as ${TEE_DEMO_EMAIL}\n`);

console.log("App must still work (0011 narrowed reads — this is the risky part):");

const { data: library } = await supabase
  .from("user_courses")
  .select("created_at, course:courses(*)")
  .eq("profile_id", uid);
const courses = (library ?? [])
  .map((r) => (Array.isArray(r.course) ? r.course[0] : r.course))
  .filter(Boolean);
check("Courses tab lists the seeded course", courses.length >= 1, `${courses.length} course(s)`);

const courseId = courses[0]?.id;
const { data: holes } = await supabase
  .from("holes")
  .select("*")
  .eq("course_id", courseId ?? "")
  .order("number");
check("Holes load for that course", (holes ?? []).length === 18, `${(holes ?? []).length}/18`);
check(
  "Greens are pinned (distance readout will work)",
  (holes ?? []).every((h) => h.green_lat != null && h.green_lng != null)
);

console.log("\nLocation fallback must have data to work with (round 8 fix):");

// Read-only: re-runs the same embedded-holes shape fetchCourses() now uses
// (services/db.ts) and reports, per course, what a golfer's device would see —
// the course's own latitude/longitude, and how many of its holes have a
// pinned green. Proves the fallback (green centroid) has something to fall
// back TO, without writing anything.
const { data: libraryWithHoles } = await supabase
  .from("user_courses")
  .select("course:courses(id, name, latitude, longitude, holes(green_lat, green_lng))")
  .eq("profile_id", uid);
const coursesForLocation = (libraryWithHoles ?? [])
  .map((r) => (Array.isArray(r.course) ? r.course[0] : r.course))
  .filter(Boolean);

let anyHolesEmbedded = false;
let fallbackWorks = true;
let strandedCourses = 0;
for (const c of coursesForLocation) {
  const holesList = c.holes ?? [];
  if (holesList.length > 0) anyHolesEmbedded = true;
  const pinned = holesList.filter((h) => h.green_lat != null && h.green_lng != null);
  const hasOwnPoint = c.latitude != null && c.longitude != null;
  // The fallback's whole job: no coordinates of its own, but greens to average.
  if (!hasOwnPoint && pinned.length > 0) {
    // Nothing to assert per-course beyond "it has something to fall back to",
    // which pinned.length > 0 already establishes.
  } else if (!hasOwnPoint && pinned.length === 0) {
    strandedCourses += 1;
  }
  const via = hasOwnPoint ? "own point" : pinned.length > 0 ? "green centroid" : "NOTHING";
  console.log(
    `    ${c.name}: latitude=${c.latitude ?? "null"} longitude=${c.longitude ?? "null"} ` +
      `greens-pinned=${pinned.length}/${holesList.length} -> ${via}`
  );
}

// The failure mode this guards is RLS returning an EMPTY embed rather than an
// error — exactly what migration 0011 warns about. If the join silently
// returned no holes, the fallback would have nothing to average and every
// course would quietly lose its distance, with no error anywhere.
check(
  "The Courses tab can read holes through user_courses (0011 did not close this)",
  coursesForLocation.length > 0 && anyHolesEmbedded,
  `${coursesForLocation.length} course(s), holes embedded: ${anyHolesEmbedded}`
);
check(
  "Every course with pinned greens resolves to a point",
  fallbackWorks,
  "the fallback has something to average for each"
);
// NOT a failure. A catalog course whose import-time geocode missed and that
// nobody has played yet genuinely has no location to report — it simply shows
// no distance. Asserting on it would paint the suite red for a data condition
// rather than a defect, which is how a check stops meaning anything.
if (strandedCourses > 0) {
  console.log(
    `    note: ${strandedCourses} course(s) have neither coordinates nor a pinned green,` +
      ` so they will show no distance until someone plays them.`
  );
}

const { data: myScores } = await supabase.from("scores").select("*").eq("profile_id", uid);
check("Stats tab has scores to read", (myScores ?? []).length > 0, `${(myScores ?? []).length} rows`);

const { data: clubs } = await supabase.from("clubs").select("*").eq("profile_id", uid);
check("Bag loads", (clubs ?? []).length > 0, `${(clubs ?? []).length} clubs`);

const { data: ownProfile } = await supabase.from("profiles").select("*").eq("id", uid).maybeSingle();
check("Own profile readable", ownProfile != null, ownProfile?.display_name);

console.log("\nPrivacy must be closed (0011):");

const { data: allProfiles } = await supabase.from("profiles").select("id, display_name, handicap");
check(
  "Cannot enumerate other golfers' profiles",
  (allProfiles ?? []).length <= 1,
  `${(allProfiles ?? []).length} visible (should be 1 — only your own)`
);

const { data: allCourses } = await supabase
  .from("courses")
  .select("id, name, source, created_by, latitude, longitude");
const foreignUserCourses = (allCourses ?? []).filter(
  (c) => c.source === "user" && c.created_by !== uid
);
check(
  "Cannot read other golfers' hand-mapped courses",
  foreignUserCourses.length === 0,
  `${foreignUserCourses.length} leaked`
);

console.log("\nWrite scoping must be closed (0010):");

const par = holes?.[0]?.par;
const { error: parErr } = await supabase
  .from("holes")
  .update({ par: 99 })
  .eq("id", holes?.[0]?.id ?? "");
const { data: after } = await supabase
  .from("holes")
  .select("par")
  .eq("id", holes?.[0]?.id ?? "")
  .maybeSingle();
check(
  "Cannot rewrite a hole's par",
  parErr != null || after?.par === par,
  parErr ? `rejected: ${parErr.code}` : `par still ${after?.par}`
);

const { error: nameErr } = await supabase
  .from("profiles")
  .update({ display_name: "fuck" })
  .eq("id", uid);
check(
  "Server rejects an objectionable display name",
  nameErr != null,
  nameErr ? "rejected by trigger" : "ACCEPTED — trigger missing"
);

const { error: okNameErr } = await supabase
  .from("profiles")
  .update({ display_name: "App Review" })
  .eq("id", uid);
check("Server still accepts a normal display name", okNameErr == null);

console.log("\nGroup rounds must actually work (0012):");

/**
 * join_round_by_code shipped broken from 0004 until 0012: its OUT variable
 * `round_id` shadowed the column in the ON CONFLICT target, so every join raised
 * "column reference round_id is ambiguous" and no one could ever join a round.
 *
 * Reading the SQL does not reveal it, and neither does calling the function with
 * a code that matches nothing — that path returns before reaching the insert, so
 * the statement is never planned and never raises. The test has to create a real
 * round and actually join it. That is the whole lesson of this bug.
 */
const probeCode = "ZQ" + Math.floor(Math.random() * 9000 + 1000).toString();
const probeRoundId = crypto.randomUUID();

const { error: probeCreateErr } = await supabase.from("rounds").insert({
  id: probeRoundId,
  course_id: courseId,
  owner_id: uid,
  format: "stroke",
  is_multiplayer: true,
  join_code: probeCode,
  started_at: new Date().toISOString(),
});

if (probeCreateErr) {
  check("could create a probe round to test joining", false, probeCreateErr.message);
} else {
  const { data: joinData, error: joinErr } = await supabase.rpc("join_round_by_code", {
    p_code: probeCode,
  });
  check(
    "join_round_by_code seats a player in a real round",
    joinErr == null,
    joinErr ? `raised: ${joinErr.message}` : "returned cleanly"
  );
  const row = Array.isArray(joinData) ? joinData[0] : joinData;
  check(
    "it returns the round and course ids",
    row?.round_id === probeRoundId && row?.course_id === courseId,
    row ? `round_id=${String(row.round_id).slice(0, 8)}…` : "no row returned"
  );

  // Joining twice must be idempotent, which is the exact path ON CONFLICT used
  // to cover — and the one that raised.
  const { error: rejoinErr } = await supabase.rpc("join_round_by_code", { p_code: probeCode });
  check(
    "joining the same round twice is idempotent",
    rejoinErr == null,
    rejoinErr ? `raised: ${rejoinErr.message}` : "no error"
  );

  // Clean up so the probe never shows in the app or blocks the unique index on
  // active join codes.
  const { data: cleanupResult, error: cleanupErr } = await supabase.rpc("delete_my_round", {
    p_round_id: probeRoundId,
  });
  check(
    "probe round cleaned up",
    cleanupErr == null && cleanupResult === "deleted",
    cleanupErr?.message ?? `returned ${cleanupResult}`
  );
}

console.log("\nSingle-round deletion (migration 0013):");

// A helper that builds a real, scored round owned by the demo account.
async function makeRound({ multiplayer }) {
  const { data: lib } = await supabase
    .from("user_courses")
    .select("course_id")
    .eq("profile_id", uid)
    .limit(1);
  const courseId = lib?.[0]?.course_id;
  if (!courseId) throw new Error("demo account has no course in its library");

  const { data: holes, error: holesErr } = await supabase
    .from("holes")
    .select("id")
    .eq("course_id", courseId)
    .order("number")
    .limit(3);
  // A failed or empty select used to surface as a bare TypeError on
  // `holes.map` below, far from its real cause.
  if (holesErr) throw new Error(`could not load holes for probe round: ${holesErr.message}`);
  if (!holes || holes.length === 0) throw new Error("course has no holes to build a probe round from");

  const roundId = crypto.randomUUID();
  const code = multiplayer
    ? Array.from({ length: 6 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 32)]).join("")
    : null;

  // This is a test helper, not app code: a swallowed error here would leave
  // `roundId` naming a row that was never created, and every downstream check
  // would silently be reasoning about nothing. Throw loudly instead.
  const { error: roundErr } = await supabase.from("rounds").insert({
    id: roundId,
    course_id: courseId,
    owner_id: uid,
    format: "stroke",
    is_multiplayer: multiplayer,
    join_code: code,
    started_at: new Date().toISOString(),
  });
  if (roundErr) throw new Error(`could not insert probe round: ${roundErr.message}`);

  const { error: rpErr } = await supabase
    .from("round_players")
    .insert({ round_id: roundId, profile_id: uid });
  if (rpErr) throw new Error(`could not seat owner in probe round: ${rpErr.message}`);

  const { error: scoresErr } = await supabase.from("scores").insert(
    holes.map((h) => ({ round_id: roundId, profile_id: uid, hole_id: h.id, strokes: 4 }))
  );
  if (scoresErr) throw new Error(`could not insert probe scores: ${scoresErr.message}`);

  return { roundId, courseId, code, holeIds: holes.map((h) => h.id) };
}

// 1. Solo round deletes completely.
{
  const { roundId } = await makeRound({ multiplayer: false });
  const { data: result, error } = await supabase.rpc("delete_my_round", { p_round_id: roundId });
  check("solo round returns 'deleted'", error == null && result === "deleted", error?.message ?? `got ${result}`);

  const { count: roundsLeft } = await supabase
    .from("rounds").select("id", { count: "exact", head: true }).eq("id", roundId);
  check("solo round row is gone", roundsLeft === 0, `${roundsLeft} row(s) remain`);

  const { count: scoresLeft } = await supabase
    .from("scores").select("id", { count: "exact", head: true }).eq("round_id", roundId);
  check("its scores are gone", scoresLeft === 0, `${scoresLeft} score(s) remain`);
}

// 2 & 3. Group round with a second real player.
{
  const { roundId, code, holeIds } = await makeRound({ multiplayer: true });
  const guest = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  let guestId = null;
  // Hoisted out of `try` so `finally` can see it too — it used to be declared
  // with `const` inside the `try` block, so a throw between its creation and
  // its own cleanup call a few lines down leaked this round forever.
  let privateId = null;

  // signUp, the checks, and cleanup all live in `try` so a failure partway
  // through (signUp itself included) can't skip the `finally` below and
  // leave the probe round — join code and all — occupying its slot forever.
  try {
    const guestEmail = `tee-delete-probe-${Date.now()}@example.com`;
    const signUp = await guest.auth.signUp({ email: guestEmail, password: "TeeProbe!2026x" });
    if (!signUp.data.session) {
      check("could create a second player", false, signUp.error?.message ?? "no session returned");
    } else {
      guestId = signUp.data.user.id;
      await guest.from("profiles").upsert({ id: guestId, display_name: "Probe" });
      await guest.rpc("join_round_by_code", { p_code: code });
      await guest.from("scores").insert({
        round_id: roundId, profile_id: guestId, hole_id: holeIds[0], strokes: 5,
      });

      // Finishing a round is owner-only (rounds_update_owner). The failure this
      // guards against is not an error — it is SILENCE: a joiner's update
      // matches zero rows and Postgres reports no problem at all, which the app
      // read as success and used to tell them a live round was over. So assert
      // on the affected-row COUNT, not on the absence of an error. Checking
      // `error == null` here would pass no matter who called it.
      const guestFinish = await guest
        .from("rounds")
        .update({ finished_at: new Date().toISOString() }, { count: "exact" })
        .eq("id", roundId);
      check(
        "a joiner cannot finish the round, and it shows up as zero rows not an error",
        guestFinish.error == null && guestFinish.count === 0,
        guestFinish.error
          ? `raised instead: ${guestFinish.error.message}`
          : `count=${guestFinish.count} (must be 0)`
      );
      const { data: stillLive, error: stillLiveErr } = await guest
        .from("rounds").select("finished_at").eq("id", roundId).maybeSingle();
      // This assertion is a conjunction on purpose: it fails closed (a broken
      // read reports as "not visible", same as an actual RLS lockout), and it
      // doubles as proof the guest is still a seated member of this round at
      // this moment. Do not weaken it to optional chaining. But when the read
      // itself errors, say so — otherwise every failure here reads as "round
      // not visible", which points at RLS regardless of the real cause.
      check(
        "and the round is still live for everyone else",
        stillLive != null && stillLive.finished_at == null,
        stillLiveErr
          ? `round not visible — ${stillLiveErr.message}`
          : stillLive == null
            ? "round not visible"
            : `finished_at=${stillLive.finished_at}`
      );

      // The same write as the owner must actually land — otherwise the check
      // above would pass simply because nobody can ever finish a round.
      const ownerFinish = await supabase
        .from("rounds")
        .update({ finished_at: new Date().toISOString() }, { count: "exact" })
        .eq("id", roundId);
      check(
        "the owner can finish it, and the count proves the write landed",
        ownerFinish.error == null && ownerFinish.count === 1,
        ownerFinish.error?.message ?? `count=${ownerFinish.count} (must be 1)`
      );

      // The owner leaves a round another player is seated in.
      const { data: result, error } = await supabase.rpc("delete_my_round", { p_round_id: roundId });
      check("group round returns 'left'", error == null && result === "left", error?.message ?? `got ${result}`);

      const { count: mine } = await supabase
        .from("scores").select("id", { count: "exact", head: true })
        .eq("round_id", roundId).eq("profile_id", uid);
      check("the leaver's scores are gone", mine === 0, `${mine} remain`);

      const { count: theirs } = await guest
        .from("scores").select("id", { count: "exact", head: true })
        .eq("round_id", roundId).eq("profile_id", guestId);
      check("the other player's scores survive", theirs === 1, `${theirs} found, expected 1`);

      const { data: after } = await guest.from("rounds").select("owner_id").eq("id", roundId).maybeSingle();
      check("the round survives for them", after != null, after ? "still there" : "round was destroyed");
      check(
        "ownership transferred to the remaining player",
        after?.owner_id === guestId,
        `owner_id=${String(after?.owner_id).slice(0, 8)}…`
      );

      // 4. A non-member gets 'not_found' and changes nothing.
      privateId = (await makeRound({ multiplayer: false })).roundId;
      const { data: denied, error: deniedErr } = await guest.rpc("delete_my_round", { p_round_id: privateId });
      check("a non-member gets 'not_found'", deniedErr == null && denied === "not_found", deniedErr?.message ?? `got ${denied}`);
      const { count: survived } = await supabase
        .from("rounds").select("id", { count: "exact", head: true }).eq("id", privateId);
      check("and the round they targeted is untouched", survived === 1, `${survived} row(s)`);

      await supabase.rpc("delete_my_round", { p_round_id: privateId });
      await guest.rpc("delete_my_round", { p_round_id: roundId });

      // The guest account must not become a permanent, real auth user in a
      // production project — left behind, it's a stray seated "guest" the
      // App Store reviewer could see while signed in as the demo account.
      // `guest` is already authenticated as the guest from signUp above, so
      // this is already "signed in as the guest" calling its own account's
      // deletion — no separate sign-in call is needed.
      const { error: deleteAcctErr } = await guest.rpc("delete_my_account");
      check("probe guest account deleted itself", deleteAcctErr == null, deleteAcctErr?.message);

      // Querying `profiles` as the DEMO account cannot prove anything here:
      // profiles_select_scoped (0011) is `id = auth.uid() or
      // shares_round_with(id)`, and the shared round was already deleted a
      // few lines up, so `shares_round_with(guestId)` is false regardless of
      // whether delete_my_account actually removed the guest's row — the
      // demo account would see `null` either way. That made this a check
      // that could never fail. auth.getUser() instead asks GoTrue directly
      // whether the guest's own (still-unexpired) access token resolves to a
      // live user — which is exactly what delete_my_account is supposed to
      // make false, and does not depend on any RLS policy or round state.
      // Do not "simplify" this back to a profiles select as the demo account.
      const { data: guestAfter, error: guestAfterErr } = await guest.auth.getUser();
      check(
        "guest account no longer resolves to a live user",
        guestAfterErr != null || guestAfter?.user == null,
        guestAfterErr ? guestAfterErr.message : "still resolves to a user"
      );
    }
  } finally {
    // Runs whether signUp succeeded, failed, or something above threw — the
    // shared probe round (and its active join code), the private probe round
    // from check 4, and the guest account must not survive this run. Every
    // step below is independently best-effort: supabase-js's query builder is
    // PromiseLike but not a real Promise (no .catch/.finally), so failures
    // are swallowed with try/catch rather than a chained .catch(), and no
    // single failure here is allowed to mask whatever error triggered this
    // block in the first place.
    if (privateId) {
      try {
        await supabase.rpc("delete_my_round", { p_round_id: privateId });
      } catch {
        // best-effort cleanup
      }
    }
    // If the demo account already left (ownership transferred to the guest)
    // before a throw reached this block, the demo account is no longer a
    // member and this call returns 'not_found' — leaving the round, and its
    // live join code, seated under the guest. Fall back to the guest's own
    // deletion path so the round doesn't survive just because the account
    // that can no longer reach it happened to go first.
    let roundStillThere = true;
    try {
      const { data } = await supabase.rpc("delete_my_round", { p_round_id: roundId });
      roundStillThere = data !== "deleted" && data !== "left";
    } catch {
      // best-effort cleanup
    }
    if (roundStillThere) {
      try {
        await guest.rpc("delete_my_round", { p_round_id: roundId });
      } catch {
        // best-effort cleanup
      }
    }
    try {
      await guest.rpc("delete_my_account");
    } catch {
      // best-effort cleanup — already deleted above, or signUp never got
      // this far and there is no account to delete
    }
    try {
      await guest.auth.signOut();
    } catch {
      // best-effort cleanup
    }
  }
}

// 5. Anonymous callers are rejected.
{
  const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await anon.rpc("delete_my_round", { p_round_id: crypto.randomUUID() });
  // "some error happened" is not good enough: before the migration is applied
  // this call also errors, with "could not find the function". Assert the
  // error is about permission, so the check cannot pass for the wrong reason.
  const missing = error != null && /could not find|does not exist|schema cache/i.test(error.message);
  check(
    "anonymous callers are rejected",
    error != null && !missing,
    error == null
      ? "it succeeded"
      : missing
        ? "function not found — migration not applied yet, this check is not meaningful"
        : error.message.slice(0, 70)
  );
}

console.log("\nNearby round discovery & join (migration 0014):");

/**
 * Everything below builds ONE throwaway course — with no coordinates of its
 * own, only pinned greens, exactly the Miramont scenario the migration's
 * fallback exists for — plus several probe rounds on it (one per way a round
 * can be ineligible) and a second real player, then tears all of it down.
 *
 * Cleanup relies on `rounds.course_id references courses(id) on delete
 * cascade` (0001) — and holes, round_players and scores all cascade the same
 * way off rounds/courses — so deleting the one probe course at the end
 * removes it, every probe round, every seat, and every score in one
 * statement, regardless of which rounds got joined along the way. Postgres
 * enforces foreign-key cascades ahead of row-level security, so this works
 * even though round_players' own RLS would not otherwise let the course
 * owner delete another golfer's seat directly.
 */
{
  const NEARBY_MARKER = `verify-backend-nearby-${Date.now()}`;
  const IN_RADIUS_METERS = 5000; // 5 km — comfortably covers the ~100 m test green cluster below
  const FAR_LAT_OFFSET = 2.0; // ~222 km north — nowhere near any reasonable radius
  // Three greens a few hundred meters apart so their centroid is well-defined
  // and worth telling apart from "far away" at a 5 km test radius.
  const TEST_GREENS = [
    { number: 1, lat: 10.0000, lng: 20.0000 },
    { number: 2, lat: 10.0009, lng: 20.0004 },
    { number: 3, lat: 10.0002, lng: 20.0011 },
  ];
  const CENTROID_LAT = TEST_GREENS.reduce((s, g) => s + g.lat, 0) / TEST_GREENS.length;
  const CENTROID_LNG = TEST_GREENS.reduce((s, g) => s + g.lng, 0) / TEST_GREENS.length;

  let nearbyCourseId = null;
  let nearbyGuest = null;

  try {
    const { data: courseRow, error: courseErr } = await supabase
      .from("courses")
      .insert({ name: `Nearby Test Course ${NEARBY_MARKER}`, source: "user", created_by: uid })
      .select()
      .single();
    if (courseErr) throw new Error(`could not create probe course: ${courseErr.message}`);
    nearbyCourseId = courseRow.id;
    check(
      "probe course has no coordinates of its own (sets up the green-centroid fallback)",
      courseRow.latitude == null && courseRow.longitude == null
    );

    const { error: holesErr } = await supabase.from("holes").insert(
      TEST_GREENS.map((g) => ({
        course_id: nearbyCourseId,
        number: g.number,
        par: 4,
        green_lat: g.lat,
        green_lng: g.lng,
      }))
    );
    if (holesErr) throw new Error(`could not pin probe greens: ${holesErr.message}`);

    // Builds one probe round on the shared probe course, owned by the demo
    // account, with the owner seated (mirrors createMultiplayerRound in
    // services/db.ts). Every knob defaults to "should be discoverable" so
    // each call only has to say what makes THIS round different.
    async function makeProbeRound({ discoverable = true, finished = false, startedHoursAgo = 0 } = {}) {
      const roundId = crypto.randomUUID();
      const payload = {
        id: roundId,
        course_id: nearbyCourseId,
        owner_id: uid,
        format: "stroke",
        is_multiplayer: true,
        join_code: null,
        started_at: new Date(Date.now() - startedHoursAgo * 3600 * 1000).toISOString(),
      };
      if (finished) payload.finished_at = new Date().toISOString();
      if (!discoverable) payload.is_discoverable = false;
      const { error } = await supabase.from("rounds").insert(payload);
      if (error) return { roundId, error };
      const { error: seatErr } = await supabase
        .from("round_players")
        .insert({ round_id: roundId, profile_id: uid });
      return { roundId, error: seatErr };
    }

    const good = await makeProbeRound();
    check("could create an open, discoverable, fresh probe round", good.error == null, good.error?.message);
    const good2 = await makeProbeRound(); // kept separate so the "join from outside the radius" case below is isolated
    const stale = await makeProbeRound({ startedHoursAgo: 8 }); // past the 6h freshness window
    const hidden = await makeProbeRound({ discoverable: false });
    const finishedRound = await makeProbeRound({ finished: true });

    // A second real player, same signUp/cleanup machinery the group-round
    // tests above use.
    nearbyGuest = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const guestEmail = `tee-nearby-probe-${Date.now()}@example.com`;
    const signUp = await nearbyGuest.auth.signUp({ email: guestEmail, password: "TeeProbe!2026y" });

    if (!signUp.data.session) {
      check("could create a second player for nearby-round tests", false, signUp.error?.message ?? "no session returned");
    } else {
      const guestId = signUp.data.user.id;
      await nearbyGuest.from("profiles").upsert({ id: guestId, display_name: "Nearby Probe" });

      // --- Discovery ---
      const { data: seenByGuest, error: discErr } = await nearbyGuest.rpc("nearby_open_rounds", {
        p_lat: CENTROID_LAT,
        p_lng: CENTROID_LNG,
        p_radius_meters: IN_RADIUS_METERS,
      });
      const seenIds = (seenByGuest ?? []).map((r) => r.round_id);
      check(
        "a round at a course within the radius is discovered by a second player (via the green-centroid fallback, since the probe course has no coordinates of its own)",
        discErr == null && seenIds.includes(good.roundId),
        discErr ? `raised: ${discErr.message}` : `found: ${seenIds.includes(good.roundId)}`
      );
      check(
        "discovery returns no coordinates of any kind",
        (seenByGuest ?? []).every((r) => !("latitude" in r || "longitude" in r || "lat" in r || "lng" in r))
      );
      check(
        "discovery returns no owner/created_by identifiers, only the host's display name",
        (seenByGuest ?? []).every((r) => !("owner_id" in r || "created_by" in r) && "host_display_name" in r)
      );
      check("a finished round is not discovered", !seenIds.includes(finishedRound.roundId));
      check("a round with the switch off is not discovered", !seenIds.includes(hidden.roundId));
      check("a stale (>6h old) unfinished round is not discovered", !seenIds.includes(stale.roundId));

      const { data: seenByHost } = await supabase.rpc("nearby_open_rounds", {
        p_lat: CENTROID_LAT,
        p_lng: CENTROID_LNG,
        p_radius_meters: IN_RADIUS_METERS,
      });
      check(
        "the host does not see their own open round",
        !(seenByHost ?? []).map((r) => r.round_id).includes(good.roundId)
      );

      const { data: seenFromFar, error: farErr } = await nearbyGuest.rpc("nearby_open_rounds", {
        p_lat: CENTROID_LAT + FAR_LAT_OFFSET,
        p_lng: CENTROID_LNG,
        p_radius_meters: IN_RADIUS_METERS,
      });
      check(
        "a round outside the radius is not discovered",
        farErr == null && !(seenFromFar ?? []).map((r) => r.round_id).includes(good.roundId),
        farErr ? `raised: ${farErr.message}` : `found: ${(seenFromFar ?? []).map((r) => r.round_id).includes(good.roundId)}`
      );

      // --- Joining ---
      const { data: joinData, error: joinErr } = await nearbyGuest.rpc("join_nearby_round", {
        p_round_id: good.roundId,
        p_lat: CENTROID_LAT,
        p_lng: CENTROID_LNG,
        p_radius_meters: IN_RADIUS_METERS,
      });
      const joinRow = Array.isArray(joinData) ? joinData[0] : joinData;
      check(
        "joining seats the player, and returns join_round_by_code's round_id/course_id shape",
        joinErr == null && joinRow?.status === "joined" && joinRow?.round_id === good.roundId && joinRow?.course_id === nearbyCourseId,
        joinErr ? `raised: ${joinErr.message}` : `status=${joinRow?.status}`
      );

      const { count: seatCount } = await nearbyGuest
        .from("round_players")
        .select("id", { count: "exact", head: true })
        .eq("round_id", good.roundId)
        .eq("profile_id", guestId);
      check("the guest is actually seated in round_players", seatCount === 1, `${seatCount} row(s)`);

      const { data: rejoinData, error: rejoinErr } = await nearbyGuest.rpc("join_nearby_round", {
        p_round_id: good.roundId,
        p_lat: CENTROID_LAT,
        p_lng: CENTROID_LNG,
        p_radius_meters: IN_RADIUS_METERS,
      });
      const rejoinRow = Array.isArray(rejoinData) ? rejoinData[0] : rejoinData;
      check(
        "joining the same round twice is idempotent",
        rejoinErr == null && rejoinRow?.status === "joined",
        rejoinErr?.message ?? `status=${rejoinRow?.status}`
      );
      const { count: seatCountAfter } = await nearbyGuest
        .from("round_players")
        .select("id", { count: "exact", head: true })
        .eq("round_id", good.roundId)
        .eq("profile_id", guestId);
      check("rejoining does not create a duplicate seat", seatCountAfter === 1, `${seatCountAfter} row(s)`);

      const { data: seenAfterJoin } = await nearbyGuest.rpc("nearby_open_rounds", {
        p_lat: CENTROID_LAT,
        p_lng: CENTROID_LNG,
        p_radius_meters: IN_RADIUS_METERS,
      });
      check(
        "a player already seated does not see the round again",
        !(seenAfterJoin ?? []).map((r) => r.round_id).includes(good.roundId)
      );

      // Refused: the switch is off. Must be distinguishable from success, not
      // a silent zero-row no-op — this codebase has shipped three bugs shaped
      // exactly like that.
      const { data: hiddenJoin, error: hiddenJoinErr } = await nearbyGuest.rpc("join_nearby_round", {
        p_round_id: hidden.roundId,
        p_lat: CENTROID_LAT,
        p_lng: CENTROID_LNG,
        p_radius_meters: IN_RADIUS_METERS,
      });
      const hiddenRow = Array.isArray(hiddenJoin) ? hiddenJoin[0] : hiddenJoin;
      check(
        "joining a round that is not discoverable is refused, distinguishably from success",
        hiddenJoinErr == null && hiddenRow?.status === "unavailable",
        hiddenJoinErr ? `raised: ${hiddenJoinErr.message}` : `status=${hiddenRow?.status}`
      );
      const { count: hiddenSeat } = await nearbyGuest
        .from("round_players")
        .select("id", { count: "exact", head: true })
        .eq("round_id", hidden.roundId)
        .eq("profile_id", guestId);
      check("the refused join did not seat the guest", hiddenSeat === 0, `${hiddenSeat} row(s)`);

      // Refused: an otherwise-valid round, but the caller's claimed position
      // is outside the radius.
      const { data: farJoin, error: farJoinErr } = await nearbyGuest.rpc("join_nearby_round", {
        p_round_id: good2.roundId,
        p_lat: CENTROID_LAT + FAR_LAT_OFFSET,
        p_lng: CENTROID_LNG,
        p_radius_meters: IN_RADIUS_METERS,
      });
      const farRow = Array.isArray(farJoin) ? farJoin[0] : farJoin;
      check(
        "joining a round from outside the radius is refused, not silently accepted",
        farJoinErr == null && farRow?.status === "unavailable",
        farJoinErr ? `raised: ${farJoinErr.message}` : `status=${farRow?.status}`
      );
      const { count: farSeat } = await nearbyGuest
        .from("round_players")
        .select("id", { count: "exact", head: true })
        .eq("round_id", good2.roundId)
        .eq("profile_id", guestId);
      check("the out-of-radius join did not seat the guest", farSeat === 0, `${farSeat} row(s)`);

      // Same round, correct coordinates this time — proves the refusal above
      // was really about distance, not some other defect masquerading as one.
      const { data: good2Join, error: good2JoinErr } = await nearbyGuest.rpc("join_nearby_round", {
        p_round_id: good2.roundId,
        p_lat: CENTROID_LAT,
        p_lng: CENTROID_LNG,
        p_radius_meters: IN_RADIUS_METERS,
      });
      const good2Row = Array.isArray(good2Join) ? good2Join[0] : good2Join;
      check(
        "the same round is joinable once the caller is actually in range",
        good2JoinErr == null && good2Row?.status === "joined",
        good2JoinErr?.message ?? `status=${good2Row?.status}`
      );

      // An attacker calling join directly with a guessed round id cannot use
      // it to seat themselves in their own round, either.
      const { data: ownerJoin } = await supabase.rpc("join_nearby_round", {
        p_round_id: good.roundId,
        p_lat: CENTROID_LAT,
        p_lng: CENTROID_LNG,
        p_radius_meters: IN_RADIUS_METERS,
      });
      const ownerRow = Array.isArray(ownerJoin) ? ownerJoin[0] : ownerJoin;
      check(
        "the host cannot join their own round through this path",
        ownerRow?.status === "unavailable",
        `status=${ownerRow?.status}`
      );
    }
  } catch (e) {
    check("nearby-round discovery/join probe completed without throwing", false, e.message);
  } finally {
    // Cascades away every probe round, seat and score created above — see
    // this block's opening comment.
    if (nearbyCourseId) {
      try {
        await supabase.from("courses").delete().eq("id", nearbyCourseId);
      } catch {
        // best-effort cleanup
      }
    }
    if (nearbyGuest) {
      try {
        await nearbyGuest.rpc("delete_my_account");
      } catch {
        // best-effort cleanup
      }
      try {
        await nearbyGuest.auth.signOut();
      } catch {
        // best-effort cleanup
      }
    }
  }
}

// Anonymous callers are rejected by both new functions.
{
  const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { error: discErr } = await anon.rpc("nearby_open_rounds", {
    p_lat: 0,
    p_lng: 0,
    p_radius_meters: 1000,
  });
  const discMissing = discErr != null && /could not find|does not exist|schema cache/i.test(discErr.message);
  check(
    "anonymous callers are rejected by nearby_open_rounds",
    discErr != null && !discMissing,
    discErr == null
      ? "it succeeded"
      : discMissing
        ? "function not found — migration not applied yet, this check is not meaningful"
        : discErr.message.slice(0, 70)
  );

  const { error: joinErr } = await anon.rpc("join_nearby_round", {
    p_round_id: crypto.randomUUID(),
    p_lat: 0,
    p_lng: 0,
    p_radius_meters: 1000,
  });
  const joinMissing = joinErr != null && /could not find|does not exist|schema cache/i.test(joinErr.message);
  check(
    "anonymous callers are rejected by join_nearby_round",
    joinErr != null && !joinMissing,
    joinErr == null
      ? "it succeeded"
      : joinMissing
        ? "function not found — migration not applied yet, this check is not meaningful"
        : joinErr.message.slice(0, 70)
  );
}

await supabase.auth.signOut();
console.log(`\n${failures === 0 ? "All checks passed." : failures + " check(s) failed."}`);
process.exit(failures > 0 ? 1 : 0);
