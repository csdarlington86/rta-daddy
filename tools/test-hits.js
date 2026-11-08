/* Local check for deploy/worker.js: runs the real Worker code against a real
   SQLite database through a small D1 shim (node:sqlite), and serves the built
   dist through a stub ASSETS binding that mimics the host's route rewrites. */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { DatabaseSync } = require('node:sqlite');

const dist = path.join(__dirname, '..', 'deploy', 'dist');
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
};

function makeD1(db) {
  const wrap = (stmt, params) => ({
    first: () => (params.length ? stmt.get(...params) : stmt.get()) || null,
    run: () => (params.length ? stmt.run(...params) : stmt.run()),
    all: () => (params.length ? stmt.all(...params) : stmt.all())
  });
  return {
    prepare(sql) {
      const stmt = db.prepare(sql);
      return {
        bind: (...p) => wrap(stmt, p),
        ...wrap(stmt, [])
      };
    },
    batch: async (list) => Promise.all(list.map((s) => s.run()))
  };
}

const ASSETS = {
  async fetch(req) {
    const url = new URL(req.url);
    let p = decodeURIComponent(url.pathname);
    if (p === '/') p = '/index.html';
    else if (!path.extname(p)) p += '.html';
    const file = path.join(dist, p);
    if (!file.startsWith(dist) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      return new Response('Not found', { status: 404 });
    }
    return new Response(fs.readFileSync(file), {
      headers: { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' }
    });
  }
};

(async () => {
  const tmp = path.join(os.tmpdir(), 'rta-worker-check-' + process.pid + '.mjs');
  fs.copyFileSync(path.join(__dirname, '..', 'deploy', 'worker.js'), tmp);
  const worker = (await import(pathToFileURL(tmp).href)).default;
  fs.unlinkSync(tmp);

  const db = new DatabaseSync(':memory:');
  const env = { DB: makeD1(db), ASSETS };
  const call = (p, init, e) => worker.fetch(new Request('https://rta.test' + p, init), e || env);

  let fails = 0;
  const check = (label, ok, extra) => {
    console.log((ok ? 'ok   ' : 'FAIL ') + label + (extra === undefined ? '' : '   ' + extra));
    if (!ok) fails++;
  };

  /* counter: first call creates the table, then each call adds one */
  let res = await call('/api/hits');
  let body = await res.json();
  check('first bump creates the table and returns 1', body.hits === 1, JSON.stringify(body));
  check('counter is never cached', res.headers.get('cache-control') === 'no-store');
  check('counter is JSON', (res.headers.get('content-type') || '').includes('application/json'));
  for (let i = 2; i <= 5; i++) {
    body = await (await call('/api/hits')).json();
    check('bump ' + i + ' returns ' + i, body.hits === i, JSON.stringify(body));
  }
  check('trailing slash also works', (await (await call('/api/hits/')).json()).hits === 6);
  res = await call('/api/hits', { method: 'POST' });
  check('POST is rejected with 405', res.status === 405, 'status ' + res.status);
  check('405 advertises Allow: GET', res.headers.get('allow') === 'GET');
  check('only one row is kept', db.prepare('SELECT COUNT(*) AS c FROM hits').get().c === 1);

  /* static serving and the /app route still work */
  res = await call('/');
  const home = await res.text();
  check('/ serves the landing page', res.status === 200 && home.includes('id="hits"') && home.includes('RTA Daddy'));
  res = await call('/app');
  const app = await res.text();
  check('/app serves the analyzer', res.status === 200 && app.includes('id="specCanvas"'));
  check('/app.html still resolves to the analyzer', (await (await call('/app.html')).text()).includes('id="specCanvas"'));
  check('stylesheet is served', (await call('/css/site.css')).status === 200);
  check('missing file is a 404', (await call('/nope.js')).status === 404);

  /* no database bound: the site must still work, the counter just stays off */
  res = await call('/api/hits', undefined, { ASSETS });
  body = await res.json();
  check('no DB binding returns hits: null', res.status === 200 && body.hits === null, JSON.stringify(body));
  res = await call('/', undefined, { ASSETS });
  check('site still serves without a database', res.status === 200 && (await res.text()).includes('RTA Daddy'));

  /* a broken database must not break the page either */
  const brokenDb = { prepare() { throw new Error('db down'); } };
  res = await call('/api/hits', undefined, { DB: brokenDb, ASSETS });
  body = await res.json();
  check('broken DB degrades to null', res.status === 200 && body.hits === null, JSON.stringify(body));

  db.close();
  console.log(fails ? '\n' + fails + ' check(s) failed' : '\nall checks passed');
  process.exit(fails ? 1 : 0);
})().catch((e) => {
  console.error('harness error:', e);
  process.exit(1);
});
