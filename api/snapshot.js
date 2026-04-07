// Proxy for dashboard_snapshots read (GET) and write (POST/upsert).
// Server-side only — browser never reaches Supabase directly.
// Uses user's access_token for RLS enforcement.
module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  const authHeader = req.headers['authorization'] || '';
  const accessToken = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!accessToken) return res.status(401).json({ error: 'Authentication required.' });

  const supabaseUrl = (process.env.SUPABASE_URL || '').trim();
  const anonKey     = (process.env.SUPABASE_ANON_KEY || '').trim();

  if (!supabaseUrl || !anonKey) {
    return res.status(500).json({ error: 'Server not configured.' });
  }

  const headers = {
    'apikey': anonKey,
    'Authorization': `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  };

  try {
    if (req.method === 'GET') {
      // Read snapshot for program_id
      const programId = req.query.program_id || '';
      if (!programId) return res.status(400).json({ error: 'program_id is required.' });

      const r = await fetch(
        `${supabaseUrl}/rest/v1/dashboard_snapshots?program_id=eq.${encodeURIComponent(programId)}&select=payload,updated_at,project_name&limit=1`,
        { headers }
      );
      const data = await r.json();
      if (!r.ok) return res.status(r.status).json({ error: data.message || 'Fetch failed.' });

      const row = Array.isArray(data) ? data[0] : null;
      if (!row) return res.status(404).json({ error: 'No snapshot found for this program.' });

      return res.status(200).json(row);

    } else if (req.method === 'POST') {
      // Upsert snapshot
      const { program_id, project_name, payload } = req.body || {};
      if (!program_id || !payload) return res.status(400).json({ error: 'program_id and payload are required.' });

      const r = await fetch(`${supabaseUrl}/rest/v1/dashboard_snapshots`, {
        method: 'POST',
        headers: {
          ...headers,
          'Prefer': 'resolution=merge-duplicates,return=minimal',
        },
        body: JSON.stringify({ program_id, project_name: project_name || '', payload }),
      });

      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        return res.status(r.status).json({ error: err.message || 'Upsert failed.' });
      }

      return res.status(200).json({ ok: true });

    } else {
      return res.status(405).json({ error: 'Method not allowed.' });
    }
  } catch (e) {
    return res.status(502).json({ error: 'Server error: ' + e.message });
  }
};
