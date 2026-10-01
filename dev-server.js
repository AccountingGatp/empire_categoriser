// Local test server: serves public/ and runs api/db.js. Usage: APP_PASSWORD=x ALLOW_MEMORY_STORE=1 node dev-server.js 3000
const http = require('http'), fs = require('fs'), path = require('path');
const handler = require('./api/db.js');
http.createServer((req, res) => {
  if (req.url.startsWith('/api/db')) {
    let d = ''; req.on('data', c => d += c); req.on('end', () => { try { req.body = d ? JSON.parse(d) : undefined; } catch (e) { req.body = undefined; } handler(req, res); }); return;
  }
  const f = path.join(__dirname, 'public', req.url === '/' ? 'index.html' : req.url.split('?')[0]);
  if (!f.startsWith(path.join(__dirname, 'public')) || !fs.existsSync(f)) { res.statusCode = 404; return res.end('nf'); }
  res.setHeader('content-type', f.endsWith('.html') ? 'text/html' : 'application/octet-stream'); res.end(fs.readFileSync(f));
}).listen(+process.argv[2] || 3000);
