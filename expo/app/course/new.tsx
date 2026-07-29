import { useMutation, useQueryClient } from "@tanstack/react-query";
import * as Location from "expo-location";
import { useRouter } from "expo-router";
import { Check, Crosshair, Minus, Plus, Undo2, X } from "lucide-react-native";
import React, { useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { SatelliteMap } from "@/components/SatelliteMap";
import type { MapRegion } from "@/components/SatelliteMap.types";
import { TeeButton } from "@/components/ui/TeeButton";
import { TeeTextField } from "@/components/ui/TeeTextField";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Colors, Radius, Spacing, Typography, cardShadow, hairline } from "@/constants/theme";
import { useAuth } from "@/providers/AuthProvider";
import { createCourseWithHoles, type NewHoleInput } from "@/services/db";
import { notifySuccess, tapMedium } from "@/utils/haptics";
import { checkCourseName } from "@/utils/moderation";

type Phase = "details" | "mapping";

interface PlacedHole {
  number: number;
  par: number;
  latitude: number;
  longitude: number;
}

const DEFAULT_REGION: MapRegion = {
  latitude: 36.5687,
  longitude: -121.9501,
  latitudeDelta: 0.004,
  longitudeDelta: 0.004,
};

const HOLE_OPTIONS: { label: string; value: number }[] = [
  { label: "9 holes", value: 9 },
  { label: "18 holes", value: 18 },
];

export default function NewCourseScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const [phase, setPhase] = useState<Phase>("details");
  const [name, setName] = useState<string>("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [city, setCity] = useState<string>("");
  const [country, setCountry] = useState<string>("");
  const [holeCount, setHoleCount] = useState<number>(18);

  const [holes, setHoles] = useState<PlacedHole[]>([]);
  const [par, setPar] = useState<number>(4);
  const [preparing, setPreparing] = useState<boolean>(false);
  const [initialRegion, setInitialRegion] = useState<MapRegion>(DEFAULT_REGION);

  const regionRef = useRef<MapRegion>(DEFAULT_REGION);

  const save = useMutation({
    mutationFn: (placed: PlacedHole[]) => {
      if (!user) throw new Error("Not signed in");
      const holeInputs: NewHoleInput[] = placed.map((h) => ({
        number: h.number,
        par: h.par,
        green_lat: h.latitude,
        green_lng: h.longitude,
      }));
      return createCourseWithHoles({
        name: name.trim(),
        city: city.trim() || null,
        country: country.trim() || null,
        createdBy: user.id,
        holes: holeInputs,
      });
    },
    onSuccess: async () => {
      notifySuccess();
      await queryClient.invalidateQueries({ queryKey: ["courses"] });
      router.back();
    },
  });

  const startMapping = async (): Promise<void> => {
    if (name.trim().length < 2 || preparing) return;

    // A hand-mapped course name reaches other golfers: it is shown in the round
    // header to everyone who joins the group, and goes out in the invite text
    // via the share sheet. So it gets the same pre-post filter as a display name.
    const check = checkCourseName(name);
    if (!check.ok) {
      setNameError(check.reason);
      return;
    }
    setNameError(null);

    setPreparing(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === "granted") {
        const loc = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.High,
        }).catch(() => null);
        if (loc) {
          const region: MapRegion = {
            latitude: loc.coords.latitude,
            longitude: loc.coords.longitude,
            latitudeDelta: 0.004,
            longitudeDelta: 0.004,
          };
          setInitialRegion(region);
          regionRef.current = region;
        }
      }
    } finally {
      setPreparing(false);
      setPhase("mapping");
    }
  };

  const currentNumber = holes.length + 1;
  const isLastHole = currentNumber >= holeCount;

  const setGreen = (): void => {
    const center = regionRef.current;
    const placed: PlacedHole = {
      number: currentNumber,
      par,
      latitude: center.latitude,
      longitude: center.longitude,
    };
    const next = [...holes, placed];
    tapMedium();
    // Commit the green to state BEFORE saving, even on the last hole. Returning
    // early without setHoles meant a failed save left `holes` one green short,
    // and the retry button then silently persisted an incomplete course.
    setHoles(next);
    if (next.length >= holeCount) {
      save.mutate(next);
      return;
    }
    setPar(4);
  };

  // Save whatever greens are already placed, without forcing the golfer to map
  // every hole. Lets you finish early with a partial course.
  const saveNow = (): void => {
    if (holes.length === 0 || save.isPending) return;
    tapMedium();
    save.mutate(holes);
  };

  const undo = (): void => {
    if (holes.length === 0) return;
    const next = holes.slice(0, -1);
    setHoles(next);
    setPar(next.length > 0 ? 4 : par);
  };

  if (phase === "details") {
    return (
      <View style={styles.container}>
        <Header
          title="New course"
          topInset={insets.top}
          onClose={() => router.back()}
        />
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          keyboardVerticalOffset={insets.top + 56}
        >
          <ScrollView
            contentContainerStyle={styles.detailsScroll}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.lead}>
              Name the course, then drop one point on the center of every green.
            </Text>

            <View style={styles.form}>
              <TeeTextField
                label="Course name"
                value={name}
                onChangeText={(text) => {
                  setName(text);
                  if (nameError) setNameError(null);
                }}
                placeholder="e.g. Riverbend Links"
                autoCapitalize="words"
                returnKeyType="next"
                maxLength={40}
              />
              {nameError ? <Text style={styles.fieldError}>{nameError}</Text> : null}
              <View style={styles.fieldRow}>
                <TeeTextField
                  label="City"
                  value={city}
                  onChangeText={setCity}
                  placeholder="Optional"
                  autoCapitalize="words"
                  containerStyle={styles.flex}
                />
                <TeeTextField
                  label="Country"
                  value={country}
                  onChangeText={setCountry}
                  placeholder="Optional"
                  autoCapitalize="words"
                  containerStyle={styles.flex}
                />
              </View>

              <View>
                <Text style={styles.fieldLabel}>Holes</Text>
                <SegmentedControl
                  options={HOLE_OPTIONS}
                  value={holeCount}
                  onChange={setHoleCount}
                />
              </View>
            </View>
          </ScrollView>

          <View style={[styles.footer, { paddingBottom: insets.bottom + Spacing.lg }]}>
            <TeeButton
              label="Start mapping"
              onPress={startMapping}
              loading={preparing}
              disabled={name.trim().length < 2}
            />
          </View>
        </KeyboardAvoidingView>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <SatelliteMap
        style={StyleSheet.absoluteFill}
        initialRegion={initialRegion}
        markers={holes.map((h) => ({
          id: String(h.number),
          coordinate: { latitude: h.latitude, longitude: h.longitude },
          label: String(h.number),
        }))}
        onRegionChange={(r) => {
          regionRef.current = r;
        }}
      />

      {/* Fixed crosshair marking the exact green coordinate. */}
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.reticleWrap]}>
        <View style={styles.reticleRing}>
          <View style={styles.reticleDot} />
        </View>
      </View>

      {/* Top: hole + par controls */}
      <View style={[styles.mapTop, { paddingTop: insets.top + Spacing.sm }]}>
        <View style={styles.topCard}>
          <Pressable style={styles.topClose} onPress={() => router.back()} hitSlop={8}>
            <X size={20} color={Colors.primary} strokeWidth={2.4} />
          </Pressable>
          <View style={styles.topInfo}>
            <Text style={styles.topOverline}>MAPPING GREEN</Text>
            <Text style={styles.topHole}>
              Hole {currentNumber}
              <Text style={styles.topHoleOf}> of {holeCount}</Text>
            </Text>
          </View>
          <ParStepper value={par} onChange={setPar} />
        </View>
      </View>

      {/* Bottom: instruction + actions */}
      <View style={[styles.mapBottom, { paddingBottom: insets.bottom + Spacing.lg }]}>
        <View style={styles.bottomCard}>
          <View style={styles.bottomHint}>
            <Crosshair size={16} color={Colors.accent} strokeWidth={2.4} />
            <Text style={styles.bottomHintText}>
              Drag the map so the crosshair sits on the middle of the green.
            </Text>
          </View>
          <View style={styles.bottomActions}>
            {holes.length > 0 ? (
              <Pressable style={styles.undoButton} onPress={undo} hitSlop={6}>
                <Undo2 size={18} color={Colors.primary} strokeWidth={2.4} />
                <Text style={styles.undoText}>Undo</Text>
              </Pressable>
            ) : null}
            <TeeButton
              label={isLastHole ? "Set green & save course" : "Set green & continue"}
              onPress={setGreen}
              style={styles.flex}
            />
          </View>
          {holes.length > 0 && !isLastHole ? (
            <Pressable style={styles.saveNowButton} onPress={saveNow} hitSlop={6}>
              <Check size={17} color={Colors.accent} strokeWidth={2.6} />
              <Text style={styles.saveNowText}>
                Save course now ({holes.length} {holes.length === 1 ? "green" : "greens"})
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      {save.isPending ? (
        <View style={styles.savingOverlay}>
          <ActivityIndicator color={Colors.onPrimary} />
          <Text style={styles.savingText}>Saving course…</Text>
        </View>
      ) : null}

      {save.isError ? (
        <View style={[styles.errorToast, { bottom: insets.bottom + 160 }]}>
          <Text style={styles.errorToastText}>Couldn&apos;t save. Tap to retry.</Text>
          <TeeButton label="Retry" variant="secondary" onPress={() => save.mutate(holes)} />
        </View>
      ) : null}
    </View>
  );
}

function ParStepper({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const dec = (): void => {
    if (value <= 3) return;
    tapMedium();
    onChange(value - 1);
  };
  const inc = (): void => {
    if (value >= 6) return;
    tapMedium();
    onChange(value + 1);
  };
  return (
    <View style={styles.parWrap}>
      <Text style={styles.parLabel}>PAR</Text>
      <View style={styles.parRow}>
        <Pressable style={styles.parButton} onPress={dec} hitSlop={6}>
          <Minus size={16} color={value <= 3 ? Colors.textTertiary : Colors.primary} strokeWidth={3} />
        </Pressable>
        <Text style={styles.parValue}>{value}</Text>
        <Pressable style={styles.parButton} onPress={inc} hitSlop={6}>
          <Plus size={16} color={value >= 6 ? Colors.textTertiary : Colors.primary} strokeWidth={3} />
        </Pressable>
      </View>
    </View>
  );
}

function Header({
  title,
  topInset,
  onClose,
}: {
  title: string;
  topInset: number;
  onClose: () => void;
}) {
  return (
    <View style={[styles.header, { paddingTop: topInset + Spacing.sm }]}>
      <Pressable style={styles.headerClose} onPress={onClose} hitSlop={8}>
        <X size={22} color={Colors.primary} strokeWidth={2.4} />
      </Pressable>
      <Text style={styles.headerTitle}>{title}</Text>
      <View style={styles.headerSpacer} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },

  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.md,
  },
  headerClose: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: { ...Typography.headline, flex: 1, textAlign: "center" },
  headerSpacer: { width: 40 },

  detailsScroll: { padding: Spacing.xl, gap: Spacing.xl },
  lead: { ...Typography.body, color: Colors.textSecondary, lineHeight: 22 },
  form: { gap: Spacing.lg },
  fieldRow: { flexDirection: "row", gap: Spacing.md },
  fieldError: {
    color: Colors.danger,
    fontSize: 14,
    fontWeight: "500",
    marginTop: -Spacing.sm,
  },
  fieldLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: Colors.textTertiary,
    letterSpacing: 1.4,
    textTransform: "uppercase",
    marginBottom: Spacing.sm,
    marginLeft: 2,
  },
  footer: {
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.md,
    borderTopWidth: hairline,
    borderTopColor: Colors.border,
    backgroundColor: Colors.background,
  },

  reticleWrap: { alignItems: "center", justifyContent: "center" },
  reticleRing: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 2.5,
    borderColor: Colors.surface,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(78,140,106,0.18)",
    shadowColor: "#000",
    shadowOpacity: 0.4,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  reticleDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: Colors.accent },

  placedPin: {
    minWidth: 26,
    height: 26,
    paddingHorizontal: 6,
    borderRadius: 13,
    backgroundColor: Colors.accent,
    borderWidth: 2,
    borderColor: Colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  placedPinText: { color: Colors.onAccent, fontSize: 13, fontWeight: "800" },

  mapTop: { position: "absolute", top: 0, left: 0, right: 0, paddingHorizontal: Spacing.md },
  topCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.md,
    ...cardShadow,
  },
  topClose: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: Colors.primarySoft },
  topInfo: { flex: 1 },
  topOverline: { ...Typography.overline, fontSize: 10 },
  topHole: { ...Typography.headline, fontSize: 20, marginTop: 2 },
  topHoleOf: { color: Colors.textTertiary, fontWeight: "500" },

  parWrap: { alignItems: "center", gap: 4 },
  parLabel: { ...Typography.overline, fontSize: 10 },
  parRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  parButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: hairline,
    borderColor: Colors.borderStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  parValue: {
    minWidth: 22,
    textAlign: "center",
    fontSize: 20,
    fontWeight: "800",
    color: Colors.primary,
    fontVariant: ["tabular-nums"],
  },

  mapBottom: { position: "absolute", bottom: 0, left: 0, right: 0, paddingHorizontal: Spacing.md },
  bottomCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    gap: Spacing.md,
    ...cardShadow,
  },
  bottomHint: { flexDirection: "row", alignItems: "center", gap: 8 },
  bottomHintText: { ...Typography.subhead, color: Colors.textSecondary, flex: 1, lineHeight: 18 },
  bottomActions: { flexDirection: "row", alignItems: "center", gap: Spacing.md },
  undoButton: {
    height: 56,
    paddingHorizontal: Spacing.lg,
    borderRadius: Radius.md,
    borderWidth: hairline,
    borderColor: Colors.borderStrong,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  undoText: { ...Typography.callout, color: Colors.primary },
  saveNowButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: Spacing.sm,
  },
  saveNowText: { ...Typography.callout, color: Colors.accent, fontWeight: "700" },

  savingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: Colors.scrim,
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.md,
  },
  savingText: { color: Colors.onPrimary, fontSize: 16, fontWeight: "600" },

  errorToast: {
    position: "absolute",
    left: Spacing.lg,
    right: Spacing.lg,
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    padding: Spacing.lg,
    gap: Spacing.md,
    ...cardShadow,
  },
  errorToastText: { ...Typography.callout, color: Colors.danger },
});
