-- Tee — de-duplicate catalog courses
-- Paste this whole file into the Supabase SQL editor and run it once,
-- AFTER 0006_account_deletion.sql.
--
-- Catalog courses are meant to be SHARED: the first golfer to add a course
-- creates the single row everyone else reuses (matched by external_id). But if
-- the same course was imported more than once before the unique index was in
-- place, duplicate rows exist for one external_id. That broke "add course" for
-- everyone, because the lookup that finds the existing row expected exactly one
-- match. This migration collapses those duplicates down to a single row per
-- external_id and (re)installs the unique index so it can never happen again.

-- ---------------------------------------------------------------------------
-- 1. Re-point any rounds that referenced a duplicate course onto the surviving
--    (oldest) row for that external_id, so no history is lost.
-- ---------------------------------------------------------------------------
with ranked as (
  select
    id,
    external_id,
    row_number() over (
      partition by external_id
      order by created_at asc, id asc
    ) as rn,
    first_value(id) over (
      partition by external_id
      order by created_at asc, id asc
    ) as keep_id
  from public.courses
  where external_id is not null
)
update public.rounds r
set course_id = ranked.keep_id
from ranked
where r.course_id = ranked.id
  and ranked.rn > 1;

-- ---------------------------------------------------------------------------
-- 2. Delete the duplicate course rows (their holes cascade away). The kept row
--    keeps whatever greens have already been pinned on it.
-- ---------------------------------------------------------------------------
with ranked as (
  select
    id,
    row_number() over (
      partition by external_id
      order by created_at asc, id asc
    ) as rn
  from public.courses
  where external_id is not null
)
delete from public.courses c
using ranked
where c.id = ranked.id
  and ranked.rn > 1;

-- ---------------------------------------------------------------------------
-- 3. Make the de-dup permanent: one row per external_id.
-- ---------------------------------------------------------------------------
create unique index if not exists courses_external_id_key
  on public.courses (external_id)
  where external_id is not null;
