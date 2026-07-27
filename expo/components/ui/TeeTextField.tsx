import { Eye, EyeOff } from "lucide-react-native";
import React, { useState } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
  type ViewStyle,
} from "react-native";

import { Colors, Radius, Spacing, hairline } from "@/constants/theme";

interface TeeTextFieldProps extends TextInputProps {
  label?: string;
  errorText?: string | null;
  containerStyle?: ViewStyle;
}

export function TeeTextField({
  label,
  errorText,
  containerStyle,
  style,
  onFocus,
  onBlur,
  secureTextEntry,
  ...rest
}: TeeTextFieldProps) {
  const [focused, setFocused] = useState<boolean>(false);
  const [revealed, setRevealed] = useState<boolean>(false);
  const isSecureField = secureTextEntry === true;
  const borderColor = errorText
    ? Colors.danger
    : focused
      ? Colors.accent
      : Colors.borderStrong;

  return (
    <View style={containerStyle}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <View>
        <TextInput
          placeholderTextColor={Colors.textTertiary}
          selectionColor={Colors.accent}
          secureTextEntry={isSecureField && !revealed}
          style={[styles.input, isSecureField && styles.inputWithAccessory, { borderColor }, style]}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          {...rest}
        />
        {isSecureField ? (
          <Pressable
            onPress={() => setRevealed((v) => !v)}
            hitSlop={10}
            style={styles.eyeButton}
            accessibilityRole="button"
            accessibilityLabel={revealed ? "Hide password" : "Show password"}
          >
            {revealed ? (
              <EyeOff size={20} color={Colors.textTertiary} />
            ) : (
              <Eye size={20} color={Colors.textTertiary} />
            )}
          </Pressable>
        ) : null}
      </View>
      {errorText ? <Text style={styles.error}>{errorText}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  label: {
    fontSize: 11,
    fontWeight: "700",
    color: Colors.textTertiary,
    letterSpacing: 1.4,
    textTransform: "uppercase",
    marginBottom: Spacing.sm,
    marginLeft: 2,
  },
  input: {
    height: 56,
    borderRadius: Radius.md,
    borderWidth: hairline,
    backgroundColor: Colors.surface,
    paddingHorizontal: Spacing.lg,
    fontSize: 17,
    color: Colors.textPrimary,
  },
  inputWithAccessory: {
    paddingRight: 52,
  },
  eyeButton: {
    position: "absolute",
    right: 0,
    top: 0,
    bottom: 0,
    width: 52,
    alignItems: "center",
    justifyContent: "center",
  },
  error: {
    color: Colors.danger,
    fontSize: 13,
    marginTop: Spacing.sm,
    marginLeft: 2,
  },
});
