-- Tee — per-user course library
-- Paste this whole file into the Supabase SQL editor and run it once,
-- AFTER 0007_dedupe_catalog_courses.sql.
--
-- Until now, `courses` was a single GLOBAL catalog: every signed-in golfer saw
-- EVERY course, and there was no notion of "my saved courses". That had two
-- bad consequences:
--   1. Signing into a different account still showed the first account's
--      courses (they were global), so data appeared to leak across accounts.
--   2. A course already added by one golfer couldn't be independently "saved"
--      by another — there was nothing per-user to save into.
--
-- This migration introduces a per-user library (`user_courses`). The shared
-- `courses`/`holes` rows stay shared (so a green pinned by anyone is visible to
-- everyone who has that course), but WHICH courses show in a golfer's list is
-- now their own saved set. Two golfers can each save the same shared course.

-- ---------------------------------------------------------------------------
-- 1. The membership table: one row per (golfer, course) they've saved.
-- ---------------------------------------------------------------------------
create table if not exists public.user_courses (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  course_id uuid not null references public.courses (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (profile_id, course_id)
);

create index if not exists user_courses_profile_id_idx
  on public.user_courses (profile_id);
create index if not exists user_courses_course_id_idx
  on public.user_courses (course_id);

-- ---------------------------------------------------------------------------
-- 2. Backfill: every existing course joins the library of whoever created it,
--    so current golfers keep the courses they already had.
-- ---------------------------------------------------------------------------
insert into public.user_courses (profile_id, course_id)
select c.created_by, c.id
from public.courses c
where c.created_by is not null
on conflict (profile_id, course_id) do nothing;

-- ---------------------------------------------------------------------------
-- 3. Row Level Security: a golfer only ever sees/edits their own library rows.
-- ---------------------------------------------------------------------------
alter table public.user_courses enable row level security;

drop policy if exists "user_courses_select_own" on public.user_courses;
create policy "user_courses_select_own" on public.user_courses
  for select to authenticated using (profile_id = auth.uid());

drop policy if exists "user_courses_insert_own" on public.user_courses;
create policy "user_courses_insert_own" on public.user_courses
  for insert to authenticated with check (profile_id = auth.uid());

drop policy if exists "user_courses_delete_own" on public.user_courses;
create policy "user_courses_delete_own" on public.user_courses
  for delete to authenticated using (profile_id = auth.uid());
