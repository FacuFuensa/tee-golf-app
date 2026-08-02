import { useMutation, useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { Alert } from "react-native";

import { fetchNearbyOpenRounds, joinNearbyRound, type NearbyRound } from "@/services/db";
import { notifySuccess } from "@/utils/haptics";

export interface Coords {
  latitude: number;
  longitude: number;
}

/**
 * "Standing on this course," not "in this town." `nearby_open_rounds`
 * measures from the golfer to the COURSE's own anchor point — its stored
 * latitude/longitude, or the centroid of its pinned greens (see migration
 * 0014) — which sits somewhere in the middle of the property, not at its
 * edge. A large 18-hole layout can span close to a kilometer end to end, so
 * 1 km of slack from that centre point covers any hole on a normal-sized
 * course with headroom, while staying nowhere near courses.tsx's own 80 km
 * "closest course you might be heading to" radius — that answers a
 * completely different question ("which course, of many, is mine?") than
 * this one ("is anyone already playing THIS course, right now?").
 */
export const NEARBY_ROUND_RADIUS_METERS = 1000;

export interface UseNearbyRoundsOptions {
  staleTime?: number;
  /**
   * false (the default) means "fetch on enable/mount and whenever asked,
   * never on a timer" — the right default for a query that only runs while
   * something is actually visible (e.g. JoinGameSheet's list, only mounted
   * while the sheet is open). Pass a number to actually poll on an interval;
   * NearbyRoundPrompt is the one caller that does, and its own comment says
   * why that number and not another.
   */
  refetchInterval?: number | false;
}

/**
 * Open group rounds at the course the golfer is currently standing on.
 * Shared by NearbyRoundPrompt (the unprompted "someone's hosting" card) and
 * JoinGameSheet's own list (the same rounds, offered from inside the Join
 * flow instead) — one query, one cache entry per rounded location, so the
 * two entry points can never disagree about what's nearby, and opening one
 * right after the other doesn't re-fetch data the other just brought back.
 */
export function useNearbyRounds(
  coords: Coords | null,
  enabled: boolean,
  options: UseNearbyRoundsOptions = {}
): UseQueryResult<NearbyRound[]> {
  const placeKey = coords
    ? `${coords.latitude.toFixed(3)},${coords.longitude.toFixed(3)}`
    : null;

  return useQuery({
    queryKey: ["nearby-open-rounds", placeKey],
    queryFn: () =>
      fetchNearbyOpenRounds(coords!.latitude, coords!.longitude, NEARBY_ROUND_RADIUS_METERS),
    enabled: enabled && coords != null,
    // A host's round can open (or close) while a screen holding this query
    // just sits idle, so this can't be fetch-once-and-forget — but 30s of
    // slack is plenty for cached data to still count as "current" when a
    // second consumer (JoinGameSheet) mounts moments after the first.
    staleTime: options.staleTime ?? 30_000,
    refetchInterval: options.refetchInterval ?? false,
  });
}

export interface UseJoinNearbyRoundOptions {
  /**
   * Called once the shared 'unavailable' handling below (the alert) has
   * already run — e.g. to drop the round from a local list or add it to a
   * dismissed-id set. Never called for 'joined' (navigation already leaves
   * the screen) or for a thrown error (its own alert already covers that).
   */
  onUnavailable?: (roundId: string) => void;
  /**
   * Called right before navigating to the newly-joined round. RN's `Modal`
   * renders above whatever the navigator pushes next, so a caller backed by
   * a TeeModal sheet should close it here — same reason
   * app/(tabs)/courses.tsx's own startSolo/startHost success handlers clear
   * `startCourse` before pushing. Optional: left unset by NearbyRoundPrompt,
   * whose own pre-existing "leave `current` alone on success" behaviour is
   * unrelated to D1/D2 and out of scope for this fix.
   */
  onJoined?: (roundId: string) => void;
}

/**
 * The one join path for a round surfaced by useNearbyRounds — used by both
 * NearbyRoundPrompt's "Join round" button and JoinGameSheet's list (see
 * GroupRoundSheets.tsx), so "what happens when you tap a nearby round" can
 * only ever mean one thing. Do not reimplement this at a call site: the
 * 'unavailable' branch is a product decision (see joinNearbyRound's own doc
 * comment on why a round that moved on is its own outcome, not an error),
 * not incidental behaviour worth duplicating.
 */
export function useJoinNearbyRound(options: UseJoinNearbyRoundOptions = {}) {
  const router = useRouter();
  const { onUnavailable, onJoined } = options;

  return useMutation({
    mutationFn: (args: { round: NearbyRound; coords: Coords }) =>
      joinNearbyRound(
        args.round.roundId,
        args.coords.latitude,
        args.coords.longitude,
        NEARBY_ROUND_RADIUS_METERS
      ),
    onSuccess: (result) => {
      if (result.status === "unavailable") {
        // Its own outcome, never success: the round moved on (finished, the
        // host turned discovery off, or it simply aged out) between being
        // offered and being tapped. Same "unavailable is not an error, and
        // is not success" contract as join_nearby_round's own doc comment.
        onUnavailable?.(result.roundId);
        Alert.alert(
          "Round no longer open",
          "That round isn't accepting players anymore — it may have finished or closed to new joins."
        );
        return;
      }
      notifySuccess();
      onJoined?.(result.roundId);
      // Same navigation the join-by-code flow uses on success (see
      // JoinGameSheet's caller in app/(tabs)/courses.tsx).
      router.push(`/round/${result.roundId}`);
    },
    onError: () => {
      Alert.alert("Couldn't join", "Please try again in a moment.");
    },
  });
}
