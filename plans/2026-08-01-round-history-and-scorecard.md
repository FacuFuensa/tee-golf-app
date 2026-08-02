# Round History, Per-Hole Bests and Shareable Scorecards — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a golfer delete one round from history, open any round to see it hole by hole, see their previous best while replaying a hole, and export a round as a shareable image.

**Architecture:** Deletion goes through a single `SECURITY DEFINER` Postgres function because the decision "should the round row itself die?" depends on state the deletion itself changes, and cannot be made atomically from the client. Everything else is read-side: the history detail screen and the per-hole bests reuse queries that already exist or add one narrow course-scoped query. Scorecard export renders ordinary React Native views and captures them to PNG, so the cards stay styled with the app's own theme tokens.

**Tech Stack:** Expo SDK 54, React Native 0.81.5, React 19.1.0, expo-router 6, Supabase (Postgres + RLS), TanStack Query 5, `react-native-gesture-handler` 2.28 (already installed), `react-native-view-shot` (new).

**Spec:** `specs/2026-08-01-round-history-and-scorecard-design.md`

## Global Constraints

- Ships as **1.1.0**. Version 1.0.0 is in App Store review — do not touch `version` in `app.json` until review resolves.
- Migration `0013` must be applied to Supabase **before** any build that calls `delete_my_round` is submitted.
- Do **not** add `react-native-reanimated`. It was deliberately removed during App Store cleanup. Use the legacy `Swipeable`, verified present at `react-native-gesture-handler@2.28.0` `index.d.ts:53`.
- Do **not** add `eas-cli` as a dependency — expo-doctor rejects it. Use `npx --yes eas-cli@latest`.
- Do **not** commit the demo password. It lives only in gitignored `expo/store/.demo-credentials`.
- Never write a `0` into a scorecard cell for an unscored hole. Blank only.
- All new user-facing copy is in English, matching the rest of the app.
- Work on a branch. The repo is currently on `main`.
- Run `npx tsc --noEmit` before every commit. It is the only reliable validator for `lucide-react-native` icon names, which are aliased and cannot be checked by filename.

---

## File Structure

**Create:**
- `expo/supabase/migrations/0013_delete_single_round.sql` — the deletion function
- `expo/utils/scorecard.ts` — pure scorecard aggregation (nines, totals, blanks)
- `expo/utils/capture.ts` — isolates the native view-shot dependency
- `expo/app/history/[roundId].tsx` — round detail screen
- `expo/components/scorecard/ScorecardCard.tsx` — hole-by-hole grid, 4:5
- `expo/components/scorecard/SummaryCard.tsx` — big total + breakdown, 1:1
- `expo/components/scorecard/GroupCard.tsx` — one line per player, 4:5
- `expo/components/scorecard/ShareRoundSheet.tsx` — tabs, preview, capture, share
- `expo/store/verify-scorecard.mjs` — pure-logic tests for `utils/scorecard.ts`

**Modify:**
- `expo/services/db.ts` — add `deleteMyRound`, `fetchHoleBests`
- `expo/utils/stats.ts` — add `isMultiplayer` to `RoundSummary`
- `expo/app/(tabs)/stats.tsx:298-339` — swipeable rows, delete mutation, navigation
- `expo/app/round/[id].tsx` — hole bests query + render; Finish navigates to detail
- `expo/app/_layout.tsx:69` — register the `history/[roundId]` route
- `expo/store/verify-backend.mjs` — deletion checks; fix the broken cleanup
- `expo/package.json` — add `react-native-view-shot`, add `verify:scorecard` script

---

## Task 1: Deletion function and backend verification

**Files:**
- Create: `expo/supabase/migrations/0013_delete_single_round.sql`
- Modify: `expo/store/verify-backend.mjs` (append before the final `signOut`)

**Interfaces:**
- Consumes: nothing.
- Produces: Postgres function `public.delete_my_round(p_round_id uuid) returns text`, returning exactly one of `'deleted'`, `'left'`, `'not_found'`.

**Context the implementer needs:** `verify-backend.mjs` signs in as the demo account using `expo/store/.demo-credentials` and exposes a `check(label, ok, detail)` helper that increments a `failures` counter. `populate-leaderboard.mjs:74` shows the established way to create a second real player — `supabase.auth.signUp({ email, password })` returns a session directly because email confirmation is off on this project. Reuse that pattern; do not use a service-role key.

- [ ] **Step 1: Write the failing checks**

Append to `expo/store/verify-backend.mjs`, immediately before the final `await supabase.auth.signOut();`:

```js
console.log("\nSingle-round deletion (migration 0013):");

// A helper that builds a real, scored round owned by the demo account.
async function makeRound({ multiplayer }) {
  const { data: lib } = await supabase
    .from("user_courses")
    .select("course_id")
    .eq("profile_id", uid)
    .limit(1);
  const courseId = lib?.[0]?.course_id;
  if (!courseId) throw new Error("demo account has no course in its library");

  const { data: holes } = await supabase
    .from("holes")
    .select("id")
    .eq("course_id", courseId)
    .order("number")
    .limit(3);

  const roundId = crypto.randomUUID();
  const code = multiplayer
    ? Array.from({ length: 6 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 32)]).join("")
    : null;

  await supabase.from("rounds").insert({
    id: roundId,
    course_id: courseId,
    owner_id: uid,
    format: "stroke",
    is_multiplayer: multiplayer,
    join_code: code,
    started_at: new Date().toISOString(),
  });
  await supabase.from("round_players").insert({ round_id: roundId, profile_id: uid });
  await supabase.from("scores").insert(
    holes.map((h) => ({ round_id: roundId, profile_id: uid, hole_id: h.id, strokes: 4 }))
  );
  return { roundId, courseId, code, holeIds: holes.map((h) => h.id) };
}

// 1. Solo round deletes completely.
{
  const { roundId } = await makeRound({ multiplayer: false });
  const { data: result, error } = await supabase.rpc("delete_my_round", { p_round_id: roundId });
  check("solo round returns 'deleted'", error == null && result === "deleted", error?.message ?? `got ${result}`);

  const { count: roundsLeft } = await supabase
    .from("rounds").select("id", { count: "exact", head: true }).eq("id", roundId);
  check("solo round row is gone", roundsLeft === 0, `${roundsLeft} row(s) remain`);

  const { count: scoresLeft } = await supabase
    .from("scores").select("id", { count: "exact", head: true }).eq("round_id", roundId);
  check("its scores are gone", scoresLeft === 0, `${scoresLeft} score(s) remain`);
}

// 2 & 3. Group round with a second real player.
{
  const { roundId, code, holeIds } = await makeRound({ multiplayer: true });

  const guestEmail = `tee-delete-probe-${Date.now()}@example.com`;
  const guest = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const signUp = await guest.auth.signUp({ email: guestEmail, password: "TeeProbe!2026x" });
  if (!signUp.data.session) {
    check("could create a second player", false, signUp.error?.message ?? "no session returned");
  } else {
    const guestId = signUp.data.user.id;
    await guest.from("profiles").upsert({ id: guestId, display_name: "Probe" });
    await guest.rpc("join_round_by_code", { p_code: code });
    await guest.from("scores").insert({
      round_id: roundId, profile_id: guestId, hole_id: holeIds[0], strokes: 5,
    });

    // The owner leaves a round another player is seated in.
    const { data: result, error } = await supabase.rpc("delete_my_round", { p_round_id: roundId });
    check("group round returns 'left'", error == null && result === "left", error?.message ?? `got ${result}`);

    const { count: mine } = await supabase
      .from("scores").select("id", { count: "exact", head: true })
      .eq("round_id", roundId).eq("profile_id", uid);
    check("the leaver's scores are gone", mine === 0, `${mine} remain`);

    const { count: theirs } = await guest
      .from("scores").select("id", { count: "exact", head: true })
      .eq("round_id", roundId).eq("profile_id", guestId);
    check("the other player's scores survive", theirs === 1, `${theirs} found, expected 1`);

    const { data: after } = await guest.from("rounds").select("owner_id").eq("id", roundId).maybeSingle();
    check("the round survives for them", after != null, after ? "still there" : "round was destroyed");
    check(
      "ownership transferred to the remaining player",
      after?.owner_id === guestId,
      `owner_id=${String(after?.owner_id).slice(0, 8)}…`
    );

    // 4. A non-member gets 'not_found' and changes nothing.
    const { roundId: privateId } = await makeRound({ multiplayer: false });
    const { data: denied, error: deniedErr } = await guest.rpc("delete_my_round", { p_round_id: privateId });
    check("a non-member gets 'not_found'", deniedErr == null && denied === "not_found", deniedErr?.message ?? `got ${denied}`);
    const { count: survived } = await supabase
      .from("rounds").select("id", { count: "exact", head: true }).eq("id", privateId);
    check("and the round they targeted is untouched", survived === 1, `${survived} row(s)`);

    await supabase.rpc("delete_my_round", { p_round_id: privateId });
    await guest.rpc("delete_my_round", { p_round_id: roundId });
    await guest.auth.signOut();
  }
}

// 5. Anonymous callers are rejected.
{
  const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await anon.rpc("delete_my_round", { p_round_id: crypto.randomUUID() });
  check("anonymous callers are rejected", error != null, error ? error.message.slice(0, 60) : "it succeeded");
}
```

- [ ] **Step 2: Run the checks and verify they fail**

```bash
cd "C:/Claude Webs/tee-golf-app/expo" && node store/verify-backend.mjs
```

Expected: the new block fails with `Could not find the function public.delete_my_round`. Earlier checks still pass.

- [ ] **Step 3: Write the migration**

Create `expo/supabase/migrations/0013_delete_single_round.sql`:

```sql
-- Delete a single round from the caller's history.
--
-- WHY A FUNCTION AND NOT A DELETE POLICY: removing a round means deleting the
-- caller's scores, releasing their seat, and THEN deciding whether the round
-- row should die — a decision that depends on state the first two steps just
-- changed. Split into separate client calls that is not atomic: another player
-- can take a seat between the check and the delete, and the client would
-- destroy their round based on a stale read. A function runs whole or not at
-- all. This also matches delete_my_data / join_round_by_code, which are
-- SECURITY DEFINER for the same reason.

create or replace function public.delete_my_round(p_round_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  v_is_member boolean;
  v_is_owner boolean;
  v_others_seated boolean;
  v_next_owner uuid;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  select exists (
    select 1 from public.round_players
    where round_id = p_round_id and profile_id = uid
  ) into v_is_member;

  -- Deliberately does not distinguish "no such round" from "not yours", so a
  -- caller cannot probe for other people's rounds.
  if not v_is_member then
    return 'not_found';
  end if;

  select (owner_id = uid) into v_is_owner
    from public.rounds where id = p_round_id;

  delete from public.scores
   where round_id = p_round_id and profile_id = uid;

  delete from public.round_players
   where round_id = p_round_id and profile_id = uid;

  select exists (
    select 1 from public.round_players where round_id = p_round_id
  ) into v_others_seated;

  -- Nobody else is seated, so nothing of anyone else's is lost. This is what
  -- stops a solo round — or a group round nobody joined — leaving a ghost.
  if not v_others_seated then
    delete from public.rounds where id = p_round_id;
    return 'deleted';
  end if;

  -- rounds_update_owner requires owner_id = auth.uid(), so a group round whose
  -- owner walked away could never be finished by anyone. Hand it to the
  -- earliest-joined survivor. profile_id breaks joined_at ties deterministically.
  if coalesce(v_is_owner, false) then
    select profile_id into v_next_owner
      from public.round_players
     where round_id = p_round_id
     order by joined_at asc, profile_id asc
     limit 1;

    if v_next_owner is not null then
      update public.rounds set owner_id = v_next_owner where id = p_round_id;
    end if;
  end if;

  return 'left';
end;
$$;

revoke all on function public.delete_my_round(uuid) from public, anon;
grant execute on function public.delete_my_round(uuid) to authenticated;
```

- [ ] **Step 4: Apply the migration**

This is a manual step — paste the file's contents into the Supabase SQL editor for project `ilrkgprannppoyjibnrw` and run it. There is no local Postgres in this project.

- [ ] **Step 5: Run the checks and verify they pass**

```bash
cd "C:/Claude Webs/tee-golf-app/expo" && node store/verify-backend.mjs
```

Expected: `All checks passed.` and exit 0. If "ownership transferred" fails, the `order by` clause is the place to look.

- [ ] **Step 6: Fix the pre-existing broken cleanup**

The probe cleanup at the end of the `join_round_by_code` block does `delete from rounds` and asserts only `cleanupErr == null`. With no DELETE policy that deletes **zero rows and returns no error**, so this check has been passing while leaving an orphan round and its scores behind on every run. Replace it:

```js
  const { data: cleanupResult, error: cleanupErr } = await supabase.rpc("delete_my_round", {
    p_round_id: probeRoundId,
  });
  check(
    "probe round cleaned up",
    cleanupErr == null && cleanupResult === "deleted",
    cleanupErr?.message ?? `returned ${cleanupResult}`
  );
```

Delete the three preceding manual `supabase.from(...).delete()` lines for `scores`, `round_players` and `rounds` — the function does all of it.

- [ ] **Step 7: Sweep the orphans that bug already left**

```bash
cd "C:/Claude Webs/tee-golf-app/expo" && node -e "console.log('Run this SQL in Supabase to see the damage:')" && echo "select r.id, r.started_at from rounds r where r.join_code is not null and r.finished_at is null order by r.started_at;"
```

Inspect the result. Delete any round whose `started_at` matches a past verification run. Do not delete rounds belonging to the demo account's seeded history (79/85/89) — those are the App Store reviewer's data.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/0013_delete_single_round.sql store/verify-backend.mjs && git commit -m "feat: delete a single round, and fix the cleanup that never deleted anything"
```

---

## Task 2: Client deletion and swipe-to-delete in history

**Files:**
- Modify: `expo/services/db.ts` (append to the "Account & data deletion" section)
- Modify: `expo/utils/stats.ts:32-42, 83-99`
- Modify: `expo/app/(tabs)/stats.tsx:298-339`

**Interfaces:**
- Consumes: `delete_my_round` from Task 1.
- Produces: `deleteMyRound(roundId: string): Promise<DeleteRoundResult>` where `DeleteRoundResult = "deleted" | "left" | "not_found"`; `RoundSummary.isMultiplayer: boolean`.

- [ ] **Step 1: Add the client function**

In `expo/services/db.ts`, after `deleteMyAccount`:

```ts
export type DeleteRoundResult = "deleted" | "left" | "not_found";

/**
 * Remove one round from the caller's history. In a group round where other
 * players are still seated this removes only the caller ("left"); otherwise the
 * round itself is deleted ("deleted"). See migration 0013 for why this is a
 * function rather than a plain delete.
 */
export async function deleteMyRound(roundId: string): Promise<DeleteRoundResult> {
  const { data, error } = await supabase.rpc("delete_my_round", { p_round_id: roundId });
  if (error) throw error;
  const value = Array.isArray(data) ? data[0] : data;
  return (value as DeleteRoundResult) ?? "not_found";
}
```

- [ ] **Step 2: Carry `is_multiplayer` into the summary**

The confirmation copy depends on it and `RoundSummary` does not have it today.

In `expo/utils/stats.ts`, add to the `RoundSummary` interface after `toParPer18`:

```ts
  /** Drives the delete confirmation copy: leaving vs deleting. */
  isMultiplayer: boolean;
```

And in `summarize()`, add to the returned object after `toParPer18`:

```ts
    isMultiplayer: round.round.is_multiplayer,
```

- [ ] **Step 3: Verify types still compile**

```bash
cd "C:/Claude Webs/tee-golf-app/expo" && npx tsc --noEmit
```

Expected: clean. A failure here means another construction site for `RoundSummary` exists — find and fix it.

- [ ] **Step 4: Replace `RoundLog` with swipeable rows**

In `expo/app/(tabs)/stats.tsx`, add to the imports:

```tsx
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { Award, BarChart3, Flag, Target, Trash2, TrendingDown } from "lucide-react-native";
import React, { useMemo, useRef } from "react";
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { Swipeable } from "react-native-gesture-handler";

import { deleteMyRound, fetchPlayerRounds } from "@/services/db";
import { notifySuccess, tapLight } from "@/utils/haptics";
```

Replace the whole `RoundLog` function (lines 298-339) with:

```tsx
function RoundLog({
  rounds,
  onOpen,
  onDelete,
}: {
  rounds: RoundSummary[];
  onOpen: (roundId: string) => void;
  onDelete: (round: RoundSummary) => void;
}) {
  return (
    <View style={styles.logSection}>
      <Text style={styles.sectionLabel}>Round history</Text>
      <Text style={styles.logHint}>Swipe a round to remove it, or hold to open the same menu.</Text>
      <TeeCard padded={false} style={styles.logCard}>
        {rounds.map((round, index) => (
          <View key={round.id}>
            {index > 0 ? <View style={styles.logDivider} /> : null}
            <RoundRow round={round} onOpen={() => onOpen(round.id)} onDelete={() => onDelete(round)} />
          </View>
        ))}
      </TeeCard>
    </View>
  );
}

function RoundRow({
  round,
  onOpen,
  onDelete,
}: {
  round: RoundSummary;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const swipeRef = useRef<Swipeable>(null);
  const verb = round.isMultiplayer ? "Leave" : "Delete";

  // Swiping is invisible to VoiceOver, so a destructive action that exists only
  // in the swipe is unreachable for some golfers. Long-press opens the same
  // confirmation, and the detail screen carries the action too.
  const confirm = (): void => {
    swipeRef.current?.close();
    Alert.alert(
      round.isMultiplayer ? "Leave this round?" : "Delete this round?",
      round.isMultiplayer
        ? "Your scores will be erased and it will disappear from your statistics. If other players are in it, the round stays for them."
        : "Your scores for all holes will be erased and it will disappear from your statistics. This can't be undone.",
      [
        { text: "Cancel", style: "cancel" },
        { text: verb, style: "destructive", onPress: onDelete },
      ]
    );
  };

  return (
    <Swipeable
      ref={swipeRef}
      friction={2}
      rightThreshold={40}
      overshootRight={false}
      renderRightActions={() => (
        <Pressable
          style={styles.swipeAction}
          onPress={confirm}
          accessibilityRole="button"
          accessibilityLabel={`${verb} this round`}
        >
          <Trash2 size={19} color={Colors.onAccent} strokeWidth={2.4} />
          <Text style={styles.swipeActionText}>{verb}</Text>
        </Pressable>
      )}
    >
      <Pressable
        style={styles.logRow}
        onPress={() => {
          tapLight();
          onOpen();
        }}
        onLongPress={confirm}
        delayLongPress={400}
        accessibilityRole="button"
        accessibilityLabel={`${round.courseName}, ${formatDate(round.date)}, ${round.strokes} strokes`}
        accessibilityHint={`Opens the round hole by hole. Double tap and hold to ${verb.toLowerCase()} it.`}
      >
        <View style={styles.logLeft}>
          <Text style={styles.logName} numberOfLines={1}>
            {round.courseName}
          </Text>
          <Text style={styles.logMeta}>
            {formatDate(round.date)} · {round.holesPlayed} holes
          </Text>
        </View>
        <View style={styles.logRight}>
          <Text style={styles.logStrokes}>{round.strokes}</Text>
          <View
            style={[
              styles.logBadge,
              { backgroundColor: round.toPar <= 0 ? Colors.accentSoft : Colors.dangerSoft },
            ]}
          >
            <Text
              style={[
                styles.logBadgeText,
                { color: round.toPar <= 0 ? Colors.accent : Colors.danger },
              ]}
            >
              {formatToPar(round.toPar)}
            </Text>
          </View>
        </View>
      </Pressable>
    </Swipeable>
  );
}
```

- [ ] **Step 5: Add the styles**

In the same file's `StyleSheet.create`, replace the `logCard` and `logRow` entries and add three new ones:

```tsx
  logHint: { ...Typography.subhead, color: Colors.textTertiary, marginLeft: 2, marginTop: -6 },
  // overflow hidden so the red action is clipped by the card's rounded corners
  logCard: { paddingHorizontal: 0, overflow: "hidden" },
  logRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    gap: Spacing.md,
    // opaque, so the row slides over the action instead of showing through it
    backgroundColor: Colors.surface,
  },
  swipeAction: {
    width: 92,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    backgroundColor: Colors.danger,
  },
  swipeActionText: { ...Typography.caption, color: Colors.onAccent, fontWeight: "700" },
```

- [ ] **Step 6: Wire the mutation into `StatsScreen`**

Add inside `StatsScreen`, after `roundsQuery`:

```tsx
  const router = useRouter();
  const queryClient = useQueryClient();

  const deleteRound = useMutation({
    mutationFn: (roundId: string) => deleteMyRound(roundId),
    onSuccess: (result) => {
      if (result === "not_found") {
        Alert.alert("Round not found", "This round is no longer in your history.");
      } else {
        notifySuccess();
      }
      queryClient.invalidateQueries({ queryKey: ["player-rounds"] });
    },
    onError: () => {
      Alert.alert(
        "Couldn't remove the round",
        "It's still in your history. Check your connection and try again."
      );
    },
  });
```

Nothing is removed optimistically: on failure the row simply stays, which is the honest state.

Change the `StatsBody` call site to pass the handlers through. Update `StatsBody`'s signature and its `RoundLog` usage:

```tsx
function StatsBody({
  stats,
  onOpenRound,
  onDeleteRound,
}: {
  stats: PlayerStats;
  onOpenRound: (roundId: string) => void;
  onDeleteRound: (round: RoundSummary) => void;
}) {
```

and

```tsx
      <RoundLog rounds={stats.rounds} onOpen={onOpenRound} onDelete={onDeleteRound} />
```

and in `StatsScreen`'s render:

```tsx
          <StatsBody
            stats={stats}
            onOpenRound={(roundId) => router.push(`/history/${roundId}`)}
            onDeleteRound={(round) => deleteRound.mutate(round.id)}
          />
```

- [ ] **Step 7: Typecheck and lint**

```bash
cd "C:/Claude Webs/tee-golf-app/expo" && npx tsc --noEmit && npx expo lint
```

Expected: both clean. The route `/history/[roundId]` does not exist yet, so tapping a row does nothing until Task 4 registers it. That is expected: this task's own deliverable — swipe and hold to remove a round — works on its own.

- [ ] **Step 8: Commit**

```bash
git add services/db.ts utils/stats.ts "app/(tabs)/stats.tsx" && git commit -m "feat: swipe or hold a round in history to remove it"
```

---

## Task 3: Scorecard aggregation (pure logic)

**Files:**
- Create: `expo/utils/scorecard.ts`
- Create: `expo/store/verify-scorecard.mjs`
- Modify: `expo/package.json` (scripts)

**Interfaces:**
- Consumes: `Hole` from `@/types/models`; `classifyHole`, `ScoreClass` from `@/utils/stats`.
- Produces: `buildScorecard(holes: Hole[], scoresByHoleId: Record<string, number>): ScorecardData` and `countByClass(data: ScorecardData): Record<ScoreClass, number>`. Types `ScorecardCell`, `ScorecardNine`, `ScorecardData`.

**Why a compile-then-import test:** this project has no test runner and uses executable verification scripts. `utils/scorecard.ts` uses the `@/` path alias and TypeScript types, so the script compiles it to a temp directory first — the same technique already proven on `utils/caddy.ts`.

- [ ] **Step 1: Write the failing test**

Create `expo/store/verify-scorecard.mjs`:

```js
/**
 * Tests the pure scorecard aggregation. The interesting cases are the ones a
 * screenshot would not catch: a 9-hole round must not render an IN row, and an
 * unscored hole must produce a blank cell rather than a 0 — a 0 in a scorecard
 * column reads as a score, and the exported image would be a lie.
 *
 *   node store/verify-scorecard.mjs
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "scorecard-"));

// Strip the @/ aliases and the type-only import so tsc can compile in isolation.
writeFileSync(
  join(dir, "scorecard.ts"),
  readFileSync("utils/scorecard.ts", "utf8")
    .replace(/import type \{ Hole \} from "@\/types\/models";/, "type Hole = { id: string; course_id: string; number: number; par: number; green_lat: number | null; green_lng: number | null; yardage: number | null };")
    .replace(/from "\.\/stats"/, 'from "./stats"')
);
writeFileSync(
  join(dir, "stats.ts"),
  readFileSync("utils/stats.ts", "utf8")
    .replace(/import type \{ PlayedHole, PlayedRound \} from "@\/services\/db";/, "type PlayedHole = { number: number; par: number; strokes: number }; type PlayedRound = { round: { id: string; started_at: string; finished_at: string | null; is_multiplayer: boolean }; courseName: string; holes: PlayedHole[] };")
);
execFileSync(
  "npx",
  ["tsc", join(dir, "scorecard.ts"), join(dir, "stats.ts"), "--target", "es2020", "--module", "es2020", "--moduleResolution", "node", "--outDir", dir],
  { stdio: "pipe", shell: true }
);
writeFileSync(join(dir, "package.json"), JSON.stringify({ type: "module" }));
writeFileSync(
  join(dir, "scorecard.js"),
  readFileSync(join(dir, "scorecard.js"), "utf8").replace(/from "\.\/stats"/g, 'from "./stats.js"')
);

const { buildScorecard, countByClass } = await import(
  "file://" + join(dir, "scorecard.js").replace(/\\/g, "/")
);

let failures = 0;
function check(label, ok, detail) {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? " — " + detail : ""}`);
  if (!ok) failures++;
}

/** Builds n holes, par 4 each unless overridden. */
function holes(n, pars) {
  return Array.from({ length: n }, (_, i) => ({
    id: `h${i + 1}`,
    course_id: "c",
    number: i + 1,
    par: pars?.[i] ?? 4,
    green_lat: null,
    green_lng: null,
    yardage: null,
  }));
}

console.log("Eighteen holes, fully scored:");
{
  const h = holes(18);
  const scores = Object.fromEntries(h.map((x) => [x.id, 5]));
  const card = buildScorecard(h, scores);
  check("splits into two nines", card.nines.length === 2, `${card.nines.length}`);
  check("labels them OUT and IN", card.nines[0].label === "OUT" && card.nines[1].label === "IN");
  check("course par is 72", card.coursePar === 72, `${card.coursePar}`);
  check("total strokes is 90", card.totalStrokes === 90, `${card.totalStrokes}`);
  check("to par is +18", card.toPar === 18, `${card.toPar}`);
  check("OUT strokes is 45", card.nines[0].strokes === 45, `${card.nines[0].strokes}`);
}

console.log("\nNine holes:");
{
  const h = holes(9);
  const card = buildScorecard(h, Object.fromEntries(h.map((x) => [x.id, 4])));
  check("produces a single nine", card.nines.length === 1, `${card.nines.length}`);
  check("labelled OUT, never IN", card.nines[0].label === "OUT", card.nines[0].label);
  check("to par is even", card.toPar === 0, `${card.toPar}`);
}

console.log("\nA partial round — the case that must not lie:");
{
  const h = holes(18);
  // Only the first five holes were scored; hole 3 was explicitly left at 0.
  const scores = { h1: 4, h2: 5, h3: 0, h4: 6, h5: 3 };
  const card = buildScorecard(h, scores);
  check("counts only scored holes", card.holesScored === 4, `${card.holesScored}`);
  check("a 0 becomes a blank, not a zero", card.nines[0].cells[2].strokes === null, String(card.nines[0].cells[2].strokes));
  check("an absent hole is blank", card.nines[0].cells[8].strokes === null, String(card.nines[0].cells[8].strokes));
  check("total counts only what was scored", card.totalStrokes === 18, `${card.totalStrokes}`);
  check("to par uses only scored holes' par", card.toPar === 2, `${card.toPar} (18 strokes vs 16 par)`);
  check("course par still reflects the whole course", card.coursePar === 72, `${card.coursePar}`);
}

console.log("\nOrdering and classification:");
{
  const h = holes(3, [3, 5, 4]).reverse();
  const card = buildScorecard(h, { h1: 2, h2: 7, h3: 4 });
  check("cells sort by hole number", card.nines[0].cells.map((c) => c.number).join(",") === "1,2,3");
  const counts = countByClass(card);
  check("a 2 on a par 3 is a birdie", counts.birdie === 1, JSON.stringify(counts));
  check("a 7 on a par 5 is a double", counts.double === 1, JSON.stringify(counts));
  check("a 4 on a par 4 is a par", counts.par === 1, JSON.stringify(counts));
}

console.log(`\n${failures === 0 ? "All checks passed." : failures + " check(s) failed."}`);
process.exit(failures > 0 ? 1 : 0);
```

- [ ] **Step 2: Run it and verify it fails**

```bash
cd "C:/Claude Webs/tee-golf-app/expo" && node store/verify-scorecard.mjs
```

Expected: fails reading `utils/scorecard.ts` — the file does not exist.

- [ ] **Step 3: Write the implementation**

Create `expo/utils/scorecard.ts`:

```ts
import type { Hole } from "@/types/models";

import { classifyHole, type ScoreClass } from "./stats";

/**
 * Turns a round's holes and scores into the shape a printed scorecard has.
 * Kept pure and free of React so it can be tested directly and shared by the
 * detail screen and all three share cards.
 */

export interface ScorecardCell {
  number: number;
  par: number;
  /** null when the hole was never scored. Never 0 — a 0 reads as a score. */
  strokes: number | null;
}

export interface ScorecardNine {
  label: "OUT" | "IN";
  cells: ScorecardCell[];
  /** Par for every hole in this nine, scored or not — a fact about the course. */
  par: number;
  strokes: number;
}

export interface ScorecardData {
  nines: ScorecardNine[];
  /** Par of the whole course, as printed on the card. */
  coursePar: number;
  /** Par of only the holes actually scored. The basis for `toPar`. */
  scoredPar: number;
  totalStrokes: number;
  /** Strokes minus par over scored holes only, so a partial round reads honestly. */
  toPar: number;
  holesScored: number;
}

export function buildScorecard(
  holes: Hole[],
  scoresByHoleId: Record<string, number>
): ScorecardData {
  const cells: ScorecardCell[] = [...holes]
    .sort((a, b) => a.number - b.number)
    .map((h) => {
      const raw = scoresByHoleId[h.id] ?? 0;
      return { number: h.number, par: h.par, strokes: raw > 0 ? raw : null };
    });

  // Built from the holes that exist, never from an assumed 18: a nine-hole
  // round gets one nine labelled OUT and no IN row at all.
  const chunks = cells.length > 9 ? [cells.slice(0, 9), cells.slice(9)] : [cells];
  const nines: ScorecardNine[] = chunks.map((chunk, index) => ({
    label: index === 0 ? "OUT" : "IN",
    cells: chunk,
    par: chunk.reduce((sum, c) => sum + c.par, 0),
    strokes: chunk.reduce((sum, c) => sum + (c.strokes ?? 0), 0),
  }));

  const scored = cells.filter((c): c is ScorecardCell & { strokes: number } => c.strokes != null);
  const totalStrokes = scored.reduce((sum, c) => sum + c.strokes, 0);
  const scoredPar = scored.reduce((sum, c) => sum + c.par, 0);

  return {
    nines,
    coursePar: cells.reduce((sum, c) => sum + c.par, 0),
    scoredPar,
    totalStrokes,
    toPar: totalStrokes - scoredPar,
    holesScored: scored.length,
  };
}

/** Birdie/par/bogey counts for the summary card, reusing the app's own buckets. */
export function countByClass(data: ScorecardData): Record<ScoreClass, number> {
  const counts: Record<ScoreClass, number> = {
    eagle: 0,
    birdie: 0,
    par: 0,
    bogey: 0,
    double: 0,
    triple: 0,
  };
  for (const nine of data.nines) {
    for (const cell of nine.cells) {
      if (cell.strokes == null) continue;
      counts[classifyHole({ number: cell.number, par: cell.par, strokes: cell.strokes })] += 1;
    }
  }
  return counts;
}
```

- [ ] **Step 4: Run it and verify it passes**

```bash
cd "C:/Claude Webs/tee-golf-app/expo" && node store/verify-scorecard.mjs
```

Expected: `All checks passed.` and exit 0.

- [ ] **Step 5: Add the script and typecheck**

In `expo/package.json`, after `"verify:backend"`:

```json
    "verify:scorecard": "node store/verify-scorecard.mjs",
```

```bash
cd "C:/Claude Webs/tee-golf-app/expo" && npx tsc --noEmit
```

Expected: clean. `utils/scorecard.ts` has no consumers yet — Task 4 is the first.

- [ ] **Step 6: Commit**

```bash
git add utils/scorecard.ts store/verify-scorecard.mjs package.json && git commit -m "feat: scorecard aggregation, with blanks for unscored holes"
```

---

## Task 4: Round detail screen

**Files:**
- Create: `expo/app/history/[roundId].tsx`
- Modify: `expo/app/_layout.tsx:69`
- Modify: `expo/app/round/[id].tsx` (the `finish` mutation, around line 194)

**Interfaces:**
- Consumes: `buildScorecard`, `ScorecardCell` from `@/utils/scorecard` (Task 3); `fetchRoundBundle`, `fetchLeaderboard` from `@/services/db`; `deleteMyRound` from Task 2; `classifyHole`, `formatToPar` from `@/utils/stats`.
- Produces: route `/history/[roundId]`. Task 7 adds a share button to this screen.

- [ ] **Step 1: Register the route**

In `expo/app/_layout.tsx`, after the `round/[id]` line:

```tsx
      <Stack.Screen name="history/[roundId]" options={{ animation: "slide_from_right" }} />
```

- [ ] **Step 2: Create the screen**

Create `expo/app/history/[roundId].tsx`:

```tsx
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ChevronLeft, Trash2, Users } from "lucide-react-native";
import React, { useMemo } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { TeeButton } from "@/components/ui/TeeButton";
import { TeeCard } from "@/components/ui/TeeCard";
import { Colors, Fonts, Radius, Spacing, Typography, hairline } from "@/constants/theme";
import { useAuth } from "@/providers/AuthProvider";
import { deleteMyRound, fetchLeaderboard, fetchRoundBundle } from "@/services/db";
import { buildScorecard, type ScorecardCell } from "@/utils/scorecard";
import { classifyHole, formatToPar, type ScoreClass } from "@/utils/stats";
import { notifySuccess, tapLight } from "@/utils/haptics";

const CLASS_COLORS: Record<ScoreClass, string> = {
  eagle: "#C7A24A",
  birdie: "#4E8C6A",
  par: "#1C3A2B",
  bogey: "#9BA59C",
  double: "#B0463B",
  triple: "#6E2F28",
};

export default function RoundDetailScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { roundId: param } = useLocalSearchParams<{ roundId: string }>();
  const roundId = typeof param === "string" ? param : "";
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const bundleQuery = useQuery({
    queryKey: ["round", roundId],
    queryFn: () => fetchRoundBundle(roundId),
    enabled: roundId.length > 0,
  });

  const isMultiplayer = bundleQuery.data?.round.is_multiplayer ?? false;

  const boardQuery = useQuery({
    queryKey: ["leaderboard", roundId],
    queryFn: () => fetchLeaderboard(roundId),
    enabled: roundId.length > 0 && isMultiplayer,
  });

  // Only this golfer's scores drive the card; a group round holds everyone's.
  const myScores = useMemo<Record<string, number>>(() => {
    const out: Record<string, number> = {};
    for (const s of bundleQuery.data?.scores ?? []) {
      if (s.profile_id === user?.id) out[s.hole_id] = s.strokes;
    }
    return out;
  }, [bundleQuery.data, user?.id]);

  const card = useMemo(
    () => (bundleQuery.data ? buildScorecard(bundleQuery.data.holes, myScores) : null),
    [bundleQuery.data, myScores]
  );

  const remove = useMutation({
    mutationFn: () => deleteMyRound(roundId),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["player-rounds"] });
      if (result === "not_found") {
        Alert.alert("Round not found", "This round is no longer in your history.");
      } else {
        notifySuccess();
      }
      router.back();
    },
    onError: () => {
      Alert.alert(
        "Couldn't remove the round",
        "It's still in your history. Check your connection and try again."
      );
    },
  });

  const confirmRemove = (): void => {
    tapLight();
    Alert.alert(
      isMultiplayer ? "Leave this round?" : "Delete this round?",
      isMultiplayer
        ? "Your scores will be erased and it will disappear from your statistics. If other players are in it, the round stays for them."
        : "Your scores for all holes will be erased and it will disappear from your statistics. This can't be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: isMultiplayer ? "Leave" : "Delete",
          style: "destructive",
          onPress: () => remove.mutate(),
        },
      ]
    );
  };

  return (
    <View style={styles.container}>
      <View style={[styles.topBar, { paddingTop: insets.top + Spacing.sm }]}>
        <Pressable style={styles.iconButton} onPress={() => router.back()} hitSlop={8}>
          <ChevronLeft size={24} color={Colors.primary} strokeWidth={2.4} />
        </Pressable>
        <Text style={styles.topTitle} numberOfLines={1}>
          {bundleQuery.data?.course.name ?? "Round"}
        </Text>
        <View style={styles.iconButton} />
      </View>

      {bundleQuery.isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={Colors.accent} />
        </View>
      ) : bundleQuery.isError || !bundleQuery.data || !card ? (
        <View style={styles.center}>
          <Text style={styles.emptyTitle}>Couldn&apos;t load this round</Text>
          <Text style={styles.emptyBody}>
            Your scores are safe — we just couldn&apos;t reach them right now.
          </Text>
          <TeeButton
            label="Try again"
            variant="secondary"
            onPress={() => bundleQuery.refetch()}
            style={styles.retry}
          />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.hero}>
            <Text style={styles.heroEyebrow}>{formatFullDate(bundleQuery.data.round.finished_at ?? bundleQuery.data.round.started_at)}</Text>
            <Text style={styles.heroNumber}>{card.totalStrokes}</Text>
            <Text style={styles.heroMeta}>
              {formatToPar(card.toPar)} · {card.holesScored} {card.holesScored === 1 ? "hole" : "holes"}
            </Text>
          </View>

          {card.nines.map((nine) => (
            <TeeCard key={nine.label} style={styles.nineCard}>
              <View style={styles.nineHeader}>
                <Text style={styles.nineLabel}>{nine.label}</Text>
                <Text style={styles.nineTotals}>
                  {nine.strokes} · par {nine.par}
                </Text>
              </View>
              {nine.cells.map((cell) => (
                <HoleRow key={cell.number} cell={cell} />
              ))}
            </TeeCard>
          ))}

          {isMultiplayer && (boardQuery.data?.length ?? 0) > 0 ? (
            <TeeCard style={styles.nineCard}>
              <View style={styles.nineHeader}>
                <Users size={15} color={Colors.primary} strokeWidth={2.6} />
                <Text style={styles.nineLabel}>Players</Text>
              </View>
              {(boardQuery.data ?? []).map((entry) => (
                <View key={entry.profileId} style={styles.playerRow}>
                  <Text style={styles.playerName} numberOfLines={1}>
                    {entry.name}
                  </Text>
                  <Text style={styles.playerScore}>
                    {entry.total} ({formatToPar(entry.toPar)})
                  </Text>
                </View>
              ))}
            </TeeCard>
          ) : null}

          <TeeButton
            label={isMultiplayer ? "Leave this round" : "Delete this round"}
            variant="danger"
            icon={<Trash2 size={17} color={Colors.danger} strokeWidth={2.4} />}
            onPress={confirmRemove}
            loading={remove.isPending}
            style={styles.deleteButton}
          />
        </ScrollView>
      )}
    </View>
  );
}

function HoleRow({ cell }: { cell: ScorecardCell }) {
  const scored = cell.strokes != null;
  const tone = scored
    ? CLASS_COLORS[classifyHole({ number: cell.number, par: cell.par, strokes: cell.strokes as number })]
    : Colors.textTertiary;

  return (
    <View style={styles.holeRow}>
      <Text style={styles.holeNumber}>{cell.number}</Text>
      <Text style={styles.holePar}>Par {cell.par}</Text>
      <View style={styles.holeSpacer} />
      <View style={[styles.holeDot, { backgroundColor: scored ? tone : "transparent" }]} />
      <Text style={[styles.holeStrokes, !scored && styles.holeStrokesEmpty]}>
        {scored ? cell.strokes : "—"}
      </Text>
    </View>
  );
}

function formatFullDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.sm,
    gap: Spacing.sm,
  },
  iconButton: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  topTitle: { ...Typography.headline, flex: 1, textAlign: "center" },
  content: { paddingHorizontal: Spacing.xl, gap: Spacing.lg },
  center: { alignItems: "center", paddingTop: Spacing.xxxl, paddingHorizontal: Spacing.xl, gap: Spacing.sm },

  hero: {
    backgroundColor: Colors.primary,
    borderRadius: Radius.xl,
    padding: Spacing.xl,
    alignItems: "center",
  },
  heroEyebrow: { ...Typography.overline, color: Colors.onPrimary, opacity: 0.7, textAlign: "center" },
  heroNumber: { fontFamily: Fonts.serifSemibold, fontSize: 72, color: Colors.onPrimary, letterSpacing: -2 },
  heroMeta: { ...Typography.subhead, color: Colors.onPrimary, opacity: 0.75 },

  nineCard: { padding: Spacing.lg, gap: Spacing.xs },
  nineHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingBottom: Spacing.sm,
    borderBottomWidth: hairline,
    borderBottomColor: Colors.border,
    marginBottom: Spacing.xs,
  },
  nineLabel: { ...Typography.overline, flex: 1 },
  nineTotals: { ...Typography.caption, color: Colors.textSecondary },

  holeRow: { flexDirection: "row", alignItems: "center", paddingVertical: 7, gap: Spacing.sm },
  holeNumber: { fontFamily: Fonts.serifSemibold, fontSize: 16, color: Colors.primary, width: 26 },
  holePar: { ...Typography.caption, color: Colors.textTertiary },
  holeSpacer: { flex: 1 },
  holeDot: { width: 7, height: 7, borderRadius: 4 },
  holeStrokes: { fontFamily: Fonts.serifSemibold, fontSize: 18, color: Colors.primary, width: 26, textAlign: "right" },
  holeStrokesEmpty: { color: Colors.textTertiary },

  playerRow: { flexDirection: "row", alignItems: "center", paddingVertical: 8, gap: Spacing.md },
  playerName: { ...Typography.callout, flex: 1 },
  playerScore: { ...Typography.callout, color: Colors.textSecondary },

  deleteButton: { marginTop: Spacing.sm },
  emptyTitle: { ...Typography.title, fontSize: 22, marginTop: Spacing.lg },
  emptyBody: { ...Typography.body, color: Colors.textSecondary, textAlign: "center", lineHeight: 22 },
  retry: { marginTop: Spacing.lg, alignSelf: "stretch", maxWidth: 260 },
});
```

- [ ] **Step 3: Point Finish at the detail screen**

In `expo/app/round/[id].tsx`, change the `finish` mutation's `onSuccess` (around line 194) from `router.back()` to:

```tsx
  const finish = useMutation({
    mutationFn: () => finishRound(roundId),
    onSuccess: () => {
      clearActiveRound(roundId);
      // Land on the round's own page rather than the tab: it already holds the
      // hole-by-hole breakdown and the share action, so the just-finished round
      // and a round from three months ago are the same screen.
      router.replace(`/history/${roundId}`);
    },
  });
```

`replace`, not `push`, so the back gesture does not walk into the finished round's play screen.

- [ ] **Step 4: Typecheck, lint, and open a real round**

```bash
cd "C:/Claude Webs/tee-golf-app/expo" && npx tsc --noEmit && npx expo lint && npm run go
```

Expected: both clean. Open the Statistics tab and tap a seeded demo round — it must show the hero, an OUT and an IN card with 18 rows, and the delete button. Confirm an unscored hole shows `—` and not `0`.

- [ ] **Step 5: Commit**

```bash
git add app/history/ app/_layout.tsx "app/round/[id].tsx" && git commit -m "feat: open any round hole by hole from history"
```

---

## Task 5: Per-hole personal bests

**Files:**
- Modify: `expo/services/db.ts` (append to the "Statistics" section)
- Modify: `expo/app/round/[id].tsx` (query near `bundleQuery`; render in the `holeNav` block near line 484; one new style near line 1533)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `fetchHoleBests(profileId: string, courseId: string, excludeRoundId: string): Promise<Record<string, number>>` — keys are `hole_id`, values are the lowest strokes ever recorded there.

- [ ] **Step 1: Add the query**

In `expo/services/db.ts`, at the end of the file:

```ts
/**
 * The golfer's lowest score on each hole of one course, keyed by hole_id.
 * Excludes the round in progress, so "your best" never means "what you just
 * wrote down". Hole ids are course-scoped, so this is the same hole at the
 * same course across every past round.
 */
export async function fetchHoleBests(
  profileId: string,
  courseId: string,
  excludeRoundId: string
): Promise<Record<string, number>> {
  const { data, error } = await supabase
    .from("scores")
    .select("hole_id, strokes, holes!inner(course_id)")
    .eq("profile_id", profileId)
    .eq("holes.course_id", courseId)
    .neq("round_id", excludeRoundId)
    .gt("strokes", 0);
  if (error) throw error;

  const rows = (data as unknown as { hole_id: string; strokes: number }[] | null) ?? [];
  const best: Record<string, number> = {};
  for (const row of rows) {
    const current = best[row.hole_id];
    if (current == null || row.strokes < current) best[row.hole_id] = row.strokes;
  }
  return best;
}
```

- [ ] **Step 2: Query it once per round**

In `expo/app/round/[id].tsx`, add `fetchHoleBests` to the existing `@/services/db` import, then add after `bundleQuery`:

```tsx
  // Fetched once when the round opens, not per hole. A missing best must never
  // block play, so failures here are simply absent (see the `?? null` below).
  const holeBestsQuery = useQuery({
    queryKey: ["hole-bests", user?.id, bundleQuery.data?.course.id, roundId],
    queryFn: () =>
      fetchHoleBests(user?.id ?? "", bundleQuery.data?.course.id ?? "", roundId),
    enabled: !!user && !!bundleQuery.data?.course.id,
    staleTime: 5 * 60 * 1000,
  });
```

- [ ] **Step 3: Derive the values**

Add after the existing `const strokes = ...` line (around line 363):

```tsx
  const holeBest = currentHole ? holeBestsQuery.data?.[currentHole.id] ?? null : null;
  const beatingBest = holeBest != null && strokes > 0 && strokes < holeBest;
```

- [ ] **Step 4: Render it**

Replace the `displayYardage` block inside `holeNavCenter` (around line 484) with:

```tsx
          {displayYardage != null || holeBest != null ? (
            <Text style={styles.holeNavYardage}>
              {displayYardage != null ? `${displayYardage} ${unitShort(unit)}` : ""}
              {displayYardage != null && holeBest != null ? "  ·  " : ""}
              {holeBest != null ? (
                <Text style={beatingBest ? styles.holeNavBest : undefined}>Best {holeBest}</Text>
              ) : null}
            </Text>
          ) : null}
```

Both values are optional and either can be absent. With neither, the line is not rendered and the screen looks exactly as it does today.

- [ ] **Step 5: Add the style**

Next to `holeNavYardage` (around line 1533):

```tsx
  holeNavBest: { color: Colors.accent, fontWeight: "700" },
```

- [ ] **Step 6: Typecheck**

```bash
cd "C:/Claude Webs/tee-golf-app/expo" && npx tsc --noEmit && npx expo lint
```

Expected: both clean.

- [ ] **Step 7: Verify against real data**

```bash
cd "C:/Claude Webs/tee-golf-app/expo" && npm run go
```

The demo account has three seeded rounds on the same course, so opening a fourth round there must show `Best N` under the hole number. Set the current hole's strokes below that number and confirm it turns green. If nothing appears, the `holes!inner` join is the first thing to check — RLS on `holes` was narrowed by migration 0011.

- [ ] **Step 8: Commit**

```bash
git add services/db.ts "app/round/[id].tsx" && git commit -m "feat: show your best score on a hole you've played before"
```

---

## Task 6: The three share cards

**Files:**
- Create: `expo/components/scorecard/ScorecardCard.tsx`
- Create: `expo/components/scorecard/SummaryCard.tsx`
- Create: `expo/components/scorecard/GroupCard.tsx`

**Interfaces:**
- Consumes: `ScorecardData`, `countByClass` from `@/utils/scorecard`; `LeaderboardEntry` from `@/services/db`; `formatToPar` from `@/utils/stats`.
- Produces: three components sharing this prop shape, plus the constant `CARD_WIDTH`.

```ts
export const CARD_WIDTH = 340;

interface CardProps {
  courseName: string;
  date: string;      // ISO
  card: ScorecardData;
  playerName: string;
}
// GroupCard additionally takes: entries: LeaderboardEntry[]
```

Cards render at a small logical width and are captured at `pixelRatio: 3` in Task 7, producing 1020 px wide images.

- [ ] **Step 1: Create the shared header and the scorecard grid**

Create `expo/components/scorecard/ScorecardCard.tsx`:

```tsx
import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { Wordmark } from "@/components/Wordmark";
import { Colors, Fonts, Radius, Spacing, hairline } from "@/constants/theme";
import type { ScorecardData } from "@/utils/scorecard";
import { formatToPar } from "@/utils/stats";

export const CARD_WIDTH = 340;

export interface CardProps {
  courseName: string;
  /** ISO timestamp. */
  date: string;
  card: ScorecardData;
  playerName: string;
}

export function formatCardDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** Shared header so all three formats read as the same family. */
export function CardHeader({ courseName, date }: { courseName: string; date: string }) {
  return (
    <View style={headerStyles.root}>
      <View style={headerStyles.text}>
        <Text style={headerStyles.course} numberOfLines={1}>
          {courseName}
        </Text>
        <Text style={headerStyles.date}>{formatCardDate(date)}</Text>
      </View>
      <Wordmark height={16} tint={Colors.onPrimary} />
    </View>
  );
}

const headerStyles = StyleSheet.create({
  root: { flexDirection: "row", alignItems: "center", gap: Spacing.md },
  text: { flex: 1 },
  course: { fontFamily: Fonts.serifSemibold, fontSize: 22, color: Colors.onPrimary },
  date: { fontFamily: Fonts.serifRegular, fontSize: 13, color: Colors.onPrimary, opacity: 0.7 },
});

export function ScorecardCard({ courseName, date, card, playerName }: CardProps) {
  return (
    <View style={[styles.root, { width: CARD_WIDTH, height: Math.round(CARD_WIDTH * 1.25) }]}>
      <CardHeader courseName={courseName} date={date} />

      <View style={styles.totals}>
        <Text style={styles.total}>{card.totalStrokes}</Text>
        <View>
          <Text style={styles.toPar}>{formatToPar(card.toPar)}</Text>
          <Text style={styles.player} numberOfLines={1}>
            {playerName}
          </Text>
        </View>
      </View>

      <View style={styles.grid}>
        {card.nines.map((nine) => (
          <View key={nine.label} style={styles.nine}>
            <View style={styles.row}>
              <Text style={[styles.rowLabel, styles.muted]}>HOLE</Text>
              {nine.cells.map((c) => (
                <Text key={c.number} style={[styles.cell, styles.muted]}>
                  {c.number}
                </Text>
              ))}
              <Text style={[styles.cellTotal, styles.muted]}>{nine.label}</Text>
            </View>
            <View style={styles.row}>
              <Text style={[styles.rowLabel, styles.muted]}>PAR</Text>
              {nine.cells.map((c) => (
                <Text key={c.number} style={[styles.cell, styles.muted]}>
                  {c.par}
                </Text>
              ))}
              <Text style={[styles.cellTotal, styles.muted]}>{nine.par}</Text>
            </View>
            <View style={[styles.row, styles.scoreRow]}>
              <Text style={styles.rowLabel}>SCORE</Text>
              {nine.cells.map((c) => (
                <Text key={c.number} style={styles.cell}>
                  {/* blank, never 0 — a 0 here would read as a score */}
                  {c.strokes ?? ""}
                </Text>
              ))}
              <Text style={styles.cellTotal}>{nine.strokes}</Text>
            </View>
          </View>
        ))}
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          {card.holesScored} of {card.nines.reduce((n, x) => n + x.cells.length, 0)} holes · par{" "}
          {card.coursePar}
        </Text>
        <Text style={styles.footerTotal}>TOTAL {card.totalStrokes}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    backgroundColor: Colors.primary,
    borderRadius: Radius.xl,
    padding: Spacing.xl,
    justifyContent: "space-between",
  },
  totals: { flexDirection: "row", alignItems: "flex-end", gap: Spacing.md },
  total: { fontFamily: Fonts.serifSemibold, fontSize: 64, color: Colors.onPrimary, letterSpacing: -2 },
  toPar: { fontFamily: Fonts.serifSemibold, fontSize: 22, color: Colors.accent },
  player: { fontFamily: Fonts.serifRegular, fontSize: 13, color: Colors.onPrimary, opacity: 0.7 },

  grid: { gap: Spacing.md },
  nine: {
    backgroundColor: "rgba(244,240,231,0.07)",
    borderRadius: Radius.md,
    padding: Spacing.sm,
    gap: 2,
  },
  row: { flexDirection: "row", alignItems: "center" },
  scoreRow: { borderTopWidth: hairline, borderTopColor: "rgba(244,240,231,0.2)", paddingTop: 4, marginTop: 2 },
  rowLabel: { fontFamily: Fonts.serifSemibold, fontSize: 8, color: Colors.onPrimary, width: 30, letterSpacing: 0.6 },
  cell: { flex: 1, textAlign: "center", fontFamily: Fonts.serifSemibold, fontSize: 12, color: Colors.onPrimary },
  cellTotal: { width: 26, textAlign: "right", fontFamily: Fonts.serifBold, fontSize: 12, color: Colors.accent },
  muted: { opacity: 0.55, fontFamily: Fonts.serifRegular },

  footer: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  footerText: { fontFamily: Fonts.serifRegular, fontSize: 11, color: Colors.onPrimary, opacity: 0.6 },
  footerTotal: { fontFamily: Fonts.serifBold, fontSize: 13, color: Colors.onPrimary },
});
```

Check `expo/components/Wordmark.tsx` for its actual prop names before using it. If it does not accept `height`/`tint`, render `<Text>TEE</Text>` in the app's serif instead rather than changing `Wordmark`.

- [ ] **Step 2: Create the summary card**

Create `expo/components/scorecard/SummaryCard.tsx`:

```tsx
import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { Colors, Fonts, Radius, Spacing } from "@/constants/theme";
import { countByClass } from "@/utils/scorecard";
import { formatToPar, type ScoreClass } from "@/utils/stats";

import { CARD_WIDTH, CardHeader, type CardProps } from "./ScorecardCard";

const SHOWN: { key: ScoreClass; label: string }[] = [
  { key: "eagle", label: "Eagles" },
  { key: "birdie", label: "Birdies" },
  { key: "par", label: "Pars" },
  { key: "bogey", label: "Bogeys" },
  { key: "double", label: "Doubles" },
  { key: "triple", label: "Triple+" },
];

/** Square, because that is what survives a chat crop intact. */
export function SummaryCard({ courseName, date, card, playerName }: CardProps) {
  const counts = countByClass(card);
  const present = SHOWN.filter((s) => counts[s.key] > 0);

  return (
    <View style={[styles.root, { width: CARD_WIDTH, height: CARD_WIDTH }]}>
      <CardHeader courseName={courseName} date={date} />

      <View style={styles.middle}>
        <Text style={styles.total}>{card.totalStrokes}</Text>
        <Text style={styles.toPar}>{formatToPar(card.toPar)}</Text>
        <Text style={styles.player} numberOfLines={1}>
          {playerName} · {card.holesScored} holes
        </Text>
      </View>

      <View style={styles.breakdown}>
        {present.map((s) => (
          <View key={s.key} style={styles.stat}>
            <Text style={styles.statValue}>{counts[s.key]}</Text>
            <Text style={styles.statLabel}>{s.label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    backgroundColor: Colors.primary,
    borderRadius: Radius.xl,
    padding: Spacing.xl,
    justifyContent: "space-between",
  },
  middle: { alignItems: "center" },
  total: { fontFamily: Fonts.serifSemibold, fontSize: 92, color: Colors.onPrimary, letterSpacing: -4 },
  toPar: { fontFamily: Fonts.serifSemibold, fontSize: 26, color: Colors.accent, marginTop: -8 },
  player: { fontFamily: Fonts.serifRegular, fontSize: 13, color: Colors.onPrimary, opacity: 0.7, marginTop: 6 },
  breakdown: { flexDirection: "row", justifyContent: "space-between", gap: Spacing.xs },
  stat: { alignItems: "center", flex: 1 },
  statValue: { fontFamily: Fonts.serifSemibold, fontSize: 20, color: Colors.onPrimary },
  statLabel: { fontFamily: Fonts.serifRegular, fontSize: 9, color: Colors.onPrimary, opacity: 0.6 },
});
```

- [ ] **Step 3: Create the group card**

Create `expo/components/scorecard/GroupCard.tsx`:

```tsx
import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { Colors, Fonts, Radius, Spacing, hairline } from "@/constants/theme";
import type { LeaderboardEntry } from "@/services/db";
import { formatToPar } from "@/utils/stats";

import { CARD_WIDTH, CardHeader, type CardProps } from "./ScorecardCard";

interface GroupCardProps extends CardProps {
  entries: LeaderboardEntry[];
}

/** One line per player. Rendered only for multiplayer rounds. */
export function GroupCard({ courseName, date, entries }: GroupCardProps) {
  return (
    <View style={[styles.root, { width: CARD_WIDTH, height: Math.round(CARD_WIDTH * 1.25) }]}>
      <CardHeader courseName={courseName} date={date} />

      <View style={styles.list}>
        {entries.map((entry, index) => (
          <View key={entry.profileId} style={[styles.row, index > 0 && styles.rowDivided]}>
            <Text style={styles.position}>{index + 1}</Text>
            <Text style={styles.name} numberOfLines={1}>
              {entry.name}
            </Text>
            <Text style={styles.thru}>thru {entry.thru}</Text>
            <Text style={styles.total}>{entry.total}</Text>
            <Text style={styles.toPar}>{formatToPar(entry.toPar)}</Text>
          </View>
        ))}
      </View>

      <Text style={styles.footer}>
        {entries.length} {entries.length === 1 ? "player" : "players"}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    backgroundColor: Colors.primary,
    borderRadius: Radius.xl,
    padding: Spacing.xl,
    justifyContent: "space-between",
  },
  list: { gap: 2 },
  row: { flexDirection: "row", alignItems: "center", paddingVertical: 9, gap: Spacing.sm },
  rowDivided: { borderTopWidth: hairline, borderTopColor: "rgba(244,240,231,0.16)" },
  position: { fontFamily: Fonts.serifBold, fontSize: 13, color: Colors.accent, width: 16 },
  name: { flex: 1, fontFamily: Fonts.serifSemibold, fontSize: 16, color: Colors.onPrimary },
  thru: { fontFamily: Fonts.serifRegular, fontSize: 11, color: Colors.onPrimary, opacity: 0.55 },
  total: { fontFamily: Fonts.serifSemibold, fontSize: 18, color: Colors.onPrimary, width: 30, textAlign: "right" },
  toPar: { fontFamily: Fonts.serifSemibold, fontSize: 13, color: Colors.accent, width: 40, textAlign: "right" },
  footer: { fontFamily: Fonts.serifRegular, fontSize: 11, color: Colors.onPrimary, opacity: 0.6, textAlign: "center" },
});
```

- [ ] **Step 4: Typecheck**

```bash
cd "C:/Claude Webs/tee-golf-app/expo" && npx tsc --noEmit && npx expo lint
```

Expected: both clean.

- [ ] **Step 5: Commit**

```bash
git add components/scorecard/ && git commit -m "feat: three scorecard formats for sharing"
```

---

## Task 7: Capture, share sheet, and wiring

**Files:**
- Create: `expo/utils/capture.ts`
- Create: `expo/components/scorecard/ShareRoundSheet.tsx`
- Modify: `expo/app/history/[roundId].tsx`
- Modify: `expo/package.json` (dependency)

**Interfaces:**
- Consumes: all three cards from Task 6; `ScorecardData` from Task 3; `LeaderboardEntry` from `@/services/db`.
- Produces: `<ShareRoundSheet visible onClose courseName date card playerName entries />`.

- [ ] **Step 1: Install the native module**

```bash
cd "C:/Claude Webs/tee-golf-app/expo" && npx expo install react-native-view-shot
```

Then confirm nothing else broke:

```bash
cd "C:/Claude Webs/tee-golf-app/expo" && npx expo-doctor
```

Expected: 18/18 checks pass. If a version-compatibility check fails, take the version `expo install` chose — do not pin manually.

- [ ] **Step 2: Isolate the native dependency**

Create `expo/utils/capture.ts`:

```ts
import type { RefObject } from "react";
import type { View } from "react-native";

/**
 * react-native-view-shot is a native module, so it does not exist in Expo Go.
 * Isolating it here means the share sheet, the previews and all three cards
 * stay ordinary React Native views that render fine in Expo Go — only the
 * export reports that it needs a real build, and it says so rather than
 * crashing.
 */

export type CaptureFailure = "unavailable" | "failed";

export interface CaptureResult {
  uri: string | null;
  reason: CaptureFailure | null;
}

type CaptureFn = (ref: RefObject<View | null>, options: object) => Promise<string>;

let captureRef: CaptureFn | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  captureRef = require("react-native-view-shot").captureRef as CaptureFn;
} catch {
  captureRef = null;
}

export function isCaptureAvailable(): boolean {
  return captureRef != null;
}

/** Captures a view to a PNG file at 3x, returning its file:// uri. */
export async function captureViewToPng(ref: RefObject<View | null>): Promise<CaptureResult> {
  if (captureRef == null) return { uri: null, reason: "unavailable" };
  try {
    const uri = await captureRef(ref, { format: "png", quality: 1, result: "tmpfile", pixelRatio: 3 });
    return { uri, reason: null };
  } catch {
    return { uri: null, reason: "failed" };
  }
}
```

- [ ] **Step 3: Build the sheet**

Create `expo/components/scorecard/ShareRoundSheet.tsx`:

```tsx
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
```

`collapsable={false}` is required — without it Android flattens the wrapper out of the view tree and the capture finds nothing to shoot.

- [ ] **Step 4: Wire it into the detail screen**

In `expo/app/history/[roundId].tsx`, add the imports:

```tsx
import { ChevronLeft, Share2, Trash2, Users } from "lucide-react-native";
import React, { useMemo, useState } from "react";

import { ShareRoundSheet } from "@/components/scorecard/ShareRoundSheet";
```

Add the state next to the other hooks:

```tsx
  const [sharing, setSharing] = useState(false);
```

Add a share button in the top bar, replacing the empty spacer `<View style={styles.iconButton} />`:

```tsx
        <Pressable
          style={styles.iconButton}
          onPress={() => {
            tapLight();
            setSharing(true);
          }}
          hitSlop={8}
          disabled={!card}
          accessibilityRole="button"
          accessibilityLabel="Share this round"
        >
          <Share2 size={20} color={card ? Colors.primary : Colors.textTertiary} strokeWidth={2.4} />
        </Pressable>
```

And render the sheet just before the closing `</View>` of the screen:

```tsx
      {bundleQuery.data && card ? (
        <ShareRoundSheet
          visible={sharing}
          onClose={() => setSharing(false)}
          courseName={bundleQuery.data.course.name}
          date={bundleQuery.data.round.finished_at ?? bundleQuery.data.round.started_at}
          card={card}
          playerName={user?.user_metadata?.display_name ?? "You"}
          entries={isMultiplayer ? boardQuery.data ?? [] : []}
        />
      ) : null}
```

If `user.user_metadata.display_name` is not populated in this app, read the name from the profile instead — check `providers/AuthProvider.tsx` for what it exposes and use that. Do not ship the literal `"You"` if a real name is available.

- [ ] **Step 5: Typecheck and lint**

```bash
cd "C:/Claude Webs/tee-golf-app/expo" && npx tsc --noEmit && npx expo lint
```

Expected: both clean.

- [ ] **Step 6: Verify the Expo Go path degrades correctly**

```bash
cd "C:/Claude Webs/tee-golf-app/expo" && npm run go
```

Open a finished round, tap share, switch between all tabs. All three cards must render. Tapping Share must show "Not available here" — **not** a crash and not a silent no-op. This is the degradation the design promises; confirm it before building.

- [ ] **Step 7: Verify the real capture**

```bash
cd "C:/Claude Webs/tee-golf-app/expo" && npx --yes eas-cli@latest build --platform ios --profile development
```

Install on the device, open a finished round, share each format, and confirm the image arrives at 1020 px wide with no transparent background. Check specifically that an unscored hole is blank in the exported PNG, not `0`.

- [ ] **Step 8: Commit**

```bash
git add utils/capture.ts components/scorecard/ShareRoundSheet.tsx "app/history/[roundId].tsx" package.json package-lock.json && git commit -m "feat: export a round as a shareable scorecard image"
```

---

## Task 8: Release checks

**Files:**
- Modify: `expo/app.json` (version)
- Modify: `expo/store/SUBMISSION.md`

- [ ] **Step 1: Run every verification**

```bash
cd "C:/Claude Webs/tee-golf-app/expo" && npx tsc --noEmit && npx expo lint && npx expo-doctor && npm run verify:scorecard && npm run verify:backend && npm run verify:release
```

Expected: all clean, 18/18 doctor checks, and both verify scripts exit 0. `verify:release` guards against Rork reintroducing the PostHog analytics wrapper — if it fails, `metro.config.js` was overwritten and must be restored before building.

- [ ] **Step 2: Bump the version**

Only after 1.0.0 has cleared review. In `expo/app.json`, set `"version": "1.1.0"`. Leave `buildNumber` alone — `eas.json` sets `appVersionSource: "remote"` with `autoIncrement`, so EAS assigns it.

- [ ] **Step 3: Record what changed**

Append a `1.1.0` section to `expo/store/SUBMISSION.md` listing the four features and noting that migration 0013 is a prerequisite for the build. If Apple asks about the new data flows, nothing here collects anything new — no privacy manifest or nutrition-label change is needed. Say so explicitly in that section so the next person does not have to re-derive it.

- [ ] **Step 4: Commit**

```bash
git add app.json store/SUBMISSION.md && git commit -m "chore: prepare 1.1.0"
```

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
| --- | --- |
| 1. Migration 0013, function semantics, ownership transfer | Task 1 |
| 1. Client `deleteMyRound`, cache invalidation | Task 2 |
| 2. Swipe to delete, long-press fallback, confirmation copy | Task 2 |
| 2. Detail screen, route, data reuse | Task 4 |
| 3. `fetchHoleBests`, display, green when beating | Task 5 |
| 4. Capture path, Expo Go degradation | Task 7 |
| 4. Three card components | Task 6 |
| 4. Nine-hole shape, blank cells | Task 3 (logic) + Task 6 (render) |
| 4. Finish navigates to detail | Task 4, Step 3 |
| Error handling table | Task 2 Step 6, Task 4 Step 2, Task 5 Step 2, Task 7 Step 3 |
| Testing: backend cases | Task 1 Step 1 |
| Testing: pure logic | Task 3 Step 1 |
| Release | Task 8 |

**Type consistency:** `DeleteRoundResult` is defined in Task 2 and used in Tasks 2 and 4. `ScorecardData`/`ScorecardCell` are defined in Task 3 and consumed in Tasks 4, 6, 7. `CardProps` and `CARD_WIDTH` are defined in Task 6's `ScorecardCard.tsx` and imported by both sibling cards. `fetchHoleBests` has the same three-parameter signature in Task 5's definition and call site. `RoundSummary.isMultiplayer` is added in Task 2 Step 2 and read in Task 2 Step 4.

**Dependency order:** every task compiles and passes its own gate at the point it commits. The one cross-task edge is `buildScorecard`, created in Task 3 and consumed by Task 4 — which is why the pure logic comes first. Task 2 is the single deliberate exception: it navigates to `/history/[roundId]`, a route Task 4 registers, so that navigation is dead until Task 4 lands. Task 2 still typechecks and its own deliverable — removing a round — works on its own.
