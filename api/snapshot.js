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
      // Optional list mode for admin/debug UI.
      const listMode = String(req.query.list || '').trim() === '1';
      if (listMode) {
        const limitRaw = parseInt(String(req.query.limit || '20'), 10);
        const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(limitRaw, 100)) : 20;
        const r = await fetch(
          `${supabaseUrl}/rest/v1/dashboard_snapshots?select=program_id,project_name,updated_at,created_at&order=updated_at.desc&limit=${limit}`,
          { headers }
        );
        const data = await r.json().catch(() => []);
        if (!r.ok) {
          const msg = (data && (data.message || data.error_description || data.error)) || 'Snapshot list fetch failed.';
          return res.status(r.status).json({ error: msg });
        }
        return res.status(200).json({ rows: Array.isArray(data) ? data : [] });
      }

      // Read snapshot for program_id. If not found, fall back to latest snapshot user can access.
      const programId = (req.query.program_id || '').trim();

      const fetchRows = async (query) => {
        const r = await fetch(`${supabaseUrl}/rest/v1/dashboard_snapshots?${query}`, { headers });
        const data = await r.json();
        if (!r.ok) {
          const msg = (data && (data.message || data.error_description || data.error)) || 'Fetch failed.';
          const err = new Error(msg);
          err.status = r.status;
          throw err;
        }
        return Array.isArray(data) ? data : [];
      };

      let rows = [];
      if (programId) {
        rows = await fetchRows(
          `program_id=eq.${encodeURIComponent(programId)}&select=payload,updated_at,project_name,program_id&order=updated_at.desc&limit=1`
        );
      }

      if (!rows.length) {
        rows = await fetchRows('select=payload,updated_at,project_name,program_id&order=updated_at.desc&limit=1');
      }

      const row = rows[0] || null;
      if (!row) return res.status(404).json({ error: 'No snapshot found.' });

      return res.status(200).json(row);

    } else if (req.method === 'POST') {
      // Upsert snapshot
      const { program_id, project_name, payload } = req.body || {};
      if (!program_id || !payload) return res.status(400).json({ error: 'program_id and payload are required.' });

      const r = await fetch(`${supabaseUrl}/rest/v1/dashboard_snapshots?on_conflict=program_id`, {
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
