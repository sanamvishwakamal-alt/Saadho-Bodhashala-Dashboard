-- Create 4 test users and assign roles in Supabase
-- Run this in the Supabase SQL editor

-- 1. Create users (if not already present)
insert into auth.users (email, encrypted_password, email_confirmed_at)
select 'admin@test.com', crypt('Test@1234', gen_salt('bf')), now()
where not exists (select 1 from auth.users where email = 'admin@test.com');

insert into auth.users (email, encrypted_password, email_confirmed_at)
select 'facilitator@test.com', crypt('Test@1234', gen_salt('bf')), now()
where not exists (select 1 from auth.users where email = 'facilitator@test.com');

insert into auth.users (email, encrypted_password, email_confirmed_at)
select 'member@test.com', crypt('Test@1234', gen_salt('bf')), now()
where not exists (select 1 from auth.users where email = 'member@test.com');

insert into auth.users (email, encrypted_password, email_confirmed_at)
select 'guest@test.com', crypt('Test@1234', gen_salt('bf')), now()
where not exists (select 1 from auth.users where email = 'guest@test.com');

-- 2. Assign roles
insert into public.user_roles (user_id, role) values
  ((select id from auth.users where email='admin@test.com'), 'admin'),
  ((select id from auth.users where email='facilitator@test.com'), 'facilitator'),
  ((select id from auth.users where email='member@test.com'), 'sadhak'),
  ((select id from auth.users where email='guest@test.com'), 'guest')
on conflict (user_id) do update set role = excluded.role;

-- 3. (Optional) Set account status to active
insert into public.user_account_status (user_id, is_active)
select id, true from auth.users where email in ('admin@test.com','facilitator@test.com','member@test.com','guest@test.com')
on conflict (user_id) do update set is_active = true;

-- 4. (Optional) Grant global admin scope to admin
insert into public.user_admin_scopes (user_id, scope_type)
select id, 'global' from auth.users where email = 'admin@test.com'
on conflict do nothing;

-- Now you can log in with:
-- admin@test.com / Test@1234
-- facilitator@test.com / Test@1234
-- member@test.com / Test@1234
-- guest@test.com / Test@1234
