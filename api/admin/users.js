const {
  VALID_GLOBAL_ROLES,
  getEnv,
  json,
  fetchJson,
  serviceSelect,
  serviceUpsert,
  getActorContext,
  normalizeAssignments,
  normalizeAdminScopes,
  buildProfilePayload,
  buildStatusPayload,
  replaceProgramAssignments,
  replaceAdminScopes,
  writeAuditEvent,
  listAuthUsers,
  createTemporaryPassword,
  serviceHeaders,
} = require('../_lib/admin');

function mapBy(rows, key) {
  return new Map((rows || []).map(row => [row[key], row]));
}

function mergeUserRecord(authUser, roleMap, profileMap, statusMap, assignmentsMap, scopeMap, actor) {
  const userId = authUser.id;
  const assignments = (assignmentsMap.get(userId) || []).filter(item => actor.isGlobalAdmin || (actor.programIds || []).includes(item.program_id));
  const scopes = scopeMap.get(userId) || [];
  return {
    user_id: userId,
    email: authUser.email || '',
    created_at: authUser.created_at || '',
    last_sign_in_at: authUser.last_sign_in_at || '',
    role: roleMap.get(userId)?.role || 'guest',
    profile: profileMap.get(userId) || {},
    account_status: statusMap.get(userId) || { is_locked: false, is_active: true, force_password_reset: false },
    assignments,
    admin_scope: {
      scope_type: scopes.some(scope => scope.scope_type === 'global') || !scopes.length ? 'global' : 'program',
      program_ids: scopes.filter(scope => scope.scope_type === 'program' && scope.program_id).map(scope => scope.program_id),
    },
    auth_metadata: authUser.user_metadata || {},
  };
}

async function listUsers(actor, req) {
  const [authUsers, roleRows, profileRows, statusRows, assignmentRows, scopeRows, programRows] = await Promise.all([
    listAuthUsers(),
    serviceSelect('user_roles', { select: 'user_id,role' }),
    serviceSelect('user_profiles', { select: '*' }),
    serviceSelect('user_account_status', { select: '*' }),
    serviceSelect('user_program_roles', { select: 'user_id,program_id,role' }),
    serviceSelect('user_admin_scopes', { select: 'user_id,scope_type,program_id' }),
    serviceSelect('dashboard_snapshots', { select: 'program_id,project_name', order: 'updated_at.desc' }),
  ]);

  const roleMap = mapBy(roleRows, 'user_id');
  const profileMap = mapBy(profileRows, 'user_id');
  const statusMap = mapBy(statusRows, 'user_id');
  const assignmentsMap = assignmentRows.reduce((map, row) => {
    const items = map.get(row.user_id) || [];
    items.push(row);
    map.set(row.user_id, items);
    return map;
  }, new Map());
  const scopeMap = scopeRows.reduce((map, row) => {
    const items = map.get(row.user_id) || [];
    items.push(row);
    map.set(row.user_id, items);
    return map;
  }, new Map());

  let users = authUsers.map(authUser => mergeUserRecord(authUser, roleMap, profileMap, statusMap, assignmentsMap, scopeMap, actor));

  if (!actor.isGlobalAdmin) {
    const allowedPrograms = new Set(actor.programIds || []);
    users = users.filter(user => user.user_id === actor.user.id || user.assignments.some(item => allowedPrograms.has(item.program_id)));
  }

  const search = String(req.query.search || '').trim().toLowerCase();
  const roleFilter = String(req.query.role || '').trim().toLowerCase();
  const statusFilter = String(req.query.status || '').trim().toLowerCase();
  const programFilter = String(req.query.program_id || '').trim();

  if (search) {
    users = users.filter(user => {
      const haystack = [
        user.email,
        user.profile?.full_name,
        user.profile?.phone,
        user.profile?.city,
        user.profile?.group_name,
      ].join(' ').toLowerCase();
      return haystack.includes(search);
    });
  }
  if (roleFilter) users = users.filter(user => String(user.role || '').toLowerCase() === roleFilter);
  if (statusFilter === 'locked') users = users.filter(user => !!user.account_status?.is_locked);
  if (statusFilter === 'active') users = users.filter(user => user.account_status?.is_active !== false);
  if (statusFilter === 'inactive') users = users.filter(user => user.account_status?.is_active === false);
  if (programFilter) users = users.filter(user => user.assignments.some(item => item.program_id === programFilter));

  return {
    users,
    programs: Array.from(new Map(programRows.map(row => [row.program_id, row])).values()).map(row => ({
      program_id: row.program_id,
      project_name: row.project_name || row.program_id,
    })),
    actor: {
      user_id: actor.user.id,
      email: actor.user.email,
      is_global_admin: actor.isGlobalAdmin,
      program_ids: actor.programIds,
    },
  };
}

async function createAuthUser(body) {
  const { supabaseUrl, serviceRoleKey } = getEnv();
  const result = await fetchJson(`${supabaseUrl}/auth/v1/admin/users`, {
    method: 'POST',
    headers: serviceHeaders(serviceRoleKey),
    body: JSON.stringify(body),
  });
  if (!result.ok) {
    const error = new Error(result.data.msg || result.data.message || result.data.error || 'Failed to create auth user.');
    error.status = result.status;
    throw error;
  }
  return result.data.user || result.data;
}

async function updateAuthUser(userId, body) {
  const { supabaseUrl, serviceRoleKey } = getEnv();
  const result = await fetchJson(`${supabaseUrl}/auth/v1/admin/users/${userId}`, {
    method: 'PUT',
    headers: serviceHeaders(serviceRoleKey),
    body: JSON.stringify(body),
  });
  if (!result.ok) {
    const error = new Error(result.data.msg || result.data.message || result.data.error || 'Failed to update auth user.');
    error.status = result.status;
    throw error;
  }
  return result.data.user || result.data;
}

async function getMergedUserById(actor, userId) {
  const listing = await listUsers(actor, { query: {} });
  return listing.users.find(user => user.user_id === userId) || null;
}

module.exports = async function handler(req, res) {
  try {
    const actor = await getActorContext(req);

    if (req.method === 'GET') {
      return json(res, 200, await listUsers(actor, req));
    }

    if (req.method === 'POST') {
      const email = String(req.body?.email || '').trim().toLowerCase();
      const role = String(req.body?.role || '').trim().toLowerCase();
      if (!email) return json(res, 400, { error: 'Email is required.' });
      if (!VALID_GLOBAL_ROLES.includes(role)) return json(res, 400, { error: 'Invalid role.' });
      if (role === 'admin' && !actor.isGlobalAdmin) return json(res, 403, { error: 'Only global admins can create admin users.' });

      const assignments = normalizeAssignments(req.body?.assignments, actor);
      const tempPassword = String(req.body?.temporary_password || '').trim() || createTemporaryPassword();
      const authUser = await createAuthUser({
        email,
        password: tempPassword,
        email_confirm: true,
        user_metadata: { full_name: String(req.body?.profile?.full_name || '').trim() || email },
      });

      const userId = authUser.id;
      await serviceUpsert('user_roles', { user_id: userId, role }, { prefer: 'resolution=merge-duplicates,return=representation' });
      await serviceUpsert('user_profiles', buildProfilePayload(userId, req.body?.profile, actor.user.id), { prefer: 'resolution=merge-duplicates,return=representation' });
      await serviceUpsert('user_account_status', buildStatusPayload(userId, {
        is_locked: false,
        is_active: true,
        force_password_reset: req.body?.force_password_reset !== false,
        temp_password_issued_at: new Date().toISOString(),
        last_password_reset_at: new Date().toISOString(),
      }, actor.user.id), { prefer: 'resolution=merge-duplicates,return=representation' });
      await replaceProgramAssignments(userId, assignments);

      if (role === 'admin') {
        const scopes = normalizeAdminScopes(req.body?.admin_scope || { scope_type: 'global', program_ids: [] }, actor);
        await replaceAdminScopes(userId, scopes, actor.user.id);
      }

      await writeAuditEvent({
        actor_user_id: actor.user.id,
        target_user_id: userId,
        entity_type: 'user',
        action: 'user_created',
        reason: req.body?.reason || null,
        old_value: {},
        new_value: {
          email,
          role,
          assignments,
          profile: req.body?.profile || {},
        },
      });

      return json(res, 201, {
        ok: true,
        user_id: userId,
        email,
        temporary_password: tempPassword,
        force_password_reset: req.body?.force_password_reset !== false,
      });
    }

    if (req.method === 'PATCH') {
      const userId = String(req.body?.user_id || '').trim();
      if (!userId) return json(res, 400, { error: 'user_id is required.' });

      const previous = await getMergedUserById(actor, userId);
      if (!previous) return json(res, 404, { error: 'User not found or outside your admin scope.' });

      const nextRole = req.body?.role ? String(req.body.role).trim().toLowerCase() : previous.role;
      if (!VALID_GLOBAL_ROLES.includes(nextRole)) return json(res, 400, { error: 'Invalid role.' });
      if (nextRole === 'admin' && !actor.isGlobalAdmin) return json(res, 403, { error: 'Only global admins can assign admin role.' });

      const nextAssignments = req.body?.assignments !== undefined
        ? normalizeAssignments(req.body.assignments, actor)
        : previous.assignments;

      if (!actor.isGlobalAdmin && nextRole === 'admin') {
        return json(res, 403, { error: 'Only global admins can manage admin users.' });
      }

      const authUpdate = {};
      if (req.body?.email && String(req.body.email).trim().toLowerCase() !== previous.email) {
        authUpdate.email = String(req.body.email).trim().toLowerCase();
      }
      const requestedName = String(req.body?.profile?.full_name || '').trim();
      if (requestedName && requestedName !== String(previous.profile?.full_name || '').trim()) {
        authUpdate.user_metadata = { ...(previous.auth_metadata || {}), full_name: requestedName };
      }
      if (Object.keys(authUpdate).length) await updateAuthUser(userId, authUpdate);

      await serviceUpsert('user_roles', { user_id: userId, role: nextRole }, { prefer: 'resolution=merge-duplicates,return=representation' });
      if (req.body?.profile) {
        await serviceUpsert('user_profiles', buildProfilePayload(userId, { ...previous.profile, ...req.body.profile }, actor.user.id), {
          prefer: 'resolution=merge-duplicates,return=representation',
        });
      }
      if (req.body?.account_status) {
        await serviceUpsert('user_account_status', buildStatusPayload(userId, { ...previous.account_status, ...req.body.account_status }, actor.user.id), {
          prefer: 'resolution=merge-duplicates,return=representation',
        });
      }
      if (req.body?.assignments !== undefined) await replaceProgramAssignments(userId, nextAssignments);
      if (nextRole === 'admin' && req.body?.admin_scope) {
        const nextScopes = normalizeAdminScopes(req.body.admin_scope, actor);
        await replaceAdminScopes(userId, nextScopes, actor.user.id);
      }
      if (nextRole !== 'admin') {
        await replaceAdminScopes(userId, [], actor.user.id);
      }

      const current = await getMergedUserById(actor, userId);
      await writeAuditEvent({
        actor_user_id: actor.user.id,
        target_user_id: userId,
        entity_type: 'user',
        action: 'user_updated',
        reason: req.body?.reason || null,
        old_value: previous,
        new_value: current,
      });

      return json(res, 200, { ok: true, user: current });
    }

    return json(res, 405, { error: 'Method not allowed.' });
  } catch (error) {
    return json(res, error.status || 500, { error: error.message || 'Server error.' });
  }
};