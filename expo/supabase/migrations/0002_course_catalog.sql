-- Tee — course catalog (GolfCourseAPI) support
-- Paste this whole file into the Supabase SQL editor and run it once,
-- AFTER 0001_init.sql.

-- ---------------------------------------------------------------------------
-- courses: track imported catalog courses + their single course-level point
-- ---------------------------------------------------------------------------
alter table public.courses
  add column if not exists external_id text,
  add column if not exists source text not null default 'user',
  add column if not exists latitude double precision,
  add column if not exists longitude double precision;

-- One row per catalog course (prevents duplicate imports of the same course).
create unique index if not exists courses_external_id_key
  on public.courses (external_id)
  where external_id is not null;

-- ---------------------------------------------------------------------------
-- holes: store yardage; greens are unknown for catalog courses until a golfer
-- pins them, so green coordinates become nullable.
-- ---------------------------------------------------------------------------
alter table public.holes
  add column if not exists yardage int;

alter table public.holes alter column green_lat drop not null;
alter table public.holes alter column green_lng drop not null;

-- ---------------------------------------------------------------------------
-- RLS: any authenticated golfer can pin / refine greens on a catalog course
-- (manually-mapped 'user' courses stay editable only by their creator).
-- This is additive — it sits alongside holes_update_course_creator from 0001.
-- ---------------------------------------------------------------------------
drop policy if exists "holes_update_catalog" on public.holes;
create policy "holes_update_catalog" on public.holes
  for update to authenticated
  using (
    exists (
      select 1 from public.courses c
      where c.id = course_id and c.source <> 'user'
    )
  )
  with check (
    exists (
      select 1 from public.courses c
      where c.id = course_id and c.source <> 'user'
    )
  );
