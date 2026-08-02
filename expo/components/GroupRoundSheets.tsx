import { Flag, MapPin, Users, X } from "lucide-react-native";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { TeeButton } from "@/components/ui/TeeButton";
import { TeeModal } from "@/components/ui/TeeModal";
import { Colors, Radius, Spacing, Typography, hairline } from "@/constants/theme";
import { useJoinNearbyRound, useNearbyRounds, type Coords } from "@/hooks/useNearbyRounds";
import { usePressScale } from "@/hooks/usePressScale";
import { useSettings } from "@/providers/SettingsProvider";
import type { NearbyRound } from "@/services/db";
import type { Course } from "@/types/models";
import { formatProximity } from "@/utils/geo";

/** Small circular icon button shared by both modals below — press-scales like everything else in these flows. */
function CloseButton({ onPress, disabled }: { onPress: () => void; disabled?: boolean }) {
  const { scale, onPressIn, onPressOut } = usePressScale();
  return (
    <Pressable onPress={onPress} onPressIn={onPressIn} onPressOut={onPressOut} disabled={disabled} hitSlop={8}>
      <Animated.View style={[styles.close, { transform: [{ scale }] }]}>
        <X size={20} color={Colors.primary} strokeWidth={2.4} />
      </Animated.View>
    </Pressable>
  );
}

/** Centered popup shown when a course is tapped: play solo or host a group. */
export function StartRoundSheet({
  course,
  soloLoading,
  hostLoading,
  onSolo,
  onHost,
  onClose,
}: {
  course: Course | null;
  soloLoading: boolean;
  hostLoading: boolean;
  onSolo: () => void;
  onHost: () => void;
  onClose: () => void;
}) {
  const visible = course !== null;
  const busy = soloLoading || hostLoading;

  return (
    <TeeModal visible={visible} onClose={onClose} dismissable={!busy}>
      <View style={styles.body}>
        <View style={styles.sheetHead}>
          <View style={styles.rowLeft}>
            <Text style={styles.overline}>START A ROUND</Text>
            <Text style={styles.sheetTitle} numberOfLines={1}>
              {course?.name ?? "Course"}
            </Text>
          </View>
          <CloseButton onPress={onClose} disabled={busy} />
        </View>

        <ChoiceRow
          icon={<Flag size={22} color={Colors.accent} strokeWidth={2.4} />}
          title="Play solo"
          subtitle="Track your own scorecard and GPS distances."
          loading={soloLoading}
          disabled={busy}
          onPress={onSolo}
        />
        <ChoiceRow
          icon={<Users size={22} color={Colors.accent} strokeWidth={2.4} />}
          title="Host a group"
          subtitle="Get a code friends enter to score together live."
          loading={hostLoading}
          disabled={busy}
          onPress={onHost}
        />
      </View>
    </TeeModal>
  );
}

function ChoiceRow({
  icon,
  title,
  subtitle,
  loading,
  disabled,
  onPress,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  loading: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  const { scale, onPressIn, onPressOut } = usePressScale();
  return (
    <Pressable onPress={onPress} onPressIn={onPressIn} onPressOut={onPressOut} disabled={disabled}>
      <Animated.View style={[styles.choice, loading && styles.choiceActive, { transform: [{ scale }] }]}>
        <View style={styles.choiceIcon}>{icon}</View>
        <View style={styles.rowLeft}>
          <Text style={styles.choiceTitle}>{title}</Text>
          <Text style={styles.choiceSub}>{subtitle}</Text>
        </View>
        {loading ? <View style={styles.dot} /> : null}
      </Animated.View>
    </Pressable>
  );
}

/** One open round at the course the golfer is standing on, listed above the code field. */
function NearbyRoundRow({
  round,
  unit,
  loading,
  disabled,
  onPress,
}: {
  round: NearbyRound;
  unit: "yards" | "meters";
  loading: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  const { scale, onPressIn, onPressOut } = usePressScale();
  return (
    <Pressable
      onPress={onPress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      disabled={disabled}
    >
      <Animated.View style={[styles.nearbyRow, { transform: [{ scale }] }]}>
        <View style={styles.nearbyRowIcon}>
          <Users size={18} color={Colors.accent} strokeWidth={2.4} />
        </View>
        <View style={styles.rowLeft}>
          <Text style={styles.nearbyRowTitle} numberOfLines={1}>
            {round.hostDisplayName} at {round.courseName}
          </Text>
          <View style={styles.nearbyRowMeta}>
            <MapPin size={12} color={Colors.textTertiary} strokeWidth={2.4} />
            <Text style={styles.nearbyRowMetaText}>
              {formatProximity(round.distanceMeters, unit)} away
            </Text>
          </View>
        </View>
        {loading ? <ActivityIndicator color={Colors.accent} size="small" /> : null}
      </Animated.View>
    </Pressable>
  );
}

/**
 * Centered popup for joining a friend's round: any open round at the course
 * you're standing on right now, tappable directly, above a 6-character code
 * field kept as the fallback for when you're not at the course (or nothing
 * nearby shows up).
 */
export function JoinGameSheet({
  visible,
  loading,
  error,
  coords,
  onJoin,
  onClose,
}: {
  visible: boolean;
  loading: boolean;
  error: string | null;
  /** Live GPS fix, same one courses.tsx feeds NearbyRoundPrompt — used only to look up open rounds at the course the golfer is standing on right now. */
  coords: Coords | null;
  onJoin: (code: string) => void;
  onClose: () => void;
}) {
  const [code, setCode] = useState<string>("");
  const { unit } = useSettings();

  // Clear the field on every fresh open, same as the old Modal's onShow did —
  // TeeModal fully unmounts between opens, so this effect (keyed on the
  // caller's `visible`) is what replaces that.
  useEffect(() => {
    if (visible) setCode("");
  }, [visible]);

  // D1: the same nearby-round query NearbyRoundPrompt polls, only enabled
  // while this sheet is actually open. Fetch-once (no interval) is correct
  // here — see useNearbyRounds' own default — this sheet doesn't sit open
  // long enough to be worth polling, and it shares a cache entry with
  // whatever the prompt has already fetched for the same rounded location.
  //
  // Deliberately NOT filtered against NearbyRoundPrompt's `dismissed` set: a
  // round the golfer swiped away on that popup still belongs here. That
  // popup's dismissal is a decision about the interruption, not about the
  // round — see NearbyRoundPrompt's own comment on `dismissed` for why. This
  // component doesn't even receive that set as a prop; don't add one to
  // "keep them in sync".
  const nearbyQuery = useNearbyRounds(coords, visible);
  const nearbyRounds = nearbyQuery.data ?? [];

  // D1: exactly the same join path as the prompt's "Join round" button,
  // 'unavailable' outcome included — see useJoinNearbyRound. A round that
  // went stale between being listed and being tapped is dropped from view
  // by re-fetching, rather than left behind as a dead row someone could tap
  // again.
  const join = useJoinNearbyRound({
    onUnavailable: () => nearbyQuery.refetch(),
    // RN's Modal renders above whatever screen gets pushed next — close this
    // sheet on success or it would still be sitting on top of the round
    // screen we just navigated to. Same reason the code-join path a few
    // lines down calls setShowJoin(false) in its own onSuccess.
    onJoined: onClose,
  });

  const submit = (): void => {
    if (code.trim().length < 4) return;
    onJoin(code.trim().toUpperCase());
  };

  const busy = loading || join.isPending;

  return (
    <TeeModal visible={visible} onClose={onClose} dismissable={!busy}>
      <View style={styles.body}>
        <View style={styles.sheetHead}>
          <View style={styles.rowLeft}>
            <Text style={styles.overline}>JOIN A GROUP</Text>
            <Text style={styles.sheetTitle}>Enter the code</Text>
          </View>
          <CloseButton onPress={onClose} disabled={busy} />
        </View>

        {/*
          Nothing renders here at all when there's no GPS fix or no open
          round nearby — same "no empty state, no placeholder" contract as
          NearbyRoundPrompt, so the sheet looks exactly as it did before D1
          whenever there's nothing to add above the code field.
        */}
        {coords && nearbyRounds.length > 0 ? (
          <View style={styles.nearbyList}>
            {nearbyRounds.map((round) => (
              <NearbyRoundRow
                key={round.roundId}
                round={round}
                unit={unit}
                loading={join.isPending && join.variables?.round.roundId === round.roundId}
                disabled={busy}
                onPress={() => {
                  if (busy || !coords) return;
                  join.mutate({ round, coords });
                }}
              />
            ))}
            <View style={styles.orDivider}>
              <View style={styles.orLine} />
              <Text style={styles.orText}>OR ENTER A CODE</Text>
              <View style={styles.orLine} />
            </View>
          </View>
        ) : null}

        <TextInput
          value={code}
          onChangeText={(t) => setCode(t.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
          placeholder="ABC123"
          placeholderTextColor={Colors.textTertiary}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={6}
          style={styles.codeInput}
          returnKeyType="go"
          onSubmitEditing={submit}
          editable={!busy}
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}

        <TeeButton
          label="Join group"
          onPress={submit}
          loading={loading}
          disabled={code.trim().length < 4 || busy}
          style={styles.joinCta}
          icon={<Users size={18} color={Colors.onPrimary} strokeWidth={2.4} />}
        />
      </View>
    </TeeModal>
  );
}

const styles = StyleSheet.create({
  body: { gap: Spacing.md },
  sheetHead: { flexDirection: "row", alignItems: "center", gap: Spacing.md },
  rowLeft: { flex: 1, gap: 3 },
  overline: { ...Typography.overline, fontSize: 10 },
  sheetTitle: { ...Typography.title, fontSize: 24 },
  close: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.primarySoft,
  },
  choice: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: hairline,
    borderColor: Colors.border,
    padding: Spacing.lg,
  },
  choiceActive: { borderColor: Colors.accent, backgroundColor: Colors.accentSoft },
  choiceIcon: {
    width: 48,
    height: 48,
    borderRadius: Radius.md,
    backgroundColor: Colors.accentSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  choiceTitle: { ...Typography.headline, fontSize: 18 },
  choiceSub: { ...Typography.subhead, color: Colors.textSecondary, lineHeight: 18 },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: Colors.accent },
  codeInput: {
    height: 64,
    borderRadius: Radius.md,
    borderWidth: 1.5,
    borderColor: Colors.borderStrong,
    backgroundColor: Colors.surface,
    textAlign: "center",
    fontSize: 30,
    fontWeight: "800",
    letterSpacing: 8,
    color: Colors.primary,
  },
  error: { ...Typography.subhead, color: Colors.danger, textAlign: "center" },
  joinCta: { marginTop: Spacing.xs },
  nearbyList: { gap: Spacing.sm },
  nearbyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    backgroundColor: Colors.accentSoft,
    borderRadius: Radius.md,
    borderWidth: hairline,
    borderColor: Colors.accent,
    padding: Spacing.md,
  },
  nearbyRowIcon: {
    width: 40,
    height: 40,
    borderRadius: Radius.sm,
    backgroundColor: Colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  nearbyRowTitle: { ...Typography.callout, fontWeight: "700" },
  nearbyRowMeta: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 },
  nearbyRowMetaText: { ...Typography.caption, color: Colors.textSecondary, letterSpacing: 0 },
  orDivider: { flexDirection: "row", alignItems: "center", gap: Spacing.sm, marginTop: 2 },
  orLine: { flex: 1, height: hairline, backgroundColor: Colors.border },
  orText: { ...Typography.caption, color: Colors.textTertiary, letterSpacing: 1 },
});
