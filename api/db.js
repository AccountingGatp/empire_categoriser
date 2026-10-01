// Team storage for the Empire Categoriser.
// Data lives in Upstash Redis (free) – one Redis hash per collection, one field per document.
// Every request must carry the team password in the "x-app-key" header (env APP_PASSWORD).
const crypto = require('crypto');

const COLLS = new Set(['team', 'master', 'masterrows', 'added', 'emailrules', 'bankrules', 'nvlog', 'payroll']);
const PATH = /^[A-Za-z0-9_\-.~:@+]+\/[A-Za-z0-9_\-.~:@+]+$/;
const MAX_JSON = 900000;

const URL_ = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || '';
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || '';
const mem = globalThis.__empireMem || (globalThis.__empireMem = { h: {}, rev: 0 });   // local tests only

async function redis(cmds) {            // cmds: array of commands, e.g. [['HGETALL','c:team']]
  if (!URL_ || !TOKEN) {
    if (process.env.ALLOW_MEMORY_STORE !== '1') { const e = new Error('Database is not connected. Add the Upstash Redis integration in Vercel and redeploy.'); e.status = 503; throw e; }
    return cmds.map(c => ({ result: memCmd(c) }));
  }
  const r = await fetch(URL_.replace(/\/$/, '') + '/pipeline', {
    method: 'POST', headers: { Authorization: 'Bearer ' + TOKEN, 'content-type': 'application/json' }, body: JSON.stringify(cmds)
  });
  if (!r.ok) { const e = new Error('Database error (' + r.status + ').'); e.status = 502; throw e; }
  const out = await r.json();
  const bad = out.find(x => x && x.error);
  if (bad) { const e = new Error('Database error: ' + bad.error); e.status = 502; throw e; }
  return out;
}
function memCmd(c) {
  const [op, key, f, v] = c;
  const h = mem.h[key] = mem.h[key] || {};
  if (op === 'HSET') { h[f] = v; return 1; }
  if (op === 'HDEL') { const had = f in h; delete h[f]; return had ? 1 : 0; }
  if (op === 'HGETALL') return [].concat(...Object.entries(h));
  if (op === 'INCR') { mem.rev++; return mem.rev; }
  if (op === 'GET') return String(mem.rev);
  return null;
}
const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const send = (res, code, obj) => { res.statusCode = code; res.setHeader('content-type', 'application/json'); res.setHeader('cache-control', 'no-store'); res.end(JSON.stringify(obj)); };

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });
    const pw = process.env.APP_PASSWORD;
    if (!pw) return send(res, 503, { error: 'APP_PASSWORD is not set in Vercel. Add it under Settings → Environment Variables and redeploy.' });
    if (!same(req.headers['x-app-key'] || '', pw)) return send(res, 401, { error: 'unauthorized' });

    let b = req.body;
    if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = null; } }
    if (!b || typeof b !== 'object') return send(res, 400, { error: 'bad request' });

    if (b.op === 'rev') {
      const r = await redis([['GET', 'rev']]);
      return send(res, 200, { rev: Number(r[0].result || 0) });
    }
    if (b.op === 'snapshot') {
      const cur = Number((await redis([['GET', 'rev']]))[0].result || 0);
      if (b.rev != null && Number(b.rev) === cur) return send(res, 200, { same: true, rev: cur });
      const names = [...COLLS];
      const out = await redis(names.map(n => ['HGETALL', 'c:' + n]));
      const colls = {};
      names.forEach((n, i) => { const a = out[i].result || []; const m = {}; for (let k = 0; k < a.length; k += 2) m[a[k]] = a[k + 1]; colls[n] = m; });
      return send(res, 200, { rev: cur, colls });
    }
    if (b.op === 'set' || b.op === 'del') {
      if (typeof b.path !== 'string' || !PATH.test(b.path)) return send(res, 400, { error: 'bad path' });
      const i = b.path.indexOf('/'), c = b.path.slice(0, i), id = b.path.slice(i + 1);
      if (!COLLS.has(c)) return send(res, 400, { error: 'unknown collection' });
      if (b.op === 'set') {
        if (typeof b.json !== 'string' || b.json.length > MAX_JSON) return send(res, 400, { error: 'document too large' });
        try { JSON.parse(b.json); } catch (e) { return send(res, 400, { error: 'invalid json' }); }
        await redis([['HSET', 'c:' + c, id, b.json], ['INCR', 'rev']]);
      } else await redis([['HDEL', 'c:' + c, id], ['INCR', 'rev']]);
      return send(res, 200, { ok: true });
    }
    return send(res, 400, { error: 'unknown op' });
  } catch (e) {
    return send(res, e.status || 500, { error: e.message || 'server error' });
  }
};
