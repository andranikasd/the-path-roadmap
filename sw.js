// Network first, so updates appear without a hard refresh. The cache only answers when offline.
const CACHE = 'the-path-v1';
const FILES = ['./', 'index.html', 'app.js', 'styles.css', 'map.css', 'data/roadmap.json', 'icon.svg', 'manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== location.origin) return;
  event.respondWith(fetch(event.request, { cache: 'no-cache' })
    .then((response) => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(event.request, copy));
      }
      return response;
    })
    .catch(async () => (await caches.match(event.request, { ignoreSearch: true })) || (await caches.match('index.html')) || Response.error()));
});
