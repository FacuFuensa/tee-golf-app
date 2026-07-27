import React from "react";
import { Pressable, StyleSheet, Text, View, type ViewStyle } from "react-native";

import { Colors, Radius, cardShadow, hairline } from "@/constants/theme";
import { selectionChanged } from "@/utils/haptics";

export interface SegmentOption<T extends string | number> {
  label: string;
  value: T;
}

interface SegmentedControlProps<T extends string | number> {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  style?: ViewStyle;
}

export function SegmentedControl<T extends string | number>({
  options,
  value,
  onChange,
  style,
}: SegmentedControlProps<T>) {
  return (
    <View style={[styles.track, style]}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Pressable
            key={String(option.value)}
            style={[styles.segment, active && styles.segmentActive]}
            onPress={() => {
              if (active) return;
              selectionChanged();
              onChange(option.value);
            }}
          >
            <Text style={[styles.label, active ? styles.labelActive : styles.labelInactive]}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: "row",
    backgroundColor: Colors.primarySoft,
    borderRadius: Radius.md,
    padding: 4,
    gap: 4,
  },
  segment: {
    flex: 1,
    height: 44,
    borderRadius: Radius.sm + 2,
    alignItems: "center",
    justifyContent: "center",
  },
  segmentActive: {
    backgroundColor: Colors.surface,
    borderWidth: hairline,
    borderColor: Colors.border,
    ...cardShadow,
  },
  label: { fontSize: 15, fontWeight: "600" },
  labelActive: { color: Colors.primary },
  labelInactive: { color: Colors.textSecondary },
});
