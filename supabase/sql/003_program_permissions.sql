-- ============================================================
-- 003_program_permissions.sql  — Program-based Access Control
-- Run this AFTER 002_rbac.sql
-- ============================================================

-- Per-program user assignment table.
create table if not exists public.user_program_roles (
  user_id uuid not null references auth.users(id) on delete cascade,
  program_id text not null,
  role text not null check (role in ('facilitator', 'sadhak', 'guest', 'admin')),
  created_at timestamptz not null default now(),
  primary key (user_id, program_id)
);

alter table public.user_program_roles enable row level security;

-- Users can read only their own program assignments.
drop policy if exists "user_program_roles_select_own" on public.user_program_roles;
create policy "user_program_roles_select_own"
  on public.user_program_roles
  for select
  to authenticated
  using (auth.uid() = user_id);

-- Admin can manage all program assignments.
drop policy if exists "user_program_roles_insert_admin" on public.user_program_roles;
create policy "user_program_roles_insert_admin"
  on public.user_program_roles
  for insert
  to authenticated
  with check (public.get_my_role() = 'admin');

drop policy if exists "user_program_roles_update_admin" on public.user_program_roles;
create policy "user_program_roles_update_admin"
  on public.user_program_roles
  for update
  to authenticated
  using (public.get_my_role() = 'admin')
  with check (public.get_my_role() = 'admin');

drop policy if exists "user_program_roles_delete_admin" on public.user_program_roles;
create policy "user_program_roles_delete_admin"
  on public.user_program_roles
  for delete
  to authenticated
  using (public.get_my_role() = 'admin');

-- Replace snapshot policies with program-aware RLS.
drop policy if exists "dashboard_snapshots_select_auth" on public.dashboard_snapshots;
drop policy if exists "dashboard_snapshots_insert_admin" on public.dashboard_snapshots;
drop policy if exists "dashboard_snapshots_update_admin" on public.dashboard_snapshots;
drop policy if exists "dashboard_snapshots_delete_admin" on public.dashboard_snapshots;

-- SELECT: admin can read all, facilitator/sadhak can read assigned programs.
create policy "dashboard_snapshots_select_program_scoped"
  on public.dashboard_snapshots
  for select
  to authenticated
  using (
    public.get_my_role() = 'admin'
    or exists (
      select 1
      from public.user_program_roles upr
      where upr.user_id = auth.uid()
        and upr.program_id = dashboard_snapshots.program_id
        and upr.role in ('facilitator', 'sadhak', 'admin')
    )
  );

-- INSERT: admin can create any; facilitator can create assigned program snapshots.
create policy "dashboard_snapshots_insert_program_scoped"
  on public.dashboard_snapshots
  for insert
  to authenticated
  with check (
    public.get_my_role() = 'admin'
    or exists (
      select 1
      from public.user_program_roles upr
      where upr.user_id = auth.uid()
        and upr.program_id = dashboard_snapshots.program_id
        and upr.role in ('facilitator', 'admin')
    )
  );

-- UPDATE: admin can update any; facilitator can update assigned program snapshots.
create policy "dashboard_snapshots_update_program_scoped"
  on public.dashboard_snapshots
  for update
  to authenticated
  using (
    public.get_my_role() = 'admin'
    or exists (
      select 1
      from public.user_program_roles upr
      where upr.user_id = auth.uid()
        and upr.program_id = dashboard_snapshots.program_id
        and upr.role in ('facilitator', 'admin')
    )
  )
  with check (
    public.get_my_role() = 'admin'
    or exists (
      select 1
      from public.user_program_roles upr
      where upr.user_id = auth.uid()
        and upr.program_id = dashboard_snapshots.program_id
        and upr.role in ('facilitator', 'admin')
    )
  );

-- DELETE: admin only.
create policy "dashboard_snapshots_delete_admin_only"
  on public.dashboard_snapshots
  for delete
  to authenticated
  using (public.get_my_role() = 'admin');

-- Example assignment SQL:
-- insert into public.user_program_roles (user_id, program_id, role)
-- values ('<user-uuid>', 'prog_1712486400000', 'facilitator')
-- on conflict (user_id, program_id) do update set role = excluded.role;
