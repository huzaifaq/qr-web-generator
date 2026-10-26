// Service worker template. integrations/offline.mjs fills in VERSION and FILES
// at build time and writes the result to dist/sw.js.
//
// Every file in the build is cached on install, so once a browser has loaded the site it
// keeps working while the server is down. Pages come from the network while the server
// is up, so a new deploy shows on the next load; everything else is served from the cache.

const VERSION = '__VERSION__';
const FILES = __FILES__;
const PREFIX = 'qr-studio-';
const CACHE = PREFIX + VERSION;
const INDEX = new URL('index.html', self.location).href;
// Fall back to the cached page if the server takes longer than this to answer.
const NETWORK_TIMEOUT = 4000;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // Bypass the HTTP cache so a stale index.html can't end up next to new assets.
      .then((cache) => cache.addAll(FILES.map((file) => new Request(new URL(file, self.location), { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith(PREFIX) && key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(fromNetwork(request).catch(() => caches.match(INDEX, { ignoreSearch: true })));
  } else {
    event.respondWith(caches.match(request).then((cached) => cached ?? fetch(request)));
  }
});

// Rejects when the server is unreachable, answers with a 5xx (e.g. a proxy's 502), or is too slow.
function fromNetwork(request) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(reject, NETWORK_TIMEOUT);
    fetch(request).then(
      (response) => {
        clearTimeout(timer);
        if (response.status >= 500) reject();
        else resolve(response);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
