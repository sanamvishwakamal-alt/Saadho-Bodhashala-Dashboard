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
  const uniq = [...new Set(all.map(u => String(u.email || '').toLowerCase()).filter(Boolean))].sort();
  const del = uniq.filter(e => e !== keep);
  console.log('TOTAL_USERS=' + uniq.length);
  console.log('KEEP=' + keep);
  console.log('DELETE_COUNT=' + del.length);
  console.log('DELETE_LIST_START');
  for (const e of del) console.log(e);
  console.log('DELETE_LIST_END');
})();
