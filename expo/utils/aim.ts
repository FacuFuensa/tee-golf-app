import { haversineMeters } from "./geo";

export interface AimShot {
  /**
   * Distance from the player to the aim point, in meters — the shot about to
   * be hit. Null when there's no location fix yet: the player's position, not
   * the aim point, is what's missing.
   */
  toAimMeters: number | null;
  /**
   * Distance remaining from the aim point to the green, in meters — what's
   * left after that shot. Null when the hole has no pinned green: that number
   * is unknowable, not zero, so callers must never print it as a distance.
   * Computed independently of the player's position, so it's available even
   * before a GPS fix (e.g. planning an aim point from home).
   */
  aimToGreenMeters: number | null;
}

/**
 * Distances for a temporary aim point dropped somewhere short of (or past)
 * the green — the "how far to that bunker, and what's left after" the golfer
 * actually wants when the green itself is out of reach.
 *
 * The two legs are computed independently: `toAimMeters` needs the player's
 * position, `aimToGreenMeters` doesn't. That matters because an aim point can
 * be set before a GPS fix arrives (same as mapping a green from home), and
 * "what's left" shouldn't wait on a signal it doesn't actually need.
 *
 * An aim point placed beyond the green — aiming through a dogleg, say — is
 * legitimate: haversine distance doesn't care about direction, so this simply
 * returns the real (positive) distance rather than treating it as an error.
 */
export function computeAimShot(
  player: { latitude: number; longitude: number } | null,
  aim: { latitude: number; longitude: number },
  green: { latitude: number; longitude: number } | null
): AimShot {
  const toAimMeters =
    player != null
      ? haversineMeters(player.latitude, player.longitude, aim.latitude, aim.longitude)
      : null;
  const aimToGreenMeters =
    green != null
      ? haversineMeters(aim.latitude, aim.longitude, green.latitude, green.longitude)
      : null;
  return { toAimMeters, aimToGreenMeters };
}
