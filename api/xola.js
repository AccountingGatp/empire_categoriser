// Reads Xola payouts so the Empire Categoriser can match a bank deposit to a Xola location by amount.
// Needs these Environment Variables in Vercel (Settings > Environment Variables), then redeploy:
//   XOLA_API_KEY   your Xola API key (sent as the X-API-KEY header)
//   XOLA_SELLERS   OPTIONAL. JSON naming each location and its Xola seller id, for example
//                  {"Chicago_Discount_Tours":"5f1...","NYC_Discount_Tours":"5f2..."}
//                  If left out, the function asks Xola (users/me) which sellers the key can see.
//   XOLA_BASE      OPTIONAL. Defaults to https://xola.com/api
// Every request must carry the same team password as /api/db (header x-app-key = APP_PASSWORD).
const crypto = require('crypto');
const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const send = (res, code, obj) => { res.statusCode = code; res.setHeader('content-type', 'application/json'); res.setHeader('cache-control', 'no-store'); res.end(JSON.stringify(obj)); };
const BASE = (process.env.XOLA_BASE || 'https://xola.com/api').replace(/\/$/, '');
const KEY = process.env.XOLA_API_KEY || '';

async function xget(path) {
  const r = await fetch(BASE + path, { headers: { 'X-API-KEY': KEY, accept: 'application/json' } });
  if (!r.ok) { const e = new Error('Xola answered ' + r.status + ' for ' + path.split('?')[0]); e.status = r.status === 401 || r.status === 403 ? 401 : 502; throw e; }
  return r.json();
}
const listOf = j => Array.isArray(j) ? j : (j && (j.data || j.transactions || j.sellers || j.items)) || [];
const num = v => { const n = parseFloat(String(v == null ? '' : v).replace(/[^0-9.\-]/g, '')); return isNaN(n) ? 0 : n; };
const iso = v => { if (!v) return ''; const d = new Date(typeof v === 'object' ? (v.date || v.createdAt || v.paidAt || '') : v); return isNaN(d) ? '' : d.toISOString().slice(0, 10); };

async function sellers() {
  if (process.env.XOLA_SELLERS) {
    const m = JSON.parse(process.env.XOLA_SELLERS);
    return Object.keys(m).map(name => ({ name, id: m[name] }));
  }
  const me = await xget('/users/me');
  const raw = [].concat(me.seller || [], me.sellers || [], me.sellerList || [], (me.roles && me.roles.sellers) || []);
  const out = raw.map(s => typeof s === 'string' ? { id: s, name: s } : { id: s.id, name: s.name || s.displayName || s.id }).filter(s => s.id);
  if (!out.length && me.id) out.push({ id: me.id, name: me.name || me.id });
  return out;
}
// Net of one transaction: sum of its line items' net, else its own net / amount.
const netOf = t => Array.isArray(t.items) && t.items.length ? t.items.reduce((a, i) => a + num(i.net != null ? i.net : i.amount), 0) : num(t.net != null ? t.net : t.amount);

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });
    const pw = process.env.APP_PASSWORD;
    if (!pw) return send(res, 503, { error: 'APP_PASSWORD is not set in Vercel.' });
    if (!same(req.headers['x-app-key'] || '', pw)) return send(res, 401, { error: 'unauthorized' });
    if (!KEY) return send(res, 503, { error: 'XOLA_API_KEY is not set in Vercel. Add it under Settings > Environment Variables and redeploy.' });
    let b = req.body; if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = {}; } } b = b || {};
    const from = /^\d{4}-\d{2}-\d{2}$/.test(b.from || '') ? b.from : '0000-00-00', to = /^\d{4}-\d{2}-\d{2}$/.test(b.to || '') ? b.to : '9999-99-99';
    const list = await sellers();
    if (!list.length) return send(res, 200, { entries: [], sellers: [], note: 'The Xola key did not return any sellers. Set XOLA_SELLERS in Vercel.' });
    const entries = [], sample = {}, errors = [];
    for (const s of list) {
      const groups = new Map();
      try {
        for (let skip = 0, page = 0; page < 12; page++, skip += 200) {
          const j = await xget('/transactions?seller=' + encodeURIComponent(s.id) + '&limit=200&skip=' + skip);
          const arr = listOf(j); if (!arr.length) break;
          if (!sample[s.name]) sample[s.name] = Object.keys(arr[0] || {});
          arr.forEach(t => {
            if (!t.payout) return;
            const key = typeof t.payout === 'object' ? (t.payout.id || iso(t.payout)) : String(t.payout);
            const g = groups.get(key) || { date: iso(t.payout) || iso(t.payoutDate), net: 0 }; g.net += netOf(t); groups.set(key, g);
          });
          if (arr.length < 200) break;
        }
      } catch (e) { errors.push(s.name + ': ' + e.message); continue; }
      groups.forEach((g, id) => { const d = g.date; if (d && (d < from || d > to)) return; entries.push({ loc: s.name, date: d, net: Math.round(g.net * 100) / 100, id }); });
    }
    send(res, 200, { entries, sellers: list.map(s => s.name), sample, errors });
  } catch (e) { send(res, e.status || 500, { error: e.message || 'Xola request failed' }); }
};
