import { GOLF_API_BASE_URL, GOLF_API_KEY, isGolfApiConfigured } from "./golfApiConfig";

/**
 * Thin client for GolfCourseAPI (golfcourseapi.com).
 *
 * Both `/v1/search` and `/v1/courses/{id}` return the SAME course shape, and
 * each row already embeds the full hole-by-hole scorecard (par + yardage). So
 * we import straight from search results and almost never spend a second
 * (rate-limited) request on the detail endpoint.
 *
 * What the catalog does NOT provide is a GPS pin on each green — golfers pin
 * those while playing (see `setHoleGreen` + the Play screen).
 */

interface GolfApiHole {
  par?: number | null;
  yardage?: number | null;
  handicap?: number | null;
}

interface GolfApiTee {
  tee_name?: string;
  number_of_holes?: number;
  par_total?: number;
  total_yards?: number;
  holes?: GolfApiHole[] | null;
}

export interface GolfApiLocation {
  address?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}

/** Unified course payload — identical between search rows and course detail. */
export interface GolfApiCourse {
  id: number;
  club_name: string;
  course_name: string;
  location?: GolfApiLocation | null;
  tees?: {
    male?: GolfApiTee[] | null;
    female?: GolfApiTee[] | null;
  } | null;
}

/** Normalized shape ready to persist into Supabase. */
export interface NormalizedCatalogHole {
  number: number;
  par: number;
  yardage: number | null;
}

export interface NormalizedCatalogCourse {
  externalId: string;
  name: string;
  city: string | null;
  country: string | null;
  latitude: number | null;
  longitude: number | null;
  holes: NormalizedCatalogHole[];
}

class GolfApiError extends Error {}

function authHeaders(): Record<string, string> {
  // GolfCourseAPI expects:  Authorization: Key <API_KEY>
  return { Authorization: `Key ${GOLF_API_KEY}`, Accept: "application/json" };
}

async function request<T>(path: string): Promise<T> {
  if (!isGolfApiConfigured) {
    throw new GolfApiError("Add your GolfCourseAPI key to browse the course catalog.");
  }
  let res: Response;
  try {
    res = await fetch(`${GOLF_API_BASE_URL}${path}`, { headers: authHeaders() });
  } catch {
    throw new GolfApiError("Couldn't reach the course catalog. Check your connection.");
  }

  if (res.status === 401) {
    throw new GolfApiError("Your GolfCourseAPI key looks invalid. Double-check it in settings.");
  }
  if (res.status === 429) {
    throw new GolfApiError("Daily catalog request limit reached. Try again tomorrow or upgrade your plan.");
  }
  if (!res.ok) {
    throw new GolfApiError("The course catalog is unavailable right now. Please try again.");
  }

  return (await res.json()) as T;
}

/** Search the catalog by course or club name. Rows already embed the scorecard. */
export async function searchGolfCourses(query: string): Promise<GolfApiCourse[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];
  const data = await request<{ courses?: GolfApiCourse[] | null }>(
    `/v1/search?search_query=${encodeURIComponent(trimmed)}`
  );
  return data.courses ?? [];
}

/**
 * Fetch the full scorecard for one course. The detail endpoint nests the
 * payload under a `course` key, so we unwrap it here.
 */
export async function getGolfCourseDetail(id: number): Promise<GolfApiCourse> {
  const data = await request<{ course?: GolfApiCourse | null }>(`/v1/courses/${id}`);
  if (!data.course) {
    throw new GolfApiError("This course isn't in the catalog anymore.");
  }
  return data.course;
}

/** Pick the first tee that actually carries hole-by-hole data (male preferred). */
function pickHoles(course: GolfApiCourse): GolfApiHole[] {
  const tees: GolfApiTee[] = [
    ...(course.tees?.male ?? []),
    ...(course.tees?.female ?? []),
  ];
  for (const tee of tees) {
    if (tee.holes && tee.holes.length > 0) return tee.holes;
  }
  return [];
}

/** How many holes the catalog has for this course (0 when the row has no scorecard). */
export function courseHoleCount(course: GolfApiCourse): number {
  return pickHoles(course).length;
}

function cleanString(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

/** Convert a catalog course into a persistable course (throws if no scorecard). */
export function normalizeCatalogCourse(course: GolfApiCourse): NormalizedCatalogCourse {
  const rawHoles = pickHoles(course);
  if (rawHoles.length === 0) {
    throw new GolfApiError("This course doesn't have a scorecard in the catalog yet.");
  }

  const holes: NormalizedCatalogHole[] = rawHoles.map((h, index) => ({
    number: index + 1,
    par: typeof h.par === "number" && h.par >= 3 ? h.par : 4,
    yardage: typeof h.yardage === "number" && h.yardage > 0 ? h.yardage : null,
  }));

  const loc = course.location ?? null;
  const name =
    cleanString(course.course_name) ?? cleanString(course.club_name) ?? "Unnamed course";

  return {
    externalId: String(course.id),
    name,
    city: cleanString(loc?.city),
    country: cleanString(loc?.country),
    latitude: typeof loc?.latitude === "number" ? loc.latitude : null,
    longitude: typeof loc?.longitude === "number" ? loc.longitude : null,
    holes,
  };
}

/** A friendly one-line label for a course. */
export function courseDisplayName(course: GolfApiCourse): string {
  return (
    cleanString(course.course_name) ?? cleanString(course.club_name) ?? "Unnamed course"
  );
}

export function courseLocationLabel(course: GolfApiCourse): string | null {
  const loc = course.location ?? null;
  if (!loc) return null;
  const parts = [cleanString(loc.city), cleanString(loc.state), cleanString(loc.country)].filter(
    Boolean
  );
  if (parts.length > 0) return parts.join(", ");
  return cleanString(loc.address);
}

/**
 * Curated famous courses used to seed the browse screen so it never feels
 * empty. Each is a real search term that returns live catalog results.
 */
export const POPULAR_COURSES: readonly string[] = [
  "Pebble Beach",
  "St Andrews",
  "Pinehurst",
  "Torrey Pines",
  "Bethpage",
  "TPC Sawgrass",
  "Bandon Dunes",
  "Kiawah Island",
  "Whistling Straits",
  "Spyglass Hill",
];
