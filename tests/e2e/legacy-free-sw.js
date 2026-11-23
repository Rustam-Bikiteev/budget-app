// Previous v4 network-first shell, without the new module dependencies.
// The test server explicitly permits /free/ scope for this fixture.
const CACHE = 'budget-free-v4';
const SHELL = ['/free/', '/free/index.html', '/free/manifest.webmanifest',
  '/shared/core.js', '/shared/core.css', '/icon-192.png', '/icon-512.png'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)));
  self.skipWaiting();
});
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== location.origin) return;
  event.respondWith(fetch(event.request).then(response => {
    if (response.ok) event.waitUntil(caches.open(CACHE).then(cache => cache.put(event.request, response.clone())));
    return response;
  }).catch(() => caches.open(CACHE).then(cache => cache.match(event.request, { ignoreSearch: true }))));
});
