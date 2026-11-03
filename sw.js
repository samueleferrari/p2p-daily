const CACHE_NAME = 'p2p-daily-v1';
const ASSETS = [
    './',
    './index.html',
    './script.js',
    './manifest.json'
];

// Install: save files to the device cache
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(ASSETS);
        })
    );
});

// Intercept network requests to make the app work offline
self.addEventListener('fetch', (event) => {
    event.respondWith(
        caches.match(event.request).then((cachedResponse) => {
            // Return the cached version if it exists, otherwise fetch from the network
            return cachedResponse || fetch(event.request);
        })
    );
});
