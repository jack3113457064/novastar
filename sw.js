const CACHE = 'novastar-v1';
const FILES = ['/novastar/', '/novastar/index.html', '/novastar/app.js', '/novastar/logo.png', '/novastar/manifest.json'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES))); });
self.addEventListener('fetch', e => { e.respondWith(caches.match(e.request).then(r => r || fetch(e.request))); });
