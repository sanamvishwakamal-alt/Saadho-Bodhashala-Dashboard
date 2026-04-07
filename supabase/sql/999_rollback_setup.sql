-- ============================================================
-- 999_rollback_setup.sql
-- Full rollback for Saadho Bodhashala Dashboard SQL setup
--
-- Use for test resets only.
-- This removes tables, policies, triggers, and helper functions
-- created by 000_run_all_setup.sql / 001..006.
-- ============================================================

-- ----------------------------
-- Drop policies first (safe)
-- ----------------------------
-- dashboard_snapshots policies
DROP POLICY IF EXISTS "dashboard_snapshots_select_program_scoped" ON public.dashboard_snapshots;
DROP POLICY IF EXISTS "dashboard_snapshots_insert_program_scoped" ON public.dashboard_snapshots;
DROP POLICY IF EXISTS "dashboard_snapshots_update_program_scoped" ON public.dashboard_snapshots;
DROP POLICY IF EXISTS "dashboard_snapshots_delete_admin_only" ON public.dashboard_snapshots;
DROP POLICY IF EXISTS "dashboard_snapshots_select_auth" ON public.dashboard_snapshots;
DROP POLICY IF EXISTS "dashboard_snapshots_insert_admin" ON public.dashboard_snapshots;
DROP POLICY IF EXISTS "dashboard_snapshots_update_admin" ON public.dashboard_snapshots;
DROP POLICY IF EXISTS "dashboard_snapshots_delete_admin" ON public.dashboard_snapshots;
DROP POLICY IF EXISTS "dashboard_snapshots_select_anon" ON public.dashboard_snapshots;
DROP POLICY IF EXISTS "dashboard_snapshots_insert_anon" ON public.dashboard_snapshots;
DROP POLICY IF EXISTS "dashboard_snapshots_update_anon" ON public.dashboard_snapshots;

-- user_roles policies
DROP POLICY IF EXISTS "user_roles_select_own" ON public.user_roles;

-- user_program_roles policies
DROP POLICY IF EXISTS "user_program_roles_select_own" ON public.user_program_roles;
DROP POLICY IF EXISTS "user_program_roles_insert_admin" ON public.user_program_roles;
DROP POLICY IF EXISTS "user_program_roles_update_admin" ON public.user_program_roles;
DROP POLICY IF EXISTS "user_program_roles_delete_admin" ON public.user_program_roles;

-- admin control plane policies
DROP POLICY IF EXISTS "user_profiles_select_own" ON public.user_profiles;
DROP POLICY IF EXISTS "user_account_status_select_own" ON public.user_account_status;
DROP POLICY IF EXISTS "user_admin_scopes_select_own" ON public.user_admin_scopes;
DROP POLICY IF EXISTS "audit_log_select_admin_only" ON public.audit_log;
DROP POLICY IF EXISTS "user_login_events_select_admin_only" ON public.user_login_events;

-- ----------------------------
-- Drop triggers
-- ----------------------------
DROP TRIGGER IF EXISTS trg_dashboard_snapshots_updated_at ON public.dashboard_snapshots;
DROP TRIGGER IF EXISTS trg_user_profiles_updated_at ON public.user_profiles;
DROP TRIGGER IF EXISTS trg_user_account_status_updated_at ON public.user_account_status;

-- ----------------------------
-- Drop indexes
-- ----------------------------
DROP INDEX IF EXISTS public.user_admin_scopes_global_uniq;
DROP INDEX IF EXISTS public.user_admin_scopes_program_uniq;
DROP INDEX IF EXISTS public.audit_log_created_at_idx;
DROP INDEX IF EXISTS public.audit_log_target_user_id_idx;
DROP INDEX IF EXISTS public.audit_log_actor_user_id_idx;
DROP INDEX IF EXISTS public.audit_log_program_id_idx;
DROP INDEX IF EXISTS public.user_login_events_created_at_idx;
DROP INDEX IF EXISTS public.user_login_events_user_id_idx;

-- ----------------------------
-- Drop tables (reverse dependency order)
-- ----------------------------
DROP TABLE IF EXISTS public.user_login_events;
DROP TABLE IF EXISTS public.audit_log;
DROP TABLE IF EXISTS public.user_admin_scopes;
DROP TABLE IF EXISTS public.user_account_status;
DROP TABLE IF EXISTS public.user_profiles;
DROP TABLE IF EXISTS public.user_program_roles;
DROP TABLE IF EXISTS public.user_roles;
DROP TABLE IF EXISTS public.dashboard_snapshots;

-- ----------------------------
-- Drop helper functions
-- ----------------------------
DROP FUNCTION IF EXISTS public.get_my_role();
DROP FUNCTION IF EXISTS public.set_generic_updated_at();
DROP FUNCTION IF EXISTS public.set_dashboard_snapshot_updated_at();

-- ----------------------------
-- Verification
-- ----------------------------
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'dashboard_snapshots',
    'user_roles',
    'user_program_roles',
    'user_profiles',
    'user_account_status',
    'user_admin_scopes',
    'audit_log',
    'user_login_events'
  )
ORDER BY table_name;
