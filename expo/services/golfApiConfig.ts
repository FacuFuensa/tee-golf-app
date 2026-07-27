/**
 * GolfCourseAPI credentials (golfcourseapi.com).
 *
 * Provide your key as an env var in `expo/.env`:
 *   EXPO_PUBLIC_GOLF_COURSE_API_KEY=...
 *
 * Get a free key at https://golfcourseapi.com (sign up with just an email).
 * Free tier = 50 requests/day; Pro = 10,000/day. Tee only calls the API while
 * you search or open a course for the first time, so usage stays low.
 *
 * Note: this key ships inside the app bundle (it's a public/client key). That's
 * fine for GolfCourseAPI's read-only data; rotate it from your dashboard if needed.
 */
const PLACEHOLDER_KEY = "YOUR-GOLFCOURSEAPI-KEY";

export const GOLF_API_BASE_URL = "https://api.golfcourseapi.com";

export const GOLF_API_KEY: string =
  process.env.EXPO_PUBLIC_GOLF_COURSE_API_KEY ?? PLACEHOLDER_KEY;

/** True once a real key is in place — used to show a friendly setup notice. */
export const isGolfApiConfigured: boolean =
  GOLF_API_KEY.length > 0 && GOLF_API_KEY !== PLACEHOLDER_KEY;
