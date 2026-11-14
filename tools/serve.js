/* Minimal static server for local + LAN testing (no dependencies).
   Usage: node tools/serve.js [port]                                  */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const root = path.join(__dirname, '..');
const port = Number(process.argv[2] || 8123);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8'
};

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  /* The hosted Worker answers the counter without storage as hits: null.
     Mirror that here so local landing-page testing has no console 404. */
  if (url === '/api/hits' || url === '/api/hits/') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end('{"hits":null}');
    return;
  }
  let rel = url === '/' ? '/index.html' : url;
  /* Match the hosted Worker's extensionless routes: /app serves app.html,
     including links from the landing page during local testing. */
  if (!path.extname(rel)) rel += '.html';
  const file = path.normalize(path.join(root, rel));
  if (!file.startsWith(root)) { res.writeHead(403).end('forbidden'); return; }

  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('not found: ' + rel);
      return;
    }
    res.writeHead(200, {
      'content-type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-cache',
      'service-worker-allowed': '/'
    });
    res.end(data);
  });
});

server.listen(port, '0.0.0.0', () => {
  console.log('local : http://localhost:' + port + '/');
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list || []) {
      if (ni.family === 'IPv4' && !ni.internal) console.log('lan   : http://' + ni.address + ':' + port + '/');
    }
  }
});
