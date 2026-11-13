/* Network-first: deploys land on the next load. Falls back to cache so the
   analyzer still works with no network on the tablet. */
const CACHE = 'rta-daddy-v25';
const ASSETS = [
  './',
  './index.html',
  './app',
  './app.html',
  './css/site.css',
  './css/app.css',
  './js/app.js',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-512-maskable.png'
];

/* Cache each asset on its own: addAll() rejects the whole install if a single
   URL is missing, which would leave the app with no offline copy at all. A
   host that does not rewrite /app to app.html must not cost you the shell. */
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => Promise.all(ASSETS.map((url) => c.add(url).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  /* the visit counter is live data: never cache it, and never answer it offline */
  if (new URL(req.url).pathname.indexOf('/api/') === 0) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      })
      /* Offline: ignore ?demo=1 and other query strings, and send an /app
         navigation to the cached app shell rather than the landing page. */
      .catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => {
        if (hit) return hit;
        if (req.mode === 'navigate') {
          return caches.match('./app', { ignoreSearch: true })
            .then((shell) => shell || caches.match('./index.html'));
        }
        return caches.match('./index.html');
      }))
  );
});
