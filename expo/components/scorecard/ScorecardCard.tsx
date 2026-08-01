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

// Used only within this module (CardHeader) — not exported.
function formatCardDate(iso: string): string {
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
        <Text style={headerStyles.date} numberOfLines={1}>
          {formatCardDate(date)}
        </Text>
      </View>
      <Text style={headerStyles.wordmark} numberOfLines={1}>
        Tee
      </Text>
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
  // A nine with nothing scored must not appear in the photo at all — an
  // unplayed back nine on an 18-hole course would otherwise print a full
  // HOLE/PAR block with a blank SCORE row. `nine.strokes` is already null
  // exactly when nothing in that nine was scored (see buildScorecard), so
  // filtering on it here needs no extra bookkeeping. `buildScorecard` itself
  // stays untouched — the detail screen still shows unplayed holes, since
  // there it's a record of the round rather than something sent to a friend.
  const playedNines = card.nines.filter((nine) => nine.strokes != null);
  // The footer must still count every hole on the course, not just the
  // nines rendered above — a 9-of-18 round should read "9 of 18 holes".
  const totalHoles = card.nines.reduce((n, x) => n + x.cells.length, 0);

  return (
    // No explicit height: with only one nine rendered, a fixed CARD_WIDTH * 1.25
    // height left a large empty gap below the grid. `styles.root`'s `gap`
    // (rather than `justifyContent: "space-between"`) now supplies the
    // spacing between sections, so the card's height simply follows its
    // content for both the one-nine and two-nine cases.
    <View style={[styles.root, { width: CARD_WIDTH }]}>
      <CardHeader courseName={courseName} date={date} />

      <View style={styles.totals}>
        <Text style={styles.total} numberOfLines={1}>
          {card.totalStrokes}
        </Text>
        <View>
          <Text style={styles.toPar} numberOfLines={1}>
            {formatToPar(card.toPar)}
          </Text>
          <Text style={styles.player} numberOfLines={1}>
            {playerName}
          </Text>
        </View>
      </View>

      <View style={styles.grid}>
        {playedNines.map((nine) => (
          <View key={nine.label} style={styles.nine}>
            <View style={styles.row}>
              <Text style={[styles.rowLabel, styles.muted]} numberOfLines={1}>
                HOLE
              </Text>
              {nine.cells.map((c) => (
                <Text key={c.number} style={[styles.cell, styles.muted]} numberOfLines={1}>
                  {c.number}
                </Text>
              ))}
              <Text style={[styles.cellTotal, styles.muted]} numberOfLines={1}>
                {nine.label}
              </Text>
            </View>
            <View style={styles.row}>
              <Text style={[styles.rowLabel, styles.muted]} numberOfLines={1}>
                PAR
              </Text>
              {nine.cells.map((c) => (
                <Text key={c.number} style={[styles.cell, styles.muted]} numberOfLines={1}>
                  {c.par}
                </Text>
              ))}
              <Text style={[styles.cellTotal, styles.muted]} numberOfLines={1}>
                {nine.par}
              </Text>
            </View>
            <View style={[styles.row, styles.scoreRow]}>
              <Text style={styles.rowLabel} numberOfLines={1}>
                SCORE
              </Text>
              {nine.cells.map((c) => (
                <Text key={c.number} style={styles.cell} numberOfLines={1}>
                  {/* blank, never 0 — a 0 here would read as a score */}
                  {c.strokes ?? ""}
                </Text>
              ))}
              {/* blank, never 0 — an unplayed nine must not print an even-par subtotal */}
              <Text style={styles.cellTotal} numberOfLines={1}>
                {nine.strokes ?? ""}
              </Text>
            </View>
          </View>
        ))}
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText} numberOfLines={1}>
          {card.holesScored} of {totalHoles} holes · par {card.coursePar}
        </Text>
        <Text style={styles.footerTotal} numberOfLines={1}>
          TOTAL {card.totalStrokes}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    backgroundColor: Colors.primary,
    // Deliberately square. A rounded card exports a PNG with transparent
    // corners, which take on whatever background the viewer has — white in a
    // light chat, dark in a dark one. Square means the image looks identical
    // everywhere it lands.
    padding: Spacing.xl,
    // Was `justifyContent: "space-between"` against a fixed CARD_WIDTH * 1.25
    // height, which relied on that height to create the space to distribute.
    // Now that the card's height follows its content (see D3), an explicit
    // gap between the header / totals / grid / footer sections is what
    // actually produces the spacing.
    gap: Spacing.lg,
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
  // Widths sized for the longest real content, not the current one:
  // CARD_WIDTH (340) - 2*Spacing.xl (24) card padding - 2*Spacing.sm (8) nine
  // padding leaves 276px for a row. rowLabel must fit "SCORE" (the longest of
  // SCORE/HOLE/PAR) at fontSize 8; cellTotal must fit "OUT"/"IN" or a
  // three-digit subtotal at fontSize 12. 276 - 40 - 38 = 198, / 9 cells = 22px
  // each — comfortably fits a two-digit number (hole 1-18, or a bad-hole
  // score) at the existing fontSize 12, so the cell font size didn't need to
  // shrink.
  rowLabel: { fontFamily: Fonts.serifSemibold, fontSize: 8, color: Colors.onPrimary, width: 40, letterSpacing: 0.6 },
  cell: { flex: 1, textAlign: "center", fontFamily: Fonts.serifSemibold, fontSize: 12, color: Colors.onPrimary },
  cellTotal: { width: 38, textAlign: "right", fontFamily: Fonts.serifBold, fontSize: 12, color: Colors.accent },
  muted: { opacity: 0.55, fontFamily: Fonts.serifRegular },

  footer: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  footerText: { fontFamily: Fonts.serifRegular, fontSize: 11, color: Colors.onPrimary, opacity: 0.6 },
  footerTotal: { fontFamily: Fonts.serifBold, fontSize: 13, color: Colors.onPrimary },
});
