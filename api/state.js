// Program-scoped key-value state API for direct DB persistence.
// Uses user's access token so Supabase RLS controls visibility and write access.
module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  const authHeader = req.headers['authorization'] || '';
  const accessToken = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!accessToken) return res.status(401).json({ error: 'Authentication required.' });

  const supabaseUrl = (process.env.SUPABASE_URL || '').trim();
  const anonKey = (process.env.SUPABASE_ANON_KEY || '').trim();
  if (!supabaseUrl || !anonKey) {
    return res.status(500).json({ error: 'Server not configured.' });
  }

  const headers = {
    apikey: anonKey,
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  };

  const sendRest = async (url, options = {}) => {
    const r = await fetch(url, options);
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = data.message || data.error_description || data.error || 'State API request failed.';
      const err = new Error(msg);
      err.status = r.status;
      throw err;
    }
    return data;
  };

  try {
    if (req.method === 'GET') {
      const programId = String(req.query.program_id || '').trim();
      if (!programId) return res.status(400).json({ error: 'program_id is required.' });

      const includeGlobal = String(req.query.include_global || '1').trim() !== '0';
      const keyPrefix = String(req.query.key_prefix || '').trim();
      const limitRaw = parseInt(String(req.query.limit || '500'), 10);
      const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(limitRaw, 2000)) : 500;

      const filters = [];
      if (includeGlobal) {
        filters.push(`and(program_id.eq.${encodeURIComponent(programId)})`);
        filters.push('and(program_id.eq.__global__)');
      }

      const queryProgram = includeGlobal
        ? `or=(program_id.eq.${encodeURIComponent(programId)},program_id.eq.__global__)`
        : `program_id=eq.${encodeURIComponent(programId)}`;

      const queryPrefix = keyPrefix ? `&state_key=like.${encodeURIComponent(keyPrefix + '%')}` : '';
      const url = `${supabaseUrl}/rest/v1/dashboard_state_entries?select=program_id,state_key,state_value,updated_at&${queryProgram}${queryPrefix}&order=updated_at.desc&limit=${limit}`;
      const rows = await sendRest(url, { headers });
      return res.status(200).json({ rows: Array.isArray(rows) ? rows : [] });
    }

    if (req.method === 'POST') {
      const body = req.body || {};
      const incoming = Array.isArray(body.entries) ? body.entries : [];
      if (!incoming.length) {
        return res.status(400).json({ error: 'entries array is required.' });
      }
      if (incoming.length > 250) {
        return res.status(400).json({ error: 'Maximum 250 entries per request.' });
      }

      const entries = incoming.map((entry) => ({
        program_id: String(entry?.program_id || '').trim(),
        state_key: String(entry?.state_key || '').trim(),
        state_value: entry?.state_value === undefined ? null : entry.state_value,
      })).filter((entry) => entry.program_id && entry.state_key);

      if (!entries.length) {
        return res.status(400).json({ error: 'No valid entries to upsert.' });
      }

      const r = await fetch(`${supabaseUrl}/rest/v1/dashboard_state_entries?on_conflict=program_id,state_key`, {
        method: 'POST',
        headers: {
          ...headers,
          Prefer: 'resolution=merge-duplicates,return=minimal',
        },
        body: JSON.stringify(entries),
      });

      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        const msg = data.message || data.error_description || data.error || 'State upsert failed.';
        return res.status(r.status).json({ error: msg });
      }

      return res.status(200).json({ ok: true, count: entries.length });
    }

    return res.status(405).json({ error: 'Method not allowed.' });
  } catch (e) {
    return res.status(e.status || 502).json({ error: e.message || 'State API server error.' });
  }
};
