/**
 * Fills a live group round with other players, so the Leaderboard screenshot
 * shows an actual race instead of "App Review — Not started".
 *
 * A leaderboard is impossible to photograph convincingly on your own: hosting a
 * round seats exactly one player. This creates a few extra accounts, joins them
 * by invite code, and posts believable scores through the same RPC and the same
 * RLS policies the app uses — nothing privileged, no service_role key.
 *
 * USAGE, from expo/:
 *     node store/populate-leaderboard.mjs <INVITE_CODE>
 *
 * Host a group round on the phone first, read the 6-character code off the
 * Leaderboard sheet, then run this and pull down to refresh.
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  process.env.EXPO_PUBLIC_SUPABASE_URL ?? "https://ilrkgprannppoyjibnrw.supabase.co";
const SUPABASE_ANON_KEY =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlscmtncHJhbm5wcG95amlibnJ3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIwNjE5MjgsImV4cCI6MjA5NzYzNzkyOH0.9JM4yG2E-ulil5obq5Xb_ADHdafQGO_vrxNKyN1jiqI";

/**
 * Playing partners. Names are deliberately plain and non-real-person so nothing
 * in a store screenshot looks like it belongs to an actual customer
 * (Guideline 2.3.9: display fictional account information).
 *
 * `thru` is how many holes each has finished, and `offsets` their score relative
 * to par — tuned so the board has a clear leader, a close second, and someone
 * still on the front nine. That reads as a real group mid-round.
 */
const PARTNERS = [
  {
    email: "demo.player2@teegolf.app",
    name: "Sam Ortiz",
    thru: 9,
    offsets: [0, 1, 0, 0, 1, -1, 0, 1, 0],
  },
  {
    email: "demo.player3@teegolf.app",
    name: "Dana Whitlock",
    thru: 9,
    offsets: [1, 0, 1, 1, 0, 1, 1, 0, 1],
  },
  {
    email: "demo.player4@teegolf.app",
    name: "Marcus Bell",
    thru: 5,
    offsets: [1, 2, 1, 1, 2],
  },
];

const PASSWORD = process.env.TEE_PARTNER_PASSWORD ?? "TeePartner2026!";

const code = (process.argv[2] ?? "").trim().toUpperCase();
if (!/^[A-Z0-9]{6}$/.test(code)) {
  console.error("Usage: node store/populate-leaderboard.mjs <INVITE_CODE>");
  console.error("The code is the 6 characters on the Leaderboard sheet.");
  process.exit(1);
}

function client() {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function signInOrUp(sb, email) {
  const existing = await sb.auth.signInWithPassword({ email, password: PASSWORD });
  if (existing.data?.session) return existing.data.session;

  const created = await sb.auth.signUp({ email, password: PASSWORD });
  if (created.error) throw new Error(`${email}: ${created.error.message}`);
  if (!created.data.session) {
    throw new Error(
      `${email}: no session returned — email confirmation is on for this project.`
    );
  }
  return created.data.session;
}

console.log(`Joining round ${code}\n`);
let seated = 0;

for (const partner of PARTNERS) {
  const sb = client();
  try {
    const session = await signInOrUp(sb, partner.email);
    const uid = session.user.id;

    const { error: profileErr } = await sb
      .from("profiles")
      .upsert({ id: uid, display_name: partner.name }, { onConflict: "id" });
    if (profileErr) throw new Error(`profile: ${profileErr.message}`);

    // Same RPC the Join sheet calls. It seats the caller and returns the ids.
    const { data, error: joinErr } = await sb.rpc("join_round_by_code", { p_code: code });
    if (joinErr) throw new Error(`join: ${joinErr.message}`);
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) {
      console.log(`  ${partner.name}: no active round for that code`);
      console.log("     The round may have been finished, or the code has changed.");
      break;
    }

    const { data: holes, error: holesErr } = await sb
      .from("holes")
      .select("id, number, par")
      .eq("course_id", row.course_id)
      .order("number");
    if (holesErr) throw new Error(`holes: ${holesErr.message}`);

    const played = holes.slice(0, partner.thru);
    const scores = played.map((h, i) => ({
      round_id: row.round_id,
      profile_id: uid,
      hole_id: h.id,
      strokes: h.par + partner.offsets[i],
      updated_at: new Date().toISOString(),
    }));

    const { error: scoreErr } = await sb
      .from("scores")
      .upsert(scores, { onConflict: "round_id,profile_id,hole_id" });
    if (scoreErr) throw new Error(`scores: ${scoreErr.message}`);

    const strokes = scores.reduce((s, x) => s + x.strokes, 0);
    const par = played.reduce((s, h) => s + h.par, 0);
    const toPar = strokes - par;
    console.log(
      `  ${partner.name.padEnd(15)} thru ${String(partner.thru).padStart(2)}  ` +
        `${toPar > 0 ? "+" : ""}${toPar}`
    );
    seated += 1;
  } catch (e) {
    console.log(`  ${partner.name}: ${e.message}`);
  } finally {
    await sb.auth.signOut().catch(() => {});
  }
}

if (seated > 0) {
  console.log(
    `\n${seated} player(s) seated. Pull to refresh the Leaderboard sheet on the phone —` +
      "\nit also re-polls on its own every 4 seconds."
  );
} else {
  console.log("\nNobody was seated. Host a fresh round and re-run with the new code.");
}
