# Saadho Bodhashala Dashboard Launch Guide

This project is now prepared for:
- GitHub source control
- Vercel deployment
- Supabase cloud snapshot + realtime state sync

## 1) Supabase Setup

1. Create a new Supabase project.
2. Open SQL Editor in Supabase.
3. Run one-shot setup SQL:
   - `supabase/sql/000_run_all_setup.sql`
4. If your project is already on an older schema, run incremental migration:
   - `supabase/sql/007_realtime_state_store.sql`
5. Copy these values from Project Settings -> API:
   - Project URL
   - Anon public key

## 2) GitHub Setup

1. In this folder, initialize and push if not already pushed:

```powershell
git add .
git commit -m "Prepare dashboard for Vercel + Supabase launch"
git branch -M main
git remote add origin <your-github-repo-url>
git push -u origin main
```

## 3) Vercel Setup

1. Go to Vercel and import your GitHub repository.
2. Framework preset: Other.
3. Root directory: project root.
4. Add Environment Variables in Vercel Project Settings:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
5. Deploy.

Notes:
- `vercel.json` rewrites `/` to `/Saadho_Bodhashala_Dashboard.html`.
- `api/config.js` exposes Supabase URL and anon key to the client safely for public usage.

## 4) Verify in Production

1. Open deployed dashboard.
2. Go to Admin -> Settings & Backup and sign in to cloud.
3. Confirm `DB Sync` status changes from waiting/offline to active/synced.
4. Change a few fields (for example attendance or notifications).
5. Confirm DB sync status shows a recent successful write.
6. Click `Retry Now` and verify no pending queue remains.
7. Switch program and verify state hydrates from DB.
8. Optionally test snapshot backup/restore as before.

## 5) Local Environment (Optional)

For local emulation, create `.env` from `.env.example` and run with Vercel CLI if needed.

```powershell
vercel dev
```

## Security Note

Current setup is auth-first with Supabase RLS policies for role and program scope.
Keep `SUPABASE_SERVICE_ROLE_KEY` server-side only (API routes) and never expose it in frontend code.

---

## 6) RBAC Setup (Role-Based Access Control)

This step enables email/password login and enforces server-side access control via Supabase RLS.
Run this **after** the initial deployment is working.

### Step 1 — Run the RBAC SQL

In Supabase → SQL Editor, run the contents of:

```
supabase/sql/002_rbac.sql
supabase/sql/003_program_permissions.sql
supabase/sql/004_admin_control_plane.sql
```

This creates:
- `user_roles` table (maps auth users to roles: admin / facilitator / sadhak / guest)
- `user_program_roles` table (maps auth users to specific program IDs)
- `user_profiles` table (GUI-managed profile fields)
- `user_account_status` table (lock / deactivate / force reset state)
- `user_admin_scopes` table (global admin vs program admin scope)
- `audit_log` and `user_login_events` tables (accountability + login history)
- `get_my_role()` helper function used by RLS policies
- Replaces the open anon policies with authenticated + program-scoped policies on `dashboard_snapshots`

### Step 1.1 — Service role key requirement

The new Admin → Users & Access GUI uses secure server-side admin APIs.
Those endpoints require this Vercel environment variable:

```text
SUPABASE_SERVICE_ROLE_KEY
```

Do not expose this key in frontend code.
It is only used inside Vercel API routes.

### Step 2 — Create the first Admin user

In Supabase → **Authentication → Users → Invite User**, invite the admin email.
The user sets their password via the invite link.

Then in SQL Editor, assign the admin role and admin scope.
The simplest option is to run:

```
supabase/sql/005_seed_initial_admin.sql
```

Replace the placeholder email in that file with the real admin email before running it.

If you want to run the statements manually instead, use:

```sql
INSERT INTO public.user_roles (user_id, role)
VALUES ('<paste-admin-user-uuid-here>', 'admin')
ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role;

INSERT INTO public.user_admin_scopes (user_id, scope_type)
VALUES ('<paste-admin-user-uuid-here>', 'global')
ON CONFLICT DO NOTHING;
```

### Step 3 — Sign in via the dashboard

Open the deployed dashboard → Admin → Settings & Backup.
Click **🔒 Sign In to Cloud** and enter the admin email and password.

After login:
- The role dropdown locks to `admin`
- Cloud backup and restore will work
- Unauthenticated users cannot read or write Supabase data

### Step 4 — Add Facilitator accounts (optional)

Create a user in Supabase Auth, then assign role:

```sql
INSERT INTO public.user_roles (user_id, role)
VALUES ('<facilitator-user-uuid>', 'facilitator');
```

Facilitators can sign in → see read-only cloud data. Backup (write) is disabled in the UI.

### Step 5 — Assign users to specific programs

Program-level access is enforced in DB and app.
Use each program's `id` value (e.g. `prog_1712486400000`) from your local app data.

```sql
INSERT INTO public.user_program_roles (user_id, program_id, role)
VALUES ('<user-uuid>', '<program-id>', 'facilitator')
ON CONFLICT (user_id, program_id) DO UPDATE SET role = EXCLUDED.role;
```

Use `role` as `facilitator`, `sadhak`, or `guest` as needed.
Users can only access programs assigned in this table.

### Step 6 — Bulk add users from Admin GUI

The Admin → Users & Access panel now includes a Bulk Add flow for CSV-based onboarding.

Current balanced import behavior:
- supports mixed global roles per user
- supports mixed program assignments per row
- merges repeated email rows into one user with multiple program assignments
- validates scope with a dry run before final import
- auto-generates temporary passwords and can force reset on first login

Recommended CSV columns:

```text
email,full_name,phone,city,region,country,language,group_name,global_role,program_id,program_role,admin_scope_type,reason
```

Notes:
- Use repeated rows with the same `email` to assign one person to multiple programs.
- For the first release, existing emails are rejected to avoid accidental overwrites.
- `admin_scope_type` is only relevant when `global_role=admin`.

### Role Summary

| Role        | Cloud Read | Cloud Write | Notes                          |
|-------------|------------|-------------|--------------------------------|
| admin       | ✅          | ✅           | Full access                    |
| facilitator | ✅          | ❌ (UI)      | Read-only cloud, full local    |
| sadhak      | ❌          | ❌           | Local-only                     |
| guest       | ❌          | ❌           | Local-only                     |
