import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Briefcase, ChevronLeft, ChevronRight, Crosshair, Flag, LocateFixed, MapPin, Share2, Sparkles, Thermometer, Trophy, Users, Wind, X } from "lucide-react-native";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { SatelliteMap } from "@/components/SatelliteMap";
import type { MapRegion } from "@/components/SatelliteMap.types";
import { TeeButton } from "@/components/ui/TeeButton";
import { Stepper } from "@/components/ui/Stepper";
import { Links, reportMailto } from "@/constants/links";
import { Colors, Fonts, Radius, Spacing, Typography, hairline } from "@/constants/theme";
import { useClubs } from "@/hooks/useClubs";
import { useLiveLocation } from "@/hooks/useLiveLocation";
import { useActiveRound } from "@/providers/ActiveRoundProvider";
import { useAuth } from "@/providers/AuthProvider";
import { useBlockedPlayers } from "@/providers/BlockedPlayersProvider";
import { useSettings } from "@/providers/SettingsProvider";
import {
  fetchLeaderboard,
  fetchRoundBundle,
  finishRound,
  setHoleGreen,
  upsertScore,
} from "@/services/db";
import type { LeaderboardEntry } from "@/services/db";
import { fetchWeather } from "@/services/weather";
import type { Weather } from "@/services/weather";
import { isWeatherConfigured } from "@/services/weatherConfig";
import type { Club, Hole } from "@/types/models";
import { computePlaysLike, recommendClub, windKind } from "@/utils/caddy";
import type { PlaysLikeBreakdown } from "@/utils/caddy";
import { formatDistance, haversineMeters, metersToUnit, unitLabel, unitShort } from "@/utils/geo";
import { notifySuccess, tapLight } from "@/utils/haptics";

/**
 * Beyond this distance from the green we stop showing a yardage. 1.5 km is
 * comfortably past the longest hole ever played but well short of "you are in
 * another city", so it only ever triggers when the golfer genuinely isn't there.
 */
const OFF_COURSE_METERS = 1500;

export default function PlayRoundScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const { unit } = useSettings();
  const { activeRound, saveActiveRound, clearActiveRound } = useActiveRound();
  const { blockPlayer, isBlocked } = useBlockedPlayers();
  const { clubs } = useClubs();
  const queryClient = useQueryClient();

  const roundId = typeof id === "string" ? id : "";

  const bundleQuery = useQuery({
    queryKey: ["round", roundId],
    queryFn: () => fetchRoundBundle(roundId),
    enabled: roundId.length > 0,
  });

  const [holeIndex, setHoleIndex] = useState<number>(0);
  const [scores, setScores] = useState<Record<string, number>>({});
  const [seeded, setSeeded] = useState<boolean>(false);
  // Local edits that haven't been written to history/stats yet.
  const [dirty, setDirty] = useState<boolean>(false);
  // Which exit flow is asking to save: closing out, or finishing the round.
  const [exitPrompt, setExitPrompt] = useState<null | "close" | "finish">(null);

  const location = useLiveLocation(true);
  const [showCaddy, setShowCaddy] = useState<boolean>(false);

  // Weather for the Smart Caddy. Keyed on a coarse (~1km) coordinate so it stays
  // stable as the golfer walks a hole, and refreshes every few minutes / when
  // they move enough to land in a new grid cell (e.g. a new hole).
  const weatherCoordKey =
    location.coords != null
      ? `${location.coords.latitude.toFixed(2)},${location.coords.longitude.toFixed(2)}`
      : null;
  const weatherQuery = useQuery({
    queryKey: ["weather", weatherCoordKey],
    queryFn: () =>
      fetchWeather(location.coords!.latitude, location.coords!.longitude),
    enabled: weatherCoordKey != null && isWeatherConfigured,
    staleTime: 5 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  });
  const weather = weatherQuery.data ?? null;

  const bundle = bundleQuery.data;
  const holes = useMemo<Hole[]>(() => bundle?.holes ?? [], [bundle]);
  const currentHole = holes[holeIndex];

  const isMultiplayer = bundle?.round.is_multiplayer ?? false;
  const [showBoard, setShowBoard] = useState<boolean>(false);
  // True when a live multiplayer score write failed and the leaderboard is
  // therefore behind what the golfer sees on their own stepper.
  const [syncFailed, setSyncFailed] = useState<boolean>(false);

  const leaderboardQuery = useQuery({
    queryKey: ["leaderboard", roundId],
    queryFn: () => fetchLeaderboard(roundId),
    enabled: roundId.length > 0 && isMultiplayer,
    refetchInterval: isMultiplayer ? 4000 : false,
  });
  // Blocking is applied on read, so a blocked player disappears from the board
  // immediately rather than only after the round ends.
  const players = useMemo<LeaderboardEntry[]>(
    () => (leaderboardQuery.data ?? []).filter((p) => !isBlocked(p.profileId)),
    [leaderboardQuery.data, isBlocked]
  );

  // Seed local scores when the round loads. A paused round (resumed from the
  // "in progress" banner) restores its local scores and hole; otherwise we
  // start from any values already saved for this player.
  useEffect(() => {
    if (!bundle || seeded || !user) return;
    const mine: Record<string, number> = {};
    for (const s of bundle.scores) {
      if (s.profile_id === user.id) mine[s.hole_id] = s.strokes;
    }
    const resumed = activeRound && activeRound.roundId === roundId ? activeRound : null;
    if (resumed) {
      const merged = { ...mine, ...resumed.scores };
      setScores(merged);
      setHoleIndex(Math.min(Math.max(resumed.holeIndex, 0), Math.max(holes.length - 1, 0)));
      // Resumed local scores are unsaved edits until the round is finished.
      const hasUnsaved = Object.keys(resumed.scores).some(
        (holeId) => (resumed.scores[holeId] ?? 0) !== (mine[holeId] ?? 0)
      );
      if (hasUnsaved) setDirty(true);
    } else {
      setScores(mine);
    }
    setSeeded(true);
  }, [bundle, seeded, user, activeRound, roundId, holes.length]);

  const saveScore = useMutation({
    mutationFn: (input: { holeId: string; strokes: number }) => {
      if (!user) throw new Error("Not signed in");
      return upsertScore({
        round_id: roundId,
        profile_id: user.id,
        hole_id: input.holeId,
        strokes: input.strokes,
      });
    },
    onSuccess: () => {
      setSyncFailed(false);
      if (isMultiplayer) {
        queryClient.invalidateQueries({ queryKey: ["leaderboard", roundId] });
      }
    },
    onError: (error) => {
      // In a group round the leaderboard is the whole point, so a dropped write
      // has to be visible — it used to only reach console.error while the
      // stepper happily showed a score the server never received.
      console.error("[round] couldn't save score:", error);
      setSyncFailed(true);
    },
  });

  // Persist every locally-entered score in one go. Scores are kept in local
  // state while playing so an accidental tap never silently lands in history —
  // nothing is written until the golfer explicitly chooses to save.
  const persistScores = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Not signed in");
      const entries = Object.entries(scores).filter(([, strokes]) => strokes > 0);
      for (const [holeId, strokes] of entries) {
        await upsertScore({
          round_id: roundId,
          profile_id: user.id,
          hole_id: holeId,
          strokes,
        });
      }
    },
  });

  const finish = useMutation({
    mutationFn: () => finishRound(roundId),
    onSuccess: () => {
      clearActiveRound(roundId);
      router.back();
    },
  });

  const setGreen = useMutation({
    mutationFn: (input: { holeId: string; lat: number; lng: number }) =>
      setHoleGreen(input.holeId, input.lat, input.lng),
    onSuccess: () => {
      notifySuccess();
      queryClient.invalidateQueries({ queryKey: ["round", roundId] });
    },
    onError: () => {
      Alert.alert("Couldn't save the green", "Please try again in a moment.");
    },
  });

  const hasGreen =
    currentHole != null &&
    currentHole.green_lat != null &&
    currentHole.green_lng != null;

  const distanceMeters =
    location.coords && currentHole && hasGreen
      ? haversineMeters(
          location.coords.latitude,
          location.coords.longitude,
          currentHole.green_lat as number,
          currentHole.green_lng as number
        )
      : null;

  // Past this, the golfer plainly isn't on the hole — they're reviewing a
  // scorecard from home, or the green was pinned on the wrong course. Showing a
  // raw six-digit yardage in the hero slot reads as a broken app, so we swap in
  // an explicit off-course state instead.
  const offCourse = distanceMeters != null && distanceMeters > OFF_COURSE_METERS;

  // Plays-like distance: converts the raw GPS distance into what the shot really
  // plays given temperature + wind along the shot line.
  const playsLike = useMemo<PlaysLikeBreakdown | null>(() => {
    if (
      distanceMeters == null ||
      !location.coords ||
      !currentHole ||
      currentHole.green_lat == null ||
      currentHole.green_lng == null
    ) {
      return null;
    }
    return computePlaysLike(
      distanceMeters,
      { latitude: location.coords.latitude, longitude: location.coords.longitude },
      { latitude: currentHole.green_lat, longitude: currentHole.green_lng },
      weather
    );
  }, [distanceMeters, location.coords, currentHole, weather]);

  const recommendedClub = useMemo<Club | null>(
    () => (playsLike ? recommendClub(playsLike.playsLikeMeters, clubs) : null),
    [playsLike, clubs]
  );

  const onSetGreenHere = (): void => {
    if (!currentHole || !location.coords || setGreen.isPending) return;
    setGreen.mutate({
      holeId: currentHole.id,
      lat: location.coords.latitude,
      lng: location.coords.longitude,
    });
  };

  const [picking, setPicking] = useState<boolean>(false);

  // Static satellite preview of the mapped green for the current hole.
  const greenPreview = useMemo<{ region: MapRegion; markers: { id: string; coordinate: { latitude: number; longitude: number }; label: string }[] } | null>(() => {
    if (!currentHole || currentHole.green_lat == null || currentHole.green_lng == null) {
      return null;
    }
    const coordinate = { latitude: currentHole.green_lat, longitude: currentHole.green_lng };
    return {
      region: { ...coordinate, latitudeDelta: 0.0016, longitudeDelta: 0.0016 },
      markers: [{ id: "green", coordinate, label: String(currentHole.number) }],
    };
  }, [currentHole]);

  // Where to center the green picker for an UNMAPPED hole: stay on THIS course
  // instead of jumping to the player's live GPS. Prefer the centroid of greens
  // already mapped on this course, then the course's own coordinate.
  const courseAnchor = useMemo<{ latitude: number; longitude: number } | null>(() => {
    const mapped = holes.filter((h) => h.green_lat != null && h.green_lng != null);
    if (mapped.length > 0) {
      const lat =
        mapped.reduce((sum, h) => sum + (h.green_lat as number), 0) / mapped.length;
      const lng =
        mapped.reduce((sum, h) => sum + (h.green_lng as number), 0) / mapped.length;
      return { latitude: lat, longitude: lng };
    }
    if (bundle?.course.latitude != null && bundle?.course.longitude != null) {
      return { latitude: bundle.course.latitude, longitude: bundle.course.longitude };
    }
    return null;
  }, [holes, bundle]);

  // Greens already mapped on other holes — shown as faint reference pins so the
  // golfer can place this green relative to the rest of the course.
  const referenceGreens = useMemo<
    { id: string; coordinate: { latitude: number; longitude: number }; label: string }[]
  >(() => {
    if (!currentHole) return [];
    return holes
      .filter(
        (h) => h.id !== currentHole.id && h.green_lat != null && h.green_lng != null
      )
      .map((h) => ({
        id: h.id,
        coordinate: {
          latitude: h.green_lat as number,
          longitude: h.green_lng as number,
        },
        label: String(h.number),
      }));
  }, [holes, currentHole]);

  const onPickFromMap = (lat: number, lng: number): void => {
    if (!currentHole) return;
    setGreen.mutate(
      { holeId: currentHole.id, lat, lng },
      { onSuccess: () => setPicking(false) }
    );
  };

  const displayYardage =
    currentHole?.yardage != null
      ? unit === "yards"
        ? currentHole.yardage
        : Math.round(currentHole.yardage / 1.0936133)
      : null;

  // Pop animation on the hero number when the hole changes.
  const pop = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    pop.setValue(0.96);
    Animated.spring(pop, { toValue: 1, speed: 14, bounciness: 6, useNativeDriver: true }).start();
  }, [holeIndex, pop]);

  if (bundleQuery.isLoading) {
    return (
      <View style={styles.fillCenter}>
        <ActivityIndicator color={Colors.accent} />
      </View>
    );
  }

  if (bundleQuery.isError || !bundle || holes.length === 0) {
    return (
      <View style={[styles.fillCenter, { padding: Spacing.xl }]}>
        <Text style={styles.errorTitle}>Round unavailable</Text>
        <Text style={styles.errorBody}>
          We couldn&apos;t load this round&apos;s holes. Head back and try again.
        </Text>
        <TeeButton label="Go back" variant="secondary" onPress={() => router.back()} style={styles.errorCta} />
      </View>
    );
  }

  const strokes = currentHole ? scores[currentHole.id] ?? 0 : 0;

  const setStrokes = (next: number): void => {
    if (!currentHole) return;
    setScores((prev) => ({ ...prev, [currentHole.id]: next }));
    setDirty(true);
    // Multiplayer needs live sync so the group leaderboard stays current;
    // solo rounds defer all writes until the golfer saves on exit.
    if (isMultiplayer) {
      saveScore.mutate({ holeId: currentHole.id, strokes: next });
    }
  };

  const goPrev = (): void => {
    if (holeIndex === 0) return;
    tapLight();
    setHoleIndex((i) => i - 1);
  };
  const goNext = (): void => {
    if (holeIndex >= holes.length - 1) return;
    tapLight();
    setHoleIndex((i) => i + 1);
  };

  // Closing out pauses the round instead of discarding it: the local scores and
  // current hole are saved so the golfer can resume from the "Round in progress"
  // banner. Nothing is written to history/stats until they finish & save.
  const onClose = (): void => {
    if (bundle) {
      saveActiveRound({
        roundId,
        courseName: bundle.course.name,
        holeIndex,
        scores,
        isMultiplayer,
        updatedAt: Date.now(),
      });
    }
    tapLight();
    router.back();
  };

  const onFinish = (): void => {
    tapLight();
    setExitPrompt("finish");
  };

  const exitBusy = persistScores.isPending || finish.isPending;

  // Save progress, then either return to history or finalize the round.
  const onSaveProgress = (): void => {
    const mode = exitPrompt;
    persistScores.mutate(undefined, {
      onSuccess: () => {
        notifySuccess();
        queryClient.invalidateQueries({ queryKey: ["player-rounds"] });
        setDirty(false);
        setExitPrompt(null);
        if (mode === "finish") {
          finish.mutate();
        } else {
          clearActiveRound(roundId);
          router.back();
        }
      },
      onError: () => {
        Alert.alert("Couldn't save", "Your scores weren't saved. Please try again.");
      },
    });
  };

  // Leave without writing anything to history or stats, and drop the paused
  // round so it no longer shows as "in progress".
  const onDiscardProgress = (): void => {
    setExitPrompt(null);
    clearActiveRound(roundId);
    router.back();
  };

  const summary = computeSummary(holes, scores);

  return (
    <View style={styles.container}>
      {/* Top bar */}
      <View style={[styles.topBar, { paddingTop: insets.top + Spacing.sm }]}>
        <Pressable style={styles.iconButton} onPress={onClose} hitSlop={8}>
          <X size={22} color={Colors.primary} strokeWidth={2.4} />
        </Pressable>
        <Text style={styles.courseName} numberOfLines={1}>
          {bundle.course.name}
        </Text>
        {isMultiplayer ? (
          <Pressable
            style={styles.playersButton}
            onPress={() => {
              tapLight();
              setShowBoard(true);
            }}
            hitSlop={8}
          >
            <Users size={16} color={Colors.accent} strokeWidth={2.6} />
            <Text style={styles.playersButtonText}>{players.length || 1}</Text>
          </Pressable>
        ) : null}
        <Pressable style={styles.finishButton} onPress={onFinish} hitSlop={8} disabled={finish.isPending}>
          {finish.isPending ? (
            <ActivityIndicator size="small" color={Colors.accent} />
          ) : (
            <Text style={styles.finishText}>Finish</Text>
          )}
        </Pressable>
      </View>

      {/* Hole navigator */}
      <View style={styles.holeNav}>
        <NavArrow disabled={holeIndex === 0} onPress={goPrev} direction="left" />
        <View style={styles.holeNavCenter}>
          <Text style={styles.holeNavLabel}>HOLE</Text>
          <Text style={styles.holeNavNumber}>
            {currentHole?.number ?? holeIndex + 1}
            <Text style={styles.holeNavPar}>  ·  Par {currentHole?.par ?? "-"}</Text>
          </Text>
          {displayYardage != null ? (
            <Text style={styles.holeNavYardage}>
              {displayYardage} {unitShort(unit)}
            </Text>
          ) : null}
        </View>
        <NavArrow disabled={holeIndex >= holes.length - 1} onPress={goNext} direction="right" />
      </View>

      {/* Hero distance */}
      <View style={styles.hero}>
        <DistanceDisplay
          status={location.status}
          distanceMeters={distanceMeters}
          offCourse={offCourse}
          courseName={bundle.course.name}
          unit={unit}
          pop={pop}
          hasGreen={hasGreen}
          canSetGreen={location.coords !== null}
          settingGreen={setGreen.isPending}
          onSetGreen={onSetGreenHere}
          onPickOnMap={() => setPicking(true)}
          onEnable={() => Linking.openSettings()}
          onRetry={location.retry}
        />
        {hasGreen && !offCourse && distanceMeters != null && playsLike && (clubs.length > 0 || playsLike.hasWeather) ? (
          <CaddyBlock
            breakdown={playsLike}
            weather={weather}
            club={recommendedClub}
            hasClubs={clubs.length > 0}
            unit={unit}
            onPress={() => {
              tapLight();
              setShowCaddy(true);
            }}
            onSetupBag={() => {
              tapLight();
              router.push("/bag");
            }}
          />
        ) : null}
        {hasGreen && greenPreview ? (
          <View style={styles.holeMapCard}>
            <SatelliteMap
              key={currentHole?.id ?? "green-preview"}
              style={StyleSheet.absoluteFill}
              initialRegion={greenPreview.region}
              markers={greenPreview.markers}
              interactive={false}
            />
            <Pressable
              style={StyleSheet.absoluteFill}
              onPress={() => {
                tapLight();
                setPicking(true);
              }}
            />
            <View pointerEvents="none" style={styles.holeMapBadge}>
              <MapPin size={13} color={Colors.onPrimary} strokeWidth={2.4} />
              <Text style={styles.holeMapBadgeText}>Adjust green</Text>
            </View>
          </View>
        ) : null}
      </View>

      {/* Score control */}
      <View style={styles.scoreBlock}>
        <View style={styles.scoreHeader}>
          <Text style={styles.scoreLabel}>YOUR SCORE</Text>
          <ScoreTag strokes={strokes} par={currentHole?.par ?? 0} />
        </View>
        <Stepper value={strokes} onChange={setStrokes} min={0} max={20} />
        {isMultiplayer && syncFailed ? (
          <Pressable
            style={styles.syncBanner}
            onPress={() => {
              if (!currentHole) return;
              tapLight();
              saveScore.mutate({ holeId: currentHole.id, strokes });
            }}
            accessibilityRole="button"
            accessibilityLabel="Retry sending your score to the group"
          >
            <Text style={styles.syncBannerText}>
              Score not sent to the group — tap to retry
            </Text>
          </Pressable>
        ) : null}
      </View>

      {/* Scorecard strip */}
      <View style={[styles.scorecard, { paddingBottom: insets.bottom + Spacing.md }]}>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryText}>
            Thru {summary.played}
            {summary.played > 0 ? <Text style={styles.summaryDot}>  ·  </Text> : null}
            {summary.played > 0 ? (
              <Text style={styles.summaryScore}>{formatToPar(summary.toPar)}</Text>
            ) : null}
          </Text>
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chips}
        >
          {holes.map((h, idx) => (
            <HoleChip
              key={h.id}
              hole={h}
              strokes={scores[h.id] ?? 0}
              active={idx === holeIndex}
              onPress={() => {
                tapLight();
                setHoleIndex(idx);
              }}
            />
          ))}
        </ScrollView>
      </View>

      {isMultiplayer ? (
        <LeaderboardModal
          visible={showBoard}
          joinCode={bundle.round.join_code}
          courseName={bundle.course.name}
          roundId={roundId}
          players={players}
          currentUserId={user?.id ?? null}
          loading={leaderboardQuery.isLoading}
          onBlock={(profileId, name) => {
            blockPlayer(profileId);
            notifySuccess();
            Alert.alert(
              "Player blocked",
              `You won't see ${name} on any leaderboard. You can undo this in Settings.`
            );
          }}
          onClose={() => setShowBoard(false)}
        />
      ) : null}

      <CaddyDetail
        visible={showCaddy}
        breakdown={playsLike}
        weather={weather}
        club={recommendedClub}
        hasClubs={clubs.length > 0}
        unit={unit}
        onClose={() => setShowCaddy(false)}
        onSetupBag={() => {
          setShowCaddy(false);
          router.push("/bag");
        }}
      />

      <ExitPrompt
        mode={exitPrompt}
        busy={exitBusy}
        played={summary.played}
        onSave={onSaveProgress}
        onDiscard={onDiscardProgress}
        onCancel={() => setExitPrompt(null)}
      />

      {picking && currentHole ? (
        <GreenPicker
          holeNumber={currentHole.number}
          initial={
            currentHole.green_lat != null && currentHole.green_lng != null
              ? { latitude: currentHole.green_lat, longitude: currentHole.green_lng }
              : null
          }
          courseCenter={
            courseAnchor ??
            (location.coords
              ? { latitude: location.coords.latitude, longitude: location.coords.longitude }
              : null)
          }
          reference={referenceGreens}
          saving={setGreen.isPending}
          onCancel={() => setPicking(false)}
          onConfirm={onPickFromMap}
        />
      ) : null}
    </View>
  );
}

function ExitPrompt({
  mode,
  busy,
  played,
  onSave,
  onDiscard,
  onCancel,
}: {
  mode: null | "close" | "finish";
  busy: boolean;
  played: number;
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
}) {
  const insets = useSafeAreaInsets();
  const visible = mode !== null;
  const isFinish = mode === "finish";
  const title = isFinish ? "Finish round?" : "Save your progress?";
  const body =
    played > 0
      ? isFinish
        ? `You've played ${played} ${played === 1 ? "hole" : "holes"}. Save this round to your history and stats?`
        : `You've played ${played} ${played === 1 ? "hole" : "holes"}. Keep this progress so you can pick it back up?`
      : "You haven't scored any holes yet.";

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={styles.promptBackdrop} onPress={busy ? undefined : onCancel} />
      <View style={styles.promptCenter} pointerEvents="box-none">
        <View style={[styles.promptCard, { marginBottom: insets.bottom }]}>
          <Text style={styles.promptTitle}>{title}</Text>
          <Text style={styles.promptBody}>{body}</Text>

          <TeeButton
            label={isFinish ? "Save & finish" : "Save progress"}
            loading={busy}
            onPress={onSave}
            style={styles.promptSave}
          />
          <Pressable
            style={styles.promptDiscard}
            onPress={onDiscard}
            disabled={busy}
            hitSlop={6}
          >
            <Text style={styles.promptDiscardText}>Don&apos;t save</Text>
          </Pressable>
          <Pressable style={styles.promptCancel} onPress={onCancel} disabled={busy} hitSlop={6}>
            <Text style={styles.promptCancelText}>Keep playing</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function LeaderboardModal({
  visible,
  joinCode,
  courseName,
  roundId,
  players,
  currentUserId,
  loading,
  onBlock,
  onClose,
}: {
  visible: boolean;
  joinCode: string | null;
  courseName: string;
  roundId: string;
  players: LeaderboardEntry[];
  currentUserId: string | null;
  loading: boolean;
  onBlock: (profileId: string, name: string) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();

  /**
   * Guideline 1.2 requires both a way to report objectionable content and a way
   * to block the person behind it. A display name is the only thing another
   * golfer authors here, so both actions hang off the player's row.
   */
  const onModeratePlayer = (player: LeaderboardEntry): void => {
    tapLight();
    Alert.alert(
      player.name,
      "This player chose their own display name. If it's offensive you can report it to us, or block them so you stop seeing it.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Report player",
          onPress: () => {
            const url = reportMailto({ reportedName: player.name, roundId });
            Linking.openURL(url).catch(() => {
              Alert.alert(
                "Couldn't open Mail",
                `Email ${Links.supportEmail} with the player's name and we'll review it.`
              );
            });
          },
        },
        {
          text: "Block player",
          style: "destructive",
          onPress: () => onBlock(player.profileId, player.name),
        },
      ]
    );
  };

  const shareCode = (): void => {
    if (!joinCode) return;
    tapLight();
    void Share.share({
      message: `Join my round at ${courseName} on Tee. Code: ${joinCode}`,
    }).catch(() => {});
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.boardBackdrop} onPress={onClose} />
      <View style={[styles.boardSheet, { paddingBottom: insets.bottom + Spacing.lg }]}>
        <View style={styles.boardGrabber} />
        <View style={styles.boardHead}>
          <View style={styles.boardTitleWrap}>
            <Trophy size={18} color={Colors.gold} strokeWidth={2.4} />
            <Text style={styles.boardTitle}>Leaderboard</Text>
          </View>
          <Pressable style={styles.boardClose} onPress={onClose} hitSlop={8}>
            <X size={20} color={Colors.primary} strokeWidth={2.4} />
          </Pressable>
        </View>

        {joinCode ? (
          <Pressable style={styles.codeCard} onPress={shareCode}>
            <View>
              <Text style={styles.codeLabel}>INVITE CODE</Text>
              <Text style={styles.codeValue}>{joinCode}</Text>
            </View>
            <View style={styles.shareButton}>
              <Share2 size={16} color={Colors.onPrimary} strokeWidth={2.4} />
              <Text style={styles.shareButtonText}>Share</Text>
            </View>
          </Pressable>
        ) : null}

        {loading && players.length === 0 ? (
          <View style={styles.boardLoading}>
            <ActivityIndicator color={Colors.accent} />
          </View>
        ) : (
          <View style={styles.boardList}>
            {players.map((p, idx) => {
              const isMe = p.profileId === currentUserId;
              return (
                <Pressable
                  key={p.profileId}
                  style={[styles.boardRow, isMe && styles.boardRowMe]}
                  onLongPress={isMe ? undefined : () => onModeratePlayer(p)}
                  onPress={isMe ? undefined : () => onModeratePlayer(p)}
                  accessibilityRole={isMe ? undefined : "button"}
                  accessibilityLabel={
                    isMe ? undefined : `${p.name}. Double tap to report or block this player.`
                  }
                >
                  <Text style={styles.boardRank}>{p.thru > 0 ? idx + 1 : "–"}</Text>
                  <View style={styles.boardNameWrap}>
                    <Text style={styles.boardName} numberOfLines={1}>
                      {p.name}
                      {isMe ? "  (you)" : ""}
                    </Text>
                    <Text style={styles.boardThru}>
                      {p.thru > 0 ? `Thru ${p.thru}` : "Not started"}
                      {p.isOwner ? "  ·  Host" : ""}
                    </Text>
                  </View>
                  <Text
                    style={[
                      styles.boardScore,
                      p.thru === 0 && styles.boardScoreIdle,
                    ]}
                  >
                    {p.thru > 0 ? formatToPar(p.toPar) : "–"}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        )}
        <Text style={styles.boardHint}>
          Scores update live as everyone plays. Tap a player to report or block them.
        </Text>
      </View>
    </Modal>
  );
}

function GreenPicker({
  holeNumber,
  initial,
  courseCenter,
  reference,
  saving,
  onCancel,
  onConfirm,
}: {
  holeNumber: number;
  initial: { latitude: number; longitude: number } | null;
  courseCenter: { latitude: number; longitude: number } | null;
  reference: { id: string; coordinate: { latitude: number; longitude: number }; label: string }[];
  saving: boolean;
  onCancel: () => void;
  onConfirm: (lat: number, lng: number) => void;
}) {
  const insets = useSafeAreaInsets();
  // Zoom priority: an exact point (existing green or live GPS) gets a tight,
  // green-level view; otherwise center on the course and zoom to the property
  // so the golfer can find the hole instead of staring at the whole planet.
  const center = initial ?? courseCenter;
  const tight = initial != null;
  const delta = tight ? 0.0022 : 0.014;
  const fallback: MapRegion = {
    latitude: center?.latitude ?? 36.5687,
    longitude: center?.longitude ?? -121.9501,
    latitudeDelta: delta,
    longitudeDelta: delta,
  };
  const regionRef = useRef<MapRegion>(fallback);
  const markers = useMemo(
    () => [
      ...reference,
      ...(initial ? [{ id: "green", coordinate: initial }] : []),
    ],
    [initial, reference],
  );

  return (
    <View style={StyleSheet.absoluteFill}>
      <SatelliteMap
        style={StyleSheet.absoluteFill}
        initialRegion={fallback}
        markers={markers}
        onRegionChange={(r) => {
          regionRef.current = r;
        }}
      />

      <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.reticleWrap]}>
        <View style={styles.reticleRing}>
          <View style={styles.reticleDot} />
        </View>
      </View>

      <View style={[styles.pickerTop, { paddingTop: insets.top + Spacing.sm }]}>
        <View style={styles.pickerTopCard}>
          <Pressable style={styles.pickerClose} onPress={onCancel} hitSlop={8}>
            <X size={20} color={Colors.primary} strokeWidth={2.4} />
          </Pressable>
          <View style={styles.pickerTopInfo}>
            <Text style={styles.pickerOverline}>SET GREEN</Text>
            <Text style={styles.pickerHole}>Hole {holeNumber}</Text>
          </View>
          <View style={styles.pickerClose} />
        </View>
      </View>

      <View style={[styles.pickerBottom, { paddingBottom: insets.bottom + Spacing.lg }]}>
        <View style={styles.pickerBottomCard}>
          <View style={styles.bottomHint}>
            <Crosshair size={16} color={Colors.accent} strokeWidth={2.4} />
            <Text style={styles.bottomHintText}>
              Drag the map so the crosshair sits on the middle of the green, then save.
            </Text>
          </View>
          <TeeButton
            label="Save green"
            loading={saving}
            onPress={() => onConfirm(regionRef.current.latitude, regionRef.current.longitude)}
          />
        </View>
      </View>
    </View>
  );
}

function DistanceDisplay({
  status,
  distanceMeters,
  offCourse,
  courseName,
  unit,
  pop,
  hasGreen,
  canSetGreen,
  settingGreen,
  onSetGreen,
  onPickOnMap,
  onEnable,
  onRetry,
}: {
  status: ReturnType<typeof useLiveLocation>["status"];
  distanceMeters: number | null;
  offCourse: boolean;
  courseName: string;
  unit: "yards" | "meters";
  pop: Animated.Value;
  hasGreen: boolean;
  canSetGreen: boolean;
  settingGreen: boolean;
  onSetGreen: () => void;
  onPickOnMap: () => void;
  onEnable: () => void;
  onRetry: () => void;
}) {
  if (status === "denied") {
    return (
      <View style={styles.stateBlock}>
        <LocateFixed size={26} color={Colors.textTertiary} strokeWidth={2} />
        <Text style={styles.stateTitle}>Location is off</Text>
        <Text style={styles.stateBody}>
          Tee needs your location to measure distance to the green.
        </Text>
        <TeeButton label="Open settings" variant="secondary" onPress={onEnable} style={styles.stateCta} />
      </View>
    );
  }

  if (status === "error") {
    return (
      <View style={styles.stateBlock}>
        <Text style={styles.stateTitle}>Can&apos;t read GPS</Text>
        <TeeButton label="Try again" variant="secondary" onPress={onRetry} style={styles.stateCta} />
      </View>
    );
  }

  if (!hasGreen) {
    return (
      <View style={styles.stateBlock}>
        <View style={styles.greenIcon}>
          <Flag size={24} color={Colors.accent} strokeWidth={2.2} />
        </View>
        <Text style={styles.stateTitle}>Green not mapped</Text>
        <Text style={styles.stateBody}>
          Drop the green on the satellite map — perfect for mapping from home. Or, if you&apos;re
          standing on the green right now, set it from your GPS.
        </Text>
        <TeeButton
          label="Pick green on map"
          onPress={onPickOnMap}
          icon={<MapPin size={18} color={Colors.onPrimary} strokeWidth={2.4} />}
          style={styles.stateCta}
        />
        <Pressable
          style={styles.setHereLink}
          onPress={onSetGreen}
          disabled={!canSetGreen || settingGreen}
          hitSlop={6}
        >
          {settingGreen ? (
            <ActivityIndicator size="small" color={Colors.accent} />
          ) : (
            <>
              <Crosshair
                size={15}
                color={canSetGreen ? Colors.accent : Colors.textTertiary}
                strokeWidth={2.2}
              />
              <Text
                style={[
                  styles.setHereLinkText,
                  { color: canSetGreen ? Colors.accent : Colors.textTertiary },
                ]}
              >
                {canSetGreen ? "I'm on the green — use my GPS" : "Waiting for GPS…"}
              </Text>
            </>
          )}
        </Pressable>
      </View>
    );
  }

  if (distanceMeters === null) {
    return (
      <View style={styles.stateBlock}>
        <ActivityIndicator color={Colors.accent} />
        <Text style={styles.searching}>Searching for GPS…</Text>
      </View>
    );
  }

  if (offCourse) {
    return (
      <View style={styles.stateBlock}>
        <View style={styles.greenIcon}>
          <MapPin size={24} color={Colors.accent} strokeWidth={2.2} />
        </View>
        <Text style={styles.stateTitle}>You&apos;re not at this course</Text>
        <Text style={styles.stateBody}>
          Live distance appears once you&apos;re on {courseName}. You can still keep score and
          review the card from here.
        </Text>
      </View>
    );
  }

  return (
    <Animated.View style={[styles.distanceWrap, { transform: [{ scale: pop }] }]}>
      <Text style={styles.distanceNumber} numberOfLines={1} adjustsFontSizeToFit>
        {formatDistance(distanceMeters, unit)}
      </Text>
      <Text style={styles.distanceUnit}>{unitLabel(unit)}</Text>
    </Animated.View>
  );
}

/** Short, glanceable condition copy: "12 mph headwind, cool air". */
function describeConditions(
  breakdown: PlaysLikeBreakdown,
  weather: Weather | null,
  unit: "yards" | "meters"
): string {
  if (!breakdown.hasWeather || !weather) {
    return isWeatherConfigured ? "Based on raw distance" : "Add a weather key for conditions";
  }
  const parts: string[] = [];
  const totalMph = Math.sqrt(
    breakdown.headwindMph ** 2 + breakdown.crosswindMph ** 2
  );
  const speed =
    unit === "yards"
      ? `${Math.round(totalMph)} mph`
      : `${Math.round(totalMph * 1.60934)} km/h`;
  const kind = windKind(breakdown);
  if (kind === "head") parts.push(`${speed} headwind`);
  else if (kind === "tail") parts.push(`${speed} tailwind`);
  else if (kind === "cross") parts.push(`${speed} crosswind`);

  if (weather.tempC <= 10) parts.push("cold air");
  else if (weather.tempC <= 16) parts.push("cool air");
  else if (weather.tempC >= 27) parts.push("warm air");

  if (parts.length === 0) return "Calm and mild";
  return parts.join(", ");
}

/** Signed plays-like contribution, e.g. "+6 yd" / "−3 yd" / "No change". */
function formatDelta(meters: number, unit: "yards" | "meters"): string {
  const v = Math.round(metersToUnit(Math.abs(meters), unit));
  if (v === 0) return "No change";
  return `${meters > 0 ? "+" : "−"}${v} ${unitShort(unit)}`;
}

function formatTemp(tempC: number, unit: "yards" | "meters"): string {
  return unit === "yards"
    ? `${Math.round((tempC * 9) / 5 + 32)}°F`
    : `${Math.round(tempC)}°C`;
}

function CaddyBlock({
  breakdown,
  weather,
  club,
  hasClubs,
  unit,
  onPress,
  onSetupBag,
}: {
  breakdown: PlaysLikeBreakdown;
  weather: Weather | null;
  club: Club | null;
  hasClubs: boolean;
  unit: "yards" | "meters";
  onPress: () => void;
  onSetupBag: () => void;
}) {
  const playsLike = formatDistance(breakdown.playsLikeMeters, unit);
  const reason = describeConditions(breakdown, weather, unit);

  if (!hasClubs) {
    return (
      <Pressable style={styles.caddyCard} onPress={onSetupBag}>
        <View style={styles.caddyIcon}>
          <Briefcase size={18} color={Colors.accent} strokeWidth={2.4} />
        </View>
        <View style={styles.caddyInfo}>
          <Text style={styles.caddyTitle}>
            Plays {playsLike} {unitShort(unit)}
          </Text>
          <Text style={styles.caddyReason} numberOfLines={1}>
            Set up your bag for a club tip
          </Text>
        </View>
        <ChevronRight size={20} color={Colors.textTertiary} strokeWidth={2.4} />
      </Pressable>
    );
  }

  return (
    <Pressable style={styles.caddyCard} onPress={onPress}>
      <View style={styles.caddyIcon}>
        <Sparkles size={18} color={Colors.accent} strokeWidth={2.4} />
      </View>
      <View style={styles.caddyInfo}>
        <Text style={styles.caddyTitle} numberOfLines={1}>
          {club?.name ?? "—"}
          <Text style={styles.caddyPlays}>
            {"  ·  Plays "}
            {playsLike} {unitShort(unit)}
          </Text>
        </Text>
        <Text style={styles.caddyReason} numberOfLines={1}>
          {reason}
        </Text>
      </View>
      <ChevronRight size={20} color={Colors.textTertiary} strokeWidth={2.4} />
    </Pressable>
  );
}

function CaddyDetail({
  visible,
  breakdown,
  weather,
  club,
  hasClubs,
  unit,
  onClose,
  onSetupBag,
}: {
  visible: boolean;
  breakdown: PlaysLikeBreakdown | null;
  weather: Weather | null;
  club: Club | null;
  hasClubs: boolean;
  unit: "yards" | "meters";
  onClose: () => void;
  onSetupBag: () => void;
}) {
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.boardBackdrop} onPress={onClose} />
      <View style={[styles.caddySheet, { paddingBottom: insets.bottom + Spacing.lg }]}>
        <View style={styles.boardGrabber} />
        <View style={styles.boardHead}>
          <View style={styles.boardTitleWrap}>
            <Sparkles size={18} color={Colors.accent} strokeWidth={2.4} />
            <Text style={styles.boardTitle}>Smart Caddy</Text>
          </View>
          <Pressable style={styles.boardClose} onPress={onClose} hitSlop={8}>
            <X size={20} color={Colors.primary} strokeWidth={2.4} />
          </Pressable>
        </View>

        {breakdown ? (
          <>
            <View style={styles.caddyHeadline}>
              <View style={styles.caddyHeadlineCol}>
                <Text style={styles.caddyBigLabel}>RAW</Text>
                <Text style={styles.caddyBigValue}>
                  {formatDistance(breakdown.rawMeters, unit)}
                </Text>
                <Text style={styles.caddyBigUnit}>{unitShort(unit)}</Text>
              </View>
              <View style={styles.caddyArrow}>
                <ChevronRight size={22} color={Colors.textTertiary} strokeWidth={2.6} />
              </View>
              <View style={styles.caddyHeadlineCol}>
                <Text style={[styles.caddyBigLabel, { color: Colors.accent }]}>PLAYS LIKE</Text>
                <Text style={[styles.caddyBigValue, styles.caddyBigValueAccent]}>
                  {formatDistance(breakdown.playsLikeMeters, unit)}
                </Text>
                <Text style={styles.caddyBigUnit}>{unitShort(unit)}</Text>
              </View>
            </View>

            {club ? (
              <View style={styles.caddyClubRow}>
                <View style={styles.caddyIcon}>
                  <Briefcase size={18} color={Colors.accent} strokeWidth={2.4} />
                </View>
                <View style={styles.caddyInfo}>
                  <Text style={styles.caddyClubName}>{club.name}</Text>
                  <Text style={styles.caddyReason}>
                    {formatDistance(club.carry_meters, unit)} {unitShort(unit)} carry
                  </Text>
                </View>
              </View>
            ) : null}

            <View style={styles.caddyRows}>
              <CaddyFactor
                icon={<Thermometer size={17} color={Colors.textSecondary} strokeWidth={2.2} />}
                label="Temperature"
                detail={
                  breakdown.hasWeather && weather
                    ? formatTemp(weather.tempC, unit)
                    : "—"
                }
                delta={breakdown.hasWeather ? formatDelta(breakdown.tempDeltaMeters, unit) : "—"}
              />
              <CaddyFactor
                icon={<Wind size={17} color={Colors.textSecondary} strokeWidth={2.2} />}
                label="Wind"
                detail={
                  breakdown.hasWeather
                    ? describeConditions(breakdown, weather, unit)
                    : "—"
                }
                delta={breakdown.hasWeather ? formatDelta(breakdown.windDeltaMeters, unit) : "—"}
              />
            </View>

            {!breakdown.hasWeather ? (
              <Text style={styles.caddyNote}>
                {isWeatherConfigured
                  ? "Weather is unavailable right now — showing the raw distance."
                  : "Add an OpenWeatherMap key to factor in temperature and wind."}
              </Text>
            ) : null}

            {!hasClubs ? (
              <TeeButton
                label="Set up your bag"
                onPress={onSetupBag}
                style={styles.caddySetupCta}
                icon={<Briefcase size={18} color={Colors.onPrimary} strokeWidth={2.4} />}
              />
            ) : null}
          </>
        ) : null}
      </View>
    </Modal>
  );
}

function CaddyFactor({
  icon,
  label,
  detail,
  delta,
}: {
  icon: React.ReactNode;
  label: string;
  detail: string;
  delta: string;
}) {
  return (
    <View style={styles.factorRow}>
      <View style={styles.factorIcon}>{icon}</View>
      <View style={styles.factorInfo}>
        <Text style={styles.factorLabel}>{label}</Text>
        <Text style={styles.factorDetail} numberOfLines={1}>
          {detail}
        </Text>
      </View>
      <Text style={styles.factorDelta}>{delta}</Text>
    </View>
  );
}

function NavArrow({
  disabled,
  onPress,
  direction,
}: {
  disabled: boolean;
  onPress: () => void;
  direction: "left" | "right";
}) {
  return (
    <Pressable style={[styles.navArrow, disabled && styles.navArrowDisabled]} onPress={onPress} disabled={disabled} hitSlop={8}>
      {direction === "left" ? (
        <ChevronLeft size={26} color={disabled ? Colors.textTertiary : Colors.primary} strokeWidth={2.4} />
      ) : (
        <ChevronRight size={26} color={disabled ? Colors.textTertiary : Colors.primary} strokeWidth={2.4} />
      )}
    </Pressable>
  );
}

function ScoreTag({ strokes, par }: { strokes: number; par: number }) {
  if (strokes === 0 || par === 0) {
    return (
      <View style={[styles.tag, { backgroundColor: Colors.primarySoft }]}>
        <Text style={[styles.tagText, { color: Colors.textTertiary }]}>Not scored</Text>
      </View>
    );
  }
  const { label, tone } = scoreToPar(strokes, par);
  const bg = tone === "under" ? Colors.accentSoft : tone === "par" ? Colors.primarySoft : Colors.goldSoft;
  const fg = tone === "under" ? Colors.accent : tone === "par" ? Colors.primary : Colors.gold;
  return (
    <View style={[styles.tag, { backgroundColor: bg }]}>
      <Text style={[styles.tagText, { color: fg }]}>{label}</Text>
    </View>
  );
}

function HoleChip({
  hole,
  strokes,
  active,
  onPress,
}: {
  hole: Hole;
  strokes: number;
  active: boolean;
  onPress: () => void;
}) {
  const played = strokes > 0;
  return (
    <Pressable style={[styles.chip, active && styles.chipActive]} onPress={onPress}>
      <Text style={[styles.chipNumber, active && styles.chipNumberActive]}>{hole.number}</Text>
      <Text style={[styles.chipScore, played ? styles.chipScorePlayed : styles.chipScoreEmpty]}>
        {played ? strokes : hole.par}
      </Text>
    </Pressable>
  );
}

/** Helpers ---------------------------------------------------------------- */

interface Summary {
  played: number;
  toPar: number;
}

function computeSummary(holes: Hole[], scores: Record<string, number>): Summary {
  let played = 0;
  let toPar = 0;
  for (const h of holes) {
    const s = scores[h.id] ?? 0;
    if (s > 0) {
      played += 1;
      toPar += s - h.par;
    }
  }
  return { played, toPar };
}

function formatToPar(toPar: number): string {
  if (toPar === 0) return "Even";
  return toPar > 0 ? `+${toPar}` : `${toPar}`;
}

function scoreToPar(strokes: number, par: number): { label: string; tone: "under" | "par" | "over" } {
  const diff = strokes - par;
  if (diff <= -3) return { label: "Albatross", tone: "under" };
  if (diff === -2) return { label: "Eagle", tone: "under" };
  if (diff === -1) return { label: "Birdie", tone: "under" };
  if (diff === 0) return { label: "Par", tone: "par" };
  if (diff === 1) return { label: "Bogey", tone: "over" };
  if (diff === 2) return { label: "Double", tone: "over" };
  return { label: `+${diff}`, tone: "over" };
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  fillCenter: { flex: 1, backgroundColor: Colors.background, alignItems: "center", justifyContent: "center" },
  errorTitle: { ...Typography.title, fontSize: 22, marginBottom: Spacing.sm },
  errorBody: { ...Typography.body, color: Colors.textSecondary, textAlign: "center", lineHeight: 22 },
  errorCta: { marginTop: Spacing.xl, alignSelf: "stretch" },

  topBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.sm,
    gap: Spacing.md,
  },
  iconButton: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  courseName: { ...Typography.headline, flex: 1, textAlign: "center" },
  playersButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    height: 32,
    paddingHorizontal: 10,
    borderRadius: Radius.pill,
    backgroundColor: Colors.accentSoft,
  },
  playersButtonText: { ...Typography.callout, color: Colors.accent, fontWeight: "700" },
  finishButton: { minWidth: 56, height: 40, alignItems: "flex-end", justifyContent: "center" },
  finishText: { ...Typography.callout, color: Colors.accent, fontWeight: "700" },

  holeNav: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.xl,
    marginTop: Spacing.sm,
  },
  holeNavCenter: { alignItems: "center" },
  holeNavLabel: { ...Typography.overline, fontSize: 11 },
  holeNavNumber: { fontSize: 26, fontWeight: "800", color: Colors.primary, marginTop: 2 },
  holeNavPar: { fontSize: 17, fontWeight: "600", color: Colors.textSecondary },
  holeNavYardage: { ...Typography.caption, color: Colors.textTertiary, marginTop: 3 },
  navArrow: {
    width: 52,
    height: 52,
    borderRadius: Radius.pill,
    backgroundColor: Colors.surface,
    borderWidth: hairline,
    borderColor: Colors.borderStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  navArrowDisabled: { backgroundColor: "transparent", borderColor: Colors.border },

  hero: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: Spacing.xl },
  distanceWrap: { alignItems: "center" },
  distanceNumber: { ...Typography.numericHero, lineHeight: 124, includeFontPadding: false },
  distanceUnit: {
    ...Typography.subhead,
    color: Colors.textSecondary,
    letterSpacing: 1.4,
    textTransform: "uppercase",
    marginTop: -4,
  },

  greenIcon: {
    width: 56,
    height: 56,
    borderRadius: Radius.pill,
    backgroundColor: Colors.accentSoft,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing.xs,
  },
  stateBlock: { alignItems: "center", gap: Spacing.sm, paddingHorizontal: Spacing.lg },
  stateTitle: { ...Typography.title, fontSize: 22 },
  stateBody: { ...Typography.body, color: Colors.textSecondary, textAlign: "center", lineHeight: 22 },
  stateCta: { marginTop: Spacing.md, minWidth: 220 },
  searching: { ...Typography.callout, color: Colors.textSecondary, marginTop: Spacing.md },
  setHereLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: Spacing.md,
    height: 24,
  },
  setHereLinkText: { ...Typography.callout, fontWeight: "600" },
  caddyCard: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    marginTop: Spacing.lg,
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    borderWidth: hairline,
    borderColor: Colors.borderStrong,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.md,
  },
  caddyIcon: {
    width: 38,
    height: 38,
    borderRadius: Radius.pill,
    backgroundColor: Colors.accentSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  caddyInfo: { flex: 1, gap: 2 },
  caddyTitle: { ...Typography.headline, fontSize: 16 },
  caddyPlays: { ...Typography.callout, color: Colors.textSecondary, fontWeight: "600" },
  caddyReason: { ...Typography.subhead, color: Colors.textTertiary },

  caddySheet: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: Colors.background,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.md,
    gap: Spacing.lg,
  },
  caddyHeadline: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: hairline,
    borderColor: Colors.border,
    paddingVertical: Spacing.lg,
    paddingHorizontal: Spacing.xl,
  },
  caddyHeadlineCol: { alignItems: "center", flex: 1 },
  caddyArrow: { paddingHorizontal: Spacing.sm },
  caddyBigLabel: { ...Typography.overline, fontSize: 10, marginBottom: 2 },
  caddyBigValue: { fontFamily: Fonts.serifSemibold, fontSize: 44, color: Colors.primary },
  caddyBigValueAccent: { color: Colors.accent },
  caddyBigUnit: { ...Typography.caption, color: Colors.textTertiary, marginTop: -2 },
  caddyClubRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    backgroundColor: Colors.accentSoft,
    borderRadius: Radius.md,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.md,
  },
  caddyClubName: { ...Typography.headline, fontSize: 17 },
  caddyRows: { gap: Spacing.sm },
  factorRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    borderWidth: hairline,
    borderColor: Colors.border,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
  },
  factorIcon: { width: 28, alignItems: "center" },
  factorInfo: { flex: 1, gap: 2 },
  factorLabel: { ...Typography.callout, fontWeight: "600" },
  factorDetail: { ...Typography.subhead, color: Colors.textSecondary },
  factorDelta: { ...Typography.callout, fontWeight: "700", color: Colors.primary },
  caddyNote: { ...Typography.subhead, color: Colors.textTertiary, textAlign: "center", lineHeight: 19 },
  caddySetupCta: { alignSelf: "stretch" },

  holeMapCard: {
    width: "100%",
    height: 132,
    marginTop: Spacing.lg,
    borderRadius: Radius.lg,
    overflow: "hidden",
    borderWidth: hairline,
    borderColor: Colors.borderStrong,
    backgroundColor: Colors.primarySoft,
  },
  holeMapBadge: {
    position: "absolute",
    left: Spacing.md,
    bottom: Spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: Radius.pill,
    backgroundColor: "rgba(28,58,43,0.78)",
  },
  holeMapBadgeText: { color: Colors.onPrimary, fontSize: 12, fontWeight: "700" },

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
  savedPin: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: Colors.gold,
    borderWidth: 2,
    borderColor: Colors.surface,
  },
  pickerTop: { position: "absolute", top: 0, left: 0, right: 0, paddingHorizontal: Spacing.md },
  pickerTopCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.md,
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  pickerClose: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.primarySoft,
  },
  pickerTopInfo: { flex: 1, alignItems: "center" },
  pickerOverline: { ...Typography.overline, fontSize: 10 },
  pickerHole: { ...Typography.headline, fontSize: 20, marginTop: 2 },
  pickerBottom: { position: "absolute", bottom: 0, left: 0, right: 0, paddingHorizontal: Spacing.md },
  pickerBottomCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    gap: Spacing.md,
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  bottomHint: { flexDirection: "row", alignItems: "center", gap: 8 },
  bottomHintText: { ...Typography.subhead, color: Colors.textSecondary, flex: 1, lineHeight: 18 },

  syncBanner: {
    marginTop: Spacing.md,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.sm,
    backgroundColor: Colors.dangerSoft,
    alignItems: "center",
  },
  syncBannerText: { ...Typography.subhead, color: Colors.danger, fontWeight: "600" },
  scoreBlock: {
    marginHorizontal: Spacing.xl,
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: hairline,
    borderColor: Colors.border,
    paddingVertical: Spacing.lg,
    paddingHorizontal: Spacing.lg,
    gap: Spacing.md,
  },
  scoreHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  scoreLabel: { ...Typography.overline, fontSize: 11 },
  tag: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: Radius.pill },
  tagText: { fontSize: 13, fontWeight: "700" },

  scorecard: { marginTop: Spacing.lg },
  summaryRow: { paddingHorizontal: Spacing.xl, marginBottom: Spacing.sm },
  summaryText: { ...Typography.callout, color: Colors.textSecondary },
  summaryDot: { color: Colors.textTertiary },
  summaryScore: { color: Colors.primary, fontWeight: "700" },
  chips: { paddingHorizontal: Spacing.xl, gap: Spacing.sm },
  chip: {
    width: 46,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.md,
    backgroundColor: Colors.surface,
    borderWidth: hairline,
    borderColor: Colors.border,
    alignItems: "center",
    gap: 3,
  },
  chipActive: { borderColor: Colors.accent, borderWidth: 1.5, backgroundColor: Colors.accentSoft },
  chipNumber: { fontSize: 12, fontWeight: "700", color: Colors.textTertiary },
  chipNumberActive: { color: Colors.accent },
  chipScore: { fontFamily: Fonts.serifSemibold, fontSize: 18 },
  chipScorePlayed: { color: Colors.primary },
  chipScoreEmpty: { color: Colors.textTertiary },

  boardBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: Colors.scrim },
  boardSheet: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: Colors.background,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.md,
    gap: Spacing.md,
  },
  boardGrabber: {
    alignSelf: "center",
    width: 40,
    height: 5,
    borderRadius: 3,
    backgroundColor: Colors.borderStrong,
    marginBottom: Spacing.xs,
  },
  boardHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  boardTitleWrap: { flexDirection: "row", alignItems: "center", gap: 8 },
  boardTitle: { ...Typography.title, fontSize: 22 },
  boardClose: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.primarySoft,
  },
  codeCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: hairline,
    borderColor: Colors.borderStrong,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
  },
  codeLabel: { ...Typography.overline, fontSize: 10 },
  codeValue: {
    fontSize: 28,
    fontWeight: "800",
    letterSpacing: 6,
    color: Colors.primary,
    marginTop: 2,
  },
  shareButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 40,
    paddingHorizontal: Spacing.lg,
    borderRadius: Radius.pill,
    backgroundColor: Colors.primary,
  },
  shareButtonText: { ...Typography.callout, color: Colors.onPrimary, fontWeight: "700" },
  boardLoading: { paddingVertical: Spacing.xl, alignItems: "center" },
  boardList: { gap: Spacing.sm },
  boardRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    borderWidth: hairline,
    borderColor: Colors.border,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
  },
  boardRowMe: { borderColor: Colors.accent, backgroundColor: Colors.accentSoft },
  boardRank: {
    width: 22,
    textAlign: "center",
    fontFamily: Fonts.serifSemibold,
    fontSize: 18,
    color: Colors.textSecondary,
  },
  boardNameWrap: { flex: 1, gap: 2 },
  boardName: { ...Typography.headline, fontSize: 17 },
  boardThru: { ...Typography.caption, color: Colors.textTertiary, letterSpacing: 0.2 },
  boardScore: { fontFamily: Fonts.serifSemibold, fontSize: 22, color: Colors.primary },
  boardScoreIdle: { color: Colors.textTertiary },
  boardHint: {
    ...Typography.subhead,
    color: Colors.textTertiary,
    textAlign: "center",
    marginTop: Spacing.xs,
  },

  promptBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: Colors.scrim },
  promptCenter: { flex: 1, justifyContent: "center", paddingHorizontal: Spacing.xl },
  promptCard: {
    backgroundColor: Colors.background,
    borderRadius: Radius.xl,
    padding: Spacing.xl,
    gap: Spacing.sm,
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
  },
  promptTitle: { ...Typography.title, fontSize: 22, textAlign: "center" },
  promptBody: {
    ...Typography.body,
    color: Colors.textSecondary,
    textAlign: "center",
    lineHeight: 22,
    marginBottom: Spacing.md,
  },
  promptSave: { alignSelf: "stretch" },
  promptDiscard: {
    height: 50,
    borderRadius: Radius.lg,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.dangerSoft,
    marginTop: Spacing.xs,
  },
  promptDiscardText: { ...Typography.headline, fontSize: 16, color: Colors.danger },
  promptCancel: { height: 40, alignItems: "center", justifyContent: "center", marginTop: Spacing.xs },
  promptCancelText: { ...Typography.callout, color: Colors.textTertiary, fontWeight: "600" },
});
