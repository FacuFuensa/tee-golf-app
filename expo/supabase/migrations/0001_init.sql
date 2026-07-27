-- Tee — initial schema + Row Level Security
-- Paste this whole file into the Supabase SQL editor and run it once.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  handicap numeric,
  created_at timestamptz not null default now()
);

create table if not exists public.courses (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  city text,
  country text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.holes (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses (id) on delete cascade,
  number int not null,
  par int not null,
  green_lat double precision not null,
  green_lng double precision not null,
  unique (course_id, number)
);

create table if not exists public.rounds (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses (id) on delete cascade,
  owner_id uuid not null references public.profiles (id) on delete cascade,
  format text not null default 'stroke',
  join_code text,
  is_multiplayer boolean not null default false,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create table if not exists public.round_players (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.rounds (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  joined_at timestamptz not null default now(),
  unique (round_id, profile_id)
);

create table if not exists public.scores (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.rounds (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  hole_id uuid not null references public.holes (id) on delete cascade,
  strokes int not null default 0,
  putts int,
  updated_at timestamptz not null default now(),
  unique (round_id, profile_id, hole_id)
);

-- Helpful indexes
create index if not exists holes_course_id_idx on public.holes (course_id);
create index if not exists rounds_course_id_idx on public.rounds (course_id);
create index if not exists rounds_owner_id_idx on public.rounds (owner_id);
create index if not exists round_players_round_id_idx on public.round_players (round_id);
create index if not exists scores_round_id_idx on public.scores (round_id);
create index if not exists scores_hole_id_idx on public.scores (hole_id);

-- ---------------------------------------------------------------------------
-- SECURITY DEFINER helpers (avoid RLS recursion between rounds & round_players)
-- ---------------------------------------------------------------------------

create or replace function public.is_round_owner(p_round_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.rounds r
    where r.id = p_round_id and r.owner_id = auth.uid()
  );
$$;

create or replace function public.is_round_member(p_round_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.rounds r
    where r.id = p_round_id and r.owner_id = auth.uid()
  ) or exists (
    select 1 from public.round_players rp
    where rp.round_id = p_round_id and rp.profile_id = auth.uid()
  );
$$;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.profiles      enable row level security;
alter table public.courses       enable row level security;
alter table public.holes         enable row level security;
alter table public.rounds        enable row level security;
alter table public.round_players enable row level security;
alter table public.scores        enable row level security;

-- profiles: everyone (authenticated) can read; you can create + update only your own
create policy "profiles_select_all" on public.profiles
  for select to authenticated using (true);
create policy "profiles_insert_self" on public.profiles
  for insert to authenticated with check (auth.uid() = id);
create policy "profiles_update_own" on public.profiles
  for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

-- courses: authenticated can read & insert (must own what they create)
create policy "courses_select_all" on public.courses
  for select to authenticated using (true);
create policy "courses_insert_auth" on public.courses
  for insert to authenticated with check (auth.uid() = created_by);

-- holes: authenticated can read; only the course creator can insert/update
create policy "holes_select_all" on public.holes
  for select to authenticated using (true);
create policy "holes_insert_course_creator" on public.holes
  for insert to authenticated with check (
    exists (
      select 1 from public.courses c
      where c.id = course_id and c.created_by = auth.uid()
    )
  );
create policy "holes_update_course_creator" on public.holes
  for update to authenticated using (
    exists (
      select 1 from public.courses c
      where c.id = course_id and c.created_by = auth.uid()
    )
  );

-- rounds: owner & participants can read; owner creates & updates
create policy "rounds_select_member" on public.rounds
  for select to authenticated using (public.is_round_member(id));
create policy "rounds_insert_owner" on public.rounds
  for insert to authenticated with check (owner_id = auth.uid());
create policy "rounds_update_owner" on public.rounds
  for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- round_players: members can read; you add yourself, or the owner adds players
create policy "round_players_select_member" on public.round_players
  for select to authenticated using (public.is_round_member(round_id));
create policy "round_players_insert" on public.round_players
  for insert to authenticated with check (
    profile_id = auth.uid() or public.is_round_owner(round_id)
  );
create policy "round_players_delete" on public.round_players
  for delete to authenticated using (
    profile_id = auth.uid() or public.is_round_owner(round_id)
  );

-- scores: members can read; you write only your own rows
create policy "scores_select_member" on public.scores
  for select to authenticated using (public.is_round_member(round_id));
create policy "scores_insert_self" on public.scores
  for insert to authenticated with check (
    profile_id = auth.uid() and public.is_round_member(round_id)
  );
create policy "scores_update_self" on public.scores
  for update to authenticated using (profile_id = auth.uid()) with check (profile_id = auth.uid());
