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
import { usePressScale } from "@/hooks/usePressScale";
import { useActiveRound } from "@/providers/ActiveRoundProvider";
import { useAuth } from "@/providers/AuthProvider";
import { useBlockedPlayers } from "@/providers/BlockedPlayersProvider";
import { useSettings } from "@/providers/SettingsProvider";
import {
  fetchHoleBests,
  fetchLeaderboard,
  fetchRoundBundle,
  finishRound,
  NotRoundOwnerError,
  setHoleGreen,
  upsertScore,
} from "@/services/db";
import type { LeaderboardEntry } from "@/services/db";
import { fetchWeather } from "@/services/weather";
import type { Weather } from "@/services/weather";
import { isWeatherConfigured } from "@/services/weatherConfig";
import type { Club, Hole } from "@/types/models";
import { computeAimShot } from "@/utils/aim";
import type { AimShot } from "@/utils/aim";
import { CADDY_CONFIG, computePlaysLike, recommendClub } from "@/utils/caddy";
import type { ClubRecommendation, PlaysLikeBreakdown } from "@/utils/caddy";
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

  // Fetched once when the round opens, not per hole. A missing best must never
  // block play, so failures here are simply absent (see the `?? null` below).
  const holeBestsQuery = useQuery({
    queryKey: ["hole-bests", user?.id, bundleQuery.data?.course.id, roundId],
    queryFn: () =>
      fetchHoleBests(user?.id ?? "", bundleQuery.data?.course.id ?? "", roundId),
    enabled: !!user && !!bundleQuery.data?.course.id,
    staleTime: 5 * 60 * 1000,
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
  // Only the owner can close a round out (`rounds_update_owner`). A joiner is
  // never the owner, and a solo round's owner is always its only player, so
  // this is false only while the bundle is still loading — when Finish isn't
  // reachable anyway.
  const isOwner = bundle != null && bundle.round.owner_id === user?.id;
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

  // "Finish" means different things depending on whose round it is.
  //
  // For the host it closes the round out for everyone — that is the write
  // `finishRound` performs, and RLS allows it only for them.
  //
  // For someone who joined by code it means "I'm done": their scores are
  // already saved, they stop tracking and leave, and the round stays live for
  // whoever is still on the course. Calling `finishRound` for them would write
  // nothing, return no error, and let the app claim it had ended a round that
  // is still being played — so it simply isn't called.
  const finish = useMutation({
    mutationFn: async () => {
      if (isOwner) await finishRound(roundId);
    },
    onSuccess: () => {
      clearActiveRound(roundId);
      // Land on the round's own page rather than the tab: it already holds the
      // hole-by-hole breakdown and the share action, so the just-finished round
      // and a round from three months ago are the same screen.
      router.replace(`/history/${roundId}`);
    },
    onError: (error) => {
      // Belt and braces: `isOwner` should already have kept a joiner out of the
      // write, so this fires only if ownership changed under us mid-round.
      const hostOnly = error instanceof NotRoundOwnerError;
      setExitPrompt(null);
      Alert.alert(
        hostOnly ? "Only the host can finish this round" : "Couldn't finish the round",
        hostOnly
          ? "Your scores are saved. Ask whoever started the round to close it out."
          : "Your scores are saved. Please try again in a moment."
      );
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

  // Stable object reference (memoized on the hole, not recreated every render)
  // so it's safe to use as a dependency below without causing extra recompute.
  const greenCoordinate = useMemo<{ latitude: number; longitude: number } | null>(() => {
    if (!currentHole || currentHole.green_lat == null || currentHole.green_lng == null) {
      return null;
    }
    return { latitude: currentHole.green_lat, longitude: currentHole.green_lng };
  }, [currentHole]);

  const distanceMeters =
    location.coords && greenCoordinate
      ? haversineMeters(
          location.coords.latitude,
          location.coords.longitude,
          greenCoordinate.latitude,
          greenCoordinate.longitude
        )
      : null;

  // Past this, the golfer plainly isn't on the hole — they're reviewing a
  // scorecard from home, or the green was pinned on the wrong course. Showing a
  // raw six-digit yardage in the hero slot reads as a broken app, so we swap in
  // an explicit off-course state instead.
  const offCourse = distanceMeters != null && distanceMeters > OFF_COURSE_METERS;

  // A temporary, unpersisted target the golfer can drop short of the green —
  // "the green is 700 out, but I want to know the distance to that bunker."
  // Local state only: no DB write, no AsyncStorage, gone the moment the hole
  // changes (see the effect below) or the round is left.
  const [aimPoint, setAimPoint] = useState<{ latitude: number; longitude: number } | null>(null);

  // A temporary aim point only means something on the hole it was dropped on.
  useEffect(() => {
    setAimPoint(null);
  }, [holeIndex]);

  // The two numbers an aim point is for: the shot to it, and what's left after.
  // Computed independently of each other (see computeAimShot) so "what's left"
  // doesn't wait on a GPS fix it doesn't actually need.
  const aimShot = useMemo<AimShot | null>(() => {
    if (!aimPoint) return null;
    return computeAimShot(
      location.coords
        ? { latitude: location.coords.latitude, longitude: location.coords.longitude }
        : null,
      aimPoint,
      greenCoordinate
    );
  }, [aimPoint, location.coords, greenCoordinate]);

  // What the Smart Caddy is actually shooting at: the aim point when one is
  // set, otherwise the green — exactly as before. Wind/temperature handling
  // in computePlaysLike is untouched; only this target changes.
  const caddyTarget = aimPoint ?? greenCoordinate;
  const caddyTargetMeters = aimPoint ? aimShot?.toAimMeters ?? null : distanceMeters;

  // Plays-like distance: converts the raw GPS distance into what the shot really
  // plays given temperature + wind along the shot line.
  const playsLike = useMemo<PlaysLikeBreakdown | null>(() => {
    if (caddyTargetMeters == null || !location.coords || !caddyTarget) {
      return null;
    }
    return computePlaysLike(
      caddyTargetMeters,
      { latitude: location.coords.latitude, longitude: location.coords.longitude },
      caddyTarget,
      weather
    );
  }, [caddyTargetMeters, location.coords, caddyTarget, weather]);

  const recommendedClub = useMemo<ClubRecommendation | null>(
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

  // Which full-screen map picker is open, if any — the same picker handles
  // both jobs, just aimed at a different target (see MapPointPicker below).
  const [pickerMode, setPickerMode] = useState<"green" | "aim" | null>(null);
  // Press feedback for the "Aim" badge on the hole map card (see usePressScale).
  const aimBadgeAnim = usePressScale();

  // Static satellite preview of the mapped green for the current hole, plus
  // the aim point when one is set — given its own unlabeled marker (a small
  // gold dot) so it's never mistaken for the numbered green pin.
  const greenPreview = useMemo<{ region: MapRegion; markers: { id: string; coordinate: { latitude: number; longitude: number }; label?: string }[] } | null>(() => {
    if (!currentHole || currentHole.green_lat == null || currentHole.green_lng == null) {
      return null;
    }
    const coordinate = { latitude: currentHole.green_lat, longitude: currentHole.green_lng };
    const markers: { id: string; coordinate: { latitude: number; longitude: number }; label?: string }[] = [
      { id: "green", coordinate, label: String(currentHole.number) },
    ];
    if (aimPoint) markers.push({ id: "aim", coordinate: aimPoint });
    // Zoom tight on the green alone when there's no aim point (unchanged from
    // before); once one is set, frame both pins so a layup well short of the
    // green doesn't fall outside the preview.
    const region = aimPoint
      ? boundingRegion([coordinate, aimPoint], 0.0016)
      : { ...coordinate, latitudeDelta: 0.0016, longitudeDelta: 0.0016 };
    return { region, markers };
  }, [currentHole, aimPoint]);

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

  // The picker reports back a single lat/lng regardless of mode; what happens
  // with it depends on what we opened it for.
  const onConfirmPicker = (lat: number, lng: number): void => {
    if (pickerMode === "green") {
      if (!currentHole) return;
      setGreen.mutate(
        { holeId: currentHole.id, lat, lng },
        { onSuccess: () => setPickerMode(null) }
      );
      return;
    }
    if (pickerMode === "aim") {
      // No mutation — an aim point is never written anywhere.
      setAimPoint({ latitude: lat, longitude: lng });
      notifySuccess();
      setPickerMode(null);
    }
  };

  // Reference marker(s) shown inside the picker while placing an aim point:
  // this hole's own green, so the golfer can see it relative to where they're
  // aiming. Reuses the same numbered-pin styling as the green picker's
  // reference greens, since it's the same kind of "context, not the target" pin.
  const aimReference = useMemo<
    { id: string; coordinate: { latitude: number; longitude: number }; label: string }[]
  >(() => {
    if (!greenCoordinate || !currentHole) return [];
    return [{ id: "green", coordinate: greenCoordinate, label: String(currentHole.number) }];
  }, [greenCoordinate, currentHole]);

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
  const holeBest = currentHole ? holeBestsQuery.data?.[currentHole.id] ?? null : null;
  const beatingBest = holeBest != null && strokes > 0 && strokes < holeBest;

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
          {displayYardage != null || holeBest != null ? (
            <Text style={styles.holeNavYardage}>
              {displayYardage != null ? `${displayYardage} ${unitShort(unit)}` : ""}
              {displayYardage != null && holeBest != null ? "  ·  " : ""}
              {holeBest != null ? (
                <Text style={beatingBest ? styles.holeNavBest : undefined}>Best {holeBest}</Text>
              ) : null}
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
          onPickOnMap={() => setPickerMode("green")}
          onAim={() => {
            tapLight();
            setPickerMode("aim");
          }}
          hasAim={aimPoint != null}
          onEnable={() => Linking.openSettings()}
          onRetry={location.retry}
        />
        {/* Caddy target follows the aim point when one is set (see caddyTarget
            above) — `!offCourse` still gates it: an aim point is placed on the
            course itself, so if the golfer isn't there, a distance to it is as
            meaningless as one to the green would be. */}
        {!offCourse && playsLike && (clubs.length > 0 || playsLike.hasWeather) ? (
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
        {aimPoint && aimShot ? (
          <AimBlock
            unit={unit}
            aimShot={aimShot}
            offCourse={offCourse}
            hasFix={location.coords != null}
            hasGreen={hasGreen}
            onClear={() => {
              tapLight();
              setAimPoint(null);
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
                setPickerMode("green");
              }}
            />
            <View pointerEvents="none" style={styles.holeMapBadge}>
              <MapPin size={13} color={Colors.onPrimary} strokeWidth={2.4} />
              <Text style={styles.holeMapBadgeText}>Adjust green</Text>
            </View>
            <Pressable
              style={styles.aimBadge}
              onPress={() => {
                tapLight();
                setPickerMode("aim");
              }}
              onPressIn={aimBadgeAnim.onPressIn}
              onPressOut={aimBadgeAnim.onPressOut}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel={aimPoint ? "Edit aim point" : "Aim at a point"}
            >
              <Animated.View
                style={[styles.aimBadgeInner, { transform: [{ scale: aimBadgeAnim.scale }] }]}
              >
                <Crosshair size={13} color={Colors.onAccent} strokeWidth={2.4} />
                <Text style={styles.aimBadgeText}>{aimPoint ? "Edit aim" : "Aim"}</Text>
              </Animated.View>
            </Pressable>
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
        isOwner={isOwner}
        onSave={onSaveProgress}
        onDiscard={onDiscardProgress}
        onCancel={() => setExitPrompt(null)}
      />

      {pickerMode && currentHole ? (
        <MapPointPicker
          mode={pickerMode}
          holeNumber={currentHole.number}
          initial={pickerMode === "aim" ? aimPoint : greenCoordinate}
          courseCenter={
            courseAnchor ??
            (location.coords
              ? { latitude: location.coords.latitude, longitude: location.coords.longitude }
              : null)
          }
          reference={pickerMode === "aim" ? aimReference : referenceGreens}
          saving={pickerMode === "green" && setGreen.isPending}
          onCancel={() => setPickerMode(null)}
          onConfirm={onConfirmPicker}
        />
      ) : null}
    </View>
  );
}

function ExitPrompt({
  mode,
  busy,
  played,
  isOwner,
  onSave,
  onDiscard,
  onCancel,
}: {
  mode: null | "close" | "finish";
  busy: boolean;
  played: number;
  /** False only for someone who joined a group round by code. */
  isOwner: boolean;
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
}) {
  const insets = useSafeAreaInsets();
  const visible = mode !== null;
  const isFinish = mode === "finish";
  // A joiner ends only their own round, so say that rather than implying they
  // are closing the round out for the group — which they cannot do.
  const title = isFinish ? (isOwner ? "Finish round?" : "Finish your round?") : "Save your progress?";
  const holeCount = `${played} ${played === 1 ? "hole" : "holes"}`;
  const body =
    played > 0
      ? isFinish
        ? isOwner
          ? `You've played ${holeCount}. Save this round to your history and stats?`
          : `You've played ${holeCount}. Save it to your history and stats? The round stays open for the other players.`
        : `You've played ${holeCount}. Keep this progress so you can pick it back up?`
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

/**
 * Full-screen map picker shared by both "set the green" and "aim at a point" —
 * same map, same confirm/cancel shape, same crosshair mechanic. Only the
 * labels, the confirm action, and the reticle color (so a mid-placement aim
 * point is never visually mistaken for a green) change with `mode`.
 */
function MapPointPicker({
  mode,
  holeNumber,
  initial,
  courseCenter,
  reference,
  saving,
  onCancel,
  onConfirm,
}: {
  mode: "green" | "aim";
  holeNumber: number;
  initial: { latitude: number; longitude: number } | null;
  courseCenter: { latitude: number; longitude: number } | null;
  reference: { id: string; coordinate: { latitude: number; longitude: number }; label: string }[];
  saving: boolean;
  onCancel: () => void;
  onConfirm: (lat: number, lng: number) => void;
}) {
  const insets = useSafeAreaInsets();
  const isAim = mode === "aim";
  // Zoom priority: an exact point (existing green/aim point, or live GPS) gets
  // a tight view; otherwise center on the course and zoom to the property so
  // the golfer can find the hole instead of staring at the whole planet.
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
      // Unlabeled -> the small gold dot, marking the point currently being
      // adjusted (an existing green, or a previously-placed aim point).
      ...(initial ? [{ id: mode, coordinate: initial }] : []),
    ],
    [initial, reference, mode],
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
          {/* Gold for an aim point, the usual accent green for the green
              itself — the same distinction carried by the markers elsewhere. */}
          <View style={[styles.reticleDot, isAim && styles.reticleDotAim]} />
        </View>
      </View>

      <View style={[styles.pickerTop, { paddingTop: insets.top + Spacing.sm }]}>
        <View style={styles.pickerTopCard}>
          <Pressable style={styles.pickerClose} onPress={onCancel} hitSlop={8}>
            <X size={20} color={Colors.primary} strokeWidth={2.4} />
          </Pressable>
          <View style={styles.pickerTopInfo}>
            <Text style={styles.pickerOverline}>{isAim ? "AIM POINT" : "SET GREEN"}</Text>
            <Text style={styles.pickerHole}>Hole {holeNumber}</Text>
          </View>
          <View style={styles.pickerClose} />
        </View>
      </View>

      <View style={[styles.pickerBottom, { paddingBottom: insets.bottom + Spacing.lg }]}>
        <View style={styles.pickerBottomCard}>
          <View style={styles.bottomHint}>
            <Crosshair size={16} color={isAim ? Colors.gold : Colors.accent} strokeWidth={2.4} />
            <Text style={styles.bottomHintText}>
              {isAim
                ? "Drag the map so the crosshair sits where you want to aim, then save. It won't be saved to the round — just for this hole, right now."
                : "Drag the map so the crosshair sits on the middle of the green, then save."}
            </Text>
          </View>
          <TeeButton
            label={isAim ? "Set aim point" : "Save green"}
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
  onAim,
  hasAim,
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
  /** Opens the same map picker in aim mode — reachable even with no green pinned. */
  onAim: () => void;
  hasAim: boolean;
  onEnable: () => void;
  onRetry: () => void;
}) {
  const aimLinkAnim = usePressScale();

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
        {/* Distance to an arbitrary point doesn't need a green — only "what's
            left" does, and AimBlock handles that being unknowable on its own. */}
        <Pressable
          style={styles.aimLink}
          onPress={onAim}
          onPressIn={aimLinkAnim.onPressIn}
          onPressOut={aimLinkAnim.onPressOut}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel={hasAim ? "Edit aim point" : "Aim at a point on the map"}
        >
          <Animated.View
            style={[styles.aimLinkInner, { transform: [{ scale: aimLinkAnim.scale }] }]}
          >
            <Crosshair size={15} color={Colors.gold} strokeWidth={2.2} />
            <Text style={[styles.setHereLinkText, { color: Colors.gold }]}>
              {hasAim ? "Edit aim point" : "Aim at a point instead"}
            </Text>
          </Animated.View>
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

/** Formats a wind speed in the unit family the golfer has chosen. */
function windSpeed(mph: number, unit: "yards" | "meters"): string {
  return unit === "yards"
    ? `${Math.round(mph)} mph`
    : `${Math.round(mph * 1.60934)} km/h`;
}

/**
 * Describes the wind by naming the component that actually moves the number
 * first.
 *
 * Reporting only the dominant component is what a weather app does, and here it
 * misleads: a 10 mph wind can be mostly across while still carrying a 7 mph
 * tailwind, and then the card reads "10 mph crosswind" next to "−10 yd", which
 * says crosswind shortens a shot. It doesn't. Only the head/tail component
 * changes distance, so that is what gets named, with the cross mentioned after
 * it because it still matters for aim.
 */
function describeWind(breakdown: PlaysLikeBreakdown, unit: "yards" | "meters"): string {
  const head = breakdown.headwindMph;
  const cross = breakdown.crosswindMph;
  const absHead = Math.abs(head);
  const deadband = CADDY_CONFIG.windDeadbandMph;

  if (absHead < deadband && cross < deadband) return "Calm";
  if (absHead < deadband) {
    return `${windSpeed(cross, unit)} across — no distance change`;
  }

  const along =
    head > 0
      ? `${windSpeed(absHead, unit)} into you`
      : `${windSpeed(absHead, unit)} helping`;
  return cross >= deadband ? `${along}, ${windSpeed(cross, unit)} across` : along;
}

/** Short, glanceable condition copy for the compact card: "7 mph helping, warm air". */
function describeConditions(
  breakdown: PlaysLikeBreakdown,
  weather: Weather | null,
  unit: "yards" | "meters"
): string {
  if (!breakdown.hasWeather || !weather) {
    // Both branches are user-facing on purpose: the second one is unreachable in
    // a release build, but must never leak an environment variable name if it is.
    return isWeatherConfigured ? "Based on raw distance" : "Conditions unavailable";
  }

  const parts: string[] = [];
  const wind = describeWind(breakdown, unit);
  if (wind !== "Calm") {
    // Drop the explanatory tail on the compact card — there is one line for it.
    parts.push(wind.replace(" — no distance change", " across").replace(/, .* across$/, ""));
  }

  if (weather.tempC <= 10) parts.push("cold air");
  else if (weather.tempC <= 16) parts.push("cool air");
  else if (weather.tempC >= 27) parts.push("warm air");

  if (parts.length === 0) return "Calm and mild";
  return parts.join(", ");
}

/**
 * The club name, qualified when the shot doesn't fit a normal swing. A 30-yard
 * pitch is "closest" to a 65-yard lob wedge, and naming the club bare would read
 * as "hit it" — so say what kind of shot it actually is.
 */
function clubHeadline(rec: ClubRecommendation): string {
  if (rec.fit === "partial") return `${rec.club.name}, partial`;
  if (rec.fit === "beyond") return `${rec.club.name}, all of it`;
  return rec.club.name;
}

/** Explains an imperfect fit in the caddy's subtitle slot. */
function describeFit(rec: ClubRecommendation, unit: "yards" | "meters"): string {
  const gap = Math.round(metersToUnit(Math.abs(rec.deltaMeters), unit));
  if (rec.fit === "partial") {
    return `${gap} ${unitShort(unit)} inside your shortest club — take something off it`;
  }
  return `${gap} ${unitShort(unit)} past your longest club — lay up short`;
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
  club: ClubRecommendation | null;
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
          {club ? clubHeadline(club) : "—"}
          <Text style={styles.caddyPlays}>
            {"  ·  Plays "}
            {playsLike} {unitShort(unit)}
          </Text>
        </Text>
        <Text style={styles.caddyReason} numberOfLines={1}>
          {club && club.fit !== "full" ? describeFit(club, unit) : reason}
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
  club: ClubRecommendation | null;
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
                  <Text style={styles.caddyClubName}>{clubHeadline(club)}</Text>
                  <Text style={styles.caddyReason}>
                    {club.fit === "full"
                      ? `${formatDistance(club.club.carry_meters, unit)} ${unitShort(unit)} carry`
                      : describeFit(club, unit)}
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
                detail={breakdown.hasWeather ? describeWind(breakdown, unit) : "—"}
                delta={breakdown.hasWeather ? formatDelta(breakdown.windDeltaMeters, unit) : "—"}
              />
            </View>

            {!breakdown.hasWeather ? (
              <Text style={styles.caddyNote}>
                {isWeatherConfigured
                  ? "Weather is unavailable right now — showing the raw distance."
                  : "Conditions aren't available, so this is the raw distance."}
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

/**
 * The two numbers a temporary aim point exists for: the shot about to be hit,
 * and what's left after it. Gold-tinted throughout to match the aim marker,
 * so this card, the badge that opened it, and the pin on the map all read as
 * the same thing at a glance — distinct from the green's own accent green.
 */
function AimBlock({
  unit,
  aimShot,
  offCourse,
  hasFix,
  hasGreen,
  onClear,
}: {
  unit: "yards" | "meters";
  aimShot: AimShot;
  offCourse: boolean;
  hasFix: boolean;
  hasGreen: boolean;
  onClear: () => void;
}) {
  const clearAnim = usePressScale();

  const toAimText =
    !hasFix
      ? "Waiting for GPS…"
      : offCourse
        ? "Get on course to measure"
        : aimShot.toAimMeters != null
          ? `${formatDistance(aimShot.toAimMeters, unit)} ${unitShort(unit)} to aim`
          : "Waiting for GPS…";

  // The remaining leg doesn't depend on the player's position at all, so it's
  // shown even off-course or before a fix — only a missing green makes it
  // unknowable, and that's said plainly rather than left blank.
  const leftText = !hasGreen
    ? "Green isn't mapped, so no distance left to show"
    : aimShot.aimToGreenMeters != null
      ? `${formatDistance(aimShot.aimToGreenMeters, unit)} ${unitShort(unit)} left to green`
      : "";

  return (
    <View style={styles.aimCard}>
      <View style={styles.aimIcon}>
        <Crosshair size={18} color={Colors.gold} strokeWidth={2.4} />
      </View>
      <View style={styles.aimInfo}>
        <Text style={styles.aimTitle} numberOfLines={1}>
          {toAimText}
        </Text>
        {leftText ? (
          <Text style={styles.aimReason} numberOfLines={1}>
            {leftText}
          </Text>
        ) : null}
      </View>
      <Pressable
        onPress={onClear}
        onPressIn={clearAnim.onPressIn}
        onPressOut={clearAnim.onPressOut}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Clear aim point"
      >
        <Animated.View style={[styles.aimClear, { transform: [{ scale: clearAnim.scale }] }]}>
          <X size={16} color={Colors.textSecondary} strokeWidth={2.4} />
        </Animated.View>
      </Pressable>
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

/**
 * Smallest map region containing every point, with margin so pins don't sit
 * flush against the card edge. Used for the hole map preview so an aim point
 * placed well short of the green still lands in frame alongside it — the
 * green-only preview stays a fixed tight zoom (see greenPreview) since that
 * behavior must not change when there's no aim point.
 */
function boundingRegion(
  points: { latitude: number; longitude: number }[],
  minDelta: number
): MapRegion {
  const lats = points.map((p) => p.latitude);
  const lngs = points.map((p) => p.longitude);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const margin = 1.6;
  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    latitudeDelta: Math.max((maxLat - minLat) * margin, minDelta),
    longitudeDelta: Math.max((maxLng - minLng) * margin, minDelta),
  };
}

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
  // One stroke is a hole in one, whatever the par. Golfers never call an ace on
  // a par 3 an "eagle", even though it is two under.
  if (strokes === 1) return { label: "Hole in one", tone: "under" };
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
  holeNavBest: { color: Colors.accent, fontWeight: "700" },
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
  // Outer Pressable carries just position/spacing; the transform lives on the
  // inner view, matching the app's usePressScale pattern elsewhere.
  aimLink: { marginTop: Spacing.sm },
  aimLinkInner: { flexDirection: "row", alignItems: "center", gap: 6, height: 24 },
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

  // Same shape as caddyCard, gold-tinted instead of accent-tinted so an aim
  // point never reads as "another caddy card" — it's a distinct, secondary
  // thing that can be dismissed, which is why it ends in a clear button
  // instead of a chevron.
  aimCard: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    marginTop: Spacing.sm,
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    borderWidth: hairline,
    borderColor: Colors.borderStrong,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.md,
  },
  aimIcon: {
    width: 38,
    height: 38,
    borderRadius: Radius.pill,
    backgroundColor: Colors.goldSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  aimInfo: { flex: 1, gap: 2 },
  aimTitle: { ...Typography.headline, fontSize: 16 },
  aimReason: { ...Typography.subhead, color: Colors.textTertiary },
  aimClear: {
    width: 32,
    height: 32,
    borderRadius: Radius.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.primarySoft,
  },

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
  // Opposite corner from "Adjust green" so the two never overlap. Outer
  // Pressable is just position; aimBadgeInner carries the visual + transform.
  aimBadge: { position: "absolute", right: Spacing.md, top: Spacing.md },
  aimBadgeInner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: Radius.pill,
    backgroundColor: Colors.gold,
  },
  aimBadgeText: { color: Colors.onAccent, fontSize: 12, fontWeight: "700" },

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
  reticleDotAim: { backgroundColor: Colors.gold },
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
