-- ============================================================
-- 006_program_category.sql — Add category to dashboard_snapshots
-- Run this in the Supabase SQL editor.
-- ============================================================

alter table public.dashboard_snapshots
  add column if not exists category text not null default 'General';

-- Verification
select program_id, project_name, category from public.dashboard_snapshots order by category, program_id;
