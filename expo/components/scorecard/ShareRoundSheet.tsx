import * as Sharing from "expo-sharing";
import { Share2, X } from "lucide-react-native";
import React, { useRef, useState } from "react";
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { TeeButton } from "@/components/ui/TeeButton";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Colors, Spacing, Typography } from "@/constants/theme";
import type { LeaderboardEntry } from "@/services/db";
import { captureViewToPng } from "@/utils/capture";
import { tapLight } from "@/utils/haptics";
import type { ScorecardData } from "@/utils/scorecard";

import { GroupCard } from "./GroupCard";
import { CARD_WIDTH, ScorecardCard } from "./ScorecardCard";
import { SummaryCard } from "./SummaryCard";

type Format = "scorecard" | "summary" | "group";

// Logical (React Native) height for each format, matching the cards' own
// dimensions — the sheet needs these to ask capture.ts for a correctly
// proportioned, consistently-sized export.
const CARD_HEIGHTS: Record<Format, number> = {
  scorecard: Math.round(CARD_WIDTH * 1.25),
  summary: CARD_WIDTH,
  group: Math.round(CARD_WIDTH * 1.25),
};

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
    const result = await captureViewToPng(shotRef, CARD_WIDTH, CARD_HEIGHTS[format]);
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

    // expo-sharing is built to hand a file to the OS share sheet on both
    // platforms. RN's own Share.share() drops the `url` option on Android
    // entirely and has no way to attach a file, so it can't be used here.
    if (!(await Sharing.isAvailableAsync())) {
      Alert.alert("Can't share from here", "This device doesn't have a way to share files.");
      return;
    }
    try {
      await Sharing.shareAsync(result.uri, { mimeType: "image/png", UTI: "public.png" });
    } catch {
      // shareAsync resolves normally when the golfer just dismisses the
      // sheet — it only rejects on a genuine failure, so this is real.
      Alert.alert("Couldn't share the scorecard", "Please try again in a moment.");
    }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>Share this round</Text>
          <Pressable style={styles.close} onPress={onClose} hitSlop={8} disabled={busy}>
            <X size={22} color={Colors.primary} strokeWidth={2.4} />
          </Pressable>
        </View>

        {/* SegmentedControl has no `disabled` prop and is shared with other
            screens, so lock it out from the outside instead of changing it. */}
        <View pointerEvents={busy ? "none" : "auto"}>
          <SegmentedControl options={options} value={format} onChange={setFormat} style={styles.tabs} />
        </View>

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
