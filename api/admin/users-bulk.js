const {
  VALID_GLOBAL_ROLES,
  VALID_PROGRAM_ROLES,
  getEnv,
  json,
  fetchJson,
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

const PROFILE_FIELDS = ['full_name', 'phone', 'city', 'region', 'country', 'language', 'group_name'];

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeLower(value) {
  return normalizeText(value).toLowerCase();
}

function buildSummary(results) {
  return results.reduce((summary, item) => {
    summary.total += 1;
    if (item.status === 'created') summary.created += 1;
    else if (item.status === 'updated') summary.updated += 1;
    else if (item.status === 'ready' || item.status === 'update') summary.ready += 1;
    else summary.failed += 1;
    summary.assignments += Array.isArray(item.assignments) ? item.assignments.length : 0;
    return summary;
  }, { total: 0, created: 0, updated: 0, ready: 0, failed: 0, assignments: 0 });
}

function mergeProfileField(target, field, nextValue, rowNumber, errors) {
  const value = normalizeText(nextValue);
  if (!value) return;
  if (!target[field]) {
    target[field] = value;
    return;
  }
  if (target[field] !== value) {
    errors.push(`Row ${rowNumber}: conflicting ${field} value for the same email.`);
  }
}

function mergeBulkRows(rows) {
  const grouped = new Map();
  const rowErrors = [];

  rows.forEach((rawRow, index) => {
    const rowNumber = index + 1;
    const email = normalizeLower(rawRow?.email);
    if (!email) {
      rowErrors.push({ row_number: rowNumber, email: '', status: 'error', errors: ['Email is required.'] });
      return;
    }

    const globalRole = normalizeLower(rawRow?.global_role || rawRow?.role || 'facilitator');
    const programId = normalizeText(rawRow?.program_id);
    const programRole = normalizeLower(rawRow?.program_role || rawRow?.assignment_role || globalRole || 'facilitator');
    const scopeType = normalizeLower(rawRow?.admin_scope_type || rawRow?.scope_type || '');

    if (!grouped.has(email)) {
      grouped.set(email, {
        email,
        role: globalRole,
        profile: {},
        assignmentsMap: new Map(),
        admin_scope_type: scopeType,
        reason: normalizeText(rawRow?.reason),
        row_numbers: [],
        errors: [],
      });
    }

    const entry = grouped.get(email);
    entry.row_numbers.push(rowNumber);

    if (entry.role && globalRole && entry.role !== globalRole) {
      entry.errors.push(`Row ${rowNumber}: conflicting global_role for ${email}.`);
    }
    if (scopeType) {
      if (entry.admin_scope_type && entry.admin_scope_type !== scopeType) {
        entry.errors.push(`Row ${rowNumber}: conflicting admin_scope_type for ${email}.`);
      } else if (!entry.admin_scope_type) {
        entry.admin_scope_type = scopeType;
      }
    }
    if (!entry.reason) entry.reason = normalizeText(rawRow?.reason);

    PROFILE_FIELDS.forEach(field => mergeProfileField(entry.profile, field, rawRow?.[field], rowNumber, entry.errors));

    if (programId) {
      if (!VALID_PROGRAM_ROLES.includes(programRole)) {
        entry.errors.push(`Row ${rowNumber}: invalid program_role for ${programId}.`);
      } else if (entry.assignmentsMap.has(programId) && entry.assignmentsMap.get(programId).role !== programRole) {
        entry.errors.push(`Row ${rowNumber}: conflicting program_role for ${programId}.`);
      } else {
        entry.assignmentsMap.set(programId, { program_id: programId, role: programRole, row_number: rowNumber });
      }
    }
  });

  return {
    groupedUsers: Array.from(grouped.values()).map(item => ({
      ...item,
      assignments: Array.from(item.assignmentsMap.values()).map(value => ({ program_id: value.program_id, role: value.role })),
    })),
    rowErrors,
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

function buildResultBase(entry) {
  return {
    email: entry.email,
    row_numbers: entry.row_numbers,
    role: entry.role,
    assignments: entry.assignments,
    admin_scope_type: entry.admin_scope_type || '',
  };
}

async function validateGroupedUsers(actor, rows, { updateExisting = false } = {}) {
  const { groupedUsers, rowErrors } = mergeBulkRows(rows);
  const existingUsers = await listAuthUsers();
  const existingEmailMap = new Map(existingUsers.map(user => [normalizeLower(user.email), user.id]));
  const results = [...rowErrors];

  groupedUsers.forEach(entry => {
    const result = buildResultBase(entry);
    const errors = [...entry.errors];
    const role = normalizeLower(entry.role);

    if (!VALID_GLOBAL_ROLES.includes(role)) {
      errors.push('Invalid global_role.');
    }

    const existingUserId = existingEmailMap.get(entry.email);
    const isExisting = !!existingUserId;
    if (isExisting && !updateExisting) {
      errors.push('A user with this email already exists. Enable \'Update existing\' to update them.');
    }

    let normalizedAssignments = [];
    try {
      normalizedAssignments = normalizeAssignments(entry.assignments, actor);
    } catch (error) {
      errors.push(error.message || 'Invalid program assignments.');
    }

    let normalizedScopes = [];
    if (role === 'admin') {
      const scopeType = entry.admin_scope_type || 'program';
      if (!actor.isGlobalAdmin) {
        errors.push('Only global admins can create admin users.');
      }
      if (scopeType === 'program' && !normalizedAssignments.length) {
        errors.push('Program-scoped admins must have at least one program assignment.');
      }
      try {
        normalizedScopes = normalizeAdminScopes({
          scope_type: scopeType,
          program_ids: normalizedAssignments.map(item => item.program_id),
        }, actor);
      } catch (error) {
        errors.push(error.message || 'Invalid admin scope.');
      }
    }

    const finalStatus = errors.length ? 'error' : (isExisting ? 'update' : 'ready');
    results.push({
      ...result,
      role,
      assignments: normalizedAssignments,
      admin_scope: role === 'admin' ? normalizedScopes : [],
      profile: entry.profile,
      reason: entry.reason || null,
      status: finalStatus,
      existing_user_id: isExisting ? existingUserId : undefined,
      errors,
    });
  });

  return results.sort((a, b) => {
    const aRow = Array.isArray(a.row_numbers) ? a.row_numbers[0] : a.row_number;
    const bRow = Array.isArray(b.row_numbers) ? b.row_numbers[0] : b.row_number;
    return (aRow || 0) - (bRow || 0);
  });
}

async function updateImportedUser(actor, entry, options = {}) {
  const userId = entry.existing_user_id;
  if (!userId) throw new Error('No existing user ID for update.');

  await serviceUpsert('user_roles', { user_id: userId, role: entry.role }, { prefer: 'resolution=merge-duplicates,return=representation' });
  await serviceUpsert('user_profiles', buildProfilePayload(userId, entry.profile, actor.user.id), { prefer: 'resolution=merge-duplicates,return=representation' });
  if (options.forcePasswordReset) {
    await serviceUpsert('user_account_status', buildStatusPayload(userId, {
      force_password_reset: true,
      last_password_reset_at: new Date().toISOString(),
    }, actor.user.id), { prefer: 'resolution=merge-duplicates,return=representation' });
  }
  await replaceProgramAssignments(userId, entry.assignments || []);
  if (entry.role === 'admin') {
    await replaceAdminScopes(userId, entry.admin_scope || [], actor.user.id);
  }

  await writeAuditEvent({
    actor_user_id: actor.user.id,
    target_user_id: userId,
    entity_type: 'user',
    action: 'user_bulk_updated',
    reason: entry.reason || null,
    old_value: {},
    new_value: {
      email: entry.email,
      role: entry.role,
      assignments: entry.assignments || [],
      profile: entry.profile || {},
      source_rows: entry.row_numbers || [],
    },
  });

  return { userId };
}

async function createImportedUser(actor, entry, options = {}) {
  const tempPassword = createTemporaryPassword();
  const authUser = await createAuthUser({
    email: entry.email,
    password: tempPassword,
    email_confirm: true,
    user_metadata: { full_name: normalizeText(entry.profile?.full_name) || entry.email },
  });

  const userId = authUser.id;
  await serviceUpsert('user_roles', { user_id: userId, role: entry.role }, { prefer: 'resolution=merge-duplicates,return=representation' });
  await serviceUpsert('user_profiles', buildProfilePayload(userId, entry.profile, actor.user.id), { prefer: 'resolution=merge-duplicates,return=representation' });
  await serviceUpsert('user_account_status', buildStatusPayload(userId, {
    is_locked: false,
    is_active: true,
    force_password_reset: options.forcePasswordReset !== false,
    temp_password_issued_at: new Date().toISOString(),
    last_password_reset_at: new Date().toISOString(),
  }, actor.user.id), { prefer: 'resolution=merge-duplicates,return=representation' });
  await replaceProgramAssignments(userId, entry.assignments || []);
  if (entry.role === 'admin') {
    await replaceAdminScopes(userId, entry.admin_scope || [], actor.user.id);
  }

  await writeAuditEvent({
    actor_user_id: actor.user.id,
    target_user_id: userId,
    entity_type: 'user',
    action: 'user_bulk_created',
    reason: entry.reason || null,
    old_value: {},
    new_value: {
      email: entry.email,
      role: entry.role,
      assignments: entry.assignments || [],
      profile: entry.profile || {},
      source_rows: entry.row_numbers || [],
    },
  });

  return { userId, tempPassword };
}

module.exports = async function handler(req, res) {
  try {
    const actor = await getActorContext(req);
    if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed.' });

    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    const dryRun = !!req.body?.dry_run;
    const forcePasswordReset = req.body?.force_password_reset !== false;
    const updateExisting = !!req.body?.update_existing;
    if (!rows.length) return json(res, 400, { error: 'rows array is required.' });

    const results = await validateGroupedUsers(actor, rows, { updateExisting });
    if (dryRun) {
      return json(res, 200, {
        ok: true,
        dry_run: true,
        results,
        summary: buildSummary(results),
      });
    }

    const finalResults = [];
    for (const entry of results) {
      if (entry.status === 'error') {
        finalResults.push(entry);
        continue;
      }
      if (entry.status === 'update') {
        try {
          const updated = await updateImportedUser(actor, entry, { forcePasswordReset });
          finalResults.push({
            ...entry,
            status: 'updated',
            user_id: updated.userId,
            errors: [],
          });
        } catch (error) {
          finalResults.push({
            ...entry,
            status: 'error',
            errors: [error.message || 'Could not update user.'],
          });
        }
        continue;
      }
      try {
        const created = await createImportedUser(actor, entry, { forcePasswordReset });
        finalResults.push({
          ...entry,
          status: 'created',
          user_id: created.userId,
          temporary_password: created.tempPassword,
          errors: [],
        });
      } catch (error) {
        finalResults.push({
          ...entry,
          status: 'error',
          errors: [error.message || 'Could not create user.'],
        });
      }
    }

    return json(res, 200, {
      ok: true,
      dry_run: false,
      results: finalResults,
      summary: buildSummary(finalResults),
    });
  } catch (error) {
    return json(res, error.status || 500, { error: error.message || 'Server error.' });
  }
};