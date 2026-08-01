import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { Colors, Fonts, Radius, Spacing, hairline } from "@/constants/theme";
import type { LeaderboardEntry } from "@/services/db";
import { formatToPar } from "@/utils/stats";

import { CARD_WIDTH, CardHeader, type CardProps } from "./ScorecardCard";

interface GroupCardProps extends CardProps {
  entries: LeaderboardEntry[];
}

/** One line per player. Rendered only for multiplayer rounds. */
export function GroupCard({ courseName, date, entries }: GroupCardProps) {
  return (
    <View style={[styles.root, { width: CARD_WIDTH, height: Math.round(CARD_WIDTH * 1.25) }]}>
      <CardHeader courseName={courseName} date={date} />

      <View style={styles.list}>
        {entries.map((entry, index) => (
          <View key={entry.profileId} style={[styles.row, index > 0 && styles.rowDivided]}>
            <Text style={styles.position}>{index + 1}</Text>
            <Text style={styles.name} numberOfLines={1}>
              {entry.name}
            </Text>
            <Text style={styles.thru}>thru {entry.thru}</Text>
            <Text style={styles.total}>{entry.total}</Text>
            <Text style={styles.toPar}>{formatToPar(entry.toPar)}</Text>
          </View>
        ))}
      </View>

      <Text style={styles.footer}>
        {entries.length} {entries.length === 1 ? "player" : "players"}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    backgroundColor: Colors.primary,
    borderRadius: Radius.xl,
    padding: Spacing.xl,
    justifyContent: "space-between",
  },
  list: { gap: 2 },
  row: { flexDirection: "row", alignItems: "center", paddingVertical: 9, gap: Spacing.sm },
  rowDivided: { borderTopWidth: hairline, borderTopColor: "rgba(244,240,231,0.16)" },
  position: { fontFamily: Fonts.serifBold, fontSize: 13, color: Colors.accent, width: 16 },
  name: { flex: 1, fontFamily: Fonts.serifSemibold, fontSize: 16, color: Colors.onPrimary },
  thru: { fontFamily: Fonts.serifRegular, fontSize: 11, color: Colors.onPrimary, opacity: 0.55 },
  total: { fontFamily: Fonts.serifSemibold, fontSize: 18, color: Colors.onPrimary, width: 30, textAlign: "right" },
  toPar: { fontFamily: Fonts.serifSemibold, fontSize: 13, color: Colors.accent, width: 40, textAlign: "right" },
  footer: { fontFamily: Fonts.serifRegular, fontSize: 11, color: Colors.onPrimary, opacity: 0.6, textAlign: "center" },
});
