import { Share2, X } from "lucide-react-native";
import React, { useRef, useState } from "react";
import { Alert, Modal, Pressable, ScrollView, Share, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { TeeButton } from "@/components/ui/TeeButton";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Colors, Spacing, Typography } from "@/constants/theme";
import type { LeaderboardEntry } from "@/services/db";
import { captureViewToPng } from "@/utils/capture";
import { tapLight } from "@/utils/haptics";
import type { ScorecardData } from "@/utils/scorecard";

import { GroupCard } from "./GroupCard";
import { ScorecardCard } from "./ScorecardCard";
import { SummaryCard } from "./SummaryCard";

type Format = "scorecard" | "summary" | "group";

interface ShareRoundSheetProps {
  visible: boolean;
  onClose: () => void;
  courseName: string;
  date: string;
  card: ScorecardData;
  playerName: string;
  /** Empty for solo rounds — the Group tab is then not offered at all. */
  entries: LeaderboardEntry[];
}

export function ShareRoundSheet({
  visible,
  onClose,
  courseName,
  date,
  card,
  playerName,
  entries,
}: ShareRoundSheetProps) {
  const insets = useSafeAreaInsets();
  const [format, setFormat] = useState<Format>("scorecard");
  const [busy, setBusy] = useState(false);
  const shotRef = useRef<View>(null);

  // Format is an explicit choice, so other players' names and scores leave the
  // device only when the golfer deliberately picks this tab.
  const options: { label: string; value: Format }[] = [
    { label: "Scorecard", value: "scorecard" },
    { label: "Summary", value: "summary" },
    ...(entries.length > 0 ? [{ label: "Group", value: "group" as Format }] : []),
  ];

  const onShare = async (): Promise<void> => {
    setBusy(true);
    const result = await captureViewToPng(shotRef);
    setBusy(false);

    if (result.reason === "unavailable") {
      Alert.alert(
        "Not available here",
        "Sharing a scorecard needs the full app — it doesn't work in Expo Go. Everything you see here is the real card."
      );
      return;
    }
    if (result.uri == null) {
      Alert.alert("Couldn't build the image", "Please try again in a moment.");
      return;
    }
    try {
      await Share.share({ url: result.uri });
    } catch {
      // The golfer dismissed the share sheet. Nothing to report.
    }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>Share this round</Text>
          <Pressable style={styles.close} onPress={onClose} hitSlop={8}>
            <X size={22} color={Colors.primary} strokeWidth={2.4} />
          </Pressable>
        </View>

        <SegmentedControl options={options} value={format} onChange={setFormat} style={styles.tabs} />

        <ScrollView contentContainerStyle={styles.preview} showsVerticalScrollIndicator={false}>
          <View ref={shotRef} collapsable={false}>
            {format === "scorecard" ? (
              <ScorecardCard courseName={courseName} date={date} card={card} playerName={playerName} />
            ) : format === "summary" ? (
              <SummaryCard courseName={courseName} date={date} card={card} playerName={playerName} />
            ) : (
              <GroupCard
                courseName={courseName}
                date={date}
                card={card}
                playerName={playerName}
                entries={entries}
              />
            )}
          </View>
        </ScrollView>

        <View style={[styles.footer, { paddingBottom: insets.bottom + Spacing.lg }]}>
          <TeeButton
            label="Share"
            icon={<Share2 size={17} color={Colors.onPrimary} strokeWidth={2.4} />}
            loading={busy}
            onPress={() => {
              tapLight();
              void onShare();
            }}
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.xl,
    paddingBottom: Spacing.md,
  },
  title: { ...Typography.title, flex: 1 },
  close: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  tabs: { marginHorizontal: Spacing.xl },
  preview: { alignItems: "center", padding: Spacing.xl },
  footer: { paddingHorizontal: Spacing.xl, paddingTop: Spacing.md },
});
