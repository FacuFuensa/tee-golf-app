import type { Club } from "@/types/models";
import type { Weather } from "@/services/weather";

import { bearingDegrees } from "./geo";

/**
 * Smart Caddy tuning. Every coefficient lives here so the plays-like model is
 * easy to dial in later without touching the math or UI. Values are deliberately
 * conservative — a caddy nudges, it doesn't overcorrect.
 */
export const CADDY_CONFIG = {
  /** Carry is calibrated to this air temperature (≈70°F). */
  baselineTempC: 21,
  /**
   * Fractional carry change per °C away from baseline. Colder, denser air = the
   * ball carries shorter, so the shot "plays longer". ~0.18% per °C ≈ a couple
   * of yards per 10°F on a mid-iron.
   */
  tempPctPerDegreeC: 0.0018,
  /**
   * Plays-like change per mph of HEADWIND, as a fraction of the raw distance.
   * Headwind makes the shot play longer.
   */
  headwindPctPerMph: 0.01,
  /**
   * Plays-like change per mph of TAILWIND. A tailwind helps less than a headwind
   * hurts, so this is smaller.
   */
  tailwindPctPerMph: 0.005,
  /** Below this head/tail component (mph) wind is treated as pure crosswind. */
  windDeadbandMph: 1,
} as const;

const MPS_TO_MPH = 2.2369363;

export interface PlaysLikeBreakdown {
  rawMeters: number;
  playsLikeMeters: number;
  /** Meters added/removed by temperature (positive = plays longer). */
  tempDeltaMeters: number;
  /** Meters added/removed by wind (positive = plays longer). */
  windDeltaMeters: number;
  /** Signed head/tail component in mph: + headwind, - tailwind. */
  headwindMph: number;
  /** Crosswind magnitude in mph (always ≥ 0). */
  crosswindMph: number;
  /** Whether weather was available; false ⇒ plays-like equals raw. */
  hasWeather: boolean;
}

/**
 * Convert a raw GPS distance-to-green into a "plays-like" distance using the
 * current conditions. The shot bearing is computed from the player → green GPS
 * points so wind can be split into head/tail (affects distance) and cross
 * (affects aim, minimal distance change). Returns a full breakdown so the UI can
 * show each contribution.
 */
export function computePlaysLike(
  rawMeters: number,
  player: { latitude: number; longitude: number },
  green: { latitude: number; longitude: number },
  weather: Weather | null
): PlaysLikeBreakdown {
  if (!weather) {
    return {
      rawMeters,
      playsLikeMeters: rawMeters,
      tempDeltaMeters: 0,
      windDeltaMeters: 0,
      headwindMph: 0,
      crosswindMph: 0,
      hasWeather: false,
    };
  }

  // Temperature: deviation below baseline makes the ball carry shorter, so the
  // shot plays longer (positive delta).
  const tempDeviation = CADDY_CONFIG.baselineTempC - weather.tempC;
  const tempDeltaMeters = rawMeters * tempDeviation * CADDY_CONFIG.tempPctPerDegreeC;

  // Wind: split the wind vector along the shot line. windFromDeg is the bearing
  // the wind blows FROM; when that matches the shot bearing the wind is blowing
  // straight back at the player → headwind.
  const shotBearing = bearingDegrees(
    player.latitude,
    player.longitude,
    green.latitude,
    green.longitude
  );
  const angle = ((weather.windFromDeg - shotBearing) * Math.PI) / 180;
  const speedMph = weather.windSpeedMps * MPS_TO_MPH;
  const headwindMph = speedMph * Math.cos(angle); // + head, - tail
  const crosswindMph = Math.abs(speedMph * Math.sin(angle));

  let windDeltaMeters = 0;
  if (headwindMph > CADDY_CONFIG.windDeadbandMph) {
    windDeltaMeters = rawMeters * headwindMph * CADDY_CONFIG.headwindPctPerMph;
  } else if (headwindMph < -CADDY_CONFIG.windDeadbandMph) {
    // headwindMph is negative here, so this reduces the plays-like distance.
    windDeltaMeters = rawMeters * headwindMph * CADDY_CONFIG.tailwindPctPerMph;
  }

  const playsLikeMeters = Math.max(0, rawMeters + tempDeltaMeters + windDeltaMeters);

  return {
    rawMeters,
    playsLikeMeters,
    tempDeltaMeters,
    windDeltaMeters,
    headwindMph,
    crosswindMph,
    hasWeather: true,
  };
}

/**
 * How well the recommended club actually fits the shot.
 *
 * "closest carry wins" is the right rule in the middle of the bag, but it lies
 * at both ends. A 30-yard pitch is closest to a 65-yard lob wedge, and naming
 * that club with no qualifier reads as "hit your lob wedge" — which would put
 * the ball 35 yards past the flag. Same on the long end: a 280-yard shot is
 * "closest" to a driver you carry 230.
 */
export type ClubFit = "full" | "partial" | "beyond";

export interface ClubRecommendation {
  club: Club;
  fit: ClubFit;
  /** Meters between the shot and that club's carry. Positive = shot is longer. */
  deltaMeters: number;
}

/**
 * A shot within this fraction of a club's carry is a normal swing. Outside it,
 * at the ends of the bag, the golfer is manufacturing a shot rather than
 * choosing a club.
 */
const FULL_SWING_TOLERANCE = 0.1;

/** Match a plays-like distance to the club in the bag that best fits the shot. */
export function recommendClub(
  playsLikeMeters: number,
  clubs: Club[]
): ClubRecommendation | null {
  if (clubs.length === 0) return null;

  let best = clubs[0];
  let bestDiff = Math.abs(clubs[0].carry_meters - playsLikeMeters);
  for (const club of clubs) {
    const diff = Math.abs(club.carry_meters - playsLikeMeters);
    if (diff < bestDiff) {
      best = club;
      bestDiff = diff;
    }
  }

  const carries = clubs.map((c) => c.carry_meters);
  const shortest = Math.min(...carries);
  const longest = Math.max(...carries);
  const deltaMeters = playsLikeMeters - best.carry_meters;

  let fit: ClubFit = "full";
  if (playsLikeMeters < shortest * (1 - FULL_SWING_TOLERANCE)) {
    fit = "partial";
  } else if (playsLikeMeters > longest * (1 + FULL_SWING_TOLERANCE)) {
    fit = "beyond";
  }

  return { club: best, fit, deltaMeters };
}

/** Qualitative wind type for short, glanceable copy. */
export type WindKind = "head" | "tail" | "cross" | "calm";

export function windKind(breakdown: PlaysLikeBreakdown): WindKind {
  if (!breakdown.hasWeather) return "calm";
  const head = breakdown.headwindMph;
  const cross = breakdown.crosswindMph;
  const absHead = Math.abs(head);
  if (absHead < CADDY_CONFIG.windDeadbandMph && cross < CADDY_CONFIG.windDeadbandMph) {
    return "calm";
  }
  if (cross > absHead) return "cross";
  return head > 0 ? "head" : "tail";
}
