const CACHE_NAME = 'openscan-pro-v1';

// List of files to save for offline use
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './css/style.css',
  './js/app.js',
  './manifest.json',
  './assets/icon-192.png',
  './assets/icon-512.png',
  // CDN Dependencies (Caching these allows the AI to work offline!)
  'https://docs.opencv.org/4.x/opencv.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'
];

// 1. Install: Save all files into the browser cache
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Pre-caching assets');
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
});

// 2. Activate: Clean up old versions of the app
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
});

// 3. Fetch: Serve from cache first, then try the internet
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse; // Return the saved version
      }
      return fetch(event.request).then((networkResponse) => {
        // Optionally cache new resources on the fly here
        return networkResponse;
      });
    }).catch(() => {
      // If both fail (user is offline and file isn't cached), 
      // you could return a custom offline.html page here.
    })
  );
});
