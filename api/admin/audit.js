const { json, getActorContext, serviceSelect } = require('../_lib/admin');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed.' });

  try {
    const actor = await getActorContext(req);
    const limit = Math.min(Math.max(parseInt(req.query.limit || '100', 10), 1), 500);
    const action = String(req.query.action || '').trim();
    const targetUserId = String(req.query.target_user_id || '').trim();

    const params = {
      select: '*',
      order: 'created_at.desc',
      limit: String(limit),
    };
    if (action) params.action = `eq.${action}`;
    if (targetUserId) params.target_user_id = `eq.${targetUserId}`;

    let rows = await serviceSelect('audit_log', params);
    if (!actor.isGlobalAdmin) {
      const allowed = new Set(actor.programIds || []);
      rows = rows.filter(row => !row.program_id || allowed.has(row.program_id));
    }

    return json(res, 200, { rows });
  } catch (error) {
    return json(res, error.status || 500, { error: error.message || 'Server error.' });
  }
};