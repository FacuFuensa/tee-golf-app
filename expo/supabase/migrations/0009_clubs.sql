-- Tee — per-user club bag (Smart Caddy)
-- Paste this whole file into the Supabase SQL editor and run it once,
-- AFTER 0008_user_course_library.sql.
--
-- The Smart Caddy recommends a club from the golfer's OWN bag. Each golfer
-- builds their bag here: one row per club with a typical carry distance. Carry
-- is stored in METERS (SI) so it's unit-agnostic — the app converts to yards or
-- meters for display based on the golfer's preference.

create table if not exists public.clubs (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  name text not null,
  carry_meters double precision not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists clubs_profile_id_idx on public.clubs (profile_id);

-- Row Level Security: a golfer only ever sees/edits their own clubs.
alter table public.clubs enable row level security;

drop policy if exists "clubs_select_own" on public.clubs;
create policy "clubs_select_own" on public.clubs
  for select to authenticated using (profile_id = auth.uid());

drop policy if exists "clubs_insert_own" on public.clubs;
create policy "clubs_insert_own" on public.clubs
  for insert to authenticated with check (profile_id = auth.uid());

drop policy if exists "clubs_update_own" on public.clubs;
create policy "clubs_update_own" on public.clubs
  for update to authenticated using (profile_id = auth.uid()) with check (profile_id = auth.uid());

drop policy if exists "clubs_delete_own" on public.clubs;
create policy "clubs_delete_own" on public.clubs
  for delete to authenticated using (profile_id = auth.uid());
