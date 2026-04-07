-- ============================================================
-- 005_seed_initial_admin.sql  — Seed the first global admin
-- Run this AFTER 004_admin_control_plane.sql
-- ============================================================

-- Replace the email below before running.
do $$
declare
  v_email text := 'sanam.vishwakamal@gmail.com';
  v_user_id uuid;
begin
  select id
  into v_user_id
  from auth.users
  where lower(email) = lower(v_email)
  limit 1;

  if v_user_id is null then
    raise exception 'User not found in auth.users for email: %', v_email;
  end if;

  insert into public.user_roles (user_id, role)
  values (v_user_id, 'admin')
  on conflict (user_id) do update set role = excluded.role;

  insert into public.user_account_status (user_id)
  values (v_user_id)
  on conflict (user_id) do nothing;

  delete from public.user_admin_scopes
  where user_id = v_user_id;

  insert into public.user_admin_scopes (user_id, scope_type)
  values (v_user_id, 'global')
  on conflict do nothing;
end $$;

-- Verification
select u.email, r.role, s.is_active, s.is_locked, a.scope_type, a.program_id
from auth.users u
left join public.user_roles r on r.user_id = u.id
left join public.user_account_status s on s.user_id = u.id
left join public.user_admin_scopes a on a.user_id = u.id
where lower(u.email) = lower('sanam.vishwakamal@gmail.com');