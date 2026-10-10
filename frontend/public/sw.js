// Overtime Tracker Service Worker
const CACHE_NAME = 'overtime-tracker-v2';

const STATIC_ASSETS = [
  '/manifest.json',
  '/icon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Never intercept non-GET requests (e.g. POST auth payloads)
  if (event.request.method !== 'GET') {
    return;
  }

  // Let Google Apps Script API calls pass directly over the network
  const url = event.request.url;
  if (url.includes('script.google.com') || url.includes('script.googleusercontent.com')) {
    return;
  }

  // Network first with cache fallback for static assets
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        return response;
      })
      .catch(() => {
        return caches.match(event.request);
      })
  );
});

