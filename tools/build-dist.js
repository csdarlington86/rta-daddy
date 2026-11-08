/* Assembles the public build: only files the app actually needs. */
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const out = path.join(root, 'deploy', 'dist');
const ITEMS = ['index.html', 'app.html', 'manifest.webmanifest', 'sw.js', 'css', 'js', 'icons', 'og-image.png'];

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

for (const item of ITEMS) {
  const src = path.join(root, item);
  const dst = path.join(out, item);
  if (!fs.existsSync(src)) { console.error('MISSING', item); process.exit(1); }
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.cpSync(src, dst, { recursive: true });
}

/* verify every local reference in index.html exists in the build */
const html = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
const refs = [...html.matchAll(/(?:src|href)="([^"#:]+)"/g)].map((m) => m[1]).filter((r) => !r.startsWith('http'));
/* Extensionless refs are routes, not files: the host rewrites /app -> app.html,
   so only refs with a file extension can be verified on disk. */
const isRoute = (r) => !path.posix.basename(r).includes('.');
const fileRefs = refs.filter((r) => !isRoute(r));
const routeRefs = refs.filter(isRoute);
let bad = 0;
for (const r of fileRefs) {
  const p = path.join(out, r);
  if (!fs.existsSync(p)) { console.error('BROKEN REF', r); bad++; }
}
const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else files.push(path.relative(out, p));
  }
})(out);

console.log('dist files (' + files.length + '):');
files.forEach((f) => console.log('  ' + f));
console.log('index.html refs: ' + fileRefs.length + ' file(s) checked, ' + routeRefs.length + ' route(s) assumed (' + routeRefs.join(', ') + '), broken: ' + bad);
const total = files.reduce((n, f) => n + fs.statSync(path.join(out, f)).size, 0);
console.log('total size: ' + (total / 1024).toFixed(1) + ' KiB');
process.exit(bad ? 1 : 0);
