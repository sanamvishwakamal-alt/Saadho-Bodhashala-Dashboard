const {
  getEnv,
  json,
  fetchJson,
  serviceSelect,
  serviceUpsert,
  serviceDelete,
  getActorContext,
  buildStatusPayload,
  writeAuditEvent,
  createTemporaryPassword,
  serviceHeaders,
} = require('../_lib/admin');

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

async function sendRecoveryEmail(email) {
  const { supabaseUrl, anonKey } = getEnv();
  const result = await fetchJson(`${supabaseUrl}/auth/v1/recover`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email }),
  });
  if (!result.ok) {
    const error = new Error(result.data.msg || result.data.message || result.data.error || 'Failed to send reset link.');
    error.status = result.status;
    throw error;
  }
  return true;
}

async function deleteAuthUser(userId) {
  const { supabaseUrl, serviceRoleKey } = getEnv();
  const result = await fetchJson(`${supabaseUrl}/auth/v1/admin/users/${userId}`, {
    method: 'DELETE',
    headers: serviceHeaders(serviceRoleKey),
  });
  if (!result.ok) {
    const error = new Error(result.data.msg || result.data.message || result.data.error || 'Failed to delete user.');
    error.status = result.status;
    throw error;
  }
  return true;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed.' });

  try {
    const actor = await getActorContext(req);
    const userId = String(req.body?.user_id || '').trim();
    const action = String(req.body?.action || '').trim().toLowerCase();
    if (!userId || !action) return json(res, 400, { error: 'user_id and action are required.' });

    const profileRows = await serviceSelect('user_profiles', { select: '*', user_id: `eq.${userId}`, limit: '1' });
    const statusRows = await serviceSelect('user_account_status', { select: '*', user_id: `eq.${userId}`, limit: '1' });
    const roleRows = await serviceSelect('user_roles', { select: 'role', user_id: `eq.${userId}`, limit: '1' });
    const previousStatus = statusRows[0] || { is_locked: false, is_active: true, force_password_reset: false };
    const targetRole = roleRows[0]?.role || 'guest';

    let responsePayload = { ok: true };

    if (targetRole === 'admin' && !actor.isGlobalAdmin) {
      return json(res, 403, { error: 'Only global admins can manage admin accounts.' });
    }

    if (action === 'send_reset_link') {
      const email = String(req.body?.email || '').trim() || String(profileRows[0]?.email || '').trim();
      if (!email) return json(res, 400, { error: 'Email is required to send a reset link.' });
      await sendRecoveryEmail(email);
      await serviceUpsert('user_account_status', buildStatusPayload(userId, {
        ...previousStatus,
        last_password_reset_at: new Date().toISOString(),
      }, actor.user.id), { prefer: 'resolution=merge-duplicates,return=representation' });
      responsePayload.message = 'Reset link sent.';
    } else if (action === 'set_temporary_password') {
      const temporaryPassword = String(req.body?.temporary_password || '').trim() || createTemporaryPassword();
      await updateAuthUser(userId, { password: temporaryPassword });
      await serviceUpsert('user_account_status', buildStatusPayload(userId, {
        ...previousStatus,
        force_password_reset: true,
        temp_password_issued_at: new Date().toISOString(),
        last_password_reset_at: new Date().toISOString(),
      }, actor.user.id), { prefer: 'resolution=merge-duplicates,return=representation' });
      responsePayload.temporary_password = temporaryPassword;
    } else if (action === 'lock' || action === 'unlock') {
      await serviceUpsert('user_account_status', buildStatusPayload(userId, {
        ...previousStatus,
        is_locked: action === 'lock',
        locked_reason: action === 'lock' ? String(req.body?.reason || '').trim() || null : null,
      }, actor.user.id), { prefer: 'resolution=merge-duplicates,return=representation' });
    } else if (action === 'deactivate' || action === 'reactivate') {
      await serviceUpsert('user_account_status', buildStatusPayload(userId, {
        ...previousStatus,
        is_active: action === 'reactivate',
        deactivated_reason: action === 'deactivate' ? String(req.body?.reason || '').trim() || null : null,
      }, actor.user.id), { prefer: 'resolution=merge-duplicates,return=representation' });
    } else if (action === 'force_password_reset' || action === 'clear_force_password_reset') {
      await serviceUpsert('user_account_status', buildStatusPayload(userId, {
        ...previousStatus,
        force_password_reset: action === 'force_password_reset',
      }, actor.user.id), { prefer: 'resolution=merge-duplicates,return=representation' });
    } else if (action === 'delete_user') {
      // Only global admins can delete users
      if (!actor.isGlobalAdmin) {
        return json(res, 403, { error: 'Only global admins can delete users.' });
      }
      const email = String(req.body?.email || '').trim();
      const reason = String(req.body?.reason || '').trim() || 'User deleted by admin';
      // Delete from auth
      await deleteAuthUser(userId);
      // Delete related records from public tables
      await serviceDelete('user_account_status', { user_id: `eq.${userId}` });
      await serviceDelete('user_roles', { user_id: `eq.${userId}` });
      await serviceDelete('user_profiles', { user_id: `eq.${userId}` });
      await serviceDelete('user_program_roles', { user_id: `eq.${userId}` });
      await serviceDelete('user_admin_scopes', { user_id: `eq.${userId}` });
      responsePayload.message = 'User deleted successfully.';
    } else {
      return json(res, 400, { error: 'Unsupported action.' });
    }

    await writeAuditEvent({
      actor_user_id: actor.user.id,
      target_user_id: userId,
      entity_type: 'user_account',
      action,
      reason: req.body?.reason || null,
      old_value: previousStatus,
      new_value: { action, ...responsePayload },
    });

    return json(res, 200, responsePayload);
  } catch (error) {
    return json(res, error.status || 500, { error: error.message || 'Server error.' });
  }
};