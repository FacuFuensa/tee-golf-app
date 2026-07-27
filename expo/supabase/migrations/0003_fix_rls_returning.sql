-- Tee — fix Row Level Security for INSERT ... RETURNING
-- Paste this whole file into the Supabase SQL editor and run it once,
-- AFTER 0001_init.sql and 0002_course_catalog.sql.
--
-- WHY THIS EXISTS
-- The original SELECT policies on rounds / round_players / scores resolved
-- membership ONLY through the is_round_member() SECURITY DEFINER function,
-- which re-queries the table. During an INSERT ... RETURNING (what supabase-js
-- does when you call .select() after an insert/upsert), the freshly-inserted
-- row is not yet visible to that function's sub-query, so the policy returns
-- false and Postgres rejects the write with:
--   "new row violates row-level security policy"
-- That made starting a round and saving scores fail.
--
-- THE FIX
-- Add a direct, non-recursive ownership check (owner_id / profile_id = auth.uid())
-- to each SELECT policy. The new row satisfies it without re-querying the table,
-- so RETURNING works. Membership via is_round_member() is kept for everyone else.
--
-- NOTE: The app already works without this migration (it now inserts without
-- RETURNING), but running this hardens the schema and is recommended.

-- rounds ----------------------------------------------------------------------
drop policy if exists "rounds_select_member" on public.rounds;
create policy "rounds_select_member" on public.rounds
  for select to authenticated
  using (owner_id = auth.uid() or public.is_round_member(id));

-- round_players ---------------------------------------------------------------
drop policy if exists "round_players_select_member" on public.round_players;
create policy "round_players_select_member" on public.round_players
  for select to authenticated
  using (profile_id = auth.uid() or public.is_round_member(round_id));

-- scores ----------------------------------------------------------------------
drop policy if exists "scores_select_member" on public.scores;
create policy "scores_select_member" on public.scores
  for select to authenticated
  using (profile_id = auth.uid() or public.is_round_member(round_id));
