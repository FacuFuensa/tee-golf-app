# Round history, per-hole bests, and shareable scorecards

**Date:** 2026-08-01
**Ships as:** 1.1.0 (1.0.0 is in App Store review and must not be touched)
**Status:** approved design, not yet implemented

## Problem

A round saved by accident cannot be removed. The only deletion path in the app is
`delete_my_data()`, which erases *every* round the golfer has ever played. A golfer with
one junk round and twenty real ones has no move.

The root cause is in the database, not the UI. `public.rounds` and `public.scores` have
`select`, `insert` and `update` policies but **no `delete` policy at all**
(`0001_init.sql:147-175`). Row-level security denies anything not explicitly allowed, so a
client-side delete silently affects zero rows. `delete_my_data()` works only because it is
`SECURITY DEFINER` and therefore bypasses RLS.

Three adjacent gaps surfaced from the same session:

- The history list shows a round's total but not what happened on each hole.
- While playing a hole you have played before, the app does not show your previous best.
- A finished round cannot leave the app in any shareable form.

## Scope

In scope: single-round deletion, a round detail screen, per-hole personal bests during
play, and shareable scorecard images.

Explicitly out of scope: **the Apple Watch companion.** watchOS cannot run React Native. It
requires a separate native Swift/SwiftUI target with its own bundle identifier and
provisioning, plus WatchConnectivity for phone↔watch messaging. It shares no code with this
app and iterates on a ~20-minute blind EAS build loop from Windows. It gets its own spec.

---

## 1. Database — migration `0013_delete_single_round.sql`

### Decision: one `SECURITY DEFINER` function, no new RLS policies

The obvious alternative is adding `delete` policies to `rounds` and `scores` and doing the
work from the client. It is rejected for two reasons.

**It cannot be expressed correctly.** Deleting a round means: remove my scores, remove my
seat, then decide whether the round itself should go. That decision depends on state that
changes as a result of the first two steps. Split across separate client calls it is not
atomic — a group member can take a seat between the check and the delete, and the client
would destroy their round based on a stale read.

**It permanently widens what the client may delete**, in exchange for nothing. The function
approach exposes exactly one operation with the policy baked in.

This also matches the established pattern: `delete_my_data`, `delete_my_account`, and
`join_round_by_code` are all `SECURITY DEFINER` RPCs for the same reason.

### Behaviour

`delete_my_round(p_round_id uuid) returns text`, one of `deleted` | `left` | `not_found`.

1. Unauthenticated → raise.
2. Caller not seated in the round → return `not_found`, without revealing whether the round
   exists. A non-member cannot probe for other people's rounds.
3. Delete the caller's `scores` rows and their `round_players` seat.
4. If **no other player is seated**, delete the round → `deleted`.
5. Otherwise the round survives → `left`.

### Two decisions worth recording

**The "delete everything" shortcut keys on seats, not scores.** The original criterion was
"delete the whole round if you are the only one who *scored*". Changed to "if you are the
only one *seated*".

The case the shortcut exists for is: you host a group round, nobody joins, you play it
alone — it should not leave a ghost row. Nobody else is seated there either, so the
shortcut still fires. What changes is the awkward case: a player who joined but has not yet
recorded a stroke. Under the original rule your delete would make the round vanish from
their hands mid-play. Under this rule it stays. They took a seat; not having scored yet
does not make them less of a player.

**Ownership transfers when the owner leaves.** `rounds_update_owner` requires
`owner_id = auth.uid()`, so a group round whose owner has left can never be finished by
anyone. When the leaving caller is the owner and players remain, the round is handed to the
earliest-joined survivor (ties broken by `profile_id` for determinism).

### Migration

```sql
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

  if not v_others_seated then
    delete from public.rounds where id = p_round_id;
    return 'deleted';
  end if;

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

### Client

```ts
export type DeleteRoundResult = "deleted" | "left" | "not_found";

export async function deleteMyRound(roundId: string): Promise<DeleteRoundResult>;
```

On success, invalidate `["player-rounds", userId]`. History and statistics both derive from
`scores`, so a single invalidation keeps them consistent by construction — there is no
second store that can drift.

---

## 2. History — deletion and detail

### Swipe to delete

The rows in `RoundLog` (`app/(tabs)/stats.tsx:298`) become swipeable using `Swipeable` from
`react-native-gesture-handler`, already a dependency. No new package.

**Verified against the installed version (2026-08-01).** `react-native-reanimated` is not in
this project, so `ReanimatedSwipeable` is unavailable. The legacy `Swipeable` is deprecated
in RNGH 2.x, but it *is* still exported from the package root in the installed 2.28.0
(`index.d.ts:53`) and its implementation imports only `react`, `react-native` and RNGH's own
handlers — no reanimated dependency. No fallback needed.

**Long-press opens the same confirmation regardless.** A destructive action reachable only
by an invisible swipe is unusable under VoiceOver, and Apple reviews for it.

### Confirmation

Wording branches on `round.is_multiplayer`, because different things will happen:

- **Solo** — "Delete this round? Your scores for all holes will be erased and it will
  disappear from your statistics. This can't be undone."
- **Group** — "Leave this round? Your scores will be erased and it will disappear from your
  statistics. If other players are in it, the round stays for them."

Destructive style on the delete action; cancel is the default button.

After the call returns, the app reports which of the two actually happened using the
function's return value rather than guessing.

### Detail screen

New route `app/history/[roundId].tsx`. It cannot live under `app/round/[id]/` — that path is
already taken by the play screen (`app/round/[id].tsx`).

Contents:

- Header: course, date, total strokes, score to par.
- Hole by hole: number, par, strokes, and the to-par tag using the existing `BUCKET_COLORS`
  palette already defined in `stats.tsx`.
- OUT / IN / TOTAL rows when the round has 18 holes.
- Other players and their totals, for group rounds.
- Share and Delete actions. Delete being here too means it is not swipe-only.

Data comes from `fetchRoundBundle()` (`services/db.ts:393`), which already returns the
round, course, holes and every score in one trip, plus `fetchLeaderboard()` for group
member names. **No new queries for this screen.**

---

## 3. Per-hole personal best

### Query

```ts
/** Lowest strokes recorded on each hole of this course, keyed by hole_id. */
export async function fetchHoleBests(
  profileId: string,
  courseId: string,
  excludeRoundId: string
): Promise<Record<string, number>>;
```

Selects the golfer's scores joined to holes on the current course, excluding the round in
progress and any zero-stroke placeholder, then reduces to a minimum per `hole_id`:

```ts
supabase
  .from("scores")
  .select("hole_id, strokes, holes!inner(course_id)")
  .eq("profile_id", profileId)
  .eq("holes.course_id", courseId)
  .neq("round_id", excludeRoundId)
  .gt("strokes", 0);
```

Fetched **once when the round opens**, not per hole. Cached under
`["hole-bests", userId, courseId, roundId]`.

Hole identity is `hole_id`, which is course-scoped, so "this hole" means the same hole at
the same course across every past round — exactly the comparison intended.

### Display

Rendered on the existing secondary line under the hole number, which currently holds only
the scorecard yardage (`app/round/[id].tsx`, the `holeNav` block):

```
        HOLE
        3  ·  Par 4
      385 yd · Best 4
```

The line accepts both values joined by `·` and either may be absent: a course with no
yardage data shows `Best 4` alone, a hole never played shows the yardage alone, and with
neither the line is not rendered — leaving the screen exactly as it is today.

When the current round's strokes are below the stored best, the number renders green.

---

## 4. Shareable scorecards

### Rendering path

`react-native-view-shot` captures a rendered view to PNG.

**It is a native module and is not present in Expo Go.** The everyday `npm run go` loop will
not have it.

The blast radius is small and deliberately kept that way: the share sheet, all three cards,
and the live preview are ordinary React Native views and **work in Expo Go**. Only the
capture-and-share action is unavailable, and it fails with a clear message rather than
crashing. Card design and layout stay iterable in Expo Go; only real export needs a build.

The alternative — drawing the cards with `react-native-svg`, already installed and available
in Expo Go — is rejected. An 18-hole grid in SVG means positioning every text node by hand
with no flexbox, and the custom Newsreader font makes text metrics guesswork. It is
substantially more work for a benefit that expires at the next build.

### Structure

Four focused files rather than one large one:

- `components/scorecard/ScorecardCard.tsx` — the hole-by-hole grid, 4:5 portrait
- `components/scorecard/SummaryCard.tsx` — large total, to-par, birdie/par/bogey breakdown, square
- `components/scorecard/GroupCard.tsx` — one line per player, 4:5 portrait
- `components/scorecard/ShareRoundSheet.tsx` — tabs, live preview, capture, share

Each card takes plain data and renders; the sheet owns all the side effects. The cards can
be viewed and adjusted in isolation.

### Formats

Three tabs, each with a distinct reason to exist. The **Group** tab renders only when the
round was multiplayer.

Because format is an explicit choice at share time, other players' names and scores leave
the device only when the golfer deliberately selects that tab. No default has to be picked
on their behalf.

### Rendering details

Cards are laid out at a small logical size and captured at `pixelRatio: 3`, producing
1080 px wide images. Sharing uses React Native's built-in `Share` with `{ url }`, already
imported in the play screen — no dependency beyond view-shot.

**Nine-hole rounds** render OUT and TOTAL, no IN. The grid is built from the holes that
exist, never from an assumed 18.

**Unscored holes render as an empty cell, never `0`.** A zero in a scorecard column reads as
a score, and the exported image would be a lie.

### Entry points

Pressing **Finish** navigates to `app/history/[roundId]` instead of returning to the tab.
That screen already holds the hole-by-hole breakdown and the share button.

This serves both requested moments — the round just finished and the round from three
months ago — with **one screen**. There is no separate post-round summary screen to keep in
sync with the history screen.

---

## Error handling

| Failure | Behaviour |
| --- | --- |
| `delete_my_round` network/RPC error | Row stays, alert offers retry. Nothing optimistically removed. |
| Returns `not_found` | "This round is no longer in your history", refresh the list. Covers deleting from a stale screen. |
| `fetchHoleBests` fails | The `Best` value is simply absent. A missing best must never block play or the distance readout. |
| Capture fails (Expo Go, or permission) | "Sharing a scorecard needs the full app — it doesn't work in Expo Go." Preview stays usable. |
| `fetchRoundBundle` fails on the detail screen | Existing error-with-retry pattern from `stats.tsx`. |

The governing rule: nothing in this feature set may prevent recording a score. Distance and
scoring are the app's job; history, bests and sharing are all secondary and degrade to
absent.

## Testing

The project has no test runner and uses executable verification scripts
(`store/verify-backend.mjs`, `store/verify-release.mjs`). This follows that pattern rather
than introducing jest.

**Backend** — extend `verify-backend.mjs` with cases that exercise real rows against the
real database, because the previous `join_round_by_code` bug proved a check that never
reaches the interesting code path passes while proving nothing:

1. Solo round → `deleted`, round row gone, scores gone.
2. Group round, two seated players, non-owner deletes → `left`, round survives, the other
   player's scores are untouched.
3. Group round, owner deletes while another player is seated → `left`, and `owner_id` has
   moved to the remaining player.
4. Non-member calls it on someone else's round → `not_found`, and that round is unchanged.
5. Anonymous caller → rejected.

**Pure logic** — a script covering scorecard aggregation: OUT/IN/TOTAL arithmetic, the
9-hole shape, and that unscored holes produce blank cells rather than zeros.

**Manual** — swipe and long-press both reach the confirmation; VoiceOver can reach delete;
the green best-score state appears when the current score goes below the stored best.

## Release

Ships as 1.1.0 after 1.0.0 clears review. Migration 0013 must be applied to Supabase before
the build is submitted, since the client will call a function that would not yet exist.
