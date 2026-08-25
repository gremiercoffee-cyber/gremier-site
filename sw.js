const CACHE = 'gremier-v27';
const SUPABASE_FN = 'https://ayuzmwpmhncxrugsyxmw.supabase.co/functions/v1';
const PRECACHE = [
  '/index.html',
  '/admin.html',
  '/pay.html',
  '/manifest.json',
  '/admin-manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-192-maskable.png',
  '/icon-badge.png',
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

// Web Push: show native notification (admin PWA)
self.addEventListener('push', e => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch { data = { title: 'Gremier', body: e.data && e.data.text() }; }
  const title = data.title || 'Gremier';
  e.waitUntil(self.registration.showNotification(title, {
    body: data.body || '',
    tag: data.tag || undefined,
    icon: '/icon-192.png',
    // Android draws the badge from the alpha channel only — must be a
    // transparent silhouette, or it renders as a solid black square.
    badge: '/icon-badge.png',
    actions: Array.isArray(data.actions) ? data.actions.slice(0, 2) : undefined,
    data: {
      url: data.url || '/admin.html',
      jobId: data.jobId || null,
      actionToken: data.actionToken || null,
    },
  }));
});

// Tap on notification → focus/open the admin app
self.addEventListener('notificationclick', e => {
  const d = e.notification.data || {};
  const url = d.url || '/admin.html';
  e.notification.close();

  // One-tap drain completion — the side effect is a known amount of concentrate,
  // so it can be applied server-side without opening the app.
  if (e.action === 'drain_complete' && d.actionToken) {
    e.waitUntil((async () => {
      try {
        const res = await fetch(SUPABASE_FN + '/job-action', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: d.actionToken }),
        });
        const out = await res.json().catch(() => ({}));
        await self.registration.showNotification(
          out.ok ? '✓ Drain logged' : 'Could not log drain',
          {
            body: out.ok
              ? (out.already ? 'Already marked done.' : `+${out.liters_added}L ${out.product} concentrate`)
              : (out.error || 'Open the app and try again.'),
            icon: '/icon-192.png',
            badge: '/icon-badge.png',
            tag: 'drain-result',
            data: { url: '/admin.html' },
          }
        );
      } catch (err) {
        await self.registration.showNotification('Could not log drain', {
          body: 'No connection — open the app to mark it done.',
          icon: '/icon-192.png', badge: '/icon-badge.png', tag: 'drain-result',
          data: { url: '/admin.html' },
        });
      }
    })());
    return;
  }

  // The action BUTTONS ("Mark delivered" / "Open job") jump to that job's checkoff.
  // A plain tap on the notification body opens the in-app Notifications screen.
  const goToJob = e.action === 'open_job';
  const openUrl = goToJob ? url : '/admin.html?notif=1';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const client of list) {
        if (client.url.includes('admin.html') && 'focus' in client) {
          client.postMessage(goToJob
            ? { type: 'gremier:open-job', jobId: d.jobId || null }
            : { type: 'gremier:open-notifications' });
          return client.focus();
        }
      }
      return self.clients.openWindow(openUrl);
    })
  );
});

// Fetch strategy:
// - HTML pages: network-first (always fresh), fallback to cache
// - Supabase/Cloudinary API calls: network-only (never cache live data)
// - Fonts/static assets: cache-first
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Ops app — let its own service worker handle /ops/
  if (url.pathname.startsWith('/ops/')) {
    e.respondWith(fetch(e.request));
    return;
  }

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
