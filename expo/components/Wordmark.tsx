import React from "react";
import { StyleSheet, Text, View, type ViewStyle } from "react-native";

import { TeeMark } from "@/components/TeeMark";
import { Colors, Fonts } from "@/constants/theme";

interface WordmarkProps {
  size?: number;
  tint?: string;
  accent?: string;
  layout?: "horizontal" | "vertical";
  showText?: boolean;
  style?: ViewStyle;
}

/** The "Tee" wordmark: ball-on-tee mark paired with the serif name. */
export function Wordmark({
  size = 24,
  tint = Colors.primary,
  accent,
  layout = "horizontal",
  showText = true,
  style,
}: WordmarkProps) {
  const isVertical = layout === "vertical";
  const markSize = isVertical ? size * 1.5 : size * 1.15;
  return (
    <View
      style={[
        styles.row,
        isVertical && styles.col,
        { gap: isVertical ? size * 0.4 : size * 0.42 },
        style,
      ]}
    >
      <TeeMark size={markSize} tint={tint} accent={accent} />
      {showText ? (
        <Text style={[styles.word, { fontSize: size * 1.18, color: tint }]}>
          Tee
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  col: { flexDirection: "column" },
  word: {
    fontFamily: Fonts.serifSemibold,
    letterSpacing: 0.5,
    includeFontPadding: false,
  },
});
