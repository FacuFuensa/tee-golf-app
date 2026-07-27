export type DistanceUnit = "yards" | "meters";

const YARDS_PER_METER = 1.0936133;

/** Great-circle distance in meters (mirrors CLLocation.distance). */
export function haversineMeters(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number
): number {
  const R = 6371000;
  const toRad = (d: number): number => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function metersToUnit(meters: number, unit: DistanceUnit): number {
  return unit === "yards" ? meters * YARDS_PER_METER : meters;
}

export function unitToMeters(value: number, unit: DistanceUnit): number {
  return unit === "yards" ? value / YARDS_PER_METER : value;
}

/**
 * Initial great-circle bearing from A to B, in degrees clockwise from true
 * north (0 = north, 90 = east). Used to know which way the shot travels so wind
 * can be split into head/tail/cross components.
 */
export function bearingDegrees(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number
): number {
  const toRad = (d: number): number => (d * Math.PI) / 180;
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const dLng = toRad(bLng - aLng);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (Math.atan2(y, x) * 180) / Math.PI;
}

/** Rounded distance string in the active unit (no decimals — golf-style). */
export function formatDistance(meters: number, unit: DistanceUnit): string {
  return Math.round(metersToUnit(meters, unit)).toString();
}

export function unitLabel(unit: DistanceUnit): string {
  return unit === "yards" ? "yards to green" : "meters to green";
}

export function unitShort(unit: DistanceUnit): string {
  return unit === "yards" ? "yd" : "m";
}

const METERS_PER_MILE = 1609.344;

/**
 * Friendly travel-distance label for showing how far away a course is.
 * Imperial (yards) golfers see miles; metric golfers see kilometers. Close
 * distances drop to the short unit so "on the property" reads naturally.
 */
export function formatProximity(meters: number, unit: DistanceUnit): string {
  if (unit === "yards") {
    if (meters < 402) return `${Math.round(metersToUnit(meters, "yards"))} yd`;
    const miles = meters / METERS_PER_MILE;
    return `${miles < 10 ? miles.toFixed(1) : Math.round(miles)} mi`;
  }
  if (meters < 950) return `${Math.round(meters)} m`;
  const km = meters / 1000;
  return `${km < 10 ? km.toFixed(1) : Math.round(km)} km`;
}
