/**
 * ════════════════════════════════════════════════════
 *  THE NEWTOWN CLASSES — Service Worker (PWA)
 * ════════════════════════════════════════════════════
 *
 *  Minimal service worker whose only job is to make the
 *  site installable (Chrome/Edge require an SW that
 *  responds to fetch events for the PWA install prompt).
 *
 *  Strategy: NETWORK-FIRST with a tiny offline fallback
 *  for the navigation request to index.html, so users who
 *  open the installed app while offline still see something
 *  rather than a blank screen.
 *
 *  We deliberately do NOT cache anything else (HTML pages,
 *  Firebase calls, dashboards, Zoom links). Caching dynamic
 *  pages would mean stale content after teachers/admins
 *  update the site — bad. Live data should always be fresh.
 *
 *  Bump the CACHE_VERSION below to invalidate the offline
 *  shell on a deploy.
 * ════════════════════════════════════════════════════
 */
const CACHE_VERSION = 'ntc-shell-v3';
const SHELL = ['/', '/favicon.svg', '/assets/img/logo.png'];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then(cache => cache.addAll(SHELL).catch(() => {}))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const req = event.request;

  // Never intercept non-GET (POST to Firestore, Zoom, Netlify functions).
  if (req.method !== 'GET') return;

  // Network-first for navigations (HTML pages). If offline, fall back to
  // the cached index shell. All other requests pass straight through —
  // we don't want to serve stale dashboards from cache.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() =>
        caches.match('/index.html').then(r => r || new Response(
          '<h1>You are offline</h1><p>Reconnect to use The NewTown Classes.</p>',
          { headers: { 'Content-Type': 'text/html' } }
        ))
      )
    );
  }
});
