const APP_VERSION = '0.1.12';
const CACHE_NAME = `stuff-shell-v${APP_VERSION}-1`;
const SHELL = [
  './',
  './index.html',
  './privacy.html',
  './SKILL.md',
  './llms.txt',
  './manifest.webmanifest',
  './styles/app.css',
  './assets/icons/icon.svg',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/icon-maskable-192.png',
  './assets/icons/icon-maskable-512.png',
  './assets/icons/apple-touch-icon.png',
  './src/main.js',
  './src/config.js',
  './src/utils.js',
  './src/components/dom.js',
  './src/components/stuff-app.js',
  './src/components/stuff-dialog.js',
  './src/components/stuff-item-card.js',
  './src/components/stuff-toast-region.js',
  './src/data/demo-database.js',
  './src/data/schema-registry.js',
  './src/data/sheet-database.js',
  './src/data/migrations/index.js',
  './src/search/search-index.js',
  './src/services/drive-client.js',
  './src/services/google-api.js',
  './src/services/google-auth.js',
  './src/services/google-picker.js',
  './src/services/media-service.js',
  './src/services/sheets-client.js',
  './src/services/storage.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(Promise.all([
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith('stuff-shell-') && key !== CACHE_NAME).map((key) => caches.delete(key)))),
    self.clients.claim(),
  ]));
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin || event.request.method !== 'GET') return;

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok) caches.open(CACHE_NAME).then((cache) => cache.put('./index.html', response.clone()));
          return response;
        })
        .catch(() => caches.match('./index.html')),
    );
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok && response.type === 'basic') caches.open(CACHE_NAME).then((cache) => cache.put(event.request, response.clone()));
        return response;
      })
      .catch(() => caches.match(event.request)),
  );
});
