// Chief of Staff service worker: app-shell caching + notification plumbing.
// API calls are never cached — data always comes fresh from the Worker.
const CACHE = "cos-shell-v6";
const SHELL = ["/", "/manifest.webmanifest", "/icon-192.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/")) return;
  // Network first so deploys show up immediately; fall back to cache offline.
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match("/"))),
  );
});

// Server-sent Web Push from the Worker (see worker/push.ts). Buttons act without opening the app.
self.addEventListener("push", (e) => {
  const data = e.data ? e.data.json() : { title: "Chief of Staff", body: "" };
  e.waitUntil(self.registration.showNotification(data.title, {
    body: data.body, icon: "/icon-192.png", badge: "/badge.png", tag: data.tag, renotify: !!data.tag, data,
    actions: (data.actions || []).slice(0, 3).map((a) => ({ action: a.action, title: a.title })),
  }));
});

const focusOrOpen = (target) =>
  new URL(target, self.location.origin).origin !== self.location.origin
    ? self.clients.openWindow(target) // e.g. a Google Doc: open it in its own app/browser
    : self.clients.matchAll({ type: "window" }).then((list) => {
    for (const c of list) if ("focus" in c) { c.navigate(target); return c.focus(); }
    return self.clients.openWindow(target);
  });

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const data = e.notification.data || {};
  const btn = (data.actions || []).find((a) => a.action === e.action);
  if (!btn) { e.waitUntil(focusOrOpen(data.url || "/")); return; }
  e.waitUntil(
    fetch("/api/act", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ n: data.nudge_id, a: btn.action, sig: data.sig }) })
      .then((r) => r.json())
      .then((res) => {
        if (btn.opens || res.open) return focusOrOpen(res.open || "/");
        // Quiet confirmation that replaces itself.
        return self.registration.showNotification(res.message || "Done", { tag: "cos-ack", silent: true, icon: "/icon-192.png" })
          .then(() => new Promise((r) => setTimeout(r, 4000)))
          .then(() => self.registration.getNotifications({ tag: "cos-ack" }))
          .then((ns) => ns.forEach((n) => n.close()));
      })
      .catch(() => focusOrOpen(data.url || "/")),
  );
});
