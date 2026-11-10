/* Éclat Ai — service worker : l'interface s'ouvre même hors ligne.
   Seuls les fichiers de l'app sont mis en cache ; les appels aux IA (Agnes, Pollinations, serveur) passent toujours par le réseau. */
const CACHE = 'eclat-v6';
const SHELL = ['./', './index.html', './css/app.css', './js/engine.js', './js/app.js', './manifest.webmanifest',
  './assets/splash.jpg', './assets/hero.jpg', './assets/icon-192.png', './assets/icon-512.png',
  './assets/style-realiste.jpg', './assets/style-cinema.jpg', './assets/style-anime.jpg',
  './assets/style-fantastique.jpg', './assets/style-minimaliste.jpg', './assets/style-vhs.jpg'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;   // IA & polices : réseau direct
  // Réseau d'abord (pour recevoir les mises à jour), cache si hors ligne
  e.respondWith(fetch(e.request).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
    return res;
  }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('./index.html'))));
});
