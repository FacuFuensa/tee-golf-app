-- Tee — App Store submission hardening
-- Paste this whole file into the Supabase SQL editor and run it once,
-- AFTER 0009_clubs.sql.
--
-- This migration fixes five things that would either fail App Review or
-- misrepresent what the app tells users it does:
--
--   1. Server-side moderation of the two free-text fields another golfer sees
--      (display name, hand-mapped course name). Apple's Guideline 1.2 requires
--      filtering of user-generated content BEFORE it is posted; a client-side
--      check alone can be bypassed by calling the API directly.
--   2. "Delete all my data" now actually deletes all of the golfer's data. It
--      previously left their course library and their club bag behind, which
--      made the button's own label untrue.
--   3. Deleting an account now also removes the courses that account
--      hand-mapped. Guideline 5.1.1(v) requires user-generated content shared
--      with others to be deleted too.
--   4. `holes` is no longer wholesale-writable. Migration 0005 deliberately let
--      any golfer pin a green — that feature is preserved — but it did so with
--      a row-level policy, and RLS row policies are not column-scoped, so it
--      also allowed rewriting par, number, yardage and course_id on every hole
--      in the database. Column-level grants close that without losing the
--      community-greens behaviour.
--   5. join_round_by_code is no longer callable by the anonymous role.
--
-- Everything here is idempotent and safe to re-run.

-- ---------------------------------------------------------------------------
-- 1. Server-side text moderation for user-generated content
-- ---------------------------------------------------------------------------

-- The `unaccent` extension is not enabled on every Supabase project, so fall
-- back to a plain passthrough rather than failing the migration. Accented
-- evasion is still caught by the client-side filter in utils/moderation.ts.
-- Defined FIRST because normalize_for_moderation below calls it, and a
-- `language sql` body is validated at creation time.
create or replace function public.unaccent_fallback(p_text text)
returns text
language plpgsql
immutable
as $$
begin
  return public.unaccent(p_text);
exception
  when undefined_function then
    return p_text;
end;
$$;

-- Mirrors expo/utils/moderation.ts. Keep the two lists in sync when either
-- changes. Normalisation strips accents, folds leetspeak and removes anything
-- that is not a letter or digit, so "f.u.c.k" and "f u c k" are caught too.
-- The two translate() arguments must stay the same length and align 1:1:
--   4->a  @->a  3->e  1->i  !->i  |->i  0->o  5->s  $->s  7->t
create or replace function public.normalize_for_moderation(p_text text)
returns text
language sql
immutable
as $$
  select regexp_replace(
    translate(
      lower(public.unaccent_fallback(p_text)),
      '4@31!|05$7',
      'aaeiiiosst'
    ),
    '[^a-z0-9]', '', 'g'
  );
$$;

-- Mirrors the two-list design in expo/utils/moderation.ts.
--
-- Matching every term as a substring is the obvious implementation and it is
-- wrong: it rejects Scunthorpe, grape, therapist, analysis, raccoon and
-- conspicuous, because each contains a slur. So terms are split by how safely
-- they can be matched:
--
--   SUBSTRING terms  — long and distinctive; matched anywhere in the collapsed
--                      string, which is what catches "f.u.c.k" and "f u c k".
--   WHOLE-WORD terms — short enough to live inside an innocent word; matched
--                      only against a separated token, or against the whole
--                      collapsed string (so "c u n t" is still caught).
create or replace function public.contains_blocked_term(p_text text)
returns boolean
language plpgsql
immutable
as $$
declare
  collapsed text := public.normalize_for_moderation(p_text);
  term text;
  token text;
  substring_terms text[] := array[
    'fuck','asshole','arsehole','blowjob','handjob','cumshot','creampie',
    'buttplug','hentai','dildo','pedophile','paedophile',
    'nigger','nigga','sandnigger','wetback','beaner','raghead','towelhead',
    'jigaboo','faggot','shemale','mongoloid','heilhitler','killyourself',
    'gilipollas','pelotudo','maricon','pendejo','sudaca'
  ];
  whole_word_terms text[] := array[
    'shit','cunt','pussy','whore','slut','bitch','wank','bastard','porn',
    'penis','vagina','anal','rape','rapist','incest','pedo',
    'chink','gook','spic','kike','coon','wop','dago',
    'fag','fagot','dyke','tranny',
    'retard','retarded','spastic',
    'hitler','nazi','kkk','jihadist','terrorist','genocide',
    'puta','puto','mierda','cabron','verga'
  ];
begin
  if collapsed is null or collapsed = '' then
    return false;
  end if;

  foreach term in array substring_terms loop
    if position(term in collapsed) > 0 then
      return true;
    end if;
  end loop;

  -- "c u n t" collapses to exactly "cunt"; Scunthorpe merely contains it.
  if collapsed = any (whole_word_terms) then
    return true;
  end if;

  foreach token in array regexp_split_to_array(coalesce(p_text, ''), '[^[:alnum:]]+') loop
    if token <> '' and public.normalize_for_moderation(token) = any (whole_word_terms) then
      return true;
    end if;
  end loop;

  return false;
end;
$$;

create or replace function public.reject_objectionable_profile_name()
returns trigger
language plpgsql
as $$
begin
  if length(trim(new.display_name)) < 2 then
    raise exception 'Display name needs at least 2 characters.'
      using errcode = 'check_violation';
  end if;
  if length(trim(new.display_name)) > 40 then
    raise exception 'Display name can be at most 40 characters.'
      using errcode = 'check_violation';
  end if;
  if public.contains_blocked_term(new.display_name) then
    raise exception 'That display name contains language we don''t allow.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_moderate_display_name on public.profiles;
create trigger profiles_moderate_display_name
  before insert or update of display_name on public.profiles
  for each row execute function public.reject_objectionable_profile_name();

create or replace function public.reject_objectionable_course_name()
returns trigger
language plpgsql
as $$
begin
  -- Only user-authored courses are moderated. Catalog imports carry real course
  -- names from GolfCourseAPI and must never be blocked by a false positive.
  if new.source is distinct from 'user' then
    return new;
  end if;
  if public.contains_blocked_term(new.name)
     or public.contains_blocked_term(coalesce(new.city, ''))
     or public.contains_blocked_term(coalesce(new.country, '')) then
    raise exception 'That course name contains language we don''t allow.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists courses_moderate_name on public.courses;
create trigger courses_moderate_name
  before insert or update of name, city, country on public.courses
  for each row execute function public.reject_objectionable_course_name();

-- ---------------------------------------------------------------------------
-- 2 + 3. Deletion actually deletes everything it claims to
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

  delete from public.scores        where profile_id = uid;
  delete from public.round_players where profile_id = uid;
  delete from public.rounds        where owner_id  = uid;
  -- Added here: these tables were introduced in 0008 and 0009, after the
  -- original delete_my_data was written, so they were silently never cleared.
  delete from public.user_courses  where profile_id = uid;
  delete from public.clubs         where profile_id = uid;
end;
$$;

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

  -- Courses this golfer typed the name of are their user-generated content and
  -- are visible to other golfers, so account deletion must remove them
  -- (Guideline 5.1.1(v)). Holes cascade with the course. Catalog-imported
  -- courses are shared reference data, not authored content, and are kept.
  delete from public.courses where created_by = uid and source = 'user';

  delete from auth.users where id = uid;
end;
$$;

grant execute on function public.delete_my_data()    to authenticated;
grant execute on function public.delete_my_account() to authenticated;
revoke execute on function public.delete_my_data()    from anon, public;
revoke execute on function public.delete_my_account() from anon, public;

-- ---------------------------------------------------------------------------
-- 4. Community greens, without letting anyone rewrite the scorecard
-- ---------------------------------------------------------------------------
-- 0005 granted `update ... using (true) with check (true)` on holes. RLS UPDATE
-- policies authorise the ROW, not specific columns, so that also permitted
-- overwriting par, number, yardage and course_id for every hole in the shared
-- catalog. Column-level privileges are the correct tool: the policy still lets
-- any golfer touch any hole, but the grant limits them to the green pin.

revoke update on public.holes from authenticated;
grant  update (green_lat, green_lng) on public.holes to authenticated;

-- ---------------------------------------------------------------------------
-- 5. join_round_by_code must not be reachable anonymously
-- ---------------------------------------------------------------------------
-- Postgres grants EXECUTE to PUBLIC by default on `create function`, and 0004
-- never revoked it. Unauthenticated callers could probe codes: a miss returned
-- an empty set, a hit raised a not-null violation on profile_id — a clean
-- hit/miss oracle. The guard makes the intent explicit; the revoke enforces it.

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
revoke execute on function public.join_round_by_code(text) from anon, public;

-- Two live rounds sharing a code would silently seat joiners in the wrong one.
create unique index if not exists rounds_active_join_code_key
  on public.rounds (upper(join_code))
  where join_code is not null and finished_at is null;
