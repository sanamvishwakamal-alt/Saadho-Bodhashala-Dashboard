-- ============================================================
-- 005_seed_initial_admin.sql  — Seed the first global admin
-- Run this AFTER 004_admin_control_plane.sql
-- ============================================================

-- Replace the email below before running.
with target_user as (
  select id, email
  from auth.users
  where lower(email) = lower('sanam.vishwakamal@gmail.com')
  limit 1
)
insert into public.user_roles (user_id, role)
select id, 'admin'
from target_user
on conflict (user_id) do update set role = excluded.role;

with target_user as (
  select id
  from auth.users
  where lower(email) = lower('sanam.vishwakamal@gmail.com')
  limit 1
)
insert into public.user_account_status (user_id)
select id
from target_user
on conflict (user_id) do nothing;

with target_user as (
  select id
  from auth.users
  where lower(email) = lower('sanam.vishwakamal@gmail.com')
  limit 1
)
delete from public.user_admin_scopes s
using target_user t
where s.user_id = t.id;

with target_user as (
  select id
  from auth.users
  where lower(email) = lower('sanam.vishwakamal@gmail.com')
  limit 1
)
insert into public.user_admin_scopes (user_id, scope_type)
select id, 'global'
from target_user
on conflict do nothing;

-- Verification
select u.email, r.role, s.is_active, s.is_locked, a.scope_type, a.program_id
from auth.users u
left join public.user_roles r on r.user_id = u.id
left join public.user_account_status s on s.user_id = u.id
left join public.user_admin_scopes a on a.user_id = u.id
where lower(u.email) = lower('sanam.vishwakamal@gmail.com');