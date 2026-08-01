import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ChevronLeft, Trash2, Users } from "lucide-react-native";
import React, { useMemo } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { TeeButton } from "@/components/ui/TeeButton";
import { TeeCard } from "@/components/ui/TeeCard";
import { Colors, Fonts, Radius, Spacing, Typography, hairline } from "@/constants/theme";
import { useAuth } from "@/providers/AuthProvider";
import { deleteMyRound, fetchLeaderboard, fetchRoundBundle } from "@/services/db";
import { buildScorecard, type ScorecardCell } from "@/utils/scorecard";
import { classifyHole, formatToPar, type ScoreClass } from "@/utils/stats";
import { notifySuccess, tapLight } from "@/utils/haptics";

const CLASS_COLORS: Record<ScoreClass, string> = {
  eagle: "#C7A24A",
  birdie: "#4E8C6A",
  par: "#1C3A2B",
  bogey: "#9BA59C",
  double: "#B0463B",
  triple: "#6E2F28",
};

export default function RoundDetailScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { roundId: param } = useLocalSearchParams<{ roundId: string }>();
  const roundId = typeof param === "string" ? param : "";
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const bundleQuery = useQuery({
    queryKey: ["round", roundId],
    queryFn: () => fetchRoundBundle(roundId),
    enabled: roundId.length > 0,
  });

  const isMultiplayer = bundleQuery.data?.round.is_multiplayer ?? false;

  const boardQuery = useQuery({
    queryKey: ["leaderboard", roundId],
    queryFn: () => fetchLeaderboard(roundId),
    enabled: roundId.length > 0 && isMultiplayer,
  });

  // Only this golfer's scores drive the card; a group round holds everyone's.
  const myScores = useMemo<Record<string, number>>(() => {
    const out: Record<string, number> = {};
    for (const s of bundleQuery.data?.scores ?? []) {
      if (s.profile_id === user?.id) out[s.hole_id] = s.strokes;
    }
    return out;
  }, [bundleQuery.data, user?.id]);

  const card = useMemo(
    () => (bundleQuery.data ? buildScorecard(bundleQuery.data.holes, myScores) : null),
    [bundleQuery.data, myScores]
  );

  const remove = useMutation({
    mutationFn: () => deleteMyRound(roundId),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["player-rounds"] });
      if (result === "not_found") {
        Alert.alert("Round not found", "This round is no longer in your history.");
      } else {
        notifySuccess();
      }
      router.back();
    },
    onError: () => {
      Alert.alert(
        "Couldn't remove the round",
        "It's still in your history. Check your connection and try again."
      );
    },
  });

  const confirmRemove = (): void => {
    tapLight();
    Alert.alert(
      isMultiplayer ? "Leave this round?" : "Delete this round?",
      isMultiplayer
        ? "Your scores will be erased and it will disappear from your statistics. If other players are in it, the round stays for them."
        : "Your scores for all holes will be erased and it will disappear from your statistics. This can't be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: isMultiplayer ? "Leave" : "Delete",
          style: "destructive",
          onPress: () => remove.mutate(),
        },
      ]
    );
  };

  return (
    <View style={styles.container}>
      <View style={[styles.topBar, { paddingTop: insets.top + Spacing.sm }]}>
        <Pressable style={styles.iconButton} onPress={() => router.back()} hitSlop={8}>
          <ChevronLeft size={24} color={Colors.primary} strokeWidth={2.4} />
        </Pressable>
        <Text style={styles.topTitle} numberOfLines={1}>
          {bundleQuery.data?.course.name ?? "Round"}
        </Text>
        <View style={styles.iconButton} />
      </View>

      {bundleQuery.isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={Colors.accent} />
        </View>
      ) : bundleQuery.isError || !bundleQuery.data || !card ? (
        <View style={styles.center}>
          <Text style={styles.emptyTitle}>Couldn&apos;t load this round</Text>
          <Text style={styles.emptyBody}>
            Your scores are safe — we just couldn&apos;t reach them right now.
          </Text>
          <TeeButton
            label="Try again"
            variant="secondary"
            onPress={() => bundleQuery.refetch()}
            style={styles.retry}
          />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.hero}>
            <Text style={styles.heroEyebrow}>{formatFullDate(bundleQuery.data.round.finished_at ?? bundleQuery.data.round.started_at)}</Text>
            <Text style={styles.heroNumber}>{card.totalStrokes}</Text>
            <Text style={styles.heroMeta}>
              {formatToPar(card.toPar)} · {card.holesScored} {card.holesScored === 1 ? "hole" : "holes"}
            </Text>
          </View>

          {card.nines.map((nine) => (
            <TeeCard key={nine.label} style={styles.nineCard}>
              <View style={styles.nineHeader}>
                <Text style={styles.nineLabel}>{nine.label}</Text>
                <Text style={styles.nineTotals}>
                  {nine.strokes} · par {nine.par}
                </Text>
              </View>
              {nine.cells.map((cell) => (
                <HoleRow key={cell.number} cell={cell} />
              ))}
            </TeeCard>
          ))}

          {isMultiplayer && (boardQuery.data?.length ?? 0) > 0 ? (
            <TeeCard style={styles.nineCard}>
              <View style={styles.nineHeader}>
                <Users size={15} color={Colors.primary} strokeWidth={2.6} />
                <Text style={styles.nineLabel}>Players</Text>
              </View>
              {(boardQuery.data ?? []).map((entry) => (
                <View key={entry.profileId} style={styles.playerRow}>
                  <Text style={styles.playerName} numberOfLines={1}>
                    {entry.name}
                  </Text>
                  <Text style={styles.playerScore}>
                    {entry.total} ({formatToPar(entry.toPar)})
                  </Text>
                </View>
              ))}
            </TeeCard>
          ) : null}

          <TeeButton
            label={isMultiplayer ? "Leave this round" : "Delete this round"}
            variant="danger"
            icon={<Trash2 size={17} color={Colors.danger} strokeWidth={2.4} />}
            onPress={confirmRemove}
            loading={remove.isPending}
            style={styles.deleteButton}
          />
        </ScrollView>
      )}
    </View>
  );
}

function HoleRow({ cell }: { cell: ScorecardCell }) {
  const scored = cell.strokes != null;
  const tone = scored
    ? CLASS_COLORS[classifyHole({ number: cell.number, par: cell.par, strokes: cell.strokes as number })]
    : Colors.textTertiary;

  return (
    <View style={styles.holeRow}>
      <Text style={styles.holeNumber}>{cell.number}</Text>
      <Text style={styles.holePar}>Par {cell.par}</Text>
      <View style={styles.holeSpacer} />
      <View style={[styles.holeDot, { backgroundColor: scored ? tone : "transparent" }]} />
      <Text style={[styles.holeStrokes, !scored && styles.holeStrokesEmpty]}>
        {scored ? cell.strokes : "—"}
      </Text>
    </View>
  );
}

function formatFullDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.sm,
    gap: Spacing.sm,
  },
  iconButton: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  topTitle: { ...Typography.headline, flex: 1, textAlign: "center" },
  content: { paddingHorizontal: Spacing.xl, gap: Spacing.lg },
  center: { alignItems: "center", paddingTop: Spacing.xxxl, paddingHorizontal: Spacing.xl, gap: Spacing.sm },

  hero: {
    backgroundColor: Colors.primary,
    borderRadius: Radius.xl,
    padding: Spacing.xl,
    alignItems: "center",
  },
  heroEyebrow: { ...Typography.overline, color: Colors.onPrimary, opacity: 0.7, textAlign: "center" },
  heroNumber: { fontFamily: Fonts.serifSemibold, fontSize: 72, color: Colors.onPrimary, letterSpacing: -2 },
  heroMeta: { ...Typography.subhead, color: Colors.onPrimary, opacity: 0.75 },

  nineCard: { padding: Spacing.lg, gap: Spacing.xs },
  nineHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingBottom: Spacing.sm,
    borderBottomWidth: hairline,
    borderBottomColor: Colors.border,
    marginBottom: Spacing.xs,
  },
  nineLabel: { ...Typography.overline, flex: 1 },
  nineTotals: { ...Typography.caption, color: Colors.textSecondary },

  holeRow: { flexDirection: "row", alignItems: "center", paddingVertical: 7, gap: Spacing.sm },
  holeNumber: { fontFamily: Fonts.serifSemibold, fontSize: 16, color: Colors.primary, width: 26 },
  holePar: { ...Typography.caption, color: Colors.textTertiary },
  holeSpacer: { flex: 1 },
  holeDot: { width: 7, height: 7, borderRadius: 4 },
  holeStrokes: { fontFamily: Fonts.serifSemibold, fontSize: 18, color: Colors.primary, width: 26, textAlign: "right" },
  holeStrokesEmpty: { color: Colors.textTertiary },

  playerRow: { flexDirection: "row", alignItems: "center", paddingVertical: 8, gap: Spacing.md },
  playerName: { ...Typography.callout, flex: 1 },
  playerScore: { ...Typography.callout, color: Colors.textSecondary },

  deleteButton: { marginTop: Spacing.sm },
  emptyTitle: { ...Typography.title, fontSize: 22, marginTop: Spacing.lg },
  emptyBody: { ...Typography.body, color: Colors.textSecondary, textAlign: "center", lineHeight: 22 },
  retry: { marginTop: Spacing.lg, alignSelf: "stretch", maxWidth: 260 },
});
