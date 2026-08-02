import Constants from "expo-constants";
import { useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { Briefcase, ChevronRight, LifeBuoy, Lock, LogOut, Mail, Ruler, Trash2, User as UserIcon, Users } from "lucide-react-native";
import React, { useState } from "react";
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Wordmark } from "@/components/Wordmark";
import { TeeButton } from "@/components/ui/TeeButton";
import { TeeCard } from "@/components/ui/TeeCard";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Links } from "@/constants/links";
import { Colors, Radius, Spacing, Typography, hairline } from "@/constants/theme";
import { useClubs } from "@/hooks/useClubs";
import { useAuth } from "@/providers/AuthProvider";
import { useBlockedPlayers } from "@/providers/BlockedPlayersProvider";
import { useSettings } from "@/providers/SettingsProvider";
import { tapLight } from "@/utils/haptics";
import type { DistanceUnit } from "@/utils/geo";

const UNIT_OPTIONS: { label: string; value: DistanceUnit }[] = [
  { label: "Yards", value: "yards" },
  { label: "Meters", value: "meters" },
];

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { unit, setUnit, discoverableRounds, setDiscoverableRounds } = useSettings();
  const { profile, user, signOut, clearMyData, deleteAccount } = useAuth();
  const { blocked, unblockPlayer } = useBlockedPlayers();
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

      <SectionLabel icon={<Users size={14} color={Colors.textTertiary} strokeWidth={2.4} />}>
        Group rounds
      </SectionLabel>
      <TeeCard padded={false} style={styles.card}>
        <View style={styles.toggleRow}>
          <View style={styles.toggleText}>
            <Text style={styles.toggleTitle}>Let nearby players join your round</Text>
            <Text style={styles.toggleSub}>
              When you host, golfers at the same course see your name and that your round is
              open, and can join without the invite code. Off means only someone with your code
              can join.
            </Text>
          </View>
          <Switch
            value={discoverableRounds}
            onValueChange={setDiscoverableRounds}
            trackColor={{ false: Colors.border, true: Colors.accent }}
            thumbColor="#FFFFFF"
            ios_backgroundColor={Colors.border}
          />
        </View>
      </TeeCard>
      <Text style={styles.hint}>
        Applies the next time you host. A round already in progress has its own switch next to
        the invite code.
      </Text>

      {blocked.length > 0 ? (
        <>
          <SectionLabel icon={<UserIcon size={14} color={Colors.textTertiary} strokeWidth={2.4} />}>
            Blocked players
          </SectionLabel>
          <TeeCard padded={false} style={styles.card}>
            <View style={styles.row}>
              <Text style={styles.rowLabel}>
                {blocked.length} {blocked.length === 1 ? "player" : "players"} hidden
              </Text>
            </View>
            <Divider />
            <LinkRow
              icon={<UserIcon size={18} color={Colors.textSecondary} strokeWidth={2.2} />}
              label="Unblock everyone"
              onPress={() => {
                Alert.alert(
                  "Unblock everyone?",
                  "You'll start seeing these players on leaderboards again.",
                  [
                    { text: "Cancel", style: "cancel" },
                    {
                      text: "Unblock all",
                      onPress: () => blocked.forEach((id) => unblockPlayer(id)),
                    },
                  ]
                );
              }}
            />
          </TeeCard>
        </>
      ) : null}

      <SectionLabel icon={<LifeBuoy size={14} color={Colors.textTertiary} strokeWidth={2.4} />}>
        Help &amp; legal
      </SectionLabel>
      <TeeCard padded={false} style={styles.card}>
        <LinkRow
          icon={<LifeBuoy size={18} color={Colors.textSecondary} strokeWidth={2.2} />}
          label="Help &amp; FAQ"
          onPress={() => openLink(Links.support)}
        />
        <Divider />
        <LinkRow
          icon={<Mail size={18} color={Colors.textSecondary} strokeWidth={2.2} />}
          label="Contact support"
          onPress={() => {
            tapLight();
            Linking.openURL(`mailto:${Links.supportEmail}?subject=Tee%20support`).catch(() => {
              Alert.alert(
                "Couldn't open Mail",
                `Write to us at ${Links.supportEmail} and we'll get back to you.`
              );
            });
          }}
        />
        <Divider />
        <LinkRow
          icon={<Lock size={18} color={Colors.textSecondary} strokeWidth={2.2} />}
          label="Privacy Policy"
          onPress={() => openLink(Links.privacyPolicy)}
        />
      </TeeCard>

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

/** Opens a page in an in-app browser, falling back to Safari if that fails. */
async function openLink(url: string): Promise<void> {
  tapLight();
  try {
    await WebBrowser.openBrowserAsync(url);
  } catch {
    Linking.openURL(url).catch(() => {
      Alert.alert("Couldn't open the page", url);
    });
  }
}

function LinkRow({
  icon,
  label,
  onPress,
}: {
  icon: React.ReactNode;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={styles.linkRow}
      onPress={onPress}
      accessibilityRole="link"
      accessibilityLabel={label}
    >
      {icon}
      <Text style={styles.linkLabel}>{label}</Text>
      <ChevronRight size={18} color={Colors.textTertiary} strokeWidth={2.4} />
    </Pressable>
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
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: Spacing.lg,
    gap: Spacing.lg,
  },
  toggleText: { flex: 1, gap: 4 },
  toggleTitle: { ...Typography.body, fontWeight: "600" },
  toggleSub: { ...Typography.subhead, color: Colors.textTertiary, lineHeight: 18 },
  linkRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    paddingVertical: Spacing.lg,
    minHeight: 48,
  },
  linkLabel: { ...Typography.body, flex: 1 },
  divider: { height: 1, backgroundColor: Colors.border },
  hint: { ...Typography.subhead, color: Colors.textTertiary, marginTop: Spacing.md, marginLeft: 2 },
  about: { alignItems: "center", marginTop: Spacing.xxxl, gap: 8 },
  version: { ...Typography.caption, color: Colors.textTertiary },
  footer: { marginTop: "auto", paddingTop: Spacing.xxl, gap: Spacing.md },
});
