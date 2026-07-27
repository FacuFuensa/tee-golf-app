import { Flag, Users, X } from "lucide-react-native";
import React, { useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { TeeButton } from "@/components/ui/TeeButton";
import { Colors, Radius, Spacing, Typography, hairline } from "@/constants/theme";
import type { Course } from "@/types/models";

/** Bottom sheet shown when a course is tapped: play solo or host a group. */
export function StartRoundSheet({
  course,
  soloLoading,
  hostLoading,
  onSolo,
  onHost,
  onClose,
}: {
  course: Course | null;
  soloLoading: boolean;
  hostLoading: boolean;
  onSolo: () => void;
  onHost: () => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const visible = course !== null;
  const busy = soloLoading || hostLoading;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={busy ? undefined : onClose} />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + Spacing.lg }]}>
        <View style={styles.grabber} />
        <View style={styles.sheetHead}>
          <View style={styles.rowLeft}>
            <Text style={styles.overline}>START A ROUND</Text>
            <Text style={styles.sheetTitle} numberOfLines={1}>
              {course?.name ?? "Course"}
            </Text>
          </View>
          <Pressable style={styles.close} onPress={onClose} hitSlop={8} disabled={busy}>
            <X size={20} color={Colors.primary} strokeWidth={2.4} />
          </Pressable>
        </View>

        <ChoiceRow
          icon={<Flag size={22} color={Colors.accent} strokeWidth={2.4} />}
          title="Play solo"
          subtitle="Track your own scorecard and GPS distances."
          loading={soloLoading}
          disabled={busy}
          onPress={onSolo}
        />
        <ChoiceRow
          icon={<Users size={22} color={Colors.accent} strokeWidth={2.4} />}
          title="Host a group"
          subtitle="Get a code friends enter to score together live."
          loading={hostLoading}
          disabled={busy}
          onPress={onHost}
        />
      </View>
    </Modal>
  );
}

function ChoiceRow({
  icon,
  title,
  subtitle,
  loading,
  disabled,
  onPress,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  loading: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      style={({ pressed }) => [
        styles.choice,
        pressed && !disabled && styles.choicePressed,
        loading && styles.choiceActive,
      ]}
    >
      <View style={styles.choiceIcon}>{icon}</View>
      <View style={styles.rowLeft}>
        <Text style={styles.choiceTitle}>{title}</Text>
        <Text style={styles.choiceSub}>{subtitle}</Text>
      </View>
      {loading ? <View style={styles.dot} /> : null}
    </Pressable>
  );
}

/** Bottom sheet for entering a 6-character code to join a friend's round. */
export function JoinGameSheet({
  visible,
  loading,
  error,
  onJoin,
  onClose,
}: {
  visible: boolean;
  loading: boolean;
  error: string | null;
  onJoin: (code: string) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [code, setCode] = useState<string>("");

  const submit = (): void => {
    if (code.trim().length < 4) return;
    onJoin(code.trim().toUpperCase());
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      onShow={() => setCode("")}
    >
      <Pressable style={styles.backdrop} onPress={loading ? undefined : onClose} />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={[styles.sheet, { paddingBottom: insets.bottom + Spacing.lg }]}>
          <View style={styles.grabber} />
          <View style={styles.sheetHead}>
            <View style={styles.rowLeft}>
              <Text style={styles.overline}>JOIN A GROUP</Text>
              <Text style={styles.sheetTitle}>Enter the code</Text>
            </View>
            <Pressable style={styles.close} onPress={onClose} hitSlop={8} disabled={loading}>
              <X size={20} color={Colors.primary} strokeWidth={2.4} />
            </Pressable>
          </View>

          <TextInput
            value={code}
            onChangeText={(t) => setCode(t.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
            placeholder="ABC123"
            placeholderTextColor={Colors.textTertiary}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={6}
            style={styles.codeInput}
            returnKeyType="go"
            onSubmitEditing={submit}
            editable={!loading}
          />
          {error ? <Text style={styles.error}>{error}</Text> : null}

          <TeeButton
            label="Join group"
            onPress={submit}
            loading={loading}
            disabled={code.trim().length < 4}
            style={styles.joinCta}
            icon={<Users size={18} color={Colors.onPrimary} strokeWidth={2.4} />}
          />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: Colors.scrim },
  sheet: {
    backgroundColor: Colors.background,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.md,
    gap: Spacing.md,
  },
  grabber: {
    alignSelf: "center",
    width: 40,
    height: 5,
    borderRadius: 3,
    backgroundColor: Colors.borderStrong,
    marginBottom: Spacing.sm,
  },
  sheetHead: { flexDirection: "row", alignItems: "center", gap: Spacing.md },
  rowLeft: { flex: 1, gap: 3 },
  overline: { ...Typography.overline, fontSize: 10 },
  sheetTitle: { ...Typography.title, fontSize: 24 },
  close: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.primarySoft,
  },
  choice: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: hairline,
    borderColor: Colors.border,
    padding: Spacing.lg,
  },
  choicePressed: { opacity: 0.85 },
  choiceActive: { borderColor: Colors.accent, backgroundColor: Colors.accentSoft },
  choiceIcon: {
    width: 48,
    height: 48,
    borderRadius: Radius.md,
    backgroundColor: Colors.accentSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  choiceTitle: { ...Typography.headline, fontSize: 18 },
  choiceSub: { ...Typography.subhead, color: Colors.textSecondary, lineHeight: 18 },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: Colors.accent },
  codeInput: {
    height: 64,
    borderRadius: Radius.md,
    borderWidth: 1.5,
    borderColor: Colors.borderStrong,
    backgroundColor: Colors.surface,
    textAlign: "center",
    fontSize: 30,
    fontWeight: "800",
    letterSpacing: 8,
    color: Colors.primary,
  },
  error: { ...Typography.subhead, color: Colors.danger, textAlign: "center" },
  joinCta: { marginTop: Spacing.xs },
});
