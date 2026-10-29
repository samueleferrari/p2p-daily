const CACHE_NAME = 'p2p-daily-v1';
const ASSETS = [
    './',
    './index.html',
    './script.js',
    './manifest.json'
];

// Installazione: salva i file nella cache del telefono
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(ASSETS);
        })
    );
});

// Intercetta le richieste di rete per far funzionare l'app offline
self.addEventListener('fetch', (event) => {
    event.respondWith(
        caches.match(event.request).then((cachedResponse) => {
            // Restituisce la versione in cache se esiste, altrimenti la scarica da internet
            return cachedResponse || fetch(event.request);
        })
    );
});
