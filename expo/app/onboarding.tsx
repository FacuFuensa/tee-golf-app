import React, { useEffect, useRef, useState } from "react";
import {
  Animated,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { TeeMark } from "@/components/TeeMark";
import { TeeButton } from "@/components/ui/TeeButton";
import { TeeTextField } from "@/components/ui/TeeTextField";
import { Colors, Spacing, Typography } from "@/constants/theme";
import { useAuth } from "@/providers/AuthProvider";
import { checkDisplayName } from "@/utils/moderation";

export default function OnboardingScreen() {
  const insets = useSafeAreaInsets();
  const { saveProfile, signOut } = useAuth();

  const [displayName, setDisplayName] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const fade = useRef(new Animated.Value(0)).current;
  const rise = useRef(new Animated.Value(18)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fade, { toValue: 1, duration: 520, useNativeDriver: true }),
      Animated.spring(rise, { toValue: 0, speed: 12, bounciness: 4, useNativeDriver: true }),
    ]).start();
  }, [fade, rise]);

  const valid = displayName.trim().length >= 2;

  const submit = async (): Promise<void> => {
    if (!valid || loading) return;

    // This name is shown to the other golfers in any group round, so it is
    // user-generated content and has to pass the same filter as a course name.
    const check = checkDisplayName(displayName);
    if (!check.ok) {
      setError(check.reason);
      return;
    }

    setLoading(true);
    setError(null);
    const { error: saveError } = await saveProfile(displayName);
    if (saveError) {
      setError(saveError);
      setLoading(false);
    }
    // On success, the auth gate routes into the app automatically.
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top + 56, paddingBottom: insets.bottom + 24 }]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <Animated.View style={[styles.content, { opacity: fade, transform: [{ translateY: rise }] }]}>
          <View style={styles.top}>
            <TeeMark size={52} tint={Colors.primary} accent={Colors.accent} />
            <Text style={styles.overline}>Welcome to Tee</Text>
            <Text style={styles.title}>What should we{"\n"}call you?</Text>
            <Text style={styles.subtitle}>
              This name appears on your scorecards, and to the other golfers in any group
              round you play.
            </Text>
          </View>

          <View style={styles.form}>
            <TeeTextField
              label="Display name"
              value={displayName}
              onChangeText={(text) => {
                setDisplayName(text);
                if (error) setError(null);
              }}
              placeholder="e.g. Alex Morgan"
              autoCapitalize="words"
              autoFocus
              returnKeyType="go"
              onSubmitEditing={submit}
              maxLength={40}
            />
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <TeeButton
              label="Continue"
              onPress={submit}
              loading={loading}
              disabled={!valid}
            />
          </View>
        </Animated.View>

        <TeeButton label="Not you? Sign out" variant="ghost" haptic={false} onPress={signOut} />
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background, paddingHorizontal: Spacing.xl },
  flex: { flex: 1 },
  content: { flex: 1, justifyContent: "center" },
  top: { marginBottom: Spacing.xxxl },
  overline: { ...Typography.overline, marginTop: Spacing.xl },
  title: { ...Typography.largeTitle, fontSize: 36, marginTop: Spacing.md, lineHeight: 42 },
  subtitle: { ...Typography.body, color: Colors.textSecondary, marginTop: Spacing.md },
  form: { gap: Spacing.lg },
  error: { color: Colors.danger, fontSize: 14, fontWeight: "500", marginTop: -4 },
});
