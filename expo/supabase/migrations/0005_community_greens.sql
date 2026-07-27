-- Tee — community greens
-- Paste this whole file into the Supabase SQL editor and run it once,
-- AFTER 0004_join_by_code.sql.
--
-- Greens live on the shared `holes` table and are already readable by everyone
-- (holes_select_all). But until now only the course CREATOR could pin/refine a
-- green on a manually-added ('user') course, so a green dropped by another
-- golfer silently failed and never synced. This lets ANY authenticated golfer
-- pin or refine the green on ANY hole, so a green mapped by one player is
-- instantly shared with all players.
--
-- RLS permissive policies are OR'd together, so this additive policy widens
-- the existing holes_update_* policies without removing them.

drop policy if exists "holes_update_any_auth" on public.holes;
create policy "holes_update_any_auth" on public.holes
  for update to authenticated
  using (true)
  with check (true);
