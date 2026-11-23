const FILES = {
  "crawl.js": "76cda5023cc6245d",
  "crawl.wasm": "b9a836ecccf43f87",
  "crawl.data": "eb13df64de2edbaa",
  "crawl-data.js": "f0ddb4e231af80f3",
  "icon.png": "3f7a84e15d2d2831",
  "index.html": "733a9fa98a0ee9a4",
  "shell.js": "c31d86b8b37bad3f",
  "manifest.webmanifest": "57a76775ac164278",
};
// Offline support. The build prepends FILES, which maps every file of the app
// to a hash of its contents. Files are cached under their hash, so an update
// only downloads the files that changed, and it takes over only once all of
// them are cached.
const CACHE = 'crawl';

const cacheKey = file => new URL(`${file}?${FILES[file]}`, location).href;

async function hashOf(buffer) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', buffer));
  return Array.from(digest.subarray(0, 8), b => b.toString(16).padStart(2, '0')).join('');
}

async function download(cache, file) {
  // Revalidate, so an outdated copy in the HTTP cache can't sneak in.
  const response = await fetch(file, { cache: 'no-cache' });
  const body = await response.arrayBuffer();
  if (!response.ok || await hashOf(body) !== FILES[file])
    throw new Error(`Got the wrong version of ${file}`);
  const headers = { 'Content-Type': response.headers.get('Content-Type') };
  await cache.put(cacheKey(file), new Response(body, { headers }));
}

self.addEventListener('install', event => event.waitUntil((async () => {
  const cache = await caches.open(CACHE);
  for (const file of Object.keys(FILES)) {
    if (!await cache.match(cacheKey(file)))
      await download(cache, file);
  }
  await self.skipWaiting();
})()));

self.addEventListener('activate', event => event.waitUntil((async () => {
  const cache = await caches.open(CACHE);
  const current = new Set(Object.keys(FILES).map(cacheKey));
  for (const request of await cache.keys()) {
    if (!current.has(request.url))
      await cache.delete(request);
  }
  await self.clients.claim();
})()));

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  const scope = new URL(self.registration.scope);
  if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname))
    return;
  const file = url.pathname.slice(scope.pathname.length) || 'index.html';
  if (file in FILES) {
    event.respondWith(caches.match(cacheKey(file))
                      .then(cached => cached || fetch(event.request)));
  }
});
