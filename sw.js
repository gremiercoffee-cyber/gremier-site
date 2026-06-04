const CACHE = 'gremier-v1';
const PRECACHE = [
  '/index.html',
  '/admin.html',
  '/manifest.json',
  '/admin-manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-192-maskable.png',
  '/icon-512-maskable.png',
  '/favicon.png',
  'https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;0,900;1,400&family=DM+Sans:wght@300;400;500&display=swap',
];

// Install: pre-cache shell
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

// Activate: clean old caches
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch strategy:
// - HTML pages: network-first (always fresh), fallback to cache
// - Supabase/Cloudinary API calls: network-only (never cache live data)
// - Fonts/static assets: cache-first
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Never cache Supabase or Cloudinary API calls
  if (url.hostname.includes('supabase.co') || url.hostname.includes('cloudinary.com')) {
    e.respondWith(fetch(e.request));
    return;
  }

  // HTML: network first
  if (e.request.destination === 'document') {
    e.respondWith(
      fetch(e.request)
        .then(res => { caches.open(CACHE).then(c => c.put(e.request, res.clone())); return res; })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // Everything else: cache first
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        if (res.ok) caches.open(CACHE).then(c => c.put(e.request, res.clone()));
        return res;
      });
    })
  );
});
