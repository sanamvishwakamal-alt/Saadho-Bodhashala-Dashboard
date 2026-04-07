const {
  getEnv,
  json,
  verifyAccessToken,
  getUserRole,
  getProgramAssignments,
  getAccountStatus,
  getAdminScopes,
} = require('./_lib/admin');

// Returns enriched auth/account metadata for the bearer-token owner.
// All calls are server-side (Vercel → Supabase), so the browser never needs to reach Supabase.
module.exports = async function handler(req, res) {
  const authHeader = req.headers['authorization'] || '';
  const accessToken = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!accessToken) return json(res, 401, { error: 'No token provided.' });

  const { supabaseUrl, anonKey } = getEnv();
  if (!supabaseUrl || !anonKey) return json(res, 500, { error: 'Server not configured.' });

  try {
    const user = await verifyAccessToken(accessToken);
    const userId = user.id;
    const [role, assignments, accountStatus, adminScopes] = await Promise.all([
      getUserRole(userId),
      getProgramAssignments(userId),
      getAccountStatus(userId),
      getAdminScopes(userId),
    ]);

    const programIds = [...new Set(assignments.map(item => item.program_id).filter(Boolean))];
    const isGlobalAdmin = role === 'admin' && (adminScopes.some(scope => scope.scope_type === 'global') || !adminScopes.length);
    return json(res, 200, {
      email: user.email,
      role,
      programIds,
      assignments,
      account_status: {
        is_locked: !!accountStatus.is_locked,
        is_active: accountStatus.is_active !== false,
        force_password_reset: !!accountStatus.force_password_reset,
      },
      admin_scope: {
        is_global_admin: isGlobalAdmin,
        program_ids: adminScopes.filter(scope => scope.scope_type === 'program' && scope.program_id).map(scope => scope.program_id),
      },
      capabilities: {
        can_manage_users: role === 'admin',
        can_manage_all_programs: isGlobalAdmin,
        can_backup_snapshot: role === 'admin' || role === 'facilitator',
      },
    });
  } catch (e) {
    return json(res, e.status || 502, { error: e.message || 'Could not reach auth server.' });
  }
};
