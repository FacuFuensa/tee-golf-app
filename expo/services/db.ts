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
  const { data, error } = await supabase
    .from("profiles")
    .insert({ id: userId, display_name: displayName })
    .select()
    .single();
  if (error) throw error;
  return data as Profile;
}

/** Courses + holes ------------------------------------------------------- */

/**
 * The courses the given golfer has saved to their own library. Courses live in
 * a shared catalog, but each golfer picks which ones appear in their list via
 * the `user_courses` membership table — so two accounts can independently save
 * the same shared course, and one account's list never leaks into another's.
 */
export async function fetchCourses(userId: string): Promise<Course[]> {
  const { data, error } = await supabase
    .from("user_courses")
    .select("created_at, course:courses(*)")
    .eq("profile_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  const rows = (data as unknown as { course: Course | Course[] | null }[] | null) ?? [];
  return rows
    .map((r) => (Array.isArray(r.course) ? r.course[0] ?? null : r.course))
    .filter((c): c is Course => c != null);
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
  const { data: course, error } = await supabase
    .from("courses")
    .insert({
      name: input.name,
      city: input.city,
      country: input.country,
      created_by: input.createdBy,
      source: "user",
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

/** Host a group round: generates a shareable join code and seats the host. */
export async function createMultiplayerRound(
  courseId: string,
  ownerId: string
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
  };
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

export async function finishRound(roundId: string): Promise<void> {
  const { error } = await supabase
    .from("rounds")
    .update({ finished_at: new Date().toISOString() })
    .eq("id", roundId);
  if (error) throw error;
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
