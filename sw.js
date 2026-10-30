const CACHE = 'gremier-v44';
const SUPABASE_FN = 'https://ayuzmwpmhncxrugsyxmw.supabase.co/functions/v1';
const PRECACHE = [
  '/index.html',
  '/logo.png',
  '/storefront-reveal.css?v=20261029-3',
  '/storefront-reveal.js?v=20261029-3',
  '/storefront-boot.css?v=20261028-3',
  '/storefront-boot.js?v=20261028-2',
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
    // One by one: a single missing file must not stop the worker from installing.
    caches.open(CACHE).then(c => Promise.allSettled(PRECACHE.map(u => c.add(u)))).then(() => self.skipWaiting())
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

// Web Push: native notification. Admin alerts stay on screen until acted on; customer
// notifications (audience 'customer', from the shop app) behave like normal app notifications.
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
    // Re-alert even when a notification with the same tag is showing, and keep
    // order alerts on screen until acted on so they can't be missed.
    renotify: !!data.tag,
    requireInteraction: data.audience !== 'customer' && data.important !== false,
    vibrate: data.audience === 'customer' ? [120] : [180, 80, 180],
    image: data.image || undefined,
    data: {
      url: data.url || (data.audience === 'customer' ? '/' : '/admin.html'),
      audience: data.audience || 'admin',
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

  // Production alerts open their scheduling form, without creating a job automatically.
  if(e.action==='schedule_production'||new URL(url,self.location.origin).searchParams.has('production_plan')){
    const target=new URL(url,self.location.origin).href;
    e.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(list=>{
      const client=list.find(c=>/^\/admin(?:\.html)?$/.test(new URL(c.url).pathname));
      return client&&'navigate' in client?client.navigate(target).then(c=>(c||client).focus()):self.clients.openWindow(target);
    }));return;
  }
  // Customer notification: open the shop on the page it points to (reuse an open shop window).
  if (d.audience === 'customer') {
    const target = new URL(url, self.location.origin).href;
    e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const client of list) {
        const p = new URL(client.url).pathname;
        if (!p.startsWith('/admin') && 'navigate' in client) return client.navigate(target).then(c => (c || client).focus());
      }
      return self.clients.openWindow(target);
    }));
    return;
  }

  // A worker cannot use navigator.share. Open the private, automatically prepared
  // batch; its Share button keeps the user gesture required by the native panel.
  if (e.action === 'share_expenses' || new URL(url, self.location.origin).searchParams.get('finance') === 'expenses') {
    const target='/admin.html?finance=expenses&expense_share=1';
    e.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(list=>{
      for(const client of list){
        if(/^\/admin(?:\.html)?\/?$/.test(new URL(client.url).pathname)&&'focus' in client){
          if('navigate' in client)return client.navigate(target).then(c=>(c||client).focus());
          client.postMessage({type:'gremier:share-expenses'});
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    }));
    return;
  }

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

  // A paid-order alert opens that order's details (reuse an open admin window).
  const orderId = new URL(url, self.location.origin).searchParams.get('order');
  if (orderId) {
    e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      const client = list.find(c => /^\/admin(?:\.html)?\/?$/.test(new URL(c.url).pathname) && 'focus' in c);
      if (client) { client.postMessage({ type: 'gremier:open-order', orderId }); return client.focus(); }
      return self.clients.openWindow(new URL(url, self.location.origin).href);
    }));
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

  // Other sites (database, images, payments): straight to the network, untouched — routing them
  // through here only added a delay. Google Fonts are still cached below.
  if (e.request.method !== 'GET') return;
  if (url.origin !== self.location.origin && !/^fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)) return;

  // HTML: network first
  if (e.request.mode === 'navigate' || e.request.destination === 'document' || e.request.destination === 'iframe') {
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
