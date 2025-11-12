// Simple service worker to cache core assets (optional).
const CACHE = 'code-runner-v1';
const ASSETS = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/manifest.json'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  // Try cache first for core assets
  if (ASSETS.includes(new URL(req.url).pathname)) {
    e.respondWith(caches.match(req).then(r => r || fetch(req)));
  }
  // otherwise fallback to network
});
