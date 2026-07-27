import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { Check, Flag, MapPin, Plus, Search, X } from "lucide-react-native";
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { TeeButton } from "@/components/ui/TeeButton";
import { TeeCard } from "@/components/ui/TeeCard";
import { Colors, Fonts, Radius, Spacing, Typography, hairline } from "@/constants/theme";
import { useAuth } from "@/providers/AuthProvider";
import { fetchSavedExternalIds, importCatalogCourse } from "@/services/db";
import {
  courseDisplayName,
  courseHoleCount,
  courseLocationLabel,
  getGolfCourseDetail,
  normalizeCatalogCourse,
  POPULAR_COURSES,
  searchGolfCourses,
  type GolfApiCourse,
} from "@/services/golfApi";
import { isGolfApiConfigured } from "@/services/golfApiConfig";
import { notifySuccess, tapLight } from "@/utils/haptics";

export default function BrowseCoursesScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const [query, setQuery] = useState<string>("");
  const [debounced, setDebounced] = useState<string>("");
  const [importingId, setImportingId] = useState<number | null>(null);
  const [addedIds, setAddedIds] = useState<Set<number>>(new Set());

  // Courses already in this golfer's library, so a course they've saved before
  // shows as added even on a fresh visit.
  const savedQuery = useQuery({
    queryKey: ["saved-external-ids", user?.id],
    queryFn: () => {
      if (!user) return Promise.resolve([] as string[]);
      return fetchSavedExternalIds(user.id);
    },
    enabled: !!user,
  });
  const savedExternalIds = useMemo<Set<string>>(
    () => new Set(savedQuery.data ?? []),
    [savedQuery.data]
  );

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 400);
    return () => clearTimeout(t);
  }, [query]);

  const search = useQuery({
    queryKey: ["golf-search", debounced],
    queryFn: () => searchGolfCourses(debounced),
    enabled: isGolfApiConfigured && debounced.length >= 2,
    staleTime: 1000 * 60 * 5,
  });

  const importCourse = useMutation({
    mutationFn: async (course: GolfApiCourse): Promise<void> => {
      if (!user) throw new Error("You're not signed in.");
      // Search rows already embed the full scorecard, so we import straight
      // from them; only the rare row without holes needs a detail request.
      const full =
        courseHoleCount(course) > 0 ? course : await getGolfCourseDetail(course.id);
      const normalized = normalizeCatalogCourse(full);
      await importCatalogCourse({ ...normalized, createdBy: user.id });
    },
    onSuccess: (_data, course) => {
      notifySuccess();
      setAddedIds((prev) => {
        const next = new Set(prev);
        next.add(course.id);
        return next;
      });
      queryClient.invalidateQueries({ queryKey: ["courses", user?.id] });
      queryClient.invalidateQueries({ queryKey: ["saved-external-ids", user?.id] });
    },
    onSettled: () => setImportingId(null),
  });

  const isAdded = (course: GolfApiCourse): boolean =>
    addedIds.has(course.id) || savedExternalIds.has(String(course.id));

  const onAdd = (course: GolfApiCourse): void => {
    if (importCourse.isPending || isAdded(course)) return;
    setImportingId(course.id);
    importCourse.mutate(course);
  };

  const onPickPopular = (term: string): void => {
    tapLight();
    setQuery(term);
    setDebounced(term);
  };

  const results = useMemo<GolfApiCourse[]>(() => search.data ?? [], [search.data]);
  const importError =
    importCourse.isError && importCourse.error instanceof Error
      ? importCourse.error.message
      : null;

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + Spacing.sm }]}>
        <Pressable style={styles.headerClose} onPress={() => router.back()} hitSlop={8}>
          <X size={22} color={Colors.primary} strokeWidth={2.4} />
        </Pressable>
        <Text style={styles.headerTitle}>Find a course</Text>
        <View style={styles.headerSpacer} />
      </View>

      {/* Search bar */}
      <View style={styles.searchWrap}>
        <View style={styles.searchField}>
          <Search size={18} color={Colors.textTertiary} strokeWidth={2.4} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search 30,000+ courses"
            placeholderTextColor={Colors.textTertiary}
            selectionColor={Colors.accent}
            autoCapitalize="words"
            autoCorrect={false}
            returnKeyType="search"
            editable={isGolfApiConfigured}
            style={styles.searchInput}
          />
          {query.length > 0 ? (
            <Pressable onPress={() => setQuery("")} hitSlop={8}>
              <X size={16} color={Colors.textTertiary} strokeWidth={2.4} />
            </Pressable>
          ) : null}
        </View>
        {importError ? <Text style={styles.errorText}>{importError}</Text> : null}
      </View>

      {!isGolfApiConfigured ? (
        <NotConfigured />
      ) : debounced.length < 2 ? (
        <PopularBrowse onPick={onPickPopular} bottomInset={insets.bottom} />
      ) : (
        <FlatList
          data={results}
          keyExtractor={(item) => String(item.id)}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 24 }]}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => (
            <ResultRow
              course={item}
              added={isAdded(item)}
              loading={importingId === item.id && importCourse.isPending}
              onAdd={() => onAdd(item)}
            />
          )}
          ListEmptyComponent={
            <ResultsState
              loading={search.isLoading}
              error={search.isError}
              onRetry={() => search.refetch()}
            />
          }
        />
      )}
    </View>
  );
}

function PopularBrowse({
  onPick,
  bottomInset,
}: {
  onPick: (term: string) => void;
  bottomInset: number;
}) {
  return (
    <ScrollView
      contentContainerStyle={[styles.popularContent, { paddingBottom: bottomInset + 32 }]}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.bigIcon}>
        <Search size={28} color={Colors.accent} strokeWidth={2.2} />
      </View>
      <Text style={styles.stateTitle}>Find your course</Text>
      <Text style={styles.stateBody}>
        Search 30,000+ courses worldwide. Add one in a tap, then pin each green the first time you
        play it.
      </Text>
      <Text style={styles.popularLabel}>Popular</Text>
      <View style={styles.chipsWrap}>
        {POPULAR_COURSES.map((term) => (
          <Pressable
            key={term}
            style={styles.popularChip}
            onPress={() => onPick(term)}
            accessibilityRole="button"
          >
            <Flag size={13} color={Colors.accent} strokeWidth={2.6} />
            <Text style={styles.popularChipText}>{term}</Text>
          </Pressable>
        ))}
      </View>
    </ScrollView>
  );
}

function ResultRow({
  course,
  added,
  loading,
  onAdd,
}: {
  course: GolfApiCourse;
  added: boolean;
  loading: boolean;
  onAdd: () => void;
}) {
  const name = courseDisplayName(course);
  const location = courseLocationLabel(course);
  return (
    <TeeCard onPress={added ? undefined : onAdd} style={styles.row}>
      <View style={styles.rowLeft}>
        <Text style={styles.courseName} numberOfLines={2}>
          {name}
        </Text>
        {location ? (
          <View style={styles.locationRow}>
            <MapPin size={13} color={Colors.textTertiary} strokeWidth={2.4} />
            <Text style={styles.courseMeta} numberOfLines={1}>
              {location}
            </Text>
          </View>
        ) : null}
      </View>
      <View style={[styles.addBadge, added && styles.addBadgeDone]}>
        {loading ? (
          <ActivityIndicator color={added ? Colors.accent : Colors.onAccent} size="small" />
        ) : added ? (
          <Check size={18} color={Colors.accent} strokeWidth={2.8} />
        ) : (
          <Plus size={20} color={Colors.onAccent} strokeWidth={2.8} />
        )}
      </View>
    </TeeCard>
  );
}

function ResultsState({
  loading,
  error,
  onRetry,
}: {
  loading: boolean;
  error: boolean;
  onRetry: () => void;
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
        <Text style={styles.stateTitle}>Search failed</Text>
        <Text style={styles.stateBody}>The catalog didn&apos;t respond. Give it another go.</Text>
        <TeeButton label="Retry" variant="secondary" onPress={onRetry} style={styles.stateCta} />
      </View>
    );
  }
  return (
    <View style={styles.center}>
      <Text style={styles.stateTitle}>No matches</Text>
      <Text style={styles.stateBody}>
        Try a different spelling, or map it yourself from the Courses tab.
      </Text>
    </View>
  );
}

function NotConfigured() {
  return (
    <View style={styles.configWrap}>
      <TeeCard style={styles.configCard}>
        <Text style={styles.configTitle}>Add your catalog key</Text>
        <Text style={styles.stateBody}>
          Paste a free GolfCourseAPI key into{" "}
          <Text style={styles.mono}>EXPO_PUBLIC_GOLF_COURSE_API_KEY</Text> to search 30,000+
          courses. Until then, you can still map courses by hand.
        </Text>
      </TeeCard>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },

  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.md,
  },
  headerClose: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: { ...Typography.headline, flex: 1, textAlign: "center" },
  headerSpacer: { width: 40 },

  searchWrap: { paddingHorizontal: Spacing.xl, paddingBottom: Spacing.md, gap: Spacing.sm },
  searchField: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    height: 52,
    borderRadius: Radius.md,
    borderWidth: hairline,
    borderColor: Colors.borderStrong,
    backgroundColor: Colors.surface,
    paddingHorizontal: Spacing.lg,
  },
  searchInput: { flex: 1, fontSize: 17, color: Colors.textPrimary, paddingVertical: 0 },
  errorText: { ...Typography.subhead, color: Colors.danger, marginLeft: 2 },

  list: { paddingHorizontal: Spacing.xl, gap: Spacing.md, flexGrow: 1 },
  row: { flexDirection: "row", alignItems: "center", gap: Spacing.md },
  rowLeft: { flex: 1, gap: 6 },
  courseName: { ...Typography.headline, fontSize: 18 },
  locationRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  courseMeta: { ...Typography.subhead, color: Colors.textTertiary, flex: 1 },
  addBadge: {
    width: 46,
    height: 46,
    borderRadius: Radius.pill,
    backgroundColor: Colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  addBadgeDone: { backgroundColor: Colors.accentSoft },

  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingTop: Spacing.xxxl,
    paddingHorizontal: Spacing.xl,
    gap: Spacing.sm,
  },
  bigIcon: {
    width: 64,
    height: 64,
    borderRadius: Radius.pill,
    backgroundColor: Colors.accentSoft,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing.sm,
  },
  stateTitle: { ...Typography.title, fontSize: 22, textAlign: "center" },
  stateBody: {
    ...Typography.body,
    color: Colors.textSecondary,
    textAlign: "center",
    lineHeight: 22,
  },
  stateCta: { marginTop: Spacing.lg, minWidth: 180 },

  popularContent: {
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.xxl,
    alignItems: "center",
    flexGrow: 1,
  },
  popularLabel: {
    ...Typography.overline,
    alignSelf: "stretch",
    marginTop: Spacing.xxl,
    marginBottom: Spacing.md,
  },
  chipsWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: Spacing.sm,
  },
  popularChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingVertical: 10,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.pill,
    borderWidth: hairline,
    borderColor: Colors.borderStrong,
    backgroundColor: Colors.surface,
  },
  popularChipText: { ...Typography.callout, color: Colors.primary, fontWeight: "600" },

  configWrap: { paddingHorizontal: Spacing.xl, paddingTop: Spacing.md },
  configCard: { backgroundColor: Colors.goldSoft, borderColor: "transparent" },
  configTitle: { fontSize: 16, fontWeight: "700", color: Colors.primary, marginBottom: 6 },
  mono: { fontFamily: Fonts.serifSemibold, color: Colors.primary },
});
