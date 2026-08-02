import { useFocusEffect } from "expo-router";
import { MapPin, Users, X } from "lucide-react-native";
import React, { useCallback, useEffect, useState } from "react";
import { Animated, AppState, Pressable, StyleSheet, Text, View } from "react-native";

import { TeeButton } from "@/components/ui/TeeButton";
import { TeeModal } from "@/components/ui/TeeModal";
import { Colors, Spacing, Typography } from "@/constants/theme";
import { useJoinNearbyRound, useNearbyRounds, type Coords } from "@/hooks/useNearbyRounds";
import { usePressScale } from "@/hooks/usePressScale";
import { useSettings } from "@/providers/SettingsProvider";
import { type NearbyRound } from "@/services/db";
import { formatProximity } from "@/utils/geo";
import { tapLight } from "@/utils/haptics";

/**
 * D2: how often this card checks for a new round while it's actually the
 * thing on screen. The owner's report was that the old 60s poll made a
 * second player, already standing at the tee with the app open, wait far
 * too long for the card to appear once the host created the round. 8s reads
 * as "close to instant" for someone standing right there, while staying far
 * short of "every second" — nearby_open_rounds (migration 0014) is one
 * indexed range scan over open rounds plus a handful of great-circle
 * computations, cheap at this app's scale, but a timer this component owns
 * on its own should still not treat that as license to hammer it. Wired up
 * ONLY while `focused` (see below) is true — the tab navigator keeps this
 * component mounted, just off-screen, while the golfer is on Stats or
 * Settings, and an interval firing there would poll for a card nobody could
 * possibly see.
 */
const POLL_INTERVAL_MS = 8_000;

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
  const { unit } = useSettings();

  // Round ids the golfer has already said no to this session. Deliberately
  // component state, not persisted — the spec is "don't nag again this
  // session", not "never offer this round again."
  //
  // D1: this ONLY affects this popup. JoinGameSheet's own list of the same
  // rounds (GroupRoundSheets.tsx) deliberately does NOT consult this set —
  // dismissing an interruption is not the same decision as declining a
  // round, and a golfer who tapped outside this card by accident still has
  // a way back in via the Join sheet. Do not thread `dismissed` into that
  // sheet to "keep them in sync" — that would recreate the exact dead end
  // this fix removes.
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  // The round currently on screen. Kept separate from the query result (see
  // the effect below) so that dismissing/joining it doesn't yank the card out
  // from under TeeModal's own exit animation — same pattern StartRoundSheet
  // and JoinGameSheet use with their own "selected" state.
  const [current, setCurrent] = useState<NearbyRound | null>(null);

  // Whether the Courses tab is the one actually on screen right now. The tab
  // navigator keeps every tab mounted (just off-screen) rather than
  // unmounting inactive ones, so without this a golfer sitting on Stats or
  // Settings would still be polled for a card only Courses can show.
  const [focused, setFocused] = useState(false);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, [])
  );

  // Mirrors useNearbyRounds' own `enabled && coords != null` gate, plus
  // `focused`. Every manual refetch() below is guarded by this — a manual
  // refetch bypasses react-query's `enabled` option entirely, so without
  // this guard an event firing before the first GPS fix arrives would call
  // the query function with a null `coords` and crash on `coords!.latitude`.
  const canPoll = enabled && coords != null && focused;

  const nearbyQuery = useNearbyRounds(coords, enabled, {
    refetchInterval: focused ? POLL_INTERVAL_MS : false,
  });
  // Pulled out to a plain reference so the two effects below depend on a
  // function, not a call through `nearbyQuery.refetch()` — react-query's
  // observer binds `refetch` once and reuses it for the life of this query
  // (see useNearbyRounds), so this is stable across renders same as before.
  const { refetch: refetchNearby } = nearbyQuery;

  // D2, event 1: ask again immediately once conditions actually allow it —
  // covers regaining focus on this tab (and, incidentally, a GPS fix
  // arriving, or another sheet closing) — instead of waiting out the rest
  // of the poll interval.
  useEffect(() => {
    if (canPoll) refetchNearby();
  }, [canPoll, refetchNearby]);

  // D2, event 2: ask again when the app itself comes back from the
  // background — the other half of "two people standing together, one
  // creates the round while the other already has the app open [but
  // backgrounded]".
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active" && canPoll) refetchNearby();
    });
    return () => sub.remove();
  }, [canPoll, refetchNearby]);

  // Pick the next round to offer once nothing is already showing. Never
  // swaps the currently-visible offer for a "better" one mid-display — that
  // would read as the card changing under the golfer's thumb.
  useEffect(() => {
    if (current) return;
    const next = (nearbyQuery.data ?? []).find((r) => !dismissed.has(r.roundId));
    if (next) setCurrent(next);
  }, [nearbyQuery.data, dismissed, current]);

  const join = useJoinNearbyRound({
    onUnavailable: (roundId) => {
      setDismissed((prev) => new Set(prev).add(roundId));
      setCurrent(null);
      nearbyQuery.refetch();
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
          onPress={() => current && coords && join.mutate({ round: current, coords })}
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
