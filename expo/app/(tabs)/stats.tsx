import { useQuery } from "@tanstack/react-query";
import { Award, BarChart3, Flag, Target, TrendingDown } from "lucide-react-native";
import React, { useMemo } from "react";
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { TeeMark } from "@/components/TeeMark";
import { TeeCard } from "@/components/ui/TeeCard";
import { Colors, Fonts, Radius, Spacing, Typography, hairline } from "@/constants/theme";
import { useAuth } from "@/providers/AuthProvider";
import { fetchPlayerRounds } from "@/services/db";
import {
  computePlayerStats,
  formatPercent,
  formatToPar,
  formatToParDecimal,
  type PlayerStats,
  type RoundSummary,
  type ScoreBucket,
} from "@/utils/stats";

const BUCKET_COLORS: Record<string, string> = {
  eagle: "#C7A24A",
  birdie: "#4E8C6A",
  par: "#1C3A2B",
  bogey: "#9BA59C",
  double: "#B0463B",
  triple: "#6E2F28",
};

export default function StatsScreen() {
  const insets = useSafeAreaInsets();
  const { user, isConfigured } = useAuth();

  const roundsQuery = useQuery({
    queryKey: ["player-rounds", user?.id],
    queryFn: () => fetchPlayerRounds(user?.id ?? ""),
    enabled: isConfigured && !!user,
  });

  const stats = useMemo<PlayerStats | null>(
    () => (roundsQuery.data ? computePlayerStats(roundsQuery.data) : null),
    [roundsQuery.data]
  );

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + Spacing.xl, paddingBottom: insets.bottom + 32 },
        ]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={roundsQuery.isRefetching}
            onRefresh={() => roundsQuery.refetch()}
            tintColor={Colors.accent}
          />
        }
      >
        <Text style={styles.title}>Statistics</Text>
        <Text style={styles.subtitle}>Every round you play, distilled.</Text>

        {roundsQuery.isLoading ? (
          <View style={styles.center}>
            <ActivityIndicator color={Colors.accent} />
          </View>
        ) : !stats || stats.holesPlayed === 0 ? (
          <EmptyState />
        ) : (
          <StatsBody stats={stats} />
        )}
      </ScrollView>
    </View>
  );
}

function StatsBody({ stats }: { stats: PlayerStats }) {
  return (
    <View style={styles.body}>
      <HeroCard stats={stats} />

      <View style={styles.miniGrid}>
        <MiniStat
          icon={<Flag size={15} color={Colors.accent} strokeWidth={2.6} />}
          value={String(stats.roundsPlayed)}
          label={stats.roundsPlayed === 1 ? "Round" : "Rounds"}
        />
        <MiniStat
          icon={<Target size={15} color={Colors.accent} strokeWidth={2.6} />}
          value={stats.avgStrokesPerHole.toFixed(1)}
          label="Strokes / hole"
        />
        <MiniStat
          icon={<TrendingDown size={15} color={Colors.accent} strokeWidth={2.6} />}
          value={formatPercent(stats.parOrBetterRate)}
          label="Par or better"
        />
      </View>

      <TrendCard trend={stats.recentTrend} />
      <DistributionCard buckets={stats.buckets} total={stats.holesPlayed} />
      <ParTypeCard stats={stats} />
      {stats.best ? <BestRoundCard round={stats.best} /> : null}
      <RoundLog rounds={stats.rounds} />
    </View>
  );
}

function HeroCard({ stats }: { stats: PlayerStats }) {
  return (
    <View style={styles.hero}>
      <View style={styles.heroGlow} />
      <Text style={styles.heroEyebrow}>Scoring average · per 18 holes</Text>
      <Text style={styles.heroNumber}>{formatToPar(stats.scoringAvgToPar18)}</Text>
      <View style={styles.heroFooter}>
        <View style={styles.heroChip}>
          <Award size={13} color={Colors.gold} strokeWidth={2.6} />
          <Text style={styles.heroChipText}>{formatPercent(stats.birdieRate)} birdie rate</Text>
        </View>
        <Text style={styles.heroMeta}>{stats.holesPlayed} holes tracked</Text>
      </View>
    </View>
  );
}

function MiniStat({
  icon,
  value,
  label,
}: {
  icon: React.ReactNode;
  value: string;
  label: string;
}) {
  return (
    <TeeCard style={styles.mini}>
      <View style={styles.miniIcon}>{icon}</View>
      <Text style={styles.miniValue}>{value}</Text>
      <Text style={styles.miniLabel}>{label}</Text>
    </TeeCard>
  );
}

function TrendCard({ trend }: { trend: RoundSummary[] }) {
  if (trend.length < 2) return null;
  const values = trend.map((r) => r.toParPer18);
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = Math.max(max - min, 1);

  return (
    <TeeCard style={styles.card}>
      <CardHeader icon={<BarChart3 size={15} color={Colors.primary} strokeWidth={2.6} />}>
        Recent form
      </CardHeader>
      <Text style={styles.cardHint}>Score to par, projected to 18 — lower is better.</Text>
      <View style={styles.trendRow}>
        {trend.map((round) => {
          // Lower (better) scores → taller bars.
          const t = 1 - (round.toParPer18 - min) / span;
          const height = 26 + t * 78;
          const isBest = round.toParPer18 === min;
          return (
            <View key={round.id} style={styles.trendCol}>
              <Text style={styles.trendValue}>{formatToPar(round.toParPer18)}</Text>
              <View
                style={[
                  styles.trendBar,
                  { height, backgroundColor: isBest ? Colors.accent : Colors.primarySoft },
                ]}
              />
            </View>
          );
        })}
      </View>
    </TeeCard>
  );
}

function DistributionCard({
  buckets,
  total,
}: {
  buckets: ScoreBucket[];
  total: number;
}) {
  const present = buckets.filter((b) => b.count > 0);
  const maxCount = Math.max(...buckets.map((b) => b.count), 1);

  return (
    <TeeCard style={styles.card}>
      <CardHeader icon={<Flag size={15} color={Colors.primary} strokeWidth={2.6} />}>
        Scoring breakdown
      </CardHeader>

      <View style={styles.stackBar}>
        {present.map((b) => (
          <View
            key={b.key}
            style={{
              flex: b.count,
              backgroundColor: BUCKET_COLORS[b.key] ?? Colors.textTertiary,
            }}
          />
        ))}
      </View>

      <View style={styles.bucketList}>
        {buckets.map((b) => (
          <View key={b.key} style={styles.bucketRow}>
            <View style={[styles.swatch, { backgroundColor: BUCKET_COLORS[b.key] }]} />
            <Text style={styles.bucketLabel}>{b.label}</Text>
            <View style={styles.bucketTrack}>
              <View
                style={[
                  styles.bucketFill,
                  {
                    width: `${(b.count / maxCount) * 100}%`,
                    backgroundColor: BUCKET_COLORS[b.key],
                  },
                ]}
              />
            </View>
            <Text style={styles.bucketCount}>{b.count}</Text>
            <Text style={styles.bucketPct}>
              {total > 0 ? formatPercent(b.count / total) : "0%"}
            </Text>
          </View>
        ))}
      </View>
    </TeeCard>
  );
}

function ParTypeCard({ stats }: { stats: PlayerStats }) {
  if (stats.parTypes.length === 0) return null;
  return (
    <TeeCard style={styles.card}>
      <CardHeader icon={<Target size={15} color={Colors.primary} strokeWidth={2.6} />}>
        By hole type
      </CardHeader>
      <Text style={styles.cardHint}>Average score relative to par on each kind of hole.</Text>
      <View style={styles.parTypeRow}>
        {stats.parTypes.map((split) => {
          const good = split.avgToPar <= 0.0001;
          return (
            <View key={split.par} style={styles.parTypeCell}>
              <Text style={styles.parTypeName}>Par {split.par}</Text>
              <Text style={[styles.parTypeValue, { color: good ? Colors.accent : Colors.danger }]}>
                {formatToParDecimal(split.avgToPar)}
              </Text>
              <Text style={styles.parTypeMeta}>{split.holes} holes</Text>
            </View>
          );
        })}
      </View>
    </TeeCard>
  );
}

function BestRoundCard({ round }: { round: RoundSummary }) {
  return (
    <View style={styles.bestCard}>
      <View style={styles.bestIcon}>
        <Award size={18} color={Colors.gold} strokeWidth={2.4} />
      </View>
      <View style={styles.bestBody}>
        <Text style={styles.bestEyebrow}>Best round</Text>
        <Text style={styles.bestName} numberOfLines={1}>
          {round.courseName}
        </Text>
        <Text style={styles.bestMeta}>
          {round.holesPlayed} holes · {formatDate(round.date)}
        </Text>
      </View>
      <View style={styles.bestScore}>
        <Text style={styles.bestScoreValue}>{formatToPar(round.toPar)}</Text>
        <Text style={styles.bestScoreLabel}>{round.strokes} strokes</Text>
      </View>
    </View>
  );
}

function RoundLog({ rounds }: { rounds: RoundSummary[] }) {
  return (
    <View style={styles.logSection}>
      <Text style={styles.sectionLabel}>Round history</Text>
      <TeeCard padded={false} style={styles.logCard}>
        {rounds.map((round, index) => (
          <View key={round.id}>
            {index > 0 ? <View style={styles.logDivider} /> : null}
            <View style={styles.logRow}>
              <View style={styles.logLeft}>
                <Text style={styles.logName} numberOfLines={1}>
                  {round.courseName}
                </Text>
                <Text style={styles.logMeta}>
                  {formatDate(round.date)} · {round.holesPlayed} holes
                </Text>
              </View>
              <View style={styles.logRight}>
                <Text style={styles.logStrokes}>{round.strokes}</Text>
                <View
                  style={[
                    styles.logBadge,
                    { backgroundColor: round.toPar <= 0 ? Colors.accentSoft : Colors.dangerSoft },
                  ]}
                >
                  <Text
                    style={[
                      styles.logBadgeText,
                      { color: round.toPar <= 0 ? Colors.accent : Colors.danger },
                    ]}
                  >
                    {formatToPar(round.toPar)}
                  </Text>
                </View>
              </View>
            </View>
          </View>
        ))}
      </TeeCard>
    </View>
  );
}

function CardHeader({ children, icon }: { children: string; icon: React.ReactNode }) {
  return (
    <View style={styles.cardHeader}>
      {icon}
      <Text style={styles.cardTitle}>{children}</Text>
    </View>
  );
}

function EmptyState() {
  return (
    <View style={styles.center}>
      <TeeMark size={56} tint={Colors.borderStrong} />
      <Text style={styles.emptyTitle}>No stats yet</Text>
      <Text style={styles.emptyBody}>
        Play a round and record your scores — your scoring average, breakdown, and trends
        will build here automatically.
      </Text>
    </View>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { paddingHorizontal: Spacing.xl },
  title: { ...Typography.largeTitle },
  subtitle: { ...Typography.body, color: Colors.textSecondary, marginTop: 4 },
  body: { marginTop: Spacing.xl, gap: Spacing.lg },
  center: {
    alignItems: "center",
    paddingTop: Spacing.xxxl,
    paddingHorizontal: Spacing.md,
    gap: Spacing.sm,
  },

  // Hero
  hero: {
    backgroundColor: Colors.primary,
    borderRadius: Radius.xl,
    padding: Spacing.xl,
    overflow: "hidden",
  },
  heroGlow: {
    position: "absolute",
    top: -90,
    right: -60,
    width: 220,
    height: 220,
    borderRadius: 999,
    backgroundColor: Colors.accent,
    opacity: 0.28,
  },
  heroEyebrow: { ...Typography.overline, color: Colors.onPrimary, opacity: 0.7 },
  heroNumber: {
    fontFamily: Fonts.serifSemibold,
    fontSize: 84,
    color: Colors.onPrimary,
    letterSpacing: -2,
    marginTop: Spacing.xs,
  },
  heroFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: Spacing.sm,
  },
  heroChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(244,240,231,0.12)",
    paddingHorizontal: Spacing.md,
    paddingVertical: 7,
    borderRadius: Radius.pill,
  },
  heroChipText: { ...Typography.caption, color: Colors.onPrimary },
  heroMeta: { ...Typography.caption, color: Colors.onPrimary, opacity: 0.65 },

  // Mini stats
  miniGrid: { flexDirection: "row", gap: Spacing.md },
  mini: { flex: 1, alignItems: "flex-start", padding: Spacing.md, gap: 6 },
  miniIcon: {
    width: 30,
    height: 30,
    borderRadius: Radius.sm,
    backgroundColor: Colors.accentSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  miniValue: { fontFamily: Fonts.serifSemibold, fontSize: 26, color: Colors.primary },
  miniLabel: { ...Typography.caption, color: Colors.textTertiary, letterSpacing: 0.2 },

  // Cards
  card: { padding: Spacing.lg, gap: Spacing.md },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  cardTitle: { ...Typography.headline, fontSize: 17 },
  cardHint: { ...Typography.subhead, color: Colors.textTertiary, marginTop: -4 },

  // Trend
  trendRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    height: 130,
    gap: 6,
  },
  trendCol: { flex: 1, alignItems: "center", justifyContent: "flex-end", gap: 6 },
  trendValue: { ...Typography.caption, color: Colors.textSecondary, fontSize: 11 },
  trendBar: { width: "78%", borderRadius: Radius.sm, minHeight: 26 },

  // Distribution
  stackBar: {
    flexDirection: "row",
    height: 14,
    borderRadius: Radius.pill,
    overflow: "hidden",
    backgroundColor: Colors.primarySoft,
  },
  bucketList: { gap: Spacing.sm },
  bucketRow: { flexDirection: "row", alignItems: "center", gap: Spacing.sm },
  swatch: { width: 10, height: 10, borderRadius: 3 },
  bucketLabel: { ...Typography.callout, width: 64, color: Colors.textSecondary },
  bucketTrack: {
    flex: 1,
    height: 8,
    borderRadius: Radius.pill,
    backgroundColor: Colors.primarySoft,
    overflow: "hidden",
  },
  bucketFill: { height: "100%", borderRadius: Radius.pill, minWidth: 2 },
  bucketCount: {
    fontFamily: Fonts.serifSemibold,
    fontSize: 15,
    color: Colors.primary,
    width: 24,
    textAlign: "right",
  },
  bucketPct: { ...Typography.caption, color: Colors.textTertiary, width: 36, textAlign: "right" },

  // Par types
  parTypeRow: { flexDirection: "row", gap: Spacing.md },
  parTypeCell: {
    flex: 1,
    alignItems: "center",
    paddingVertical: Spacing.md,
    borderRadius: Radius.md,
    backgroundColor: Colors.primarySoft,
    gap: 4,
  },
  parTypeName: { ...Typography.caption, color: Colors.textSecondary },
  parTypeValue: { fontFamily: Fonts.serifSemibold, fontSize: 24 },
  parTypeMeta: { ...Typography.caption, color: Colors.textTertiary, fontSize: 11 },

  // Best round
  bestCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    padding: Spacing.lg,
    borderRadius: Radius.lg,
    backgroundColor: Colors.goldSoft,
    borderWidth: hairline,
    borderColor: Colors.gold,
  },
  bestIcon: {
    width: 42,
    height: 42,
    borderRadius: Radius.pill,
    backgroundColor: "rgba(199,162,74,0.18)",
    alignItems: "center",
    justifyContent: "center",
  },
  bestBody: { flex: 1, gap: 2 },
  bestEyebrow: { ...Typography.overline, color: Colors.gold },
  bestName: { ...Typography.headline, fontSize: 17 },
  bestMeta: { ...Typography.subhead, color: Colors.textSecondary },
  bestScore: { alignItems: "flex-end" },
  bestScoreValue: { fontFamily: Fonts.serifSemibold, fontSize: 28, color: Colors.primary },
  bestScoreLabel: { ...Typography.caption, color: Colors.textTertiary },

  // Round log
  logSection: { gap: Spacing.md },
  sectionLabel: { ...Typography.overline, marginLeft: 2 },
  logCard: { paddingHorizontal: Spacing.lg },
  logDivider: { height: 1, backgroundColor: Colors.border },
  logRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: Spacing.md,
    gap: Spacing.md,
  },
  logLeft: { flex: 1, gap: 2 },
  logName: { ...Typography.callout, fontWeight: "600" },
  logMeta: { ...Typography.subhead, color: Colors.textTertiary },
  logRight: { flexDirection: "row", alignItems: "center", gap: Spacing.sm },
  logStrokes: { fontFamily: Fonts.serifSemibold, fontSize: 18, color: Colors.primary },
  logBadge: {
    minWidth: 46,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 5,
    borderRadius: Radius.pill,
    alignItems: "center",
  },
  logBadgeText: { ...Typography.caption, fontWeight: "700" },

  // Empty
  emptyTitle: { ...Typography.title, fontSize: 22, marginTop: Spacing.lg },
  emptyBody: {
    ...Typography.body,
    color: Colors.textSecondary,
    textAlign: "center",
    lineHeight: 22,
  },
});
