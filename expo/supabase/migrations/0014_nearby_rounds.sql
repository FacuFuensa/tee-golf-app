-- Tee — discover open rounds at the course you're standing on
-- Run AFTER 0013_delete_single_round.sql.
--
-- THE FEATURE
-- Today, joining a group round means the host reads out a six-character code.
-- Instead: open the app at a course where someone is already hosting, and get
-- offered that round directly. No code.
--
-- THE PRIVACY DECISION (already made elsewhere — this migration just
-- implements it)
-- The query this feature answers is "are there open rounds at THIS COURSE?",
-- never "who is near me?". A round is anchored to its course's location, not
-- to the host's device position — no host coordinates are ever stored or
-- returned. The caller's own lat/lng is used only to filter courses by
-- distance and is never persisted anywhere. The accepted residual exposure is
-- that a nearby golfer learns a round is open at a course and who is hosting
-- it — the `is_discoverable` switch below is how a host opts out of that.
--
-- WHAT THIS MIGRATION ADDS
--   1. rounds.is_discoverable — the switch, default true.
--   2. nearby_open_rounds()   — read-only discovery, course-anchored.
--   3. join_nearby_round()    — seats the caller, re-validating everything.
--
-- A NOTE ON THE 0012 BUG, BECAUSE IT ALMOST HAPPENED AGAIN HERE
-- 0012 fixed join_round_by_code, which had shipped broken since 0004: its
-- `returns table (round_id uuid, ...)` declares a plpgsql OUT variable named
-- `round_id`, and an `on conflict (round_id, profile_id)` target resolves
-- column names in an expression context — so the OUT variable shadowed the
-- real `round_players.round_id` column and every join raised "column
-- reference round_id is ambiguous". join_nearby_round below has the exact
-- same OUT parameter name and does the exact same seat-the-caller insert, so
-- it carries the exact same risk. It avoids the bug the same way 0012 fixed
-- it: no ON CONFLICT target anywhere, an explicit begin/exception block
-- catching unique_violation instead, and every table column referenced
-- anywhere in either function below is either qualified with its table alias
-- (r.id, rp.round_id, cr.r_course_id, ...) or appears only inside an INSERT
-- column list — 0012's own fix comment notes both of those are safe from
-- this class of shadowing. Nothing in this file leaves a bare, unqualified
-- reference to a column that shares a name with a declared variable or an
-- OUT parameter.

-- ---------------------------------------------------------------------------
-- 1. The switch
-- ---------------------------------------------------------------------------
-- Default true — the host opts OUT, not in; the owner's explicit call given
-- the accepted exposure above. `add column ... default true` backfills every
-- existing round to `true` without a separate UPDATE (Postgres has populated
-- new non-null columns from their default without a full table rewrite since
-- v11), so "existing rows get a sane value" falls out of the DDL for free.
--
-- No new grant or RLS policy is needed for a host to flip their own switch.
-- rounds_update_owner (0001) is `using (owner_id = auth.uid()) with check
-- (owner_id = auth.uid())` — a plain `update rounds set is_discoverable =
-- ... where id = ...` from the owner already satisfies both the USING (the
-- row is theirs before the write) and the WITH CHECK (owner_id is untouched,
-- so it's still theirs after). Nothing in 0010 narrowed UPDATE on `rounds` at
-- the column level — that column-level narrowing only ever touched `holes`
-- (community-greens hardening) — so the table-wide grant Supabase gives
-- `authenticated` by default still covers this new column, and the row
-- policy is what actually restricts a client to their own round, exactly
-- like every other column on `rounds`. A different golfer's row is simply
-- never reachable: USING fails before WITH CHECK is ever evaluated, so a
-- client cannot rewrite someone else's flag no matter what column grants
-- exist. That is what "check what the UPDATE policy allows today" settles.
alter table public.rounds
  add column if not exists is_discoverable boolean not null default true;

-- Speeds up nearby_open_rounds, which always filters on exactly this
-- combination before it ever looks at distance.
create index if not exists rounds_open_discoverable_idx
  on public.rounds (course_id, started_at)
  where is_multiplayer = true and finished_at is null and is_discoverable = true;

-- ---------------------------------------------------------------------------
-- 2. Discovery
-- ---------------------------------------------------------------------------
-- Great-circle distance in meters. Mirrors utils/geo.ts haversineMeters
-- exactly (same formula, same Earth radius 6,371,000 m) so "how far away" is
-- computed identically on the client (for courses you already know about) and
-- here (for courses you don't yet). Deliberately NOT a bounding box — a box
-- either over-includes at the corners or has to be padded past the real
-- radius, and the spec calls for real distance. Pure math, no table access,
-- so — like the moderation helpers in 0010_appstore_hardening.sql — it is
-- left with Postgres's default PUBLIC execute grant; there is nothing in it
-- to protect.
create or replace function public.great_circle_meters(
  p_lat1 double precision,
  p_lng1 double precision,
  p_lat2 double precision,
  p_lng2 double precision
)
returns double precision
language sql
immutable
as $$
  select 2 * 6371000 * asin(
    least(1, sqrt(
      sin(radians(p_lat2 - p_lat1) / 2) ^ 2 +
      cos(radians(p_lat1)) * cos(radians(p_lat2)) *
      sin(radians(p_lng2 - p_lng1) / 2) ^ 2
    ))
  )
$$;

-- Open group rounds at courses within p_radius_meters of (p_lat, p_lng).
--
-- SECURITY DEFINER because the caller is, by definition, not yet a member of
-- any round this returns — same reason join_round_by_code needs it (0004's
-- comment), and the same reason courses_select_scoped (0011) would otherwise
-- hide a hand-mapped course, and its holes, from someone who hasn't played or
-- saved it yet. Running as the definer bypasses those SELECT policies for the
-- purpose of computing a distance and a display name; it does not widen what
-- the function RETURNS to the caller — that is controlled entirely by the
-- explicit column list below, which is deliberately thin:
--   * no coordinates, of the course or anything else, ever leave this
--     function — only a distance already computed server-side;
--   * no owner_id / created_by — only the host's display_name, which is the
--     one piece of identity the product decision explicitly keeps.
create or replace function public.nearby_open_rounds(
  p_lat double precision,
  p_lng double precision,
  p_radius_meters double precision
)
returns table (
  round_id uuid,
  course_id uuid,
  course_name text,
  host_display_name text,
  format text,
  started_at timestamptz,
  distance_meters double precision
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_radius double precision;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  if p_lat is null or p_lng is null then
    return;
  end if;

  -- Hard server-side cap regardless of what the client asks for. Without
  -- this, a client could pass an enormous radius and turn "is there a round
  -- at the course I'm standing on" into "list every open round on Earth" —
  -- exactly the "who is near me" query the product decision rejected. 80 km
  -- is not an arbitrary number: it is the same "realistically the one you're
  -- heading to" threshold app/(tabs)/courses.tsx already uses for its own
  -- "closest course" and "new course nearby" suggestions, so this cap never
  -- excludes anything the app's existing UI would have suggested anyway.
  v_radius := least(coalesce(p_radius_meters, 0), 80000);
  if v_radius <= 0 then
    return;
  end if;

  return query
  with candidate_rounds as (
    -- Every filter that does NOT depend on distance, applied first so the
    -- (more expensive) course-location resolution below only runs for
    -- courses that could actually matter.
    select
      r.id as r_id,
      r.course_id as r_course_id,
      r.owner_id as r_owner_id,
      r.format as r_format,
      r.started_at as r_started_at
    from public.rounds r
    where r.is_multiplayer = true
      and r.finished_at is null
      and r.is_discoverable = true
      -- Freshness window: 6 hours. An 18-hole round runs ~4 hours at a
      -- normal pace; 6 hours covers a slow round, a rain delay, or a long
      -- lunch turn without covering "abandoned three weeks ago". Relying on
      -- finished_at is null alone is not enough — an abandoned round has
      -- finished_at null FOREVER, since nobody ever finishes or deletes it,
      -- so without this window a ghost round from weeks ago would surface
      -- indefinitely. This is the same "actually live" gap 0013's own
      -- comments call out for stuck rounds, just filtered here instead of
      -- cleaned up there.
      and r.started_at > now() - interval '6 hours'
      -- Never offer the caller their own round.
      and r.owner_id <> v_uid
      -- Never offer a round the caller already sits in.
      and not exists (
        select 1 from public.round_players rp
        where rp.round_id = r.id and rp.profile_id = v_uid
      )
  ),
  course_point as (
    -- The course's own point when known, else the centroid of its pinned
    -- greens. This MUST match resolvedPoint() in app/(tabs)/courses.tsx
    -- (own latitude/longitude, falling back to the average of
    -- holes.green_lat/green_lng where both are non-null) or courses that
    -- only have that fallback — like a hand-mapped course whose creator
    -- never set a course-level point but has pinned all 18 greens — would
    -- silently never be discoverable. Scoped to just the courses behind
    -- candidate_rounds rather than every course in the catalog.
    select
      c.id as pc_course_id,
      coalesce(c.latitude, avg(h.green_lat)) as pc_lat,
      coalesce(c.longitude, avg(h.green_lng)) as pc_lng
    from public.courses c
    left join public.holes h
      on h.course_id = c.id
     and h.green_lat is not null
     and h.green_lng is not null
    where c.id in (select cr.r_course_id from candidate_rounds cr)
    group by c.id, c.latitude, c.longitude
  )
  select
    cr.r_id,
    cr.r_course_id,
    c.name,
    pr.display_name,
    cr.r_format,
    cr.r_started_at,
    public.great_circle_meters(p_lat, p_lng, cp.pc_lat, cp.pc_lng) as dist_m
  from candidate_rounds cr
  join public.courses c on c.id = cr.r_course_id
  join public.profiles pr on pr.id = cr.r_owner_id
  join course_point cp on cp.pc_course_id = cr.r_course_id
  where cp.pc_lat is not null
    and cp.pc_lng is not null
    and public.great_circle_meters(p_lat, p_lng, cp.pc_lat, cp.pc_lng) <= v_radius
  order by dist_m asc
  -- Bounded: nobody needs to browse past the closest couple dozen open
  -- rounds, and an unbounded scan is one more thing a huge radius could turn
  -- into a fishing expedition.
  limit 25;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Joining
-- ---------------------------------------------------------------------------
-- Seats the caller in a round previously surfaced by nearby_open_rounds.
-- Deliberately does NOT trust that the client only ever calls this with a
-- round_id it legitimately discovered — p_round_id is just a UUID typed by
-- the app, and nothing stops a client from calling this RPC directly with a
-- guessed or previously-seen id. So every condition nearby_open_rounds
-- filtered on is re-checked here from scratch, against the current state of
-- the row, not whatever the client believes: still multiplayer, still
-- unfinished, still discoverable, still within its freshness window, still
-- not the caller's own round, and still within p_radius_meters of the
-- course's resolved point given the (also caller-asserted, unverifiable)
-- p_lat/p_lng. That last point is a real limit, not an oversight: this
-- function has no way to confirm a caller's device is actually where it
-- claims — see the migration report for what that does and does not expose.
create or replace function public.join_nearby_round(
  p_round_id uuid,
  p_lat double precision,
  p_lng double precision,
  p_radius_meters double precision
)
returns table (
  round_id uuid,
  course_id uuid,
  status text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_radius double precision;
  v_round public.rounds%rowtype;
  v_pt_lat double precision;
  v_pt_lng double precision;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  -- Same cap as nearby_open_rounds, and enforced independently here too —
  -- otherwise a client could get the discovery-side cap by calling that
  -- function honestly, then bypass it entirely by calling this one directly
  -- with a much larger radius.
  v_radius := least(coalesce(p_radius_meters, 0), 80000);

  if p_round_id is null or v_radius <= 0 or p_lat is null or p_lng is null then
    round_id := p_round_id;
    course_id := null;
    status := 'unavailable';
    return next;
    return;
  end if;

  -- Lock the round row for the duration of this check-then-act, the same way
  -- delete_my_round (0013) locks it before deciding what "the current state"
  -- even means — otherwise a host flipping is_discoverable off, or finishing
  -- the round, in the instant between this SELECT and the INSERT below could
  -- race a join that should have been refused.
  select * into v_round
  from public.rounds r
  where r.id = p_round_id
  for update;

  if not found
     or not v_round.is_multiplayer
     or v_round.finished_at is not null
     or not v_round.is_discoverable
     or v_round.started_at <= now() - interval '6 hours'
     or v_round.owner_id = v_uid
  then
    -- One outcome, "unavailable", for every ineligibility reason — a round
    -- that plain does not exist looks identical to one that exists but is
    -- finished, private, stale, or the caller's own. Mirrors delete_my_round
    -- (0013), which "deliberately does not distinguish 'no such round' from
    -- 'not yours', so a caller cannot probe for other people's rounds" — the
    -- same anti-enumeration reasoning applies to a caller trying to learn
    -- something about a guessed round_id from this function's answer.
    round_id := p_round_id;
    course_id := null;
    status := 'unavailable';
    return next;
    return;
  end if;

  -- Re-resolve the course's point exactly as nearby_open_rounds does — see
  -- that function's course_point comment for why the fallback exists at all.
  select coalesce(c.latitude, g.avg_lat), coalesce(c.longitude, g.avg_lng)
    into v_pt_lat, v_pt_lng
  from public.courses c
  left join (
    select h.course_id as hc_id, avg(h.green_lat) as avg_lat, avg(h.green_lng) as avg_lng
    from public.holes h
    where h.green_lat is not null and h.green_lng is not null
    group by h.course_id
  ) g on g.hc_id = c.id
  where c.id = v_round.course_id;

  if v_pt_lat is null or v_pt_lng is null
     or public.great_circle_meters(p_lat, p_lng, v_pt_lat, v_pt_lng) > v_radius
  then
    round_id := p_round_id;
    course_id := null;
    status := 'unavailable';
    return next;
    return;
  end if;

  -- Seat the caller. NO ON CONFLICT target here — see this file's header
  -- comment on the 0012 bug. Catching unique_violation instead of using
  -- ON CONFLICT both sidesteps that shadowing hazard entirely and IS the
  -- idempotency this function is required to have: a second call for a
  -- caller who is already seated hits this exception, does nothing, and
  -- still reports 'joined' below, exactly like join_round_by_code does for
  -- a repeat join by code.
  begin
    insert into public.round_players (round_id, profile_id)
    values (v_round.id, v_uid);
  exception
    when unique_violation then
      null;
  end;

  -- Every prior exit above returned 'unavailable' via return next; this is
  -- the ONLY path that reports success, and it only runs after the insert
  -- (or the caught exception proving the caller is now, in fact, seated)
  -- above has actually executed. There is no path that returns a status
  -- ambiguous between "joined" and "nothing happened" — the exact failure
  -- mode behind three previous bugs in this codebase where a write touched
  -- zero rows, raised nothing, and the app reported success anyway.
  round_id := v_round.id;
  course_id := v_round.course_id;
  status := 'joined';
  return next;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Grants — match 0013's posture exactly
-- ---------------------------------------------------------------------------
-- great_circle_meters is intentionally excluded: it is pure arithmetic with
-- no table access, so there is nothing for a revoke to protect (same as
-- 0010's moderation helpers). Both RPCs below DO touch table data through a
-- SECURITY DEFINER bypass of RLS, so — like join_round_by_code and
-- delete_my_round — they must not be reachable by anon/public: an anonymous
-- caller with the public anon key must not be able to probe for open rounds
-- or seat itself in one.
revoke all on function public.nearby_open_rounds(double precision, double precision, double precision) from public, anon;
grant execute on function public.nearby_open_rounds(double precision, double precision, double precision) to authenticated;

revoke all on function public.join_nearby_round(uuid, double precision, double precision, double precision) from public, anon;
grant execute on function public.join_nearby_round(uuid, double precision, double precision, double precision) to authenticated;
