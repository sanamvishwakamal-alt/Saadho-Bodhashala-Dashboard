const VALID_GLOBAL_ROLES = ['admin', 'facilitator', 'sadhak', 'guest'];
const VALID_PROGRAM_ROLES = ['admin', 'facilitator', 'sadhak', 'guest'];
const VALID_SCOPE_TYPES = ['global', 'program'];
const VALID_REGIONS = ['INDIA', 'NON INDIA'];

function getEnv() {
  const supabaseUrl = (process.env.SUPABASE_URL || '').trim();
  const anonKey = (process.env.SUPABASE_ANON_KEY || '').trim();
  const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  return { supabaseUrl, anonKey, serviceRoleKey };
}

function json(res, status, payload) {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(status).json(payload);
}

function getBearerToken(req) {
  const authHeader = req.headers['authorization'] || '';
  return authHeader.replace(/^Bearer\s+/i, '').trim();
}

function serviceHeaders(serviceRoleKey, extra = {}) {
  return {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

function userHeaders(anonKey, accessToken, extra = {}) {
  return {
    apikey: anonKey,
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let data = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch (_e) {
      data = { raw: text };
    }
  }
  return { ok: response.ok, status: response.status, data, headers: response.headers };
}

function buildRestUrl(supabaseUrl, table, params = {}) {
  const url = new URL(`${supabaseUrl}/rest/v1/${table}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, value);
  });
  return url.toString();
}

function quotePgValue(value) {
  return '"' + String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

function buildInFilter(values) {
  return `in.(${values.map(quotePgValue).join(',')})`;
}

async function verifyAccessToken(accessToken) {
  const { supabaseUrl, anonKey } = getEnv();
  if (!supabaseUrl || !anonKey) throw new Error('Server not configured.');
  const result = await fetchJson(`${supabaseUrl}/auth/v1/user`, {
    headers: userHeaders(anonKey, accessToken),
  });
  if (!result.ok) {
    const message = result.data.message || result.data.error_description || result.data.error || 'Invalid or expired token.';
    const error = new Error(message);
    error.status = 401;
    throw error;
  }
  return result.data;
}

async function serviceSelect(table, params = {}) {
  const { supabaseUrl, serviceRoleKey } = getEnv();
  if (!supabaseUrl || !serviceRoleKey) throw new Error('Server not configured.');
  const result = await fetchJson(buildRestUrl(supabaseUrl, table, params), {
    headers: serviceHeaders(serviceRoleKey),
  });
  if (!result.ok) {
    const error = new Error(result.data.message || `Failed to query ${table}.`);
    error.status = result.status;
    throw error;
  }
  return Array.isArray(result.data) ? result.data : [];
}

async function serviceUpsert(table, payload, options = {}) {
  const { supabaseUrl, serviceRoleKey } = getEnv();
  const result = await fetchJson(`${supabaseUrl}/rest/v1/${table}`, {
    method: 'POST',
    headers: serviceHeaders(serviceRoleKey, {
      Prefer: options.prefer || 'resolution=merge-duplicates,return=representation',
    }),
    body: JSON.stringify(payload),
  });
  if (!result.ok) {
    const error = new Error(result.data.message || `Failed to upsert ${table}.`);
    error.status = result.status;
    throw error;
  }
  return result.data;
}

async function serviceDelete(table, params = {}) {
  const { supabaseUrl, serviceRoleKey } = getEnv();
  const result = await fetchJson(buildRestUrl(supabaseUrl, table, params), {
    method: 'DELETE',
    headers: serviceHeaders(serviceRoleKey, { Prefer: 'return=minimal' }),
  });
  if (!result.ok) {
    const error = new Error(result.data.message || `Failed to delete from ${table}.`);
    error.status = result.status;
    throw error;
  }
  return true;
}

async function getUserRole(userId) {
  const rows = await serviceSelect('user_roles', { select: 'role', user_id: `eq.${userId}`, limit: '1' });
  return rows[0]?.role || 'guest';
}

async function getAccountStatus(userId) {
  const rows = await serviceSelect('user_account_status', { select: '*', user_id: `eq.${userId}`, limit: '1' });
  return rows[0] || {
    user_id: userId,
    is_locked: false,
    is_active: true,
    force_password_reset: false,
  };
}

async function getAdminScopes(userId) {
  return serviceSelect('user_admin_scopes', { select: 'scope_type,program_id', user_id: `eq.${userId}` });
}

async function getProgramAssignments(userId) {
  return serviceSelect('user_program_roles', { select: 'program_id,role', user_id: `eq.${userId}` });
}

async function getActorContext(req) {
  const accessToken = getBearerToken(req);
  if (!accessToken) {
    const error = new Error('Authentication required.');
    error.status = 401;
    throw error;
  }

  const user = await verifyAccessToken(accessToken);
  const role = await getUserRole(user.id);
  if (role !== 'admin') {
    const error = new Error('Admin access required.');
    error.status = 403;
    throw error;
  }

  const accountStatus = await getAccountStatus(user.id);
  if (!accountStatus.is_active) {
    const error = new Error('Your account is deactivated.');
    error.status = 403;
    throw error;
  }
  if (accountStatus.is_locked) {
    const error = new Error('Your account is locked.');
    error.status = 403;
    throw error;
  }

  const scopes = await getAdminScopes(user.id);
  const hasGlobalScope = scopes.some(scope => scope.scope_type === 'global');
  const programIds = scopes.filter(scope => scope.scope_type === 'program' && scope.program_id).map(scope => scope.program_id);

  return {
    accessToken,
    user,
    role,
    accountStatus,
    isGlobalAdmin: hasGlobalScope || scopes.length === 0,
    programIds,
  };
}

function assertProgramScope(actor, programIds) {
  const items = Array.isArray(programIds) ? programIds.filter(Boolean) : [];
  if (!items.length || actor.isGlobalAdmin) return;
  const allowed = new Set(actor.programIds || []);
  const disallowed = items.filter(programId => !allowed.has(programId));
  if (disallowed.length) {
    const error = new Error(`Program scope violation: ${disallowed.join(', ')}`);
    error.status = 403;
    throw error;
  }
}

function normalizeRegion(country, region) {
  const normalized = String(region || '').trim().toUpperCase();
  if (VALID_REGIONS.includes(normalized)) return normalized;
  return String(country || '').trim().toLowerCase() === 'india' ? 'INDIA' : (country ? 'NON INDIA' : 'INDIA');
}

function normalizeAssignments(assignments, actor) {
  const items = Array.isArray(assignments) ? assignments : [];
  const normalized = items
    .map(item => ({
      program_id: String(item?.program_id || '').trim(),
      role: String(item?.role || '').trim().toLowerCase(),
    }))
    .filter(item => item.program_id);

  normalized.forEach(item => {
    if (!VALID_PROGRAM_ROLES.includes(item.role)) {
      throw new Error(`Invalid program role for ${item.program_id}.`);
    }
  });

  assertProgramScope(actor, normalized.map(item => item.program_id));
  return normalized;
}

function normalizeAdminScopes(scopePayload, actor) {
  const scopeType = String(scopePayload?.scope_type || '').trim().toLowerCase();
  const programIds = Array.isArray(scopePayload?.program_ids) ? scopePayload.program_ids.map(value => String(value || '').trim()).filter(Boolean) : [];
  if (!scopeType) return [];
  if (!VALID_SCOPE_TYPES.includes(scopeType)) throw new Error('Invalid admin scope type.');
  if (scopeType === 'global') {
    if (!actor.isGlobalAdmin) {
      const error = new Error('Only global admins can assign global admin scope.');
      error.status = 403;
      throw error;
    }
    return [{ scope_type: 'global', program_id: null }];
  }
  assertProgramScope(actor, programIds);
  return programIds.map(programId => ({ scope_type: 'program', program_id: programId }));
}

function buildProfilePayload(userId, profile, actorUserId) {
  const payload = {
    user_id: userId,
    full_name: String(profile?.full_name || '').trim() || null,
    phone: String(profile?.phone || '').trim() || null,
    city: String(profile?.city || '').trim() || null,
    region: normalizeRegion(profile?.country || '', profile?.region || ''),
    country: String(profile?.country || '').trim() || null,
    language: String(profile?.language || '').trim() || null,
    group_name: String(profile?.group_name || '').trim() || null,
    notes: String(profile?.notes || '').trim() || null,
    updated_by: actorUserId,
  };
  return payload;
}

function buildStatusPayload(userId, status, actorUserId) {
  return {
    user_id: userId,
    is_locked: !!status?.is_locked,
    is_active: status?.is_active === undefined ? true : !!status.is_active,
    force_password_reset: !!status?.force_password_reset,
    locked_reason: String(status?.locked_reason || '').trim() || null,
    deactivated_reason: String(status?.deactivated_reason || '').trim() || null,
    last_password_reset_at: status?.last_password_reset_at || null,
    temp_password_issued_at: status?.temp_password_issued_at || null,
    updated_by: actorUserId,
  };
}

async function replaceProgramAssignments(userId, assignments) {
  await serviceDelete('user_program_roles', { user_id: `eq.${userId}` });
  if (!assignments.length) return [];
  return serviceUpsert('user_program_roles', assignments.map(item => ({ user_id: userId, program_id: item.program_id, role: item.role })), {
    prefer: 'resolution=merge-duplicates,return=representation',
  });
}

async function replaceAdminScopes(userId, scopes, actorUserId) {
  await serviceDelete('user_admin_scopes', { user_id: `eq.${userId}` });
  if (!scopes.length) return [];
  return serviceUpsert('user_admin_scopes', scopes.map(scope => ({ ...scope, user_id: userId, created_by: actorUserId })), {
    prefer: 'resolution=merge-duplicates,return=representation',
  });
}

async function writeAuditEvent(event) {
  return serviceUpsert('audit_log', {
    actor_user_id: event.actor_user_id || null,
    target_user_id: event.target_user_id || null,
    entity_type: event.entity_type,
    action: event.action,
    program_id: event.program_id || null,
    reason: event.reason || null,
    old_value: event.old_value || {},
    new_value: event.new_value || {},
  }, { prefer: 'return=representation' });
}

async function logLoginEvent(entry) {
  try {
    await serviceUpsert('user_login_events', {
      user_id: entry.user_id || null,
      email: entry.email || null,
      login_result: entry.login_result,
      ip_address: entry.ip_address || null,
      user_agent: entry.user_agent || null,
      metadata: entry.metadata || {},
    }, { prefer: 'return=minimal' });
  } catch (_e) {
    return null;
  }
  return true;
}

async function listAuthUsers() {
  const { supabaseUrl, serviceRoleKey } = getEnv();
  const allUsers = [];
  let page = 1;
  while (page <= 5) {
    const result = await fetchJson(`${supabaseUrl}/auth/v1/admin/users?page=${page}&per_page=200`, {
      headers: serviceHeaders(serviceRoleKey),
    });
    if (!result.ok) {
      const error = new Error(result.data.msg || 'Failed to list users.');
      error.status = result.status;
      throw error;
    }
    const items = Array.isArray(result.data?.users) ? result.data.users : [];
    allUsers.push(...items);
    if (items.length < 200) break;
    page += 1;
  }
  return allUsers;
}

function createTemporaryPassword() {
  return 'Tmp#' + Math.random().toString(36).slice(2, 8) + 'A1!';
}

module.exports = {
  VALID_GLOBAL_ROLES,
  VALID_PROGRAM_ROLES,
  VALID_SCOPE_TYPES,
  VALID_REGIONS,
  getEnv,
  json,
  getBearerToken,
  fetchJson,
  buildRestUrl,
  buildInFilter,
  verifyAccessToken,
  serviceSelect,
  serviceUpsert,
  serviceDelete,
  getUserRole,
  getAccountStatus,
  getAdminScopes,
  getProgramAssignments,
  getActorContext,
  assertProgramScope,
  normalizeRegion,
  normalizeAssignments,
  normalizeAdminScopes,
  buildProfilePayload,
  buildStatusPayload,
  replaceProgramAssignments,
  replaceAdminScopes,
  writeAuditEvent,
  logLoginEvent,
  listAuthUsers,
  createTemporaryPassword,
  serviceHeaders,
  userHeaders,
};