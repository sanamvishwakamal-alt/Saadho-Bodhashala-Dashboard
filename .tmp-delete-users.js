const fs = require('fs');
for (const line of fs.readFileSync('.env.local','utf8').split(/\r?\n/)) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (!m) continue;
  let v = m[2].replace(/^"|"$/g, '');
  v = v.replace(/\\r\\n$/g, '').trim();
  process.env[m[1]] = v;
}
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
const keep = 'sanam.vishwakamal@gmail.com';
(async () => {
  let page = 1;
  let all = [];
  while (page <= 10) {
    const r = await fetch(`${url}/auth/v1/admin/users?page=${page}&per_page=200`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` }
    });
    const d = await r.json();
    if (!r.ok) throw new Error(JSON.stringify(d));
    const users = Array.isArray(d.users) ? d.users : [];
    all = all.concat(users);
    if (users.length < 200) break;
    page += 1;
  }

  const toDelete = all.filter(u => String(u.email || '').toLowerCase() !== keep);
  let deleted = 0;
  const failed = [];
  for (const user of toDelete) {
    const r = await fetch(`${url}/auth/v1/admin/users/${user.id}`, {
      method: 'DELETE',
      headers: { apikey: key, Authorization: `Bearer ${key}` }
    });
    if (!r.ok) {
      let body;
      try { body = await r.json(); } catch { body = { message: await r.text() }; }
      failed.push({ email: user.email, status: r.status, error: body });
    } else {
      deleted += 1;
    }
  }

  // Verify remaining users
  const vr = await fetch(`${url}/auth/v1/admin/users?page=1&per_page=200`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` }
  });
  const vd = await vr.json();
  const remaining = (Array.isArray(vd.users) ? vd.users : []).map(u => String(u.email || '').toLowerCase()).filter(Boolean).sort();

  console.log('DELETED=' + deleted);
  console.log('FAILED=' + failed.length);
  if (failed.length) {
    console.log('FAILED_LIST_START');
    for (const f of failed) console.log(`${f.email} | ${f.status} | ${JSON.stringify(f.error)}`);
    console.log('FAILED_LIST_END');
  }
  console.log('REMAINING_COUNT=' + remaining.length);
  console.log('REMAINING_LIST_START');
  for (const e of remaining) console.log(e);
  console.log('REMAINING_LIST_END');
})();
