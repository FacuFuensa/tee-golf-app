import { Platform, StyleSheet, type TextStyle, type ViewStyle } from "react-native";

/**
 * Tee design system tokens.
 * A calm, premium country-club palette: warm cream, pure white surfaces,
 * deep + mid greens, with a gold reserved for future premium touches.
 */
export const Colors = {
  /** Warm cream app background. */
  background: "#F2EDE3",
  /** Pure white card / surface. */
  surface: "#FFFFFF",
  /** Deep green — primary text, nav, primary buttons. */
  primary: "#1C3A2B",
  /** Mid green — active states, CTAs, the big distance number. */
  accent: "#4E8C6A",
  /** Premium gold — defined for later, intentionally unused for now. */
  gold: "#C7A24A",

  /** Text. */
  textPrimary: "#1C3A2B",
  textSecondary: "#6E7B71",
  textTertiary: "#9BA59C",
  /** Text/icon on a deep-green surface. */
  onPrimary: "#F4F0E7",
  /** Text/icon on an accent surface. */
  onAccent: "#FFFFFF",

  /** Hairline borders. */
  border: "rgba(28,58,43,0.10)",
  borderStrong: "rgba(28,58,43,0.16)",

  /** Tinted fills. */
  accentSoft: "rgba(78,140,106,0.12)",
  primarySoft: "rgba(28,58,43,0.06)",
  goldSoft: "rgba(199,162,74,0.14)",

  /** Feedback. */
  danger: "#B0463B",
  dangerSoft: "rgba(176,70,59,0.10)",

  /** Map / overlay scrims. */
  scrim: "rgba(13,26,19,0.45)",
} as const;

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

export const Radius = {
  sm: 10,
  md: 16,
  lg: 20,
  xl: 28,
  pill: 999,
} as const;

export const Fonts = {
  serifRegular: "Newsreader_400Regular",
  serifSemibold: "Newsreader_600SemiBold",
  serifBold: "Newsreader_700Bold",
} as const;

export const hairline = StyleSheet.hairlineWidth;

/** Very subtle elevation for white cards on cream. */
export const cardShadow: ViewStyle = Platform.select({
  ios: {
    shadowColor: "#1C3A2B",
    shadowOpacity: 0.06,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
  },
  default: {
    elevation: 2,
  },
}) as ViewStyle;

/** Typography scale. SF Pro (system) for UI; Newsreader serif for numerics. */
export const Typography: Record<string, TextStyle> = {
  largeTitle: { fontSize: 34, fontWeight: "700", letterSpacing: 0.2, color: Colors.textPrimary },
  title: { fontSize: 26, fontWeight: "700", letterSpacing: 0.2, color: Colors.textPrimary },
  headline: { fontSize: 19, fontWeight: "600", color: Colors.textPrimary },
  body: { fontSize: 16, fontWeight: "400", color: Colors.textPrimary },
  callout: { fontSize: 15, fontWeight: "500", color: Colors.textPrimary },
  subhead: { fontSize: 14, fontWeight: "500", color: Colors.textSecondary },
  caption: { fontSize: 12, fontWeight: "600", color: Colors.textSecondary, letterSpacing: 0.4 },
  overline: {
    fontSize: 11,
    fontWeight: "700",
    color: Colors.textTertiary,
    letterSpacing: 1.6,
    textTransform: "uppercase",
  },

  /** Serif numeric displays. */
  numericDisplay: { fontFamily: Fonts.serifSemibold, fontSize: 72, color: Colors.accent, letterSpacing: -1 },
  numericHero: { fontFamily: Fonts.serifSemibold, fontSize: 116, color: Colors.accent, letterSpacing: -3 },
  serifTitle: { fontFamily: Fonts.serifRegular, fontSize: 44, color: Colors.primary, letterSpacing: 0.5 },
  serifScore: { fontFamily: Fonts.serifSemibold, fontSize: 40, color: Colors.primary },
};
