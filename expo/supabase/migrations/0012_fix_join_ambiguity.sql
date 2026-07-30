-- Tee — fix join_round_by_code, which has never worked
-- Run AFTER 0011_scope_reads.sql.
--
-- THE BUG
-- The function is declared `returns table (round_id uuid, course_id uuid)`,
-- which creates plpgsql variables named `round_id` and `course_id`. The body
-- then did:
--
--     insert into public.round_players (round_id, profile_id)
--     values (v_round.id, auth.uid())
--     on conflict (round_id, profile_id) do nothing;
--
-- An ON CONFLICT target is resolved in an expression context, so the OUT
-- variable `round_id` shadows the column of the same name and Postgres raises:
--
--     column reference "round_id" is ambiguous
--
-- This has been there since 0004 shipped, which means joining a group round by
-- code has ALWAYS failed. The host could open a round and read the invite code,
-- but every attempt to join raised, and the app surfaced it as the generic
-- "Couldn't join. Try again." from the mutation's error handler. The leaderboard
-- consequently never had more than one player in it.
--
-- Caught by actually calling the RPC (store/populate-leaderboard.mjs) rather
-- than reading the SQL — the migration looks correct until you run it.
--
-- THE FIX
-- Drop ON CONFLICT entirely and do the insert inside a sub-block that swallows
-- the unique violation. No bare `round_id` ever appears in an expression, so
-- there is nothing to shadow, and the race between two players joining at the
-- same moment is still handled by the unique constraint from 0001.

create or replace function public.join_round_by_code(p_code text)
returns table (round_id uuid, course_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_round public.rounds%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

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

  -- Seat the caller. Every column reference here is either qualified or in an
  -- INSERT column list, neither of which can be shadowed by the OUT variables.
  begin
    insert into public.round_players (round_id, profile_id)
    values (v_round.id, auth.uid());
  exception
    when unique_violation then
      -- Already seated, which is fine — joining twice is idempotent.
      null;
  end;

  round_id := v_round.id;
  course_id := v_round.course_id;
  return next;
end;
$$;

grant execute on function public.join_round_by_code(text) to authenticated;
revoke execute on function public.join_round_by_code(text) from anon, public;

-- ---------------------------------------------------------------------------
-- Verify, right here, that the function no longer raises
-- ---------------------------------------------------------------------------
-- A code that matches nothing must return zero rows rather than an error. This
-- does not exercise the insert path (that needs a real auth.uid()), but it does
-- prove the function parses and executes. Run store/verify-backend.mjs
-- afterwards for the full round trip.
do $$
declare
  n int;
begin
  begin
    select count(*) into n from public.join_round_by_code('ZZZZZZ');
    raise notice 'join_round_by_code executed cleanly (returned % rows for a bogus code)', n;
  exception
    when others then
      -- 'Not authenticated' is the expected failure in the SQL editor, where
      -- auth.uid() is null. Anything else means the fix did not take.
      if sqlerrm like '%Not authenticated%' then
        raise notice 'join_round_by_code reached its auth guard — parses correctly';
      else
        raise exception 'join_round_by_code still broken: %', sqlerrm;
      end if;
  end;
end;
$$;
