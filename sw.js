/* Try — service worker for offline support (PWA). */
const CACHE = 'try-v2';

// App shell + the CDN libraries the app needs to boot offline.
const SHELL = [
  './',
  './index.html',
  './styles.css',
  './js/data.js',
  './js/plan.js',
  './js/app.jsx',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/favicon-48.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon-180.png',
  'https://unpkg.com/react@18/umd/react.production.min.js',
  'https://unpkg.com/react-dom@18/umd/react-dom.production.min.js',
  'https://unpkg.com/@babel/standalone/babel.min.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      // Don't let one flaky CDN request abort the whole install.
      .then((c) => Promise.all(SHELL.map((u) => c.add(u).catch(() => null))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function cachePut(req, res) {
  if (res && res.status === 200 && res.type !== 'opaque') {
    const copy = res.clone();
    caches.open(CACHE).then((c) => c.put(req, copy));
  }
  return res;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const sameOrigin = new URL(req.url).origin === self.location.origin;

  if (sameOrigin) {
    // Network-first: always fresh when online, fall back to cache offline.
    e.respondWith(
      fetch(req)
        .then((res) => cachePut(req, res))
        .catch(() => caches.match(req).then((c) => c || caches.match('./index.html')))
    );
  } else {
    // Cache-first for immutable CDN libs / Google Fonts.
    e.respondWith(
      caches.match(req).then((c) => c || fetch(req).then((res) => cachePut(req, res)))
    );
  }
});
