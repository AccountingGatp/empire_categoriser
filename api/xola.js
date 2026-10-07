// Reads Xola payouts so the Empire Categoriser can match a bank deposit to a Xola location by amount.
// Needs these Environment Variables in Vercel (Settings > Environment Variables), then redeploy:
//   XOLA_API_KEY   your Xola API key (sent as the X-API-KEY header)
//   XOLA_BASE      OPTIONAL. Defaults to https://xola.com/api
//   XOLA_SELLERS   OPTIONAL. JSON {"Location name":"sellerId"} to force the names. Normally NOT needed:
//                  the payouts carry the seller id and the name is looked up from it.
// A payout is a Xola transaction of type "auto_payout" (or "payout"). Its amount is what lands in the bank.
// Every request must carry the same team password as /api/db (header x-app-key = APP_PASSWORD).
const crypto = require('crypto');
const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const send = (res, code, obj) => { res.statusCode = code; res.setHeader('content-type', 'application/json'); res.setHeader('cache-control', 'no-store'); res.end(JSON.stringify(obj)); };
const BASE = (process.env.XOLA_BASE || 'https://xola.com/api').replace(/\/$/, '');
const KEY = process.env.XOLA_API_KEY || '';
const TYPES = ['auto_payout', 'payout'];

async function xget(path) {
  const r = await fetch(BASE + path, { headers: { 'X-API-KEY': KEY, accept: 'application/json' } });
  if (!r.ok) { const e = new Error('Xola answered ' + r.status + ' for ' + path.split('?')[0]); e.status = r.status === 401 || r.status === 403 ? 401 : 502; throw e; }
  return r.json();
}
const num = v => { const n = parseFloat(String(v == null ? '' : v).replace(/[^0-9.\-]/g, '')); return isNaN(n) ? 0 : n; };
const sid = s => s && (typeof s === 'object' ? s.id : s);
const dateOf = v => { const d = new Date(v || ''); return isNaN(d) ? '' : d.toISOString().slice(0, 10); };
const amountOf = t => Math.abs(Array.isArray(t.items) && t.items.length ? t.items.reduce((a, i) => a + num(i.net != null ? i.net : i.gross), 0) : num(t.amount));

async function payouts(from) {
  const out = [];
  for (const type of TYPES) {
    let path = '/transactions?type=' + type + '&limit=200&exclude=remoteTransactions&createdAt[gte]=' + from;
    for (let page = 0; page < 15 && path; page++) {
      const j = await xget(path.replace(/^\/api/, ''));
      (j.data || []).forEach(t => { const a = Math.round(amountOf(t) * 100) / 100; if (a > 0 && sid(t.seller)) out.push({ seller: sid(t.seller), date: dateOf(t.createdAt), net: a, id: t.id, cur: t.currency || '' }); });
      path = j.paging && j.paging.next ? j.paging.next : '';
    }
  }
  return out;
}
async function names(ids) {
  const forced = {};
  if (process.env.XOLA_SELLERS) { const m = JSON.parse(process.env.XOLA_SELLERS); Object.keys(m).forEach(n => { forced[m[n]] = n; }); }
  const map = {};
  for (const id of ids) {
    if (forced[id]) { map[id] = forced[id]; continue; }
    try { const s = await xget('/sellers/' + encodeURIComponent(id)); map[id] = s.name || s.displayName || id; } catch (e) { map[id] = id; }
  }
  return map;
}

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });
    const pw = process.env.APP_PASSWORD;
    if (!pw) return send(res, 503, { error: 'APP_PASSWORD is not set in Vercel.' });
    if (!same(req.headers['x-app-key'] || '', pw)) return send(res, 401, { error: 'unauthorized' });
    if (!KEY) return send(res, 503, { error: 'XOLA_API_KEY is not set in Vercel. Add it under Settings > Environment Variables and redeploy.' });
    let b = req.body; if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = {}; } } b = b || {};
    const from = /^\d{4}-\d{2}-\d{2}$/.test(b.from || '') ? b.from : new Date(Date.now() - 60 * 864e5).toISOString().slice(0, 10);
    const list = await payouts(from);
    const nm = await names([...new Set(list.map(p => p.seller))]);
    if (b.list) return send(res, 200, { sellers: Object.keys(nm).map(id => ({ id, name: nm[id] })) });
    send(res, 200, { entries: list.map(p => ({ loc: nm[p.seller], date: p.date, net: p.net, id: p.id, cur: p.cur })), sellers: Object.values(nm) });
  } catch (e) { send(res, e.status || 500, { error: e.message || 'Xola request failed' }); }
};
