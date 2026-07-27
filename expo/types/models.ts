/**
 * TypeScript models mirroring the Supabase tables.
 * Column names are kept snake_case to match Postgres rows returned by
 * supabase-js (the RN equivalent of the requested Swift Codable models).
 */

export interface Profile {
  id: string;
  display_name: string;
  handicap: number | null;
  created_at: string;
}

export type CourseSource = "user" | "golfcourseapi" | string;

export interface Course {
  id: string;
  name: string;
  city: string | null;
  country: string | null;
  created_by: string | null;
  created_at: string;
  /** Where the course came from: manually mapped ("user") or imported. */
  source: CourseSource;
  /** Provider id (e.g. GolfCourseAPI course id) for imported courses. */
  external_id: string | null;
  /** Single course-level point (clubhouse-ish) when known. */
  latitude: number | null;
  longitude: number | null;
}

export interface Hole {
  id: string;
  course_id: string;
  number: number;
  par: number;
  /** Null for imported courses until a golfer pins the green. */
  green_lat: number | null;
  green_lng: number | null;
  /** Yardage from the catalog scorecard, when available. */
  yardage: number | null;
}

export type RoundFormat = "stroke" | string;

export interface Round {
  id: string;
  course_id: string;
  owner_id: string;
  format: RoundFormat;
  join_code: string | null;
  is_multiplayer: boolean;
  started_at: string;
  finished_at: string | null;
}

export interface RoundPlayer {
  id: string;
  round_id: string;
  profile_id: string;
  joined_at: string;
}

/**
 * A single club in the golfer's bag. `carry_meters` is stored in SI (meters)
 * so it's unit-agnostic; the UI converts to yards/meters for display.
 */
export interface Club {
  id: string;
  profile_id: string;
  name: string;
  carry_meters: number;
  sort_order: number;
  created_at: string;
}

export interface Score {
  id: string;
  round_id: string;
  profile_id: string;
  hole_id: string;
  strokes: number;
  putts: number | null;
  updated_at: string;
}
