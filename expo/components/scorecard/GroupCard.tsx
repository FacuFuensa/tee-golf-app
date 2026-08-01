import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { Colors, Fonts, Spacing, hairline } from "@/constants/theme";
import type { LeaderboardEntry } from "@/services/db";
import { formatToPar } from "@/utils/stats";

import { CARD_WIDTH, CardHeader } from "./ScorecardCard";

// Only what this card actually renders — it used to extend CardProps and
// require `card`/`playerName` that it never read.
interface GroupCardProps {
  courseName: string;
  /** ISO timestamp. */
  date: string;
  entries: LeaderboardEntry[];
}

// The card is a fixed height and gets rasterised into a shared image, so a
// group bigger than this must be truncated rather than silently overflow it.
const MAX_SHOWN_PLAYERS = 8;

/** One line per player. Rendered only for multiplayer rounds. */
export function GroupCard({ courseName, date, entries }: GroupCardProps) {
  const shown = entries.slice(0, MAX_SHOWN_PLAYERS);
  const overflow = entries.length - shown.length;

  return (
    <View style={[styles.root, { width: CARD_WIDTH, height: Math.round(CARD_WIDTH * 1.25) }]}>
      <CardHeader courseName={courseName} date={date} />

      <View style={styles.list}>
        {shown.map((entry, index) => (
          <View key={entry.profileId} style={[styles.row, index > 0 && styles.rowDivided]}>
            <Text style={styles.position}>{index + 1}</Text>
            <Text style={styles.name} numberOfLines={1}>
              {entry.name}
            </Text>
            <Text style={styles.thru}>thru {entry.thru}</Text>
            {/* A seated player with zero scored holes has no score to report —
                printing 0/Even would attach a fabricated round to their name. */}
            <Text style={styles.total}>{entry.thru === 0 ? "—" : entry.total}</Text>
            <Text style={styles.toPar}>{entry.thru === 0 ? "—" : formatToPar(entry.toPar)}</Text>
          </View>
        ))}
        {overflow > 0 ? <Text style={styles.footer}>+{overflow} more</Text> : null}
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
    // Square on purpose — see ScorecardCard's root style.
    padding: Spacing.xl,
    justifyContent: "space-between",
    // Rasterised into a shared image — nothing may paint past the edge, even
    // though the player list is capped at MAX_SHOWN_PLAYERS.
    overflow: "hidden",
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
