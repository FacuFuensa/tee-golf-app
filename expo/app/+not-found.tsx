import { useRouter } from "expo-router";
import { Flag } from "lucide-react-native";
import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { TeeButton } from "@/components/ui/TeeButton";
import { Colors, Radius, Spacing, Typography } from "@/constants/theme";

/**
 * Shown when a deep link or a stale route points somewhere that no longer
 * exists. Styled like the rest of the app so it reads as a considered state
 * rather than a crash.
 */
export default function NotFoundScreen() {
  const router = useRouter();

  return (
    <View style={styles.container}>
      <View style={styles.icon}>
        <Flag size={26} color={Colors.accent} strokeWidth={2.2} />
      </View>
      <Text style={styles.title}>Nothing here</Text>
      <Text style={styles.body}>
        That link doesn&apos;t lead anywhere in Tee. It may be from an older version of the app.
      </Text>
      <TeeButton
        label="Back to your courses"
        onPress={() => router.replace("/(tabs)/courses")}
        style={styles.cta}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: Spacing.xl,
    backgroundColor: Colors.background,
  },
  icon: {
    width: 60,
    height: 60,
    borderRadius: Radius.pill,
    backgroundColor: Colors.accentSoft,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing.lg,
  },
  title: { ...Typography.title, textAlign: "center" },
  body: {
    ...Typography.body,
    color: Colors.textSecondary,
    textAlign: "center",
    marginTop: Spacing.sm,
    maxWidth: 300,
  },
  cta: { marginTop: Spacing.xl, alignSelf: "stretch", maxWidth: 320 },
});
