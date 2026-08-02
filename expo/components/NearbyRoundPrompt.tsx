import { useMutation, useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { MapPin, Users, X } from "lucide-react-native";
import React, { useEffect, useState } from "react";
import { Alert, Animated, Pressable, StyleSheet, Text, View } from "react-native";

import { TeeButton } from "@/components/ui/TeeButton";
import { TeeModal } from "@/components/ui/TeeModal";
import { Colors, Spacing, Typography } from "@/constants/theme";
import { usePressScale } from "@/hooks/usePressScale";
import { useSettings } from "@/providers/SettingsProvider";
import { fetchNearbyOpenRounds, joinNearbyRound, type NearbyRound } from "@/services/db";
import { formatProximity } from "@/utils/geo";
import { notifySuccess, tapLight } from "@/utils/haptics";

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
const NEARBY_ROUND_RADIUS_METERS = 1000;

interface Coords {
  latitude: number;
  longitude: number;
}

/** Small circular icon button, same treatment as GroupRoundSheets' CloseButton. */
function CloseButton({ onPress }: { onPress: () => void }) {
  const { scale, onPressIn, onPressOut } = usePressScale();
  return (
    <Pressable onPress={onPress} onPressIn={onPressIn} onPressOut={onPressOut} hitSlop={8}>
      <Animated.View style={[styles.close, { transform: [{ scale }] }]}>
        <X size={20} color={Colors.primary} strokeWidth={2.4} />
      </Animated.View>
    </Pressable>
  );
}

/**
 * Offers the closest open group round at the course the golfer is currently
 * standing on. Nothing renders until there's both a location fix and a real
 * round to offer — a missing GPS fix is simply not an error state here (see
 * useLiveLocation's own contract), it just means this never appears.
 */
export function NearbyRoundPrompt({
  coords,
  enabled,
}: {
  coords: Coords | null;
  /** False suppresses the query entirely — e.g. not signed in, or another sheet is already open. */
  enabled: boolean;
}) {
  const router = useRouter();
  const { unit } = useSettings();

  // Round ids the golfer has already said no to this session. Deliberately
  // component state, not persisted — the spec is "don't nag again this
  // session", not "never offer this round again."
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  // The round currently on screen. Kept separate from the query result (see
  // the effect below) so that dismissing/joining it doesn't yank the card out
  // from under TeeModal's own exit animation — same pattern StartRoundSheet
  // and JoinGameSheet use with their own "selected" state.
  const [current, setCurrent] = useState<NearbyRound | null>(null);

  const placeKey = coords
    ? `${coords.latitude.toFixed(3)},${coords.longitude.toFixed(3)}`
    : null;

  const nearbyQuery = useQuery({
    queryKey: ["nearby-open-rounds", placeKey],
    queryFn: () =>
      fetchNearbyOpenRounds(coords!.latitude, coords!.longitude, NEARBY_ROUND_RADIUS_METERS),
    enabled: enabled && coords != null,
    // A host's round can open (or close) while this tab just sits idle, so
    // this can't be fetch-once — but it also isn't worth polling hard.
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  // Pick the next round to offer once nothing is already showing. Never
  // swaps the currently-visible offer for a "better" one mid-display — that
  // would read as the card changing under the golfer's thumb.
  useEffect(() => {
    if (current) return;
    const next = (nearbyQuery.data ?? []).find((r) => !dismissed.has(r.roundId));
    if (next) setCurrent(next);
  }, [nearbyQuery.data, dismissed, current]);

  const join = useMutation({
    mutationFn: () => {
      if (!coords || !current) throw new Error("Nothing to join");
      return joinNearbyRound(
        current.roundId,
        coords.latitude,
        coords.longitude,
        NEARBY_ROUND_RADIUS_METERS
      );
    },
    onSuccess: (result) => {
      if (result.status === "unavailable") {
        // Its own outcome, never success: the round moved on (finished, the
        // host turned discovery off, or it simply aged out) between being
        // offered and being tapped. Same "unavailable is not an error, and
        // is not success" contract as join_nearby_round's own doc comment.
        setDismissed((prev) => new Set(prev).add(result.roundId));
        setCurrent(null);
        nearbyQuery.refetch();
        Alert.alert(
          "Round no longer open",
          "That round isn't accepting players anymore — it may have finished or closed to new joins."
        );
        return;
      }
      notifySuccess();
      // Same navigation the join-by-code flow uses on success (see
      // JoinGameSheet's caller in app/(tabs)/courses.tsx).
      router.push(`/round/${result.roundId}`);
    },
    onError: () => {
      Alert.alert("Couldn't join", "Please try again in a moment.");
    },
  });

  const dismiss = (): void => {
    if (!current) return;
    tapLight();
    setDismissed((prev) => new Set(prev).add(current.roundId));
    setCurrent(null);
  };

  const visible = current != null;

  return (
    <TeeModal visible={visible} onClose={dismiss} dismissable={!join.isPending}>
      <View style={styles.body}>
        <View style={styles.head}>
          <View style={styles.headText}>
            <Text style={styles.overline}>OPEN ROUND NEARBY</Text>
            <Text style={styles.title} numberOfLines={2}>
              {current?.hostDisplayName ?? "Someone"} is hosting at {current?.courseName ?? "this course"}
            </Text>
          </View>
          <CloseButton onPress={dismiss} />
        </View>

        <View style={styles.meta}>
          <MapPin size={14} color={Colors.accent} strokeWidth={2.4} />
          <Text style={styles.metaText}>
            {current ? formatProximity(current.distanceMeters, unit) : ""} away
          </Text>
        </View>

        <TeeButton
          label="Join round"
          onPress={() => join.mutate()}
          loading={join.isPending}
          style={styles.joinCta}
          icon={<Users size={18} color={Colors.onPrimary} strokeWidth={2.4} />}
        />
      </View>
    </TeeModal>
  );
}

const styles = StyleSheet.create({
  body: { gap: Spacing.md },
  head: { flexDirection: "row", alignItems: "flex-start", gap: Spacing.md },
  headText: { flex: 1, gap: 4 },
  overline: { ...Typography.overline, fontSize: 10 },
  title: { ...Typography.title, fontSize: 21, lineHeight: 26 },
  close: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.primarySoft,
  },
  meta: { flexDirection: "row", alignItems: "center", gap: 6 },
  metaText: { ...Typography.subhead, color: Colors.textSecondary },
  joinCta: { marginTop: Spacing.sm },
});
