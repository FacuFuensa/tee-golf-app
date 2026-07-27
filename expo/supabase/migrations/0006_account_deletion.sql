-- Tee — account & data deletion (Apple App Store guideline 5.1.1(v))
-- Paste this whole file into the Supabase SQL editor and run it once.

-- ---------------------------------------------------------------------------
-- Wipe everything the signed-in golfer owns, but KEEP their account/profile.
-- Removes their rounds (history), scores, and group memberships. Shared
-- courses/greens are left intact for other golfers.
-- ---------------------------------------------------------------------------
create or replace function public.delete_my_data()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  -- Scores the golfer recorded anywhere.
  delete from public.scores where profile_id = uid;
  -- Their seat in any group round.
  delete from public.round_players where profile_id = uid;
  -- Rounds they host (cascades to that round's scores & players).
  delete from public.rounds where owner_id = uid;
end;
$$;

-- ---------------------------------------------------------------------------
-- Permanently delete the golfer's account AND all of their data. Deleting the
-- auth user cascades to their profile, rounds, scores and memberships.
-- ---------------------------------------------------------------------------
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  perform public.delete_my_data();
  delete from auth.users where id = uid;
end;
$$;

grant execute on function public.delete_my_data() to authenticated;
grant execute on function public.delete_my_account() to authenticated;
