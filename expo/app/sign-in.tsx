import { Stack } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  Animated,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Wordmark } from "@/components/Wordmark";
import { TeeButton } from "@/components/ui/TeeButton";
import { TeeCard } from "@/components/ui/TeeCard";
import { TeeTextField } from "@/components/ui/TeeTextField";
import { Colors, Fonts, Spacing } from "@/constants/theme";
import { useAuth } from "@/providers/AuthProvider";

type Mode = "signin" | "signup";

export default function SignInScreen() {
  const insets = useSafeAreaInsets();
  const { signIn, signUp, isConfigured } = useAuth();

  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState<string>("");
  const [password, setPassword] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const fade = useRef(new Animated.Value(0)).current;
  const rise = useRef(new Animated.Value(16)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fade, { toValue: 1, duration: 520, useNativeDriver: true }),
      Animated.spring(rise, { toValue: 0, speed: 12, bounciness: 4, useNativeDriver: true }),
    ]).start();
  }, [fade, rise]);

  const valid = email.includes("@") && password.length >= 6;

  const submit = async (): Promise<void> => {
    if (!valid || loading) return;
    setLoading(true);
    setError(null);
    setNotice(null);

    if (mode === "signin") {
      const { error: signInError } = await signIn(email, password);
      if (signInError) setError(signInError);
    } else {
      const { error: signUpError, needsConfirmation } = await signUp(email, password);
      if (signUpError) {
        setError(signUpError);
      } else if (needsConfirmation) {
        setNotice("Account created. Check your email to confirm, then sign in.");
        setMode("signin");
      }
    }
    setLoading(false);
  };

  const toggleMode = (): void => {
    setMode((m) => (m === "signin" ? "signup" : "signin"));
    setError(null);
    setNotice(null);
  };

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={[
            styles.scroll,
            { paddingTop: insets.top + 48, paddingBottom: insets.bottom + 32 },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Animated.View style={{ opacity: fade, transform: [{ translateY: rise }] }}>
            <View style={styles.hero}>
              <Wordmark size={44} layout="vertical" accent={Colors.accent} />
              <Text style={styles.tagline}>Know your number.</Text>
            </View>

            <View style={styles.form}>
              <TeeTextField
                label="Email"
                value={email}
                onChangeText={setEmail}
                placeholder="you@example.com"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                textContentType="emailAddress"
                returnKeyType="next"
              />
              <TeeTextField
                label="Password"
                value={password}
                onChangeText={setPassword}
                placeholder="At least 6 characters"
                secureTextEntry
                autoCapitalize="none"
                textContentType={mode === "signup" ? "newPassword" : "password"}
                returnKeyType="go"
                onSubmitEditing={submit}
              />

              {error ? <Text style={styles.error}>{error}</Text> : null}
              {notice ? <Text style={styles.notice}>{notice}</Text> : null}

              <TeeButton
                label={mode === "signin" ? "Sign in" : "Create account"}
                onPress={submit}
                loading={loading}
                disabled={!valid}
                style={styles.cta}
              />

              <TeeButton
                label={
                  mode === "signin"
                    ? "New to Tee? Create an account"
                    : "Already have an account? Sign in"
                }
                variant="ghost"
                haptic={false}
                onPress={toggleMode}
              />
            </View>

            {!isConfigured ? (
              <TeeCard style={styles.configCard}>
                <Text style={styles.configTitle}>Connect Supabase</Text>
                <Text style={styles.configBody}>
                  Paste your project URL and anon key into{" "}
                  <Text style={styles.mono}>services/supabaseConfig.ts</Text> to enable
                  sign-in and saving.
                </Text>
              </TeeCard>
            ) : null}
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  scroll: { flexGrow: 1, justifyContent: "center", paddingHorizontal: Spacing.xl },
  hero: { alignItems: "center", marginBottom: Spacing.xxxl },
  tagline: {
    marginTop: Spacing.lg,
    fontSize: 17,
    color: Colors.textSecondary,
    fontWeight: "500",
    letterSpacing: 0.3,
  },
  form: { gap: Spacing.lg },
  cta: { marginTop: Spacing.sm },
  error: { color: Colors.danger, fontSize: 14, fontWeight: "500", marginTop: -4 },
  notice: { color: Colors.accent, fontSize: 14, fontWeight: "500", marginTop: -4 },
  configCard: { marginTop: Spacing.xxl, backgroundColor: Colors.goldSoft, borderColor: "transparent" },
  configTitle: { fontSize: 15, fontWeight: "700", color: Colors.primary, marginBottom: 6 },
  configBody: { fontSize: 14, color: Colors.textSecondary, lineHeight: 20 },
  mono: { fontFamily: Fonts.serifSemibold, color: Colors.primary },
});
