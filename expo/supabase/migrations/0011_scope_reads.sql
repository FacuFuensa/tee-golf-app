-- Tee — scope read access to what the app actually needs
-- Run AFTER 0010_appstore_hardening.sql.
--
-- ⚠ APPLY THIS ONE DELIBERATELY, NOT BLIND.
-- Unlike 0010, this migration narrows SELECT policies, which means a mistake
-- shows up as missing data in the app rather than as an error. Run it, then
-- walk the checklist at the bottom of this file before submitting a build.
--
-- WHY IT EXISTS
-- 0001 shipped three `using (true)` SELECT policies: profiles, courses and
-- holes. Combined with a client-side anon key (which is correct and expected —
-- anon keys are public and gated by RLS), that means anyone who signs up can
-- read the whole table. Concretely, before this migration a single self-
-- registered account could:
--
--   * dump every golfer's display_name and handicap;
--   * dump every hand-mapped course, including the precise GPS coordinates the
--     creator physically stood at, joined to that creator's display name.
--
-- Apple's Guideline 5.1.2(i) is explicit that personal data may not be shared
-- without permission, and 5.1.1(iii) requires collecting and exposing only what
-- core functionality needs. The app's own UI never reads any of this beyond the
-- caller's own rows and their co-players in a shared round — so the policies
-- below grant exactly that and nothing more.

-- ---------------------------------------------------------------------------
-- Helpers (SECURITY DEFINER so they can see the join tables without recursing
-- through the very policies they are used by)
-- ---------------------------------------------------------------------------

/** True when the caller and p_profile_id are seated in at least one same round. */
create or replace function public.shares_round_with(p_profile_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.round_players mine
    join public.round_players theirs on theirs.round_id = mine.round_id
    where mine.profile_id = auth.uid()
      and theirs.profile_id = p_profile_id
  );
$$;

/** True when the caller has a round (any state) on p_course_id. */
create or replace function public.plays_course(p_course_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.rounds r
    join public.round_players rp on rp.round_id = r.id
    where r.course_id = p_course_id
      and rp.profile_id = auth.uid()
  );
$$;

/** True when p_course_id is in the caller's saved library. */
create or replace function public.has_course_in_library(p_course_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.user_courses uc
    where uc.course_id = p_course_id and uc.profile_id = auth.uid()
  );
$$;

grant execute on function public.shares_round_with(uuid)      to authenticated;
grant execute on function public.plays_course(uuid)           to authenticated;
grant execute on function public.has_course_in_library(uuid)  to authenticated;

-- ---------------------------------------------------------------------------
-- profiles: yourself, plus anyone you are actually playing with
-- ---------------------------------------------------------------------------
-- Used by services/db.ts fetchProfile (own row) and fetchLeaderboard, which
-- reads `profiles(display_name)` embedded through round_players — every row it
-- touches is a co-player, so both keep working.

drop policy if exists "profiles_select_all" on public.profiles;
drop policy if exists "profiles_select_scoped" on public.profiles;
create policy "profiles_select_scoped" on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.shares_round_with(id));

-- ---------------------------------------------------------------------------
-- courses: the shared catalog stays public; hand-mapped courses do not
-- ---------------------------------------------------------------------------
-- Catalog rows (source <> 'user') must stay readable by everyone: importing a
-- course looks it up by external_id BEFORE the caller has any relationship to
-- it (services/db.ts fetchCourseByExternalId), and that lookup is what keeps a
-- single shared row per course.
--
-- Hand-mapped rows are user-authored content with precise coordinates, so they
-- are limited to the creator, anyone who saved them, and anyone playing a round
-- on them (which is how a joiner reads the host's course in fetchRoundBundle).

drop policy if exists "courses_select_all" on public.courses;
drop policy if exists "courses_select_scoped" on public.courses;
create policy "courses_select_scoped" on public.courses
  for select to authenticated
  using (
    source is distinct from 'user'
    or created_by = auth.uid()
    or public.has_course_in_library(id)
    or public.plays_course(id)
  );

-- ---------------------------------------------------------------------------
-- holes: mirror whatever the caller may see of the parent course
-- ---------------------------------------------------------------------------

drop policy if exists "holes_select_all" on public.holes;
drop policy if exists "holes_select_scoped" on public.holes;
create policy "holes_select_scoped" on public.holes
  for select to authenticated
  using (
    exists (
      select 1 from public.courses c
      where c.id = holes.course_id
        and (
          c.source is distinct from 'user'
          or c.created_by = auth.uid()
          or public.has_course_in_library(c.id)
          or public.plays_course(c.id)
        )
    )
  );

-- ---------------------------------------------------------------------------
-- courses: allow a creator to delete their own hand-mapped course
-- ---------------------------------------------------------------------------
-- services/db.ts exported deleteCourse() against a table with no DELETE policy,
-- so it would have reported success and changed nothing. delete_my_account in
-- 0010 also needs this path to work.

drop policy if exists "courses_delete_own" on public.courses;
create policy "courses_delete_own" on public.courses
  for delete to authenticated
  using (created_by = auth.uid() and source = 'user');

-- ---------------------------------------------------------------------------
-- VERIFY BEFORE SUBMITTING — walk all of this on a real device
-- ---------------------------------------------------------------------------
-- 1. Courses tab still lists every course you had saved.
-- 2. "Find a course" -> add a catalog course -> it appears in your list.
-- 3. Map a course by hand -> it appears, and its greens show a distance.
-- 4. Open a round on a catalog course -> holes and pars load.
-- 5. Host a group round on account A; join by code from account B.
--    B must see: the course name, the holes, and A's display name on the board.
--    This is the single most likely thing to break — it exercises all three
--    helpers at once.
-- 6. Stats tab still shows your history.
-- 7. Settings -> Delete all my data -> courses and bag are both emptied.
--
-- If step 5 fails, the cause is almost always that the joiner's round_players
-- row is written by join_round_by_code AFTER the client tries to read the
-- course. Re-open the round from the Courses tab and it will resolve.
