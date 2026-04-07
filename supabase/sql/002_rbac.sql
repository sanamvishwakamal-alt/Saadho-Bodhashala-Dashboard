-- ============================================================
-- 002_rbac.sql  —  Role-Based Access Control for Dashboard
-- Run this AFTER 001_dashboard_snapshots.sql
-- ============================================================

-- ── 1. user_roles table ──────────────────────────────────────
-- Maps each Supabase auth user to a single app role.
-- Supported roles: admin | facilitator | sadhak | guest

create table if not exists public.user_roles (
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       text not null check (role in ('admin', 'facilitator', 'sadhak', 'guest')),
  created_at timestamptz not null default now(),
  primary key (user_id)
);

alter table public.user_roles enable row level security;

-- Authenticated users can only read their own role row.
drop policy if exists "user_roles_select_own" on public.user_roles;
create policy "user_roles_select_own"
  on public.user_roles
  for select
  to authenticated
  using (auth.uid() = user_id);

-- ── 2. get_my_role() helper ──────────────────────────────────
-- SECURITY DEFINER so it can bypass RLS when called
-- from within other policy expressions.

create or replace function public.get_my_role()
returns text
language sql
security definer
stable
as $$
  select role from public.user_roles where user_id = auth.uid();
$$;

-- ── 3. Replace open-anon policies on dashboard_snapshots ─────
-- Drop the three wide-open anonymous policies added by 001_*.sql

drop policy if exists "dashboard_snapshots_select_anon" on public.dashboard_snapshots;
drop policy if exists "dashboard_snapshots_insert_anon" on public.dashboard_snapshots;
drop policy if exists "dashboard_snapshots_update_anon" on public.dashboard_snapshots;

-- SELECT: admin and facilitator users can read snapshots.
drop policy if exists "dashboard_snapshots_select_auth" on public.dashboard_snapshots;
create policy "dashboard_snapshots_select_auth"
  on public.dashboard_snapshots
  for select
  to authenticated
  using (public.get_my_role() in ('admin', 'facilitator'));

-- INSERT: admin only.
drop policy if exists "dashboard_snapshots_insert_admin" on public.dashboard_snapshots;
create policy "dashboard_snapshots_insert_admin"
  on public.dashboard_snapshots
  for insert
  to authenticated
  with check (public.get_my_role() = 'admin');

-- UPDATE: admin only.
drop policy if exists "dashboard_snapshots_update_admin" on public.dashboard_snapshots;
create policy "dashboard_snapshots_update_admin"
  on public.dashboard_snapshots
  for update
  to authenticated
  using  (public.get_my_role() = 'admin')
  with check (public.get_my_role() = 'admin');

-- DELETE: admin only.
drop policy if exists "dashboard_snapshots_delete_admin" on public.dashboard_snapshots;
create policy "dashboard_snapshots_delete_admin"
  on public.dashboard_snapshots
  for delete
  to authenticated
  using (public.get_my_role() = 'admin');

-- ── 4. Seed: assign first admin (run manually after signup) ──
-- Replace the UUID below with the user_id from auth.users.
-- You can find it in: Supabase dashboard → Auth → Users

-- INSERT INTO public.user_roles (user_id, role)
-- VALUES ('<paste-admin-user-uuid-here>', 'admin')
-- ON CONFLICT (user_id) DO UPDATE SET role = 'admin';
