// BeatBook service worker: app shell offline + CDN library caching.
// Model weights are cached by the AI libraries themselves (Cache Storage).
const VERSION = 'bb-v2';
const SHELL = ['./', './index.html', './app.js', './ai.js', './parser.js', './catalog.js', './manifest.webmanifest', './icon-192.png', './icon-512.png', './manager.html'];
const CDN_HOSTS = ['cdn.jsdelivr.net', 'esm.run'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('bb-') && k !== VERSION && k !== 'bb-cdn').map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    // network first so updates show up; fall back to cache when offline
    e.respondWith(fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match('./index.html'))));
    return;
  }
  if (CDN_HOSTS.includes(url.hostname)) {
    // libraries are versioned: cache first
    e.respondWith(caches.open('bb-cdn').then(async c => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok || res.type === 'opaque') c.put(req, res.clone());
      return res;
    }));
  }
});
