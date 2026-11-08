/* Static-asset Worker for the RTA Daddy site.
   Mostly client-side: this serves the shell plus one tiny counter endpoint,
   GET /api/hits, which bumps a single row in D1 and returns the new total.
   No cookies, no identifiers - it only counts page loads. */

const NO_STORE = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store'
};

/* The table is created on first use so no migration step is needed. */
const CREATE = 'CREATE TABLE IF NOT EXISTS hits (id INTEGER PRIMARY KEY CHECK (id = 1), n INTEGER NOT NULL DEFAULT 0)';
const BUMP = 'INSERT INTO hits (id, n) VALUES (1, 1) ON CONFLICT(id) DO UPDATE SET n = n + 1 RETURNING n';

async function bumpHits(env) {
  /* fast path: the table exists */
  try {
    const row = await env.DB.prepare(BUMP).first();
    if (row && Number.isFinite(row.n)) return row.n;
  } catch (e) { /* table not there yet */ }
  await env.DB.prepare(CREATE).run();
  const row = await env.DB.prepare(BUMP).first();
  return row && Number.isFinite(row.n) ? row.n : null;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/hits' || url.pathname === '/api/hits/') {
      if (request.method !== 'GET') {
        return new Response('Method not allowed', { status: 405, headers: { allow: 'GET' } });
      }
      /* No database bound (e.g. an environment without storage): say so rather
         than failing the page. The counter simply stays hidden. */
      if (!env || !env.DB) {
        return new Response(JSON.stringify({ hits: null }), { headers: NO_STORE });
      }
      try {
        const hits = await bumpHits(env);
        return new Response(JSON.stringify({ hits }), { headers: NO_STORE });
      } catch (e) {
        return new Response(JSON.stringify({ hits: null }), { headers: NO_STORE });
      }
    }

    return env.ASSETS.fetch(request);
  }
};
