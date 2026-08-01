-- Delete a single round from the caller's history.
--
-- WHY A FUNCTION AND NOT A DELETE POLICY: `rounds` and `scores` have no DELETE
-- policy at all (0001_init.sql), which is why the app could only ever offer
-- delete_my_data() — erase everything or nothing. Adding plain DELETE policies
-- would not fix it: removing a round means deleting the caller's scores,
-- releasing their seat, and THEN deciding whether the round row should die — a
-- decision that depends on state the first two steps just changed. Split into
-- separate client calls that is not atomic: another player can take a seat
-- between the check and the delete, and the client would destroy their round
-- based on a stale read. A function runs whole or not at all, and exposes
-- exactly one operation instead of widening what the client may delete forever.
--
-- This matches delete_my_data / delete_my_account / join_round_by_code, which
-- are SECURITY DEFINER for the same reason.

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
  --
  -- Keyed on seats rather than scores on purpose: a player who joined but has
  -- not recorded a stroke yet would otherwise have the round vanish from their
  -- hands mid-play. They took a seat; not having scored does not make them
  -- less of a player.
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
