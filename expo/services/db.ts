import * as Crypto from "expo-crypto";

import type { Club, Course, Hole, Profile, Round, Score } from "@/types/models";

import { supabase } from "./supabase";

/** Profiles -------------------------------------------------------------- */

export async function fetchProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  return (data as Profile | null) ?? null;
}

export async function createProfile(
  userId: string,
  displayName: string
): Promise<Profile> {
  // Upsert, not insert: if the profile already exists (a transient network
  // failure on the first load can send an existing golfer back through
  // onboarding), a plain insert raises a raw `profiles_pkey` violation that
  // used to be printed verbatim on screen.
  const { data, error } = await supabase
    .from("profiles")
    .upsert({ id: userId, display_name: displayName }, { onConflict: "id" })
    .select()
    .single();
  if (error) throw error;
  return data as Profile;
}

/** Courses + holes ------------------------------------------------------- */

/**
 * Centroid of every pinned green in `points`, or null when none are pinned.
 * Unpinned holes are dropped rather than treated as (0, 0), so a
 * partially-mapped course still anchors on its real greens.
 */
function centroidOfGreens(
  points: { lat: number | null; lng: number | null }[]
): { latitude: number; longitude: number } | null {
  const pinned = points.filter(
    (p): p is { lat: number; lng: number } => p.lat != null && p.lng != null
  );
  if (pinned.length === 0) return null;
  return {
    latitude: pinned.reduce((sum, p) => sum + p.lat, 0) / pinned.length,
    longitude: pinned.reduce((sum, p) => sum + p.lng, 0) / pinned.length,
  };
}

/**
 * A saved course plus a fallback location for when `latitude`/`longitude` is
 * null — every catalog import (GolfCourseAPI supplies no coordinates, and
 * forward-geocoding can fail) and every hand-mapped course saved before this
 * fix landed. `greenCentroid` is populated far more often, since a course is
 * barely playable until at least one green is pinned.
 */
export interface CourseWithGreenCentroid extends Course {
  greenCentroid: { latitude: number; longitude: number } | null;
}

/**
 * The courses the given golfer has saved to their own library. Courses live in
 * a shared catalog, but each golfer picks which ones appear in their list via
 * the `user_courses` membership table — so two accounts can independently save
 * the same shared course, and one account's list never leaks into another's.
 *
 * Holes are embedded (rather than fetched separately) to compute each course's
 * green centroid in the same round trip — see `CourseWithGreenCentroid`.
 */
export async function fetchCourses(userId: string): Promise<CourseWithGreenCentroid[]> {
  const { data, error } = await supabase
    .from("user_courses")
    .select("created_at, course:courses(*, holes(number, green_lat, green_lng))")
    .eq("profile_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw error;

  type HoleGreen = { number: number; green_lat: number | null; green_lng: number | null };
  type CourseRow = Course & { holes: HoleGreen[] | null };
  const rows = (data as unknown as { course: CourseRow | CourseRow[] | null }[] | null) ?? [];

  return rows
    .map((r) => (Array.isArray(r.course) ? r.course[0] ?? null : r.course))
    .filter((c): c is CourseRow => c != null)
    .map((c): CourseWithGreenCentroid => {
      const { holes, ...course } = c;
      const greenCentroid = centroidOfGreens(
        (holes ?? []).map((h) => ({ lat: h.green_lat, lng: h.green_lng }))
      );
      return { ...course, greenCentroid };
    });
}

/** Add a (shared) course to the golfer's own library. Idempotent. */
export async function saveCourseToLibrary(
  courseId: string,
  userId: string
): Promise<void> {
  const { error } = await supabase
    .from("user_courses")
    .upsert(
      { profile_id: userId, course_id: courseId },
      { onConflict: "profile_id,course_id", ignoreDuplicates: true }
    );
  if (error) throw error;
}

/** Remove a course from the golfer's library (the shared course row stays). */
export async function removeCourseFromLibrary(
  courseId: string,
  userId: string
): Promise<void> {
  const { error } = await supabase
    .from("user_courses")
    .delete()
    .eq("profile_id", userId)
    .eq("course_id", courseId);
  if (error) throw error;
}

/** The external_ids of catalog courses already in the golfer's library. */
export async function fetchSavedExternalIds(userId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from("user_courses")
    .select("course:courses(external_id)")
    .eq("profile_id", userId);
  if (error) throw error;
  type Row = { course: { external_id: string | null } | { external_id: string | null }[] | null };
  const rows = (data as unknown as Row[] | null) ?? [];
  return rows
    .map((r) => {
      const c = Array.isArray(r.course) ? r.course[0] ?? null : r.course;
      return c?.external_id ?? null;
    })
    .filter((id): id is string => id != null);
}

export async function fetchCourseHoles(courseId: string): Promise<Hole[]> {
  const { data, error } = await supabase
    .from("holes")
    .select("*")
    .eq("course_id", courseId)
    .order("number", { ascending: true });
  if (error) throw error;
  return (data as Hole[] | null) ?? [];
}

export async function fetchHoleCount(courseId: string): Promise<number> {
  const { count, error } = await supabase
    .from("holes")
    .select("id", { count: "exact", head: true })
    .eq("course_id", courseId);
  if (error) throw error;
  return count ?? 0;
}

export interface NewHoleInput {
  number: number;
  par: number;
  green_lat: number;
  green_lng: number;
}

export interface NewCourseInput {
  name: string;
  city: string | null;
  country: string | null;
  createdBy: string;
  holes: NewHoleInput[];
}

export async function createCourseWithHoles(
  input: NewCourseInput
): Promise<Course> {
  // Unlike a catalog import, every green is placed before this is ever called
  // (app/course/new.tsx walks the golfer through pinning each hole), so a real
  // location is available immediately — no need to wait on geocoding or fall
  // back to the green centroid at read time the way `fetchCourses` does.
  const anchor = centroidOfGreens(
    input.holes.map((h) => ({ lat: h.green_lat, lng: h.green_lng }))
  );

  const { data: course, error } = await supabase
    .from("courses")
    .insert({
      name: input.name,
      city: input.city,
      country: input.country,
      created_by: input.createdBy,
      source: "user",
      latitude: anchor?.latitude ?? null,
      longitude: anchor?.longitude ?? null,
    })
    .select()
    .single();
  if (error) throw error;

  const created = course as Course;
  const payload = input.holes.map((h) => ({ ...h, course_id: created.id }));
  const { error: holesError } = await supabase.from("holes").insert(payload);
  if (holesError) throw holesError;

  await saveCourseToLibrary(created.id, input.createdBy);

  return created;
}

/** Remove a course (and its holes/rounds cascade via FK) from the catalog. */
export async function deleteCourse(courseId: string): Promise<void> {
  const { error } = await supabase.from("courses").delete().eq("id", courseId);
  if (error) throw error;
}

/** Catalog import (GolfCourseAPI) ----------------------------------------- */

export interface CatalogHoleInput {
  number: number;
  par: number;
  yardage: number | null;
}

export interface ImportCatalogInput {
  externalId: string;
  name: string;
  city: string | null;
  country: string | null;
  latitude: number | null;
  longitude: number | null;
  holes: CatalogHoleInput[];
  createdBy: string;
}

async function fetchCourseByExternalId(externalId: string): Promise<Course | null> {
  // NOTE: we deliberately avoid `.maybeSingle()` here. If the same catalog
  // course was imported more than once before the unique index existed, there
  // can be duplicate rows for one external_id — and `.maybeSingle()` THROWS on
  // multiple rows, which would make importing that course fail for everyone.
  // Taking the oldest matching row keeps the shared course stable and lets the
  // import succeed regardless of any leftover duplicates.
  const { data, error } = await supabase
    .from("courses")
    .select("*")
    .eq("external_id", externalId)
    .order("created_at", { ascending: true })
    .limit(1);
  if (error) throw error;
  const rows = (data as Course[] | null) ?? [];
  return rows[0] ?? null;
}

/**
 * Persist a catalog course (and its scorecard) into Supabase, reusing an
 * existing row when the same course was already imported by anyone. Greens are
 * left null — golfers pin them while playing.
 */
export async function importCatalogCourse(input: ImportCatalogInput): Promise<Course> {
  const existing = await fetchCourseByExternalId(input.externalId);
  if (existing) {
    // The shared course already exists — just add it to THIS golfer's library.
    await saveCourseToLibrary(existing.id, input.createdBy);
    return existing;
  }

  const { data: course, error } = await supabase
    .from("courses")
    .insert({
      name: input.name,
      city: input.city,
      country: input.country,
      created_by: input.createdBy,
      source: "golfcourseapi",
      external_id: input.externalId,
      latitude: input.latitude,
      longitude: input.longitude,
    })
    .select()
    .single();

  // Another player may have imported the same course a moment ago.
  if (error) {
    if (error.code === "23505") {
      const raced = await fetchCourseByExternalId(input.externalId);
      if (raced) {
        await saveCourseToLibrary(raced.id, input.createdBy);
        return raced;
      }
    }
    throw error;
  }

  const created = course as Course;
  const payload = input.holes.map((h) => ({
    course_id: created.id,
    number: h.number,
    par: h.par,
    yardage: h.yardage,
    green_lat: null,
    green_lng: null,
  }));
  const { error: holesError } = await supabase.from("holes").insert(payload);
  if (holesError) throw holesError;

  await saveCourseToLibrary(created.id, input.createdBy);

  return created;
}

/** Pin (or refine) the green for a single hole. */
export async function setHoleGreen(
  holeId: string,
  lat: number,
  lng: number
): Promise<Hole> {
  const { data, error } = await supabase
    .from("holes")
    .update({ green_lat: lat, green_lng: lng })
    .eq("id", holeId)
    .select()
    .single();
  if (error) throw error;
  return data as Hole;
}

/** Rounds + scores ------------------------------------------------------- */

export async function createSoloRound(
  courseId: string,
  ownerId: string
): Promise<Round> {
  // We generate the id client-side and insert WITHOUT a RETURNING/`select()`.
  // The `rounds` SELECT policy resolves membership through a SECURITY DEFINER
  // function that re-queries the table, and that row isn't visible to the
  // function during INSERT...RETURNING — so asking for the row back makes the
  // whole insert fail the row-level security check. Inserting blind avoids it.
  const id = Crypto.randomUUID();
  const startedAt = new Date().toISOString();

  const { error } = await supabase.from("rounds").insert({
    id,
    course_id: courseId,
    owner_id: ownerId,
    format: "stroke",
    is_multiplayer: false,
    started_at: startedAt,
  });
  if (error) throw error;

  const { error: rpError } = await supabase
    .from("round_players")
    .insert({ round_id: id, profile_id: ownerId });
  if (rpError) throw rpError;

  return {
    id,
    course_id: courseId,
    owner_id: ownerId,
    format: "stroke",
    join_code: null,
    is_multiplayer: false,
    started_at: startedAt,
    finished_at: null,
    // Column default (never surfaced anywhere: nearby_open_rounds only ever
    // looks at is_multiplayer = true rounds), kept here just so this object
    // matches the real row shape.
    is_discoverable: true,
  };
}

/** A short, human-friendly join code (no ambiguous characters like 0/O/1/I). */
function makeJoinCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i += 1) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return code;
}

/**
 * Host a group round: generates a shareable join code and seats the host.
 * `discoverable` sets the round's `is_discoverable` flag from the golfer's
 * Settings preference (default on) at the moment the round is created — the
 * column itself defaults to true too, but that default only covers "the
 * client didn't say"; a golfer who turned the preference off must get a
 * private round from the first insert, not a discoverable one that's flipped
 * off a moment later (a race a second, faster device could win).
 */
export async function createMultiplayerRound(
  courseId: string,
  ownerId: string,
  discoverable: boolean
): Promise<Round> {
  const id = Crypto.randomUUID();
  const startedAt = new Date().toISOString();
  const joinCode = makeJoinCode();

  const { error } = await supabase.from("rounds").insert({
    id,
    course_id: courseId,
    owner_id: ownerId,
    format: "stroke",
    is_multiplayer: true,
    join_code: joinCode,
    started_at: startedAt,
    is_discoverable: discoverable,
  });
  if (error) throw error;

  const { error: rpError } = await supabase
    .from("round_players")
    .insert({ round_id: id, profile_id: ownerId });
  if (rpError) throw rpError;

  return {
    id,
    course_id: courseId,
    owner_id: ownerId,
    format: "stroke",
    join_code: joinCode,
    is_multiplayer: true,
    started_at: startedAt,
    finished_at: null,
    is_discoverable: discoverable,
  };
}

/**
 * Flip a live round's discoverability (Settings → the host's own switch, or
 * the toggle next to the join code while hosting). Owner-only, and no RPC is
 * needed to enforce that: `rounds_update_owner` (0001) is
 * `using (owner_id = auth.uid()) with check (owner_id = auth.uid())`, and
 * 0010's column-level grants only ever narrowed `holes`, never `rounds` — see
 * migration 0014's own header comment for why a plain update is sufficient
 * here. A non-owner's update simply matches zero rows under RLS.
 */
export async function setRoundDiscoverable(
  roundId: string,
  discoverable: boolean
): Promise<void> {
  const { error } = await supabase
    .from("rounds")
    .update({ is_discoverable: discoverable })
    .eq("id", roundId);
  if (error) throw error;
}

/**
 * Join an active group round by its code. A non-member can't SELECT the round
 * directly (RLS), so this calls a SECURITY DEFINER RPC that finds the round,
 * seats the caller, and returns just the ids needed to open it. Returns null
 * when no active round matches the code.
 */
export async function joinRoundByCode(
  code: string
): Promise<{ roundId: string; courseId: string } | null> {
  const { data, error } = await supabase.rpc("join_round_by_code", {
    p_code: code.trim().toUpperCase(),
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;
  return {
    roundId: (row as { round_id: string }).round_id,
    courseId: (row as { course_id: string }).course_id,
  };
}

/** Nearby round discovery + join (migration 0014) --------------------------- */

/** One open group round at a nearby course, as returned by `nearby_open_rounds`. */
export interface NearbyRound {
  roundId: string;
  courseId: string;
  courseName: string;
  hostDisplayName: string;
  format: string;
  startedAt: string;
  distanceMeters: number;
}

interface NearbyOpenRoundRow {
  round_id: string;
  course_id: string;
  course_name: string;
  host_display_name: string;
  format: string;
  started_at: string;
  distance_meters: number;
}

/**
 * Open group rounds at courses within `radiusMeters` of (lat, lng), nearest
 * first. Never includes the caller's own round or one they're already seated
 * in (the RPC filters both). No coordinates of any kind come back — see
 * migration 0014's own comment on why the return shape is deliberately thin.
 */
export async function fetchNearbyOpenRounds(
  lat: number,
  lng: number,
  radiusMeters: number
): Promise<NearbyRound[]> {
  const { data, error } = await supabase.rpc("nearby_open_rounds", {
    p_lat: lat,
    p_lng: lng,
    p_radius_meters: radiusMeters,
  });
  if (error) throw error;
  const rows = (data as NearbyOpenRoundRow[] | null) ?? [];
  return rows.map((row) => ({
    roundId: row.round_id,
    courseId: row.course_id,
    courseName: row.course_name,
    hostDisplayName: row.host_display_name,
    format: row.format,
    startedAt: row.started_at,
    distanceMeters: row.distance_meters,
  }));
}

export type JoinNearbyRoundStatus = "joined" | "unavailable";

export interface JoinNearbyRoundResult {
  roundId: string;
  courseId: string | null;
  status: JoinNearbyRoundStatus;
}

interface JoinNearbyRoundRow {
  round_id: string;
  course_id: string | null;
  status: JoinNearbyRoundStatus;
}

/**
 * Join a round surfaced by `fetchNearbyOpenRounds`. Unlike `joinRoundByCode`,
 * this never returns null and never throws for "the round moved on" — the
 * RPC's contract (see migration 0014) is that it ALWAYS returns exactly one
 * row, with `status` either 'joined' or 'unavailable'. That is deliberate:
 * this codebase has shipped three bugs where a write touched zero rows,
 * raised nothing, and the app reported success anyway (see `finishRound`'s
 * and `deleteMyRound`'s own doc comments). Callers MUST branch on `status`
 * and must never treat a resolved promise alone as "joined".
 */
export async function joinNearbyRound(
  roundId: string,
  lat: number,
  lng: number,
  radiusMeters: number
): Promise<JoinNearbyRoundResult> {
  const { data, error } = await supabase.rpc("join_nearby_round", {
    p_round_id: roundId,
    p_lat: lat,
    p_lng: lng,
    p_radius_meters: radiusMeters,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  // The RPC's contract guarantees a row; this is defensive only (a network
  // layer or Postgres client bug returning nothing regardless), and mapped to
  // 'unavailable' rather than throwing so a caller's status switch stays the
  // one place that decides what the golfer sees.
  if (!row) return { roundId, courseId: null, status: "unavailable" };
  const typed = row as JoinNearbyRoundRow;
  return { roundId: typed.round_id, courseId: typed.course_id, status: typed.status };
}

export interface RoundBundle {
  round: Round;
  course: Course;
  holes: Hole[];
  scores: Score[];
}

export async function fetchRoundBundle(roundId: string): Promise<RoundBundle> {
  const { data: roundData, error } = await supabase
    .from("rounds")
    .select("*")
    .eq("id", roundId)
    .single();
  if (error) throw error;
  const round = roundData as Round;

  const [courseRes, holes, scoresRes] = await Promise.all([
    supabase.from("courses").select("*").eq("id", round.course_id).single(),
    fetchCourseHoles(round.course_id),
    supabase.from("scores").select("*").eq("round_id", roundId),
  ]);

  if (courseRes.error) throw courseRes.error;
  if (scoresRes.error) throw scoresRes.error;

  return {
    round,
    course: courseRes.data as Course,
    holes,
    scores: (scoresRes.data as Score[] | null) ?? [],
  };
}

export interface UpsertScoreInput {
  round_id: string;
  profile_id: string;
  hole_id: string;
  strokes: number;
}

export async function upsertScore(input: UpsertScoreInput): Promise<void> {
  // Same RLS caveat as createSoloRound: the `scores` SELECT policy re-queries
  // round membership via a SECURITY DEFINER function, which fails on the
  // RETURNING row. Upsert without `select()` so the write isn't rejected.
  const { error } = await supabase
    .from("scores")
    .upsert(
      { ...input, updated_at: new Date().toISOString() },
      { onConflict: "round_id,profile_id,hole_id" }
    );
  if (error) throw error;
}

/**
 * Thrown when the update in `finishRound` didn't land exactly one row — either
 * because the caller isn't the round's owner, or because the round no longer
 * exists.
 */
export class NotRoundOwnerError extends Error {
  constructor() {
    super("Only the round's host can finish it — or the round no longer exists.");
    this.name = "NotRoundOwnerError";
  }
}

/**
 * Close out a round. Owner-only: `rounds_update_owner` gates this to
 * `owner_id = auth.uid()`.
 *
 * The count is not decoration. A non-owner's update matches zero rows and
 * returns NO error, so `error == null` is not evidence that anything happened —
 * the app used to treat that silence as success and tell a joiner their group
 * round was finished while it stayed live for everyone else. `count` is asked
 * for instead of `select()` because the `rounds` SELECT policy resolves
 * membership through a SECURITY DEFINER function, and asking for the row back
 * is the pattern that breaks elsewhere in this file.
 *
 * The assertion is on `count !== 1`, not `count === 0`. supabase-js only sets
 * `count` when the response carries BOTH the `Prefer: count=…` header we send
 * AND a parseable `content-range` header back — otherwise it stays `null`. And
 * a wildcard Content-Range header (both the range and the total as literal
 * asterisks, meaning "unknown") parses via `parseInt` to `NaN`. Neither `null`
 * nor `NaN` is `=== 0`, so a guard written as `count === 0` fails to fire on
 * exactly the inputs it exists to catch, silently reporting success again.
 * The filter is `.eq("id", roundId)` on a primary key, so at most one row can
 * ever match — asserting the single success value (`1`) is airtight where
 * asserting the failure value (`0`) is not. Re-finishing an already-finished
 * round still updates one row (Postgres counts rows matched by the UPDATE
 * regardless of whether any column value changed), so this stays idempotent.
 */
export async function finishRound(roundId: string): Promise<void> {
  const { error, count } = await supabase
    .from("rounds")
    .update({ finished_at: new Date().toISOString() }, { count: "exact" })
    .eq("id", roundId);
  if (error) throw error;
  if (count !== 1) throw new NotRoundOwnerError();
}

/** Live leaderboard ------------------------------------------------------ */

export interface LeaderboardEntry {
  profileId: string;
  name: string;
  /** Holes scored so far. */
  thru: number;
  /** Strokes relative to par across scored holes. */
  toPar: number;
  /** Total strokes across scored holes. */
  total: number;
  isOwner: boolean;
}

interface PlayerRow {
  profile_id: string;
  profiles: { display_name: string } | { display_name: string }[] | null;
}

/**
 * Live standings for a group round: every seated player with their thru count
 * and score-to-par. Players who haven't scored a hole yet sink to the bottom.
 */
export async function fetchLeaderboard(roundId: string): Promise<LeaderboardEntry[]> {
  const { data: roundData, error: roundErr } = await supabase
    .from("rounds")
    .select("*")
    .eq("id", roundId)
    .single();
  if (roundErr) throw roundErr;
  const round = roundData as Round;

  const [playersRes, scoresRes, holes] = await Promise.all([
    supabase
      .from("round_players")
      .select("profile_id, profiles(display_name)")
      .eq("round_id", roundId),
    supabase.from("scores").select("*").eq("round_id", roundId),
    fetchCourseHoles(round.course_id),
  ]);
  if (playersRes.error) throw playersRes.error;
  if (scoresRes.error) throw scoresRes.error;

  const parByHole = new Map(holes.map((h) => [h.id, h.par]));
  const scores = (scoresRes.data as Score[] | null) ?? [];
  const players = (playersRes.data as PlayerRow[] | null) ?? [];

  const entries: LeaderboardEntry[] = players.map((p) => {
    let thru = 0;
    let toPar = 0;
    let total = 0;
    for (const s of scores) {
      if (s.profile_id !== p.profile_id || s.strokes <= 0) continue;
      const par = parByHole.get(s.hole_id);
      if (par == null) continue;
      thru += 1;
      total += s.strokes;
      toPar += s.strokes - par;
    }
    const prof = Array.isArray(p.profiles) ? p.profiles[0] : p.profiles;
    return {
      profileId: p.profile_id,
      name: prof?.display_name ?? "Player",
      thru,
      toPar,
      total,
      isOwner: p.profile_id === round.owner_id,
    };
  });

  entries.sort((a, b) => {
    if (a.thru === 0 && b.thru === 0) return a.name.localeCompare(b.name);
    if (a.thru === 0) return 1;
    if (b.thru === 0) return -1;
    return a.toPar - b.toPar;
  });
  return entries;
}

/** Account & data deletion ----------------------------------------------- */

/**
 * Erase everything the golfer owns (rounds, scores, group memberships) while
 * keeping their account intact. Shared courses/greens are left for others.
 */
export async function deleteMyData(): Promise<void> {
  const { error } = await supabase.rpc("delete_my_data");
  if (error) throw error;
}

/** Permanently delete the golfer's account and all of their data. */
export async function deleteMyAccount(): Promise<void> {
  const { error } = await supabase.rpc("delete_my_account");
  if (error) throw error;
}

export type DeleteRoundResult = "deleted" | "left" | "not_found";

/**
 * Remove one round from the caller's history. In a group round where other
 * players are still seated this removes only the caller ("left"); otherwise the
 * round itself is deleted ("deleted"). See migration 0013 for why this is a
 * function rather than a plain delete.
 */
export async function deleteMyRound(roundId: string): Promise<DeleteRoundResult> {
  const { data, error } = await supabase.rpc("delete_my_round", { p_round_id: roundId });
  if (error) throw error;
  const value = Array.isArray(data) ? data[0] : data;
  return (value as DeleteRoundResult) ?? "not_found";
}

/** Club bag (Smart Caddy) ------------------------------------------------ */

/** Every club in the golfer's bag, ordered longest-carry first. */
export async function fetchClubs(profileId: string): Promise<Club[]> {
  const { data, error } = await supabase
    .from("clubs")
    .select("*")
    .eq("profile_id", profileId)
    .order("carry_meters", { ascending: false });
  if (error) throw error;
  return (data as Club[] | null) ?? [];
}

export interface ClubInput {
  name: string;
  carryMeters: number;
}

/** Add a club to the golfer's bag. */
export async function addClub(
  profileId: string,
  input: ClubInput
): Promise<Club> {
  const { data, error } = await supabase
    .from("clubs")
    .insert({
      profile_id: profileId,
      name: input.name,
      carry_meters: input.carryMeters,
    })
    .select()
    .single();
  if (error) throw error;
  return data as Club;
}

/** Insert several clubs at once (used by the "add a standard set" shortcut). */
export async function addClubs(
  profileId: string,
  inputs: ClubInput[]
): Promise<void> {
  if (inputs.length === 0) return;
  const payload = inputs.map((c) => ({
    profile_id: profileId,
    name: c.name,
    carry_meters: c.carryMeters,
  }));
  const { error } = await supabase.from("clubs").insert(payload);
  if (error) throw error;
}

/** Update a club's name and/or carry distance. */
export async function updateClub(
  clubId: string,
  input: ClubInput
): Promise<void> {
  const { error } = await supabase
    .from("clubs")
    .update({ name: input.name, carry_meters: input.carryMeters })
    .eq("id", clubId);
  if (error) throw error;
}

/** Remove a club from the bag. */
export async function removeClub(clubId: string): Promise<void> {
  const { error } = await supabase.from("clubs").delete().eq("id", clubId);
  if (error) throw error;
}

/** Statistics ------------------------------------------------------------ */

/** A single scored hole within a round, paired with its par. */
export interface PlayedHole {
  number: number;
  par: number;
  strokes: number;
}

/** Every round the player has recorded a score on, with its scored holes. */
export interface PlayedRound {
  round: Round;
  courseName: string;
  holes: PlayedHole[];
}

/**
 * Gather every round the player has scored on, joining each saved score to its
 * hole (for par) and round/course (for context). Rounds with no scored holes
 * are skipped. Returned newest-first.
 */
export async function fetchPlayerRounds(profileId: string): Promise<PlayedRound[]> {
  const { data: scoreData, error } = await supabase
    .from("scores")
    .select("*")
    .eq("profile_id", profileId);
  if (error) throw error;
  const scores = (scoreData as Score[] | null) ?? [];
  if (scores.length === 0) return [];

  const roundIds = [...new Set(scores.map((s) => s.round_id))];
  const holeIds = [...new Set(scores.map((s) => s.hole_id))];

  const [roundsRes, holesRes] = await Promise.all([
    supabase.from("rounds").select("*").in("id", roundIds),
    supabase.from("holes").select("*").in("id", holeIds),
  ]);
  if (roundsRes.error) throw roundsRes.error;
  if (holesRes.error) throw holesRes.error;

  const rounds = (roundsRes.data as Round[] | null) ?? [];
  const holes = (holesRes.data as Hole[] | null) ?? [];

  const courseIds = [...new Set(rounds.map((r) => r.course_id))];
  const { data: courseData, error: courseError } = await supabase
    .from("courses")
    .select("*")
    .in("id", courseIds);
  if (courseError) throw courseError;
  const courses = (courseData as Course[] | null) ?? [];

  const holeById = new Map(holes.map((h) => [h.id, h]));
  const courseById = new Map(courses.map((c) => [c.id, c]));
  const holesByRound = new Map<string, PlayedHole[]>();

  for (const s of scores) {
    const hole = holeById.get(s.hole_id);
    if (!hole) continue;
    const list = holesByRound.get(s.round_id) ?? [];
    list.push({ number: hole.number, par: hole.par, strokes: s.strokes });
    holesByRound.set(s.round_id, list);
  }

  const result: PlayedRound[] = [];
  for (const round of rounds) {
    const playedHoles = (holesByRound.get(round.id) ?? []).sort(
      (a, b) => a.number - b.number
    );
    if (playedHoles.length === 0) continue;
    result.push({
      round,
      courseName: courseById.get(round.course_id)?.name ?? "Course",
      holes: playedHoles,
    });
  }

  result.sort(
    (a, b) =>
      new Date(b.round.started_at).getTime() - new Date(a.round.started_at).getTime()
  );
  return result;
}

/**
 * The golfer's lowest score on each hole of one course, keyed by hole_id.
 * Excludes the round in progress, so "your best" never means "what you just
 * wrote down". Hole ids are course-scoped, so this is the same hole at the
 * same course across every past round.
 */
export async function fetchHoleBests(
  profileId: string,
  courseId: string,
  excludeRoundId: string
): Promise<Record<string, number>> {
  const { data, error } = await supabase
    .from("scores")
    .select("hole_id, strokes, holes!inner(course_id)")
    .eq("profile_id", profileId)
    .eq("holes.course_id", courseId)
    .neq("round_id", excludeRoundId)
    .gt("strokes", 0);
  if (error) throw error;

  const rows = (data as unknown as { hole_id: string; strokes: number }[] | null) ?? [];
  const best: Record<string, number> = {};
  for (const row of rows) {
    const current = best[row.hole_id];
    if (current == null || row.strokes < current) best[row.hole_id] = row.strokes;
  }
  return best;
}
