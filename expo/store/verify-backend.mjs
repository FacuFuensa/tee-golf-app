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

await supabase.auth.signOut();
console.log(`\n${failures === 0 ? "All checks passed." : failures + " check(s) failed."}`);
process.exit(failures > 0 ? 1 : 0);
