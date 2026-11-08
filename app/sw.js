// Offline cache. Bump VERSION when any app file changes.
const VERSION = 'bodyos-1';
const FILES = ['./', 'index.html', 'app.css', 'app.js', 'logic.js', 'manifest.webmanifest', 'icon-180.png', 'icon-512.png'];
self.addEventListener('install', e => e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return; // AI calls go straight to network
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(r => r || fetch(e.request)));
});
