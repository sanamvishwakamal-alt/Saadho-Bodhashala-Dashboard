const { getEnv, json, getAccountStatus, getUserRole, getAdminScopes, logLoginEvent } = require('./_lib/admin');

// Proxy sign-in: browser → Vercel → Supabase
// Avoids browser-to-Supabase network issues (firewall, DNS, CORS).
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return json(res, 405, { error: 'Method not allowed' });
  }

  const { email, password } = req.body || {};
  if (!email || !password) {
    return json(res, 400, { error: 'Email and password are required.' });
  }

  const { supabaseUrl, anonKey: supabaseAnonKey, serviceRoleKey } = getEnv();

  if (!supabaseUrl || !supabaseAnonKey) {
    return json(res, 500, { error: 'Server not configured. Contact administrator.' });
  }
  if (!serviceRoleKey) {
    return json(res, 500, { error: 'Server admin configuration missing (SUPABASE_SERVICE_ROLE_KEY).' });
  }

  try {
    const r = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: {
        'apikey': supabaseAnonKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email, password }),
    });

    const data = await r.json();

    if (!r.ok) {
      await logLoginEvent({
        email,
        login_result: 'invalid_credentials',
        ip_address: req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '',
        user_agent: req.headers['user-agent'] || '',
      });
      return json(res, r.status, {
        error: data.error_description || data.msg || data.error || 'Authentication failed.',
      });
    }

    const userId = data.user?.id;
    const accountStatus = userId ? await getAccountStatus(userId) : { is_locked: false, is_active: true, force_password_reset: false };
    if (!accountStatus.is_active) {
      await logLoginEvent({
        user_id: userId,
        email,
        login_result: 'blocked_deactivated',
        ip_address: req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '',
        user_agent: req.headers['user-agent'] || '',
      });
      return json(res, 403, { error: 'This account is deactivated. Contact an administrator.' });
    }
    if (accountStatus.is_locked) {
      await logLoginEvent({
        user_id: userId,
        email,
        login_result: 'blocked_locked',
        ip_address: req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '',
        user_agent: req.headers['user-agent'] || '',
      });
      return json(res, 403, { error: 'This account is locked. Contact an administrator.' });
    }

    const role = userId ? await getUserRole(userId) : 'guest';
    const adminScopes = userId && role === 'admin' ? await getAdminScopes(userId) : [];
    await logLoginEvent({
      user_id: userId,
      email,
      login_result: 'success',
      ip_address: req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '',
      user_agent: req.headers['user-agent'] || '',
      metadata: { role },
    });

    return json(res, 200, {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_in: data.expires_in,
      force_password_reset: !!accountStatus.force_password_reset,
      role,
      admin_scope: {
        scope_type: adminScopes.some(scope => scope.scope_type === 'global') || !adminScopes.length ? 'global' : 'program',
        program_ids: adminScopes.filter(scope => scope.scope_type === 'program' && scope.program_id).map(scope => scope.program_id),
      },
    });
  } catch (e) {
    const message = String(e?.message || '');
    if (/server not configured/i.test(message) || /supabase_service_role_key/i.test(message)) {
      return json(res, 500, { error: 'Server admin configuration missing (SUPABASE_SERVICE_ROLE_KEY).' });
    }
    return json(res, 502, { error: 'Could not reach auth server. Try again later.' });
  }
};
