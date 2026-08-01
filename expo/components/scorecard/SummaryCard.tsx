import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { Colors, Fonts, Spacing } from "@/constants/theme";
import { countByClass } from "@/utils/scorecard";
import { formatToPar, type ScoreClass } from "@/utils/stats";

import { CARD_WIDTH, CardHeader, type CardProps } from "./ScorecardCard";

const SHOWN: { key: ScoreClass; label: string }[] = [
  { key: "eagle", label: "Eagles" },
  { key: "birdie", label: "Birdies" },
  { key: "par", label: "Pars" },
  { key: "bogey", label: "Bogeys" },
  { key: "double", label: "Doubles" },
  { key: "triple", label: "Triple+" },
];

/** Square, because that is what survives a chat crop intact. */
export function SummaryCard({ courseName, date, card, playerName }: CardProps) {
  const counts = countByClass(card);
  const present = SHOWN.filter((s) => counts[s.key] > 0);

  return (
    <View style={[styles.root, { width: CARD_WIDTH, height: CARD_WIDTH }]}>
      <CardHeader courseName={courseName} date={date} />

      <View style={styles.middle}>
        <Text style={styles.total}>{card.totalStrokes}</Text>
        <Text style={styles.toPar}>{formatToPar(card.toPar)}</Text>
        <Text style={styles.player} numberOfLines={1}>
          {playerName} · {card.holesScored} holes
        </Text>
      </View>

      {present.length > 0 ? (
        <View style={styles.breakdown}>
          {present.map((s) => (
            <View key={s.key} style={styles.stat}>
              <Text style={styles.statValue}>{counts[s.key]}</Text>
              <Text style={styles.statLabel}>{s.label}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    backgroundColor: Colors.primary,
    // Square on purpose — see ScorecardCard's root style.
    padding: Spacing.xl,
    justifyContent: "space-between",
  },
  middle: { alignItems: "center" },
  total: { fontFamily: Fonts.serifSemibold, fontSize: 92, color: Colors.onPrimary, letterSpacing: -4 },
  toPar: { fontFamily: Fonts.serifSemibold, fontSize: 26, color: Colors.accent, marginTop: -8 },
  player: { fontFamily: Fonts.serifRegular, fontSize: 13, color: Colors.onPrimary, opacity: 0.7, marginTop: 6 },
  breakdown: { flexDirection: "row", justifyContent: "space-between", gap: Spacing.xs },
  stat: { alignItems: "center", flex: 1 },
  statValue: { fontFamily: Fonts.serifSemibold, fontSize: 20, color: Colors.onPrimary },
  statLabel: { fontFamily: Fonts.serifRegular, fontSize: 9, color: Colors.onPrimary, opacity: 0.6 },
});
