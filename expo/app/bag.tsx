import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { ChevronLeft, Plus, Sparkles, Trash2, X } from "lucide-react-native";
import React, { useMemo, useState } from "react";
import {
  Alert,
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { TeeButton } from "@/components/ui/TeeButton";
import { TeeModal } from "@/components/ui/TeeModal";
import { Colors, Radius, Spacing, Typography, cardShadow, hairline } from "@/constants/theme";
import { useClubs } from "@/hooks/useClubs";
import { usePressScale } from "@/hooks/usePressScale";
import { useAuth } from "@/providers/AuthProvider";
import { useSettings } from "@/providers/SettingsProvider";
import { addClub, addClubs, removeClub, updateClub } from "@/services/db";
import type { Club } from "@/types/models";
import { metersToUnit, unitShort, unitToMeters } from "@/utils/geo";
import { notifySuccess, tapLight } from "@/utils/haptics";

/** Height of the floating "Add a club" pill — matches TeeButton's own default. */
const ISLAND_HEIGHT = 56;
/** Gap between the pill and the safe-area bottom. */
const ISLAND_BOTTOM_GAP = Spacing.lg;
/** Height of the gradient fade above the pill — tall enough to read as a soft vignette, not a hard edge. */
const SCRIM_HEIGHT = 96;

/** A sensible starter bag, in YARDS — converted to meters on insert. */
const STANDARD_SET: { name: string; yards: number }[] = [
  { name: "Driver", yards: 230 },
  { name: "3 Wood", yards: 210 },
  { name: "5 Wood", yards: 195 },
  { name: "Hybrid", yards: 180 },
  { name: "4 Iron", yards: 170 },
  { name: "5 Iron", yards: 160 },
  { name: "6 Iron", yards: 150 },
  { name: "7 Iron", yards: 140 },
  { name: "8 Iron", yards: 130 },
  { name: "9 Iron", yards: 120 },
  { name: "Pitching Wedge", yards: 110 },
  { name: "Gap Wedge", yards: 95 },
  { name: "Sand Wedge", yards: 80 },
  { name: "Lob Wedge", yards: 65 },
];

const YARDS_PER_METER = 1.0936133;

export default function BagScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { unit } = useSettings();
  const { clubs, isLoading } = useClubs();

  const userId = user?.id ?? null;
  const [editing, setEditing] = useState<Club | "new" | null>(null);

  const invalidate = (): void => {
    queryClient.invalidateQueries({ queryKey: ["clubs", userId] });
  };

  const seedSet = useMutation({
    mutationFn: () => {
      if (!userId) throw new Error("Not signed in");
      return addClubs(
        userId,
        STANDARD_SET.map((c) => ({
          name: c.name,
          carryMeters: c.yards / YARDS_PER_METER,
        }))
      );
    },
    onSuccess: () => {
      notifySuccess();
      invalidate();
    },
    onError: () => Alert.alert("Couldn't add clubs", "Please try again."),
  });

  const remove = useMutation({
    mutationFn: (clubId: string) => removeClub(clubId),
    onSuccess: invalidate,
    onError: () => Alert.alert("Couldn't remove club", "Please try again."),
  });

  const confirmRemove = (club: Club): void => {
    Alert.alert(`Remove ${club.name}?`, "This takes it out of your bag.", [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: () => remove.mutate(club.id) },
    ]);
  };

  return (
    <View style={styles.container}>
      <View style={[styles.topBar, { paddingTop: insets.top + Spacing.sm }]}>
        <Pressable style={styles.iconButton} onPress={() => router.back()} hitSlop={8}>
          <ChevronLeft size={26} color={Colors.primary} strokeWidth={2.4} />
        </Pressable>
        <Text style={styles.topTitle}>Your bag</Text>
        <View style={styles.iconButton} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.content,
          // Enough clearance for the last row to scroll clear of the floating
          // pill (its own height + the gap to the safe area) plus a buffer so
          // it doesn't feel cramped right underneath it.
          { paddingBottom: insets.bottom + ISLAND_BOTTOM_GAP + ISLAND_HEIGHT + Spacing.xl },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.intro}>
          Set the typical carry for each club. The Smart Caddy matches your
          plays-like distance to the closest one.
        </Text>

        {!isLoading && clubs.length === 0 ? (
          <View style={styles.empty}>
            <View style={styles.emptyIcon}>
              <Sparkles size={26} color={Colors.accent} strokeWidth={2.2} />
            </View>
            <Text style={styles.emptyTitle}>Build your bag</Text>
            <Text style={styles.emptyBody}>
              Start with a standard set and fine-tune each carry, or add clubs one
              at a time.
            </Text>
            <TeeButton
              label="Add a standard set"
              loading={seedSet.isPending}
              onPress={() => seedSet.mutate()}
              style={styles.emptyCta}
            />
            <Pressable style={styles.emptyLink} onPress={() => setEditing("new")} hitSlop={6}>
              <Text style={styles.emptyLinkText}>Add a single club</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.list}>
            {clubs.map((club) => (
              <Pressable
                key={club.id}
                style={styles.clubRow}
                onPress={() => {
                  tapLight();
                  setEditing(club);
                }}
              >
                <View style={styles.clubInfo}>
                  <Text style={styles.clubName}>{club.name}</Text>
                  <Text style={styles.clubCarry}>
                    {Math.round(metersToUnit(club.carry_meters, unit))} {unitShort(unit)} carry
                  </Text>
                </View>
                <Pressable
                  hitSlop={10}
                  style={styles.clubDelete}
                  onPress={() => {
                    tapLight();
                    confirmRemove(club);
                  }}
                >
                  <Trash2 size={18} color={Colors.danger} strokeWidth={2.2} />
                </Pressable>
              </Pressable>
            ))}
          </View>
        )}
      </ScrollView>

      {clubs.length > 0 ? (
        <>
          {/* The blur/gradient substitute: expo-blur and expo-linear-gradient
              were both removed for App Store size, so this is a plain SVG
              rect painted with a transparent-to-Colors.background gradient.
              On the flat cream background it reads the same as a blur, at
              effectively no cost. Non-interactive — the list still scrolls
              and is tappable straight through it. */}
          <View
            pointerEvents="none"
            style={[styles.scrim, { height: SCRIM_HEIGHT + insets.bottom }]}
          >
            {/* width/height props (not just absoluteFill's positioning) are
                required here: react-native-svg's web target renders a plain
                DOM <svg>, which — unlike a View — is a CSS "replaced element"
                and falls back to a fixed intrinsic 300x150 box when its own
                width/height are left unset, even with all four inset edges
                pinned to 0. Percentages on the SVG itself sidestep that. */}
            <Svg width="100%" height="100%" style={StyleSheet.absoluteFill}>
              <Defs>
                <LinearGradient id="bagListFade" x1="0" y1="0" x2="0" y2="1">
                  <Stop offset="0" stopColor={Colors.background} stopOpacity={0} />
                  <Stop offset="1" stopColor={Colors.background} stopOpacity={1} />
                </LinearGradient>
              </Defs>
              <Rect x="0" y="0" width="100%" height="100%" fill="url(#bagListFade)" />
            </Svg>
          </View>
          <View style={[styles.island, { bottom: insets.bottom + ISLAND_BOTTOM_GAP }]}>
            <TeeButton
              label="Add a club"
              onPress={() => setEditing("new")}
              icon={<Plus size={18} color={Colors.onPrimary} strokeWidth={2.6} />}
              style={styles.islandButton}
            />
          </View>
        </>
      ) : null}

      <ClubEditor
        target={editing}
        unit={unit}
        userId={userId}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          invalidate();
        }}
      />
    </View>
  );
}

function ClubEditor({
  target,
  unit,
  userId,
  onClose,
  onSaved,
}: {
  target: Club | "new" | null;
  unit: "yards" | "meters";
  userId: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const visible = target !== null;
  const existing = target !== null && target !== "new" ? target : null;
  const closeAnim = usePressScale();

  const initialName = existing?.name ?? "";
  const initialCarry =
    existing != null ? String(Math.round(metersToUnit(existing.carry_meters, unit))) : "";

  const [name, setName] = useState<string>(initialName);
  const [carry, setCarry] = useState<string>(initialCarry);
  const [seedKey, setSeedKey] = useState<string>("");

  // Reseed the inputs whenever a different club (or "new") opens the editor.
  const key = existing?.id ?? (target === "new" ? "new" : "closed");
  if (key !== seedKey && visible) {
    setSeedKey(key);
    setName(initialName);
    setCarry(initialCarry);
  }

  const save = useMutation({
    mutationFn: async (): Promise<void> => {
      if (!userId) throw new Error("Not signed in");
      const carryValue = parseFloat(carry);
      const carryMeters = unitToMeters(carryValue, unit);
      const payload = { name: name.trim(), carryMeters };
      if (existing) {
        await updateClub(existing.id, payload);
      } else {
        await addClub(userId, payload);
      }
    },
    onSuccess: () => {
      notifySuccess();
      onSaved();
    },
    onError: () => Alert.alert("Couldn't save club", "Please try again."),
  });

  const carryValue = parseFloat(carry);
  const valid = name.trim().length > 0 && Number.isFinite(carryValue) && carryValue > 0;

  return (
    <TeeModal visible={visible} onClose={onClose}>
      <View style={styles.editorHead}>
        <Text style={styles.editorTitle}>{existing ? "Edit club" : "Add club"}</Text>
        <Pressable
          onPress={onClose}
          onPressIn={closeAnim.onPressIn}
          onPressOut={closeAnim.onPressOut}
          hitSlop={8}
        >
          <Animated.View style={[styles.editorClose, { transform: [{ scale: closeAnim.scale }] }]}>
            <X size={20} color={Colors.primary} strokeWidth={2.4} />
          </Animated.View>
        </Pressable>
      </View>

      <Text style={styles.fieldLabel}>CLUB</Text>
      <TextInput
        style={styles.input}
        value={name}
        onChangeText={setName}
        placeholder="e.g. 7 Iron"
        placeholderTextColor={Colors.textTertiary}
        autoCapitalize="words"
        returnKeyType="next"
      />

      <Text style={styles.fieldLabel}>CARRY ({unitShort(unit)})</Text>
      <TextInput
        style={styles.input}
        value={carry}
        onChangeText={setCarry}
        placeholder={unit === "yards" ? "e.g. 150" : "e.g. 137"}
        placeholderTextColor={Colors.textTertiary}
        keyboardType="number-pad"
        returnKeyType="done"
      />

      <TeeButton
        label={existing ? "Save changes" : "Add to bag"}
        loading={save.isPending}
        disabled={!valid}
        onPress={() => save.mutate()}
        style={styles.editorSave}
      />
    </TeeModal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.sm,
  },
  iconButton: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  topTitle: { ...Typography.headline, flex: 1, textAlign: "center" },
  scroll: { flex: 1 },
  content: { paddingHorizontal: Spacing.xl, paddingTop: Spacing.sm },
  intro: { ...Typography.subhead, color: Colors.textSecondary, lineHeight: 20, marginBottom: Spacing.lg },

  empty: { alignItems: "center", paddingTop: Spacing.xxl, gap: Spacing.sm },
  emptyIcon: {
    width: 56,
    height: 56,
    borderRadius: Radius.pill,
    backgroundColor: Colors.accentSoft,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing.xs,
  },
  emptyTitle: { ...Typography.title, fontSize: 22 },
  emptyBody: { ...Typography.body, color: Colors.textSecondary, textAlign: "center", lineHeight: 22 },
  emptyCta: { marginTop: Spacing.md, alignSelf: "stretch" },
  emptyLink: { marginTop: Spacing.md, height: 24, justifyContent: "center" },
  emptyLinkText: { ...Typography.callout, color: Colors.accent, fontWeight: "600" },

  list: { gap: Spacing.sm },
  clubRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    borderWidth: hairline,
    borderColor: Colors.border,
    paddingVertical: Spacing.md,
    paddingLeft: Spacing.lg,
    paddingRight: Spacing.sm,
  },
  clubInfo: { flex: 1, gap: 2 },
  clubName: { ...Typography.headline, fontSize: 17 },
  clubCarry: { ...Typography.subhead, color: Colors.textSecondary },
  clubDelete: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },

  scrim: { position: "absolute", left: 0, right: 0, bottom: 0 },
  island: { position: "absolute", left: Spacing.xl, right: Spacing.xl },
  islandButton: { borderRadius: Radius.pill, ...cardShadow },

  editorHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: Spacing.lg,
  },
  editorTitle: { ...Typography.title, fontSize: 22 },
  editorClose: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.primarySoft,
  },
  fieldLabel: { ...Typography.overline, marginBottom: Spacing.sm, marginTop: Spacing.md },
  input: {
    height: 54,
    borderRadius: Radius.md,
    backgroundColor: Colors.surface,
    borderWidth: hairline,
    borderColor: Colors.borderStrong,
    paddingHorizontal: Spacing.lg,
    fontSize: 17,
    color: Colors.textPrimary,
  },
  editorSave: { marginTop: Spacing.xl },
});
