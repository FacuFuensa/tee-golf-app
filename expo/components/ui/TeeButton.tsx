import React, { useRef } from "react";
import {
  ActivityIndicator,
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from "react-native";

import { Colors, Radius, hairline } from "@/constants/theme";
import { tapMedium } from "@/utils/haptics";

type Variant = "primary" | "secondary" | "ghost" | "danger";

interface TeeButtonProps {
  label: string;
  onPress?: () => void;
  variant?: Variant;
  disabled?: boolean;
  loading?: boolean;
  icon?: React.ReactNode;
  haptic?: boolean;
  style?: ViewStyle;
}

interface VariantStyle {
  bg: string;
  fg: string;
  border?: string;
}

function paletteFor(variant: Variant): VariantStyle {
  switch (variant) {
    case "primary":
      return { bg: Colors.primary, fg: Colors.onPrimary };
    case "secondary":
      return { bg: Colors.surface, fg: Colors.primary, border: Colors.borderStrong };
    case "ghost":
      return { bg: "transparent", fg: Colors.accent };
    case "danger":
      return { bg: Colors.dangerSoft, fg: Colors.danger };
  }
}

export function TeeButton({
  label,
  onPress,
  variant = "primary",
  disabled = false,
  loading = false,
  icon,
  haptic = true,
  style,
}: TeeButtonProps) {
  const scale = useRef(new Animated.Value(1)).current;
  const palette = paletteFor(variant);
  const isInteractive = !disabled && !loading;

  const animateTo = (value: number): void => {
    Animated.spring(scale, {
      toValue: value,
      useNativeDriver: true,
      speed: 40,
      bounciness: 6,
    }).start();
  };

  return (
    <Pressable
      onPress={() => {
        if (!isInteractive) return;
        if (haptic) tapMedium();
        onPress?.();
      }}
      onPressIn={() => isInteractive && animateTo(0.97)}
      onPressOut={() => animateTo(1)}
      disabled={!isInteractive}
    >
      <Animated.View
        style={[
          styles.base,
          {
            backgroundColor: palette.bg,
            borderColor: palette.border ?? "transparent",
            borderWidth: palette.border ? hairline : 0,
            opacity: disabled ? 0.4 : 1,
            transform: [{ scale }],
          },
          style,
        ]}
      >
        {loading ? (
          <ActivityIndicator color={palette.fg} />
        ) : (
          <View style={styles.content}>
            {icon}
            <Text style={[styles.label, { color: palette.fg }]}>{label}</Text>
          </View>
        )}
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    height: 56,
    borderRadius: Radius.md,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  content: { flexDirection: "row", alignItems: "center", gap: 8 },
  label: { fontSize: 17, fontWeight: "600", letterSpacing: 0.2 },
});
