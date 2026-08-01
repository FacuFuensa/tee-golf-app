import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { Colors, Fonts, Radius, Spacing, hairline } from "@/constants/theme";
import type { ScorecardData } from "@/utils/scorecard";
import { formatToPar } from "@/utils/stats";

export const CARD_WIDTH = 340;

export interface CardProps {
  courseName: string;
  /** ISO timestamp. */
  date: string;
  card: ScorecardData;
  playerName: string;
}

export function formatCardDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Shared header so all three formats read as the same family.
 *
 * `Wordmark` (see `@/components/Wordmark`) takes `size`, not `height`, so it
 * can't be dropped in as originally sketched without changing its API. Per
 * the task brief, we don't touch `Wordmark` — instead we render the name
 * directly in the app's serif at a comparable size and colour.
 */
export function CardHeader({ courseName, date }: { courseName: string; date: string }) {
  return (
    <View style={headerStyles.root}>
      <View style={headerStyles.text}>
        <Text style={headerStyles.course} numberOfLines={1}>
          {courseName}
        </Text>
        <Text style={headerStyles.date}>{formatCardDate(date)}</Text>
      </View>
      <Text style={headerStyles.wordmark}>Tee</Text>
    </View>
  );
}

const headerStyles = StyleSheet.create({
  root: { flexDirection: "row", alignItems: "center", gap: Spacing.md },
  text: { flex: 1 },
  course: { fontFamily: Fonts.serifSemibold, fontSize: 22, color: Colors.onPrimary },
  date: { fontFamily: Fonts.serifRegular, fontSize: 13, color: Colors.onPrimary, opacity: 0.7 },
  wordmark: { fontFamily: Fonts.serifBold, fontSize: 16, color: Colors.onPrimary, letterSpacing: 0.5 },
});

export function ScorecardCard({ courseName, date, card, playerName }: CardProps) {
  return (
    <View style={[styles.root, { width: CARD_WIDTH, height: Math.round(CARD_WIDTH * 1.25) }]}>
      <CardHeader courseName={courseName} date={date} />

      <View style={styles.totals}>
        <Text style={styles.total}>{card.totalStrokes}</Text>
        <View>
          <Text style={styles.toPar}>{formatToPar(card.toPar)}</Text>
          <Text style={styles.player} numberOfLines={1}>
            {playerName}
          </Text>
        </View>
      </View>

      <View style={styles.grid}>
        {card.nines.map((nine) => (
          <View key={nine.label} style={styles.nine}>
            <View style={styles.row}>
              <Text style={[styles.rowLabel, styles.muted]}>HOLE</Text>
              {nine.cells.map((c) => (
                <Text key={c.number} style={[styles.cell, styles.muted]}>
                  {c.number}
                </Text>
              ))}
              <Text style={[styles.cellTotal, styles.muted]}>{nine.label}</Text>
            </View>
            <View style={styles.row}>
              <Text style={[styles.rowLabel, styles.muted]}>PAR</Text>
              {nine.cells.map((c) => (
                <Text key={c.number} style={[styles.cell, styles.muted]}>
                  {c.par}
                </Text>
              ))}
              <Text style={[styles.cellTotal, styles.muted]}>{nine.par}</Text>
            </View>
            <View style={[styles.row, styles.scoreRow]}>
              <Text style={styles.rowLabel}>SCORE</Text>
              {nine.cells.map((c) => (
                <Text key={c.number} style={styles.cell}>
                  {/* blank, never 0 — a 0 here would read as a score */}
                  {c.strokes ?? ""}
                </Text>
              ))}
              <Text style={styles.cellTotal}>{nine.strokes}</Text>
            </View>
          </View>
        ))}
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          {card.holesScored} of {card.nines.reduce((n, x) => n + x.cells.length, 0)} holes · par{" "}
          {card.coursePar}
        </Text>
        <Text style={styles.footerTotal}>TOTAL {card.totalStrokes}</Text>
      </View>
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
  totals: { flexDirection: "row", alignItems: "flex-end", gap: Spacing.md },
  total: { fontFamily: Fonts.serifSemibold, fontSize: 64, color: Colors.onPrimary, letterSpacing: -2 },
  toPar: { fontFamily: Fonts.serifSemibold, fontSize: 22, color: Colors.accent },
  player: { fontFamily: Fonts.serifRegular, fontSize: 13, color: Colors.onPrimary, opacity: 0.7 },

  grid: { gap: Spacing.md },
  nine: {
    backgroundColor: "rgba(244,240,231,0.07)",
    borderRadius: Radius.md,
    padding: Spacing.sm,
    gap: 2,
  },
  row: { flexDirection: "row", alignItems: "center" },
  scoreRow: { borderTopWidth: hairline, borderTopColor: "rgba(244,240,231,0.2)", paddingTop: 4, marginTop: 2 },
  rowLabel: { fontFamily: Fonts.serifSemibold, fontSize: 8, color: Colors.onPrimary, width: 30, letterSpacing: 0.6 },
  cell: { flex: 1, textAlign: "center", fontFamily: Fonts.serifSemibold, fontSize: 12, color: Colors.onPrimary },
  cellTotal: { width: 26, textAlign: "right", fontFamily: Fonts.serifBold, fontSize: 12, color: Colors.accent },
  muted: { opacity: 0.55, fontFamily: Fonts.serifRegular },

  footer: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  footerText: { fontFamily: Fonts.serifRegular, fontSize: 11, color: Colors.onPrimary, opacity: 0.6 },
  footerTotal: { fontFamily: Fonts.serifBold, fontSize: 13, color: Colors.onPrimary },
});
