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

  await supabase.from("rounds").insert({
    id: roundId,
    course_id: courseId,
    owner_id: uid,
    format: "stroke",
    is_multiplayer: multiplayer,
    join_code: code,
    started_at: new Date().toISOString(),
  });
  await supabase.from("round_players").insert({ round_id: roundId, profile_id: uid });
  await supabase.from("scores").insert(
    holes.map((h) => ({ round_id: roundId, profile_id: uid, hole_id: h.id, strokes: 4 }))
  );
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
      const { roundId: privateId } = await makeRound({ multiplayer: false });
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
      const { data: stillThere } = await supabase
        .from("profiles")
        .select("id")
        .eq("id", guestId)
        .maybeSingle();
      check("guest profile is gone", stillThere == null, stillThere ? "still present" : "gone");
    }
  } finally {
    // Runs whether signUp succeeded, failed, or something above threw —
    // the probe round (and its active join code) must not survive this run.
    // supabase-js's query builder is PromiseLike but not a real Promise (no
    // .catch/.finally), so failures here are swallowed with try/catch rather
    // than a chained .catch().
    try {
      await supabase.rpc("delete_my_round", { p_round_id: roundId });
    } catch {
      // best-effort cleanup
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

await supabase.auth.signOut();
console.log(`\n${failures === 0 ? "All checks passed." : failures + " check(s) failed."}`);
process.exit(failures > 0 ? 1 : 0);
