import { Minus, Plus } from "lucide-react-native";
import React, { useRef } from "react";
import {
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from "react-native";

import { Colors, Radius, hairline } from "@/constants/theme";
import { selectionChanged } from "@/utils/haptics";

interface StepperProps {
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  step?: number;
  /** Rendered value (defaults to the numeric value). */
  display?: string;
  style?: ViewStyle;
}

export function Stepper({
  value,
  onChange,
  min = 0,
  max = 99,
  step = 1,
  display,
  style,
}: StepperProps) {
  const canDecrement = value - step >= min;
  const canIncrement = value + step <= max;

  const change = (delta: number): void => {
    const next = value + delta;
    if (next < min || next > max) return;
    selectionChanged();
    onChange(next);
  };

  return (
    <View style={[styles.row, style]}>
      <StepButton
        icon={<Minus size={22} color={canDecrement ? Colors.primary : Colors.textTertiary} strokeWidth={2.5} />}
        disabled={!canDecrement}
        onPress={() => change(-step)}
      />
      <Text style={styles.value}>{display ?? value}</Text>
      <StepButton
        icon={<Plus size={22} color={canIncrement ? Colors.primary : Colors.textTertiary} strokeWidth={2.5} />}
        disabled={!canIncrement}
        onPress={() => change(step)}
      />
    </View>
  );
}

function StepButton({
  icon,
  onPress,
  disabled,
}: {
  icon: React.ReactNode;
  onPress: () => void;
  disabled: boolean;
}) {
  const scale = useRef(new Animated.Value(1)).current;
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      onPressIn={() =>
        Animated.spring(scale, { toValue: 0.9, useNativeDriver: true, speed: 50, bounciness: 8 }).start()
      }
      onPressOut={() =>
        Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 50, bounciness: 8 }).start()
      }
    >
      <Animated.View style={[styles.button, { opacity: disabled ? 0.5 : 1, transform: [{ scale }] }]}>
        {icon}
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 24 },
  button: {
    width: 56,
    height: 56,
    borderRadius: Radius.pill,
    backgroundColor: Colors.surface,
    borderWidth: hairline,
    borderColor: Colors.borderStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  value: {
    minWidth: 64,
    textAlign: "center",
    fontSize: 36,
    fontWeight: "700",
    color: Colors.textPrimary,
    fontVariant: ["tabular-nums"],
  },
});
