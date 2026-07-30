import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as Location from "expo-location";
import { useRouter } from "expo-router";
import { MapPin, Navigation, Play, Plus, RotateCcw, Search, Sparkles, Trash2, Users } from "lucide-react-native";
import React, { useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Swipeable } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { JoinGameSheet, StartRoundSheet } from "@/components/GroupRoundSheets";
import { TeeMark } from "@/components/TeeMark";
import { Wordmark } from "@/components/Wordmark";
import { TeeButton } from "@/components/ui/TeeButton";
import { TeeCard } from "@/components/ui/TeeCard";
import { Colors, Fonts, Radius, Spacing, Typography, hairline } from "@/constants/theme";
import { useLiveLocation } from "@/hooks/useLiveLocation";
import { useActiveRound, type ActiveRound } from "@/providers/ActiveRoundProvider";
import { useAuth } from "@/providers/AuthProvider";
import { useSettings } from "@/providers/SettingsProvider";
import {
  createMultiplayerRound,
  createSoloRound,
  fetchCourses,
  finishRound,
  importCatalogCourse,
  joinRoundByCode,
  removeCourseFromLibrary,
  upsertScore,
} from "@/services/db";
import {
  courseDisplayName,
  courseHoleCount,
  courseLocationLabel,
  getGolfCourseDetail,
  normalizeCatalogCourse,
  searchGolfCourses,
  type GolfApiCourse,
} from "@/services/golfApi";
import { geocodeCourse, withResolvedCoordinates } from "@/services/geocode";
import { isGolfApiConfigured } from "@/services/golfApiConfig";
import type { Course } from "@/types/models";
import { formatProximity, haversineMeters } from "@/utils/geo";
import { notifySuccess, tapMedium } from "@/utils/haptics";
import { useMutation } from "@tanstack/react-query";

interface CourseWithDistance {
  course: Course;
  meters: number | null;
}

export default function CoursesScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, isConfigured } = useAuth();
  const { unit } = useSettings();
  const { activeRound, clearActiveRound } = useActiveRound();
  const queryClient = useQueryClient();
  const [startCourse, setStartCourse] = useState<Course | null>(null);
  const [showJoin, setShowJoin] = useState<boolean>(false);

  const coursesQuery = useQuery({
    queryKey: ["courses", user?.id],
    queryFn: () => {
      if (!user) return Promise.resolve([] as Course[]);
      return fetchCourses(user.id);
    },
    enabled: isConfigured && !!user,
  });

  const { coords } = useLiveLocation(isConfigured);

  const startSolo = useMutation({
    mutationFn: (courseId: string) => {
      if (!user) throw new Error("Not signed in");
      return createSoloRound(courseId, user.id);
    },
    onSuccess: (round) => {
      setStartCourse(null);
      router.push(`/round/${round.id}`);
    },
    onError: (error) => onStartError(error),
  });

  const startHost = useMutation({
    mutationFn: (courseId: string) => {
      if (!user) throw new Error("Not signed in");
      return createMultiplayerRound(courseId, user.id);
    },
    onSuccess: (round) => {
      setStartCourse(null);
      notifySuccess();
      router.push(`/round/${round.id}`);
    },
    onError: (error) => onStartError(error),
  });

  const [joinError, setJoinError] = useState<string | null>(null);
  const joinGame = useMutation({
    mutationFn: async (code: string) => {
      const res = await joinRoundByCode(code);
      if (!res) throw new Error("No active group found for that code.");
      return res;
    },
    onSuccess: (res) => {
      setShowJoin(false);
      setJoinError(null);
      notifySuccess();
      router.push(`/round/${res.roundId}`);
    },
    onError: (error) => {
      setJoinError(
        error instanceof Error ? error.message : "Couldn't join. Try again."
      );
    },
  });

  // Close out a stuck/paused round from the Courses tab: persist its locally
  // saved scores, then mark it finished. This is the escape hatch when the
  // in-round Finish button can't be reached.
  const finishActive = useMutation({
    mutationFn: async (round: ActiveRound): Promise<void> => {
      if (!user) throw new Error("You're not signed in.");
      const entries = Object.entries(round.scores).filter(([, s]) => s > 0);
      for (const [holeId, strokes] of entries) {
        await upsertScore({
          round_id: round.roundId,
          profile_id: user.id,
          hole_id: holeId,
          strokes,
        });
      }
      await finishRound(round.roundId);
    },
    onSuccess: (_data, round) => {
      clearActiveRound(round.roundId);
      notifySuccess();
      queryClient.invalidateQueries({ queryKey: ["player-rounds"] });
    },
    onError: (error) => {
      Alert.alert(
        "Couldn't finish the round",
        error instanceof Error ? error.message : "Please try again in a moment."
      );
    },
  });

  const onStartError = (error: unknown): void => {
    console.error("[courses] couldn't start round:", error);
    Alert.alert(
      "Couldn't start the round",
      error instanceof Error
        ? error.message
        : "Something went wrong. Please try again in a moment."
    );
  };

  const blockIfActive = (): boolean => {
    if (!activeRound) return false;
    const round = activeRound;
    Alert.alert(
      "Game already in progress",
      `You're still playing ${round.courseName}. Finish or discard that round before starting a new one.`,
      [
        { text: "Not now", style: "cancel" },
        {
          text: "Resume",
          onPress: () => {
            tapMedium();
            router.push(`/round/${round.roundId}`);
          },
        },
        {
          text: "Finish & save",
          onPress: () => {
            tapMedium();
            finishActive.mutate(round);
          },
        },
        {
          text: "Discard",
          style: "destructive",
          onPress: () => {
            tapMedium();
            clearActiveRound(round.roundId);
            notifySuccess();
          },
        },
      ]
    );
    return true;
  };

  const onPlay = (course: Course): void => {
    if (startSolo.isPending || startHost.isPending) return;
    if (blockIfActive()) return;
    setStartCourse(course);
  };

  const removeCourse = useMutation({
    mutationFn: (courseId: string) => {
      if (!user) throw new Error("Not signed in");
      return removeCourseFromLibrary(courseId, user.id);
    },
    onMutate: async (courseId: string) => {
      const key = ["courses", user?.id];
      await queryClient.cancelQueries({ queryKey: key });
      const prev = queryClient.getQueryData<Course[]>(key);
      queryClient.setQueryData<Course[]>(
        key,
        (old) => (old ?? []).filter((c) => c.id !== courseId)
      );
      return { prev };
    },
    onError: (_error, _courseId, context) => {
      const ctx = context as { prev?: Course[] } | undefined;
      if (ctx?.prev) queryClient.setQueryData(["courses", user?.id], ctx.prev);
      Alert.alert("Couldn't remove the course", "Please try again in a moment.");
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["courses", user?.id] });
    },
  });

  const onDelete = (course: Course): void => {
    notifySuccess();
    removeCourse.mutate(course.id);
  };

  const courses = useMemo<Course[]>(() => coursesQuery.data ?? [], [coursesQuery.data]);

  // Attach a great-circle distance to each course, sorting the nearest first
  // whenever we have a GPS fix. Courses without a known location sink to the
  // bottom (still alphabetical-ish via their original order).
  const ranked = useMemo<CourseWithDistance[]>(() => {
    const withDistance = courses.map((course): CourseWithDistance => {
      const meters =
        coords && course.latitude != null && course.longitude != null
          ? haversineMeters(coords.latitude, coords.longitude, course.latitude, course.longitude)
          : null;
      return { course, meters };
    });
    if (!coords) return withDistance;
    return [...withDistance].sort((a, b) => {
      if (a.meters == null) return 1;
      if (b.meters == null) return -1;
      return a.meters - b.meters;
    });
  }, [courses, coords]);

  // The single closest course becomes a "Near you" suggestion — but only when
  // it's realistically the one you're heading to (within ~80 km).
  const nearest = useMemo<CourseWithDistance | null>(() => {
    const top = ranked[0];
    if (!top || top.meters == null || top.meters > 80000) return null;
    return top;
  }, [ranked]);

  // The catalog has no geo endpoint — only name search — so we reverse-geocode
  // the GPS fix to a place name and search that. Rounding the coords keeps the
  // query stable (and cached) while you stand still.
  const placeKey = coords
    ? `${coords.latitude.toFixed(2)},${coords.longitude.toFixed(2)}`
    : null;

  const catalogQuery = useQuery({
    queryKey: ["nearby-catalog", placeKey],
    enabled: isConfigured && isGolfApiConfigured && coords != null,
    staleTime: 1000 * 60 * 30,
    queryFn: async (): Promise<GolfApiCourse[]> => {
      if (!coords) return [];
      const places = await Location.reverseGeocodeAsync({
        latitude: coords.latitude,
        longitude: coords.longitude,
      }).catch(() => []);
      const place = places[0];
      const terms = [place?.city, place?.subregion, place?.region].filter(
        (t): t is string => typeof t === "string" && t.trim().length > 1
      );
      if (terms.length === 0) return [];
      return searchGolfCourses(terms[0]);
    },
  });

  const savedExternalIds = useMemo<Set<string>>(
    () =>
      new Set(
        (coursesQuery.data ?? [])
          .map((c) => c.external_id)
          .filter((id): id is string => id != null)
      ),
    [coursesQuery.data]
  );

  /**
   * Distances for the top few unsaved catalog results.
   *
   * The catalog returns a postal address but no coordinates, so a distance can
   * only be had by geocoding. That is bounded to the first handful of results —
   * the search term already came from reverse-geocoding the golfer's own
   * position, so anything it returns is in their area, and geocoding 25 rows to
   * rank them would be wasteful.
   */
  const candidateQuery = useQuery({
    queryKey: [
      "nearby-candidates",
      placeKey,
      (catalogQuery.data ?? []).map((c) => c.id).slice(0, 6).join(","),
    ],
    enabled: coords != null && (catalogQuery.data ?? []).length > 0,
    staleTime: 1000 * 60 * 30,
    queryFn: async (): Promise<{ course: GolfApiCourse; meters: number }[]> => {
      if (!coords) return [];
      const candidates = (catalogQuery.data ?? [])
        .filter((c) => !savedExternalIds.has(String(c.id)) && courseHoleCount(c) > 0)
        .slice(0, 6);

      const located = await Promise.all(
        candidates.map(async (course) => {
          const point = await geocodeCourse({
            address: course.location?.address,
            city: course.location?.city,
            state: course.location?.state,
            country: course.location?.country,
            name: courseDisplayName(course),
          });
          if (!point) return null;
          return {
            course,
            meters: haversineMeters(
              coords.latitude,
              coords.longitude,
              point.latitude,
              point.longitude
            ),
          };
        })
      );
      return located.filter((x): x is { course: GolfApiCourse; meters: number } => x != null);
    },
  });

  // The closest catalog course you HAVEN'T added yet — surfaced only when it's
  // genuinely closer than your nearest saved course (or you have none nearby).
  const suggestion = useMemo<{ course: GolfApiCourse; meters: number } | null>(() => {
    if (!coords) return null;
    let best: { course: GolfApiCourse; meters: number } | null = null;
    for (const candidate of candidateQuery.data ?? []) {
      if (!best || candidate.meters < best.meters) best = candidate;
    }
    if (!best || best.meters > 80000) return null;
    const nearestSaved = nearest?.meters ?? null;
    if (nearestSaved != null && best.meters >= nearestSaved) return null;
    return best;
  }, [coords, candidateQuery.data, nearest]);

  const importCourse = useMutation({
    mutationFn: async (course: GolfApiCourse): Promise<void> => {
      if (!user) throw new Error("You're not signed in.");
      const full =
        courseHoleCount(course) > 0 ? course : await getGolfCourseDetail(course.id);
      const normalized = normalizeCatalogCourse(full);
      const located = await withResolvedCoordinates(normalized, full.location);
      await importCatalogCourse({ ...located, createdBy: user.id });
    },
    onSuccess: () => {
      notifySuccess();
      queryClient.invalidateQueries({ queryKey: ["courses", user?.id] });
    },
    onError: (error) => {
      Alert.alert(
        "Couldn't add the course",
        error instanceof Error ? error.message : "Please try again in a moment."
      );
    },
  });

  return (
    <View style={styles.container}>
      <View style={[styles.appBar, { paddingTop: insets.top + Spacing.sm }]}>
        <Wordmark size={20} accent={Colors.accent} />
        <View style={styles.appBarActions}>
          <Pressable
            style={styles.joinButton}
            onPress={() => {
              if (blockIfActive()) return;
              setJoinError(null);
              setShowJoin(true);
            }}
            hitSlop={8}
            accessibilityLabel="Join a group round"
          >
            <Users size={18} color={Colors.primary} strokeWidth={2.4} />
            <Text style={styles.joinButtonText}>Join</Text>
          </Pressable>
          <Pressable
            style={styles.addButton}
            onPress={() => router.push("/course/new")}
            hitSlop={8}
          >
            <Plus size={22} color={Colors.onPrimary} strokeWidth={2.6} />
          </Pressable>
        </View>
      </View>

      <FlatList
        data={ranked}
        keyExtractor={(item) => item.course.id}
        contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 24 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={coursesQuery.isRefetching}
            onRefresh={() => coursesQuery.refetch()}
            tintColor={Colors.accent}
          />
        }
        ListHeaderComponent={
          <View style={styles.header}>
            {activeRound ? (
              <InProgressCard
                round={activeRound}
                onResume={() => {
                  tapMedium();
                  router.push(`/round/${activeRound.roundId}`);
                }}
              />
            ) : null}
            <Text style={styles.title}>Courses</Text>
            <Text style={styles.subtitle}>
              {isConfigured
                ? "Search the catalog, pick a course, or map a new one."
                : "Connect Supabase to start mapping courses."}
            </Text>
            {isConfigured ? (
              <Pressable
                style={styles.searchBar}
                onPress={() => router.push("/course/browse")}
                accessibilityRole="button"
              >
                <Search size={18} color={Colors.textTertiary} strokeWidth={2.4} />
                <Text style={styles.searchBarText}>Search 30,000+ courses</Text>
              </Pressable>
            ) : null}
            {suggestion ? (
              <SuggestionCard
                course={suggestion.course}
                meters={suggestion.meters}
                unit={unit}
                loading={importCourse.isPending}
                onAdd={() => {
                  if (importCourse.isPending) return;
                  tapMedium();
                  importCourse.mutate(suggestion.course);
                }}
              />
            ) : null}
            {nearest ? (
              <NearbyCard
                course={nearest.course}
                meters={nearest.meters as number}
                unit={unit}
                loading={
                  startCourse?.id === nearest.course.id &&
                  (startSolo.isPending || startHost.isPending)
                }
                onPress={() => onPlay(nearest.course)}
              />
            ) : null}
          </View>
        }
        renderItem={({ item }) => (
          <CourseRow
            course={item.course}
            distanceLabel={
              item.meters != null ? formatProximity(item.meters, unit) : null
            }
            loading={
              startCourse?.id === item.course.id &&
              (startSolo.isPending || startHost.isPending)
            }
            onPress={() => onPlay(item.course)}
            onDelete={() => onDelete(item.course)}
          />
        )}
        ListEmptyComponent={
          isConfigured ? (
            <EmptyOrLoading
              loading={coursesQuery.isLoading}
              error={coursesQuery.isError}
              onRetry={() => coursesQuery.refetch()}
              onMap={() => router.push("/course/new")}
              onSearch={() => router.push("/course/browse")}
            />
          ) : (
            <NotConfigured />
          )
        }
      />

      <StartRoundSheet
        course={startCourse}
        soloLoading={startSolo.isPending}
        hostLoading={startHost.isPending}
        onSolo={() => startCourse && startSolo.mutate(startCourse.id)}
        onHost={() => startCourse && startHost.mutate(startCourse.id)}
        onClose={() => setStartCourse(null)}
      />
      <JoinGameSheet
        visible={showJoin}
        loading={joinGame.isPending}
        error={joinError}
        onJoin={(code) => joinGame.mutate(code)}
        onClose={() => setShowJoin(false)}
      />
    </View>
  );
}

function InProgressCard({
  round,
  onResume,
}: {
  round: { courseName: string; scores: Record<string, number> };
  onResume: () => void;
}) {
  const played = Object.values(round.scores).filter((s) => s > 0).length;
  return (
    <Pressable
      onPress={onResume}
      accessibilityRole="button"
      accessibilityLabel={`Resume round at ${round.courseName}`}
      style={({ pressed }) => [styles.resumeCard, pressed && styles.nearbyPressed]}
    >
      <View style={styles.resumePulse}>
        <View style={styles.resumeDot} />
      </View>
      <View style={styles.rowLeft}>
        <Text style={styles.resumeEyebrow}>ROUND IN PROGRESS</Text>
        <Text style={styles.resumeName} numberOfLines={1}>
          {round.courseName}
        </Text>
        <Text style={styles.resumeMeta}>
          {played > 0 ? `Thru ${played} ${played === 1 ? "hole" : "holes"}` : "Not started yet"}
        </Text>
      </View>
      <View style={styles.resumeButton}>
        <RotateCcw size={16} color={Colors.onPrimary} strokeWidth={2.6} />
        <Text style={styles.resumeButtonText}>Resume</Text>
      </View>
    </Pressable>
  );
}

function NearbyCard({
  course,
  meters,
  unit,
  loading,
  onPress,
}: {
  course: Course;
  meters: number;
  unit: "yards" | "meters";
  loading: boolean;
  onPress: () => void;
}) {
  const location = [course.city, course.country].filter(Boolean).join(", ");
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.nearbyCard, pressed && styles.nearbyPressed]}
    >
      <View style={styles.nearbyTop}>
        <Navigation size={13} color={Colors.accent} strokeWidth={2.8} fill={Colors.accent} />
        <Text style={styles.nearbyEyebrow}>Closest to you · {formatProximity(meters, unit)}</Text>
      </View>
      <View style={styles.nearbyBody}>
        <View style={styles.rowLeft}>
          <Text style={styles.nearbyName} numberOfLines={1}>
            {course.name}
          </Text>
          {location.length > 0 ? (
            <Text style={styles.nearbyMeta} numberOfLines={1}>
              {location}
            </Text>
          ) : null}
        </View>
        <View style={styles.nearbyPlay}>
          {loading ? (
            <ActivityIndicator color={Colors.onAccent} size="small" />
          ) : (
            <>
              <Play size={16} color={Colors.onAccent} strokeWidth={2.6} fill={Colors.onAccent} />
              <Text style={styles.nearbyPlayText}>Play</Text>
            </>
          )}
        </View>
      </View>
    </Pressable>
  );
}

function SuggestionCard({
  course,
  meters,
  unit,
  loading,
  onAdd,
}: {
  course: GolfApiCourse;
  meters: number;
  unit: "yards" | "meters";
  loading: boolean;
  onAdd: () => void;
}) {
  const name = courseDisplayName(course);
  const location = courseLocationLabel(course);
  return (
    <View style={styles.suggestCard}>
      <View style={styles.suggestTop}>
        <Sparkles size={13} color={Colors.gold} strokeWidth={2.8} />
        <Text style={styles.suggestEyebrow}>
          New course nearby · {formatProximity(meters, unit)}
        </Text>
      </View>
      <View style={styles.suggestBody}>
        <View style={styles.rowLeft}>
          <Text style={styles.suggestName} numberOfLines={1}>
            {name}
          </Text>
          {location ? (
            <Text style={styles.suggestMeta} numberOfLines={1}>
              {location}
            </Text>
          ) : null}
        </View>
        <Pressable
          onPress={onAdd}
          accessibilityRole="button"
          accessibilityLabel={`Add ${name}`}
          style={({ pressed }) => [styles.suggestAdd, pressed && styles.nearbyPressed]}
        >
          {loading ? (
            <ActivityIndicator color={Colors.onPrimary} size="small" />
          ) : (
            <>
              <Plus size={16} color={Colors.onPrimary} strokeWidth={2.8} />
              <Text style={styles.suggestAddText}>Add</Text>
            </>
          )}
        </Pressable>
      </View>
    </View>
  );
}

function CourseRow({
  course,
  distanceLabel,
  loading,
  onPress,
  onDelete,
}: {
  course: Course;
  distanceLabel: string | null;
  loading: boolean;
  onPress: () => void;
  onDelete: () => void;
}) {
  const location = [course.city, course.country].filter(Boolean).join(", ");
  const swipeRef = useRef<Swipeable>(null);
  const didHaptic = useRef(false);

  const renderRightActions = (
    _progress: Animated.AnimatedInterpolation<number>,
    translation: Animated.AnimatedInterpolation<number>
  ) => {
    const translateX = translation.interpolate({
      inputRange: [-88, 0],
      outputRange: [0, 88],
      extrapolate: "clamp",
    });
    return (
      <View style={styles.deleteWrap}>
        <Animated.View style={[styles.deleteAction, { transform: [{ translateX }] }]}>
          <Pressable
            onPress={() => {
              swipeRef.current?.close();
              onDelete();
            }}
            accessibilityRole="button"
            accessibilityLabel="Delete course"
            style={({ pressed }) => [styles.deleteButton, pressed && styles.deletePressed]}
          >
            <Trash2 size={20} color={Colors.onAccent} strokeWidth={2.4} />
            <Text style={styles.deleteText}>Delete</Text>
          </Pressable>
        </Animated.View>
      </View>
    );
  };

  return (
    <Swipeable
      ref={swipeRef}
      friction={2}
      rightThreshold={40}
      overshootRight={false}
      enableTrackpadTwoFingerGesture
      renderRightActions={renderRightActions}
      onSwipeableWillOpen={() => {
        if (!didHaptic.current) {
          tapMedium();
          didHaptic.current = true;
        }
      }}
      onSwipeableClose={() => {
        didHaptic.current = false;
      }}
    >
      <TeeCard onPress={onPress} style={styles.row}>
        <View style={styles.rowLeft}>
          <Text style={styles.courseName} numberOfLines={1}>
            {course.name}
          </Text>
          <View style={styles.locationRow}>
            <MapPin size={13} color={Colors.textTertiary} strokeWidth={2.4} />
            <Text style={styles.courseMeta} numberOfLines={1}>
              {location.length > 0 ? location : "Course"}
            </Text>
            {distanceLabel ? (
              <>
                <View style={styles.metaDot} />
                <Text style={styles.courseDistance}>{distanceLabel}</Text>
              </>
            ) : null}
          </View>
        </View>
        <View style={styles.playBadge}>
          {loading ? (
            <ActivityIndicator color={Colors.onAccent} size="small" />
          ) : (
            <Play size={18} color={Colors.onAccent} strokeWidth={2.6} fill={Colors.onAccent} />
          )}
        </View>
      </TeeCard>
    </Swipeable>
  );
}

function EmptyOrLoading({
  loading,
  error,
  onRetry,
  onMap,
  onSearch,
}: {
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  onMap: () => void;
  onSearch: () => void;
}) {
  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={Colors.accent} />
      </View>
    );
  }
  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyTitle}>Couldn&apos;t load courses</Text>
        <Text style={styles.emptyBody}>Check your connection and try again.</Text>
        <TeeButton label="Retry" variant="secondary" onPress={onRetry} style={styles.emptyCta} />
      </View>
    );
  }
  return (
    <View style={styles.center}>
      <TeeMark size={56} tint={Colors.borderStrong} />
      <Text style={styles.emptyTitle}>No courses yet</Text>
      <Text style={styles.emptyBody}>
        Search 30,000+ courses to add yours in seconds, or map your home course by hand for
        live GPS distances to every green.
      </Text>
      <TeeButton
        label="Search courses"
        onPress={onSearch}
        icon={<Search size={18} color={Colors.onPrimary} strokeWidth={2.4} />}
        style={styles.emptyCta}
      />
      <TeeButton
        label="Map a course"
        variant="secondary"
        onPress={onMap}
        icon={<MapPin size={18} color={Colors.primary} strokeWidth={2.4} />}
        style={styles.emptyCtaSecondary}
      />
    </View>
  );
}

function NotConfigured() {
  return (
    <TeeCard style={styles.configCard}>
      <Text style={styles.configTitle}>Connect Supabase</Text>
      <Text style={styles.emptyBody}>
        Paste your project URL and anon key into{" "}
        <Text style={styles.mono}>services/supabaseConfig.ts</Text>, then run the SQL
        migration in your Supabase project.
      </Text>
    </TeeCard>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  appBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.xl,
    paddingBottom: Spacing.sm,
  },
  appBarActions: { flexDirection: "row", alignItems: "center", gap: Spacing.sm },
  joinButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 40,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.pill,
    borderWidth: hairline,
    borderColor: Colors.borderStrong,
    backgroundColor: Colors.surface,
  },
  joinButtonText: { ...Typography.callout, color: Colors.primary, fontWeight: "700" },
  addButton: {
    width: 40,
    height: 40,
    borderRadius: Radius.pill,
    backgroundColor: Colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  list: { paddingHorizontal: Spacing.xl, gap: Spacing.md },
  header: { marginTop: Spacing.md, marginBottom: Spacing.lg },
  title: { ...Typography.largeTitle },
  subtitle: { ...Typography.body, color: Colors.textSecondary, marginTop: 4 },
  row: { flexDirection: "row", alignItems: "center", gap: Spacing.md },
  rowLeft: { flex: 1, gap: 6 },
  courseName: { ...Typography.headline, fontSize: 20 },
  locationRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  courseMeta: { ...Typography.subhead, color: Colors.textTertiary },
  metaDot: {
    width: 3,
    height: 3,
    borderRadius: 999,
    backgroundColor: Colors.textTertiary,
    marginHorizontal: 2,
  },
  courseDistance: { ...Typography.subhead, color: Colors.accent, fontWeight: "700" },
  playBadge: {
    width: 48,
    height: 48,
    borderRadius: Radius.pill,
    backgroundColor: Colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  deleteWrap: {
    width: 88,
    justifyContent: "center",
    alignItems: "center",
  },
  deleteAction: {
    width: 88,
    height: "100%",
    justifyContent: "center",
    alignItems: "center",
    paddingLeft: Spacing.sm,
  },
  deleteButton: {
    flex: 1,
    alignSelf: "stretch",
    borderRadius: Radius.md,
    backgroundColor: Colors.danger,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  deletePressed: { opacity: 0.85 },
  deleteText: { ...Typography.caption, color: Colors.onAccent, letterSpacing: 0.4 },
  center: { alignItems: "center", paddingTop: Spacing.xxxl, paddingHorizontal: Spacing.md, gap: Spacing.sm },
  emptyTitle: { ...Typography.title, fontSize: 22, marginTop: Spacing.lg },
  emptyBody: {
    ...Typography.body,
    color: Colors.textSecondary,
    textAlign: "center",
    lineHeight: 22,
  },
  emptyCta: { marginTop: Spacing.lg, alignSelf: "stretch" },
  emptyCtaSecondary: { marginTop: Spacing.md, alignSelf: "stretch" },
  resumeCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    marginBottom: Spacing.lg,
    borderRadius: Radius.lg,
    backgroundColor: Colors.primary,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
  },
  resumePulse: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.16)",
  },
  resumeDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: Colors.accent },
  resumeEyebrow: {
    ...Typography.overline,
    color: Colors.accent,
    letterSpacing: 1.4,
  },
  resumeName: { ...Typography.headline, fontSize: 19, color: Colors.onPrimary, marginTop: 2 },
  resumeMeta: { ...Typography.subhead, color: "rgba(255,255,255,0.7)", marginTop: 2 },
  resumeButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 40,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.pill,
    backgroundColor: Colors.accent,
  },
  resumeButtonText: { ...Typography.callout, color: Colors.onPrimary, fontWeight: "700" },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    height: 50,
    marginTop: Spacing.lg,
    borderRadius: Radius.md,
    borderWidth: hairline,
    borderColor: Colors.borderStrong,
    backgroundColor: Colors.surface,
    paddingHorizontal: Spacing.lg,
  },
  searchBarText: { ...Typography.callout, color: Colors.textTertiary },
  nearbyCard: {
    marginTop: Spacing.lg,
    borderRadius: Radius.lg,
    borderWidth: hairline,
    borderColor: Colors.accent,
    backgroundColor: Colors.accentSoft,
    padding: Spacing.lg,
    gap: Spacing.sm,
  },
  nearbyPressed: { opacity: 0.85 },
  nearbyTop: { flexDirection: "row", alignItems: "center", gap: 6 },
  nearbyEyebrow: {
    ...Typography.overline,
    color: Colors.accent,
    letterSpacing: 1.2,
  },
  nearbyBody: { flexDirection: "row", alignItems: "center", gap: Spacing.md },
  nearbyName: { ...Typography.headline, fontSize: 20 },
  nearbyMeta: { ...Typography.subhead, color: Colors.textSecondary, marginTop: 2 },
  nearbyPlay: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 44,
    paddingHorizontal: Spacing.lg,
    borderRadius: Radius.pill,
    backgroundColor: Colors.accent,
  },
  nearbyPlayText: { ...Typography.callout, color: Colors.onAccent, fontWeight: "700" },
  suggestCard: {
    marginTop: Spacing.lg,
    borderRadius: Radius.lg,
    borderWidth: hairline,
    borderColor: Colors.gold,
    backgroundColor: Colors.goldSoft,
    padding: Spacing.lg,
    gap: Spacing.sm,
  },
  suggestTop: { flexDirection: "row", alignItems: "center", gap: 6 },
  suggestEyebrow: { ...Typography.overline, color: Colors.gold, letterSpacing: 1.2 },
  suggestBody: { flexDirection: "row", alignItems: "center", gap: Spacing.md },
  suggestName: { ...Typography.headline, fontSize: 20 },
  suggestMeta: { ...Typography.subhead, color: Colors.textSecondary, marginTop: 2 },
  suggestAdd: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 44,
    paddingHorizontal: Spacing.lg,
    borderRadius: Radius.pill,
    backgroundColor: Colors.primary,
  },
  suggestAddText: { ...Typography.callout, color: Colors.onPrimary, fontWeight: "700" },
  configCard: { marginTop: Spacing.lg, backgroundColor: Colors.goldSoft, borderColor: "transparent" },
  configTitle: { fontSize: 16, fontWeight: "700", color: Colors.primary, marginBottom: 6 },
  mono: { fontFamily: Fonts.serifSemibold, color: Colors.primary },
});
