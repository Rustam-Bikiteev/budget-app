// Network-first: свежая версия при наличии сети, кэш — только для офлайна.
// Данные пользователя здесь не хранятся, они в IndexedDB.
const CACHE_PREFIX = 'budget-free-';
const CACHE = CACHE_PREFIX + 'v4';
const SHELL = ['./', 'index.html', 'manifest.webmanifest', '../shared/core.js', '../shared/core.css', '../icon-192.png', '../icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith(CACHE_PREFIX) && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    fetch(req)
      .then(res => {
        if (res.ok) {
          const copy = res.clone();
          e.waitUntil(caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {}));
        }
        return res;
      })
      .catch(async () => {
        const cache = await caches.open(CACHE);
        return await cache.match(req, { ignoreSearch: true })
          || new Response('Нет сети. Открой приложение онлайн перед использованием офлайн.', {
            status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' },
          });
      })
  );
});
