import * as Location from "expo-location";

import type { GolfApiLocation, NormalizedCatalogCourse } from "./golfApi";

/**
 * Turns a course's postal address into coordinates.
 *
 * WHY THIS EXISTS
 * GolfCourseAPI returns a full street address for every course but never a
 * latitude or longitude — verified empirically across 40 courses in 5 separate
 * searches, all of which came back with `location` containing only address,
 * city, state and country. Three things in the app depend on a course having
 * coordinates:
 *
 *   1. Sorting the course library nearest-first, and the "Closest to you" card.
 *   2. The "new course nearby" suggestion on the Courses tab.
 *   3. Anchoring the green picker on the COURSE rather than on the golfer.
 *
 * (3) is the one that matters most. Without a course anchor the picker opens at
 * the golfer's own GPS position, so tapping "Save green" from home pins a green
 * hundreds of miles from the hole it belongs to — and greens are shared, so that
 * corrupts the course for every other golfer.
 *
 * Geocoding runs through Apple's geocoder on iOS via expo-location. It needs no
 * API key and no location permission (forward geocoding is not a location read).
 */

interface Coordinates {
  latitude: number;
  longitude: number;
}

/** Geocoding the same course twice in a session is wasted work. */
const cache = new Map<string, Coordinates | null>();

const clean = (v: string | null | undefined): string | null => {
  const t = v?.trim();
  return t && t.length > 0 ? t : null;
};

/**
 * Builds the most specific query the address parts allow. A street address is
 * composed WITH the city/state/country, not used alone — a bare street address
 * ("100 Main St") is ambiguous across thousands of towns, and Apple's geocoder
 * needs the locality to disambiguate it. Falling back to "city, state, country"
 * (see `buildLocalityQuery`) still lands within a few kilometres, which is
 * close enough to anchor a map.
 */
function buildQuery(parts: {
  address?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  name?: string | null;
}): string | null {
  const address = clean(parts.address);
  const locality = buildLocalityQuery(parts);

  if (address) return locality ? `${address}, ${locality}` : address;
  if (!locality) return null;

  // With no street address, pairing the course name with the locality gives the
  // geocoder a chance to find the club itself rather than the town centre.
  const name = clean(parts.name);
  return name ? `${name}, ${locality}` : locality;
}

/** "City, state, country" alone — the fallback query when the fuller one above
 * finds nothing. Some geocoders fail an address they can't match exactly
 * rather than degrading gracefully to the town it's in. */
function buildLocalityQuery(parts: {
  city?: string | null;
  state?: string | null;
  country?: string | null;
}): string | null {
  const locality = [clean(parts.city), clean(parts.state), clean(parts.country)]
    .filter(Boolean)
    .join(", ");
  return locality.length > 0 ? locality : null;
}

/**
 * Runs one geocode query through the cache. A thrown exception is NOT cached:
 * expo-location's own docs on `geocodeAsync` warn that "creating too many
 * requests at a time can result in an error" (see
 * node_modules/expo-location/build/Location.js), so a throw here is usually a
 * transient throttle, not proof the address doesn't exist. Caching it as a
 * permanent null used to poison that query for the rest of the app's process
 * lifetime. Only a genuinely empty RESULT (the API answered, with nothing) is
 * cached.
 */
async function runGeocode(query: string): Promise<Coordinates | null> {
  const cached = cache.get(query);
  if (cached !== undefined) return cached;

  const results = await Location.geocodeAsync(query);
  const first = results[0];
  const resolved =
    first && typeof first.latitude === "number" && typeof first.longitude === "number"
      ? { latitude: first.latitude, longitude: first.longitude }
      : null;
  cache.set(query, resolved);
  return resolved;
}

/**
 * Resolves coordinates for a course, or null when the address can't be
 * geocoded. Never throws — a course without coordinates is degraded, not broken,
 * so a geocoding failure must not block the import.
 */
export async function geocodeCourse(parts: {
  address?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  name?: string | null;
}): Promise<Coordinates | null> {
  const query = buildQuery(parts);
  if (!query) return null;

  try {
    const resolved = await runGeocode(query);
    if (resolved) return resolved;
  } catch {
    // Geocoding is unavailable on web and can fail offline. Fall through to
    // the locality retry below rather than giving up immediately.
  }

  // The composed query found nothing (or errored) — retry once with the
  // locality alone, in case the fuller address was what tripped it up.
  const localityQuery = buildLocalityQuery(parts);
  if (!localityQuery || localityQuery === query) return null;

  try {
    return await runGeocode(localityQuery);
  } catch {
    return null;
  }
}

/**
 * Fills in a catalog course's coordinates from its address when the provider
 * didn't supply them, which for GolfCourseAPI is always. Returns the course
 * unchanged if it already has coordinates or if geocoding fails, so importing
 * never depends on the geocoder succeeding.
 */
export async function withResolvedCoordinates(
  course: NormalizedCatalogCourse,
  location: GolfApiLocation | null | undefined
): Promise<NormalizedCatalogCourse> {
  if (course.latitude != null && course.longitude != null) return course;

  const coords = await geocodeCourse({
    address: location?.address,
    city: location?.city ?? course.city,
    state: location?.state,
    country: location?.country ?? course.country,
    name: course.name,
  });
  if (!coords) return course;

  return { ...course, latitude: coords.latitude, longitude: coords.longitude };
}
