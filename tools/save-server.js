/* Static server + POST /save?name=<file> for the canvas artwork generators.
   Tools only — never part of the build. Usage: node tools/save-server.js [port] */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const outDir = path.join(root, 'social');
const port = Number(process.argv[2] || 8128);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png'
};

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const rel = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);

  if (req.method === 'POST' && url.pathname === '/save') {
    const name = String(url.searchParams.get('name') || '').replace(/[^a-z0-9-_]/gi, '');
    if (!name) { res.writeHead(400, { 'content-type': 'application/json' }).end('{"error":"bad name"}'); return; }
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const buf = Buffer.concat(chunks);
      if (!buf.length) { res.writeHead(400, { 'content-type': 'application/json' }).end('{"error":"empty"}'); return; }
      fs.mkdirSync(outDir, { recursive: true });
      const file = path.join(outDir, name + '.png');
      fs.writeFileSync(file, buf);
      console.log('saved ' + path.relative(root, file) + '  ' + buf.length + ' bytes');
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ file: path.relative(root, file), bytes: buf.length }));
    });
    return;
  }

  const file = path.normalize(path.join(root, rel));
  if (!file.startsWith(root)) { res.writeHead(403).end('forbidden'); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'content-type': 'text/plain' }).end('not found: ' + rel); return; }
    res.writeHead(200, {
      'content-type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-store'
    });
    res.end(data);
  });
}).listen(port, '127.0.0.1', () => console.log('artwork server on http://127.0.0.1:' + port + '/tools/ig-ads.html'));
