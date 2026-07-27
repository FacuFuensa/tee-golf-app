-- Tee — multiplayer join-by-code RPC
-- Paste this whole file into the Supabase SQL editor and run it once,
-- AFTER 0001_init.sql, 0002_course_catalog.sql, and 0003_fix_rls_returning.sql.
--
-- WHY THIS EXISTS
-- A player who wants to join a group round by its code is NOT yet a member, so
-- the `rounds_select_member` RLS policy hides the round from them entirely —
-- they can't even look it up to join. This SECURITY DEFINER function runs with
-- elevated rights: it finds the active round for the given code, seats the
-- caller in `round_players`, and returns just the ids needed to open the round.
-- Once seated, the caller becomes a member and all normal RLS policies apply.

create or replace function public.join_round_by_code(p_code text)
returns table (round_id uuid, course_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_round public.rounds%rowtype;
begin
  -- Most recent active group round matching the code (case-insensitive).
  select * into v_round
  from public.rounds r
  where upper(r.join_code) = upper(p_code)
    and r.is_multiplayer = true
    and r.finished_at is null
  order by r.started_at desc
  limit 1;

  if not found then
    return;
  end if;

  insert into public.round_players (round_id, profile_id)
  values (v_round.id, auth.uid())
  on conflict (round_id, profile_id) do nothing;

  round_id := v_round.id;
  course_id := v_round.course_id;
  return next;
end;
$$;

grant execute on function public.join_round_by_code(text) to authenticated;
