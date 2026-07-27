import Constants from "expo-constants";
import { useRouter } from "expo-router";
import { Briefcase, ChevronRight, LogOut, Ruler, Trash2, User as UserIcon } from "lucide-react-native";
import React, { useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Wordmark } from "@/components/Wordmark";
import { TeeButton } from "@/components/ui/TeeButton";
import { TeeCard } from "@/components/ui/TeeCard";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Colors, Radius, Spacing, Typography, hairline } from "@/constants/theme";
import { useClubs } from "@/hooks/useClubs";
import { useAuth } from "@/providers/AuthProvider";
import { useSettings } from "@/providers/SettingsProvider";
import type { DistanceUnit } from "@/utils/geo";

const UNIT_OPTIONS: { label: string; value: DistanceUnit }[] = [
  { label: "Yards", value: "yards" },
  { label: "Meters", value: "meters" },
];

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { unit, setUnit } = useSettings();
  const { profile, user, signOut, clearMyData, deleteAccount } = useAuth();
  const { clubs } = useClubs();
  const [clearing, setClearing] = useState<boolean>(false);
  const [deleting, setDeleting] = useState<boolean>(false);

  const version = Constants.expoConfig?.version ?? "1.0";

  const confirmClearData = (): void => {
    Alert.alert(
      "Delete all your data?",
      "This permanently erases your round history, scores, and stats. Your account stays active. This can't be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete data",
          style: "destructive",
          onPress: async () => {
            setClearing(true);
            const { error } = await clearMyData();
            setClearing(false);
            if (error) {
              Alert.alert("Couldn't delete data", error);
            } else {
              Alert.alert("Done", "Your data has been deleted.");
            }
          },
        },
      ]
    );
  };

  const confirmDeleteAccount = (): void => {
    Alert.alert(
      "Delete your account?",
      "This permanently deletes your account and all of your information. You'll be signed out and this can't be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete account",
          style: "destructive",
          onPress: async () => {
            setDeleting(true);
            const { error } = await deleteAccount();
            setDeleting(false);
            if (error) {
              Alert.alert("Couldn't delete account", error);
            }
          },
        },
      ]
    );
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + Spacing.xl, paddingBottom: insets.bottom + 32 },
      ]}
      showsVerticalScrollIndicator={false}
    >
      <Text style={styles.title}>Settings</Text>

      <SectionLabel icon={<UserIcon size={14} color={Colors.textTertiary} strokeWidth={2.4} />}>
        Profile
      </SectionLabel>
      <TeeCard padded={false} style={styles.card}>
        <Row label="Name" value={profile?.display_name ?? "—"} />
        <Divider />
        <Row label="Email" value={user?.email ?? "—"} />
      </TeeCard>

      <SectionLabel icon={<Briefcase size={14} color={Colors.textTertiary} strokeWidth={2.4} />}>
        Smart Caddy
      </SectionLabel>
      <Pressable style={styles.navCard} onPress={() => router.push("/bag")}>
        <View style={styles.navInfo}>
          <Text style={styles.navTitle}>Your bag</Text>
          <Text style={styles.navSub}>
            {clubs.length > 0
              ? `${clubs.length} ${clubs.length === 1 ? "club" : "clubs"} · used for club tips`
              : "Add your clubs to get club recommendations"}
          </Text>
        </View>
        <ChevronRight size={20} color={Colors.textTertiary} strokeWidth={2.4} />
      </Pressable>

      <SectionLabel icon={<Ruler size={14} color={Colors.textTertiary} strokeWidth={2.4} />}>
        Distance units
      </SectionLabel>
      <SegmentedControl options={UNIT_OPTIONS} value={unit} onChange={setUnit} />
      <Text style={styles.hint}>
        Applied everywhere — including the live distance to the green.
      </Text>

      <View style={styles.about}>
        <Wordmark size={18} tint={Colors.textTertiary} />
        <Text style={styles.version}>Version {version}</Text>
      </View>

      <View style={styles.footer}>
        <TeeButton
          label="Sign out"
          variant="danger"
          onPress={signOut}
          icon={<LogOut size={18} color={Colors.danger} strokeWidth={2.4} />}
        />
        <TeeButton
          label="Delete all my data"
          variant="danger"
          loading={clearing}
          onPress={confirmClearData}
          icon={<Trash2 size={18} color={Colors.danger} strokeWidth={2.4} />}
        />
        <TeeButton
          label="Delete account"
          variant="danger"
          loading={deleting}
          onPress={confirmDeleteAccount}
          icon={<Trash2 size={18} color={Colors.danger} strokeWidth={2.4} />}
        />
      </View>
    </ScrollView>
  );
}

function SectionLabel({ children, icon }: { children: string; icon: React.ReactNode }) {
  return (
    <View style={styles.sectionLabel}>
      {icon}
      <Text style={styles.sectionLabelText}>{children}</Text>
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

function Divider() {
  return <View style={styles.divider} />;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { paddingHorizontal: Spacing.xl },
  title: { ...Typography.largeTitle, marginBottom: Spacing.xl },
  sectionLabel: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: Spacing.xl,
    marginBottom: Spacing.md,
    marginLeft: 2,
  },
  sectionLabelText: { ...Typography.overline },
  card: { paddingHorizontal: Spacing.lg },
  navCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: hairline,
    borderColor: Colors.border,
    paddingVertical: Spacing.lg,
    paddingHorizontal: Spacing.lg,
    gap: Spacing.md,
  },
  navInfo: { flex: 1, gap: 3 },
  navTitle: { ...Typography.body, fontWeight: "600" },
  navSub: { ...Typography.subhead, color: Colors.textSecondary },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: Spacing.lg,
    gap: Spacing.lg,
  },
  rowLabel: { ...Typography.body, color: Colors.textSecondary },
  rowValue: { ...Typography.callout, flexShrink: 1, textAlign: "right" },
  divider: { height: 1, backgroundColor: Colors.border },
  hint: { ...Typography.subhead, color: Colors.textTertiary, marginTop: Spacing.md, marginLeft: 2 },
  about: { alignItems: "center", marginTop: Spacing.xxxl, gap: 8 },
  version: { ...Typography.caption, color: Colors.textTertiary },
  footer: { marginTop: "auto", paddingTop: Spacing.xxl, gap: Spacing.md },
});
