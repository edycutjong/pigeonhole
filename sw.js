// Offline fallback only. This worker never serves a cached copy of the app: every page load and every request still goes
// to the network, so a visitor with a connection always sees the live page and live chain state. The one thing it does is
// answer a NAVIGATION whose fetch throws (no network at all) with the static offline page cached at install time.
const CACHE = 'offline-v1';
const OFFLINE_URL = './offline.html';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.add(new Request(OFFLINE_URL, { cache: 'reload' }))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  if (e.request.mode !== 'navigate') return; // assets, RPC calls and everything else: untouched, straight to the network
  e.respondWith(fetch(e.request).catch(() => caches.match(OFFLINE_URL).then((r) => r || new Response('Offline.', { status: 503, headers: { 'content-type': 'text/plain' } }))));
});
