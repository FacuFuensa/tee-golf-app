import React, { useRef } from "react";
import {
  Animated,
  Pressable,
  StyleSheet,
  View,
  type ViewStyle,
} from "react-native";

import { Colors, Radius, Spacing, cardShadow, hairline } from "@/constants/theme";

interface TeeCardProps {
  children: React.ReactNode;
  onPress?: () => void;
  padded?: boolean;
  style?: ViewStyle;
}

export function TeeCard({ children, onPress, padded = true, style }: TeeCardProps) {
  const scale = useRef(new Animated.Value(1)).current;

  const body = (
    <Animated.View
      style={[
        styles.card,
        padded && styles.padded,
        onPress ? { transform: [{ scale }] } : null,
        style,
      ]}
    >
      {children}
    </Animated.View>
  );

  if (!onPress) return body;

  return (
    <Pressable
      onPress={onPress}
      onPressIn={() =>
        Animated.spring(scale, { toValue: 0.98, useNativeDriver: true, speed: 40, bounciness: 4 }).start()
      }
      onPressOut={() =>
        Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 40, bounciness: 4 }).start()
      }
    >
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: hairline,
    borderColor: Colors.border,
    ...cardShadow,
  },
  padded: { padding: Spacing.lg },
});
