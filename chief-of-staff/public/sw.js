// Chief of Staff service worker: app-shell caching + notification plumbing.
// API calls are never cached — data always comes fresh from the Worker.
const CACHE = "cos-shell-v15";
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
let pushQueue = Promise.resolve();
self.addEventListener("push", (e) => {
  const data = e.data ? e.data.json() : { title: "Chief of Staff", body: "" };
  e.waitUntil(pushQueue = pushQueue.catch(() => {}).then(async () => {
    const visible = await self.registration.getNotifications();
    const matches = visible.filter(n => (data.tag && n.tag === data.tag)
      || (data.nudge_id && n.data?.nudge_id === data.nudge_id)
      || (data.legacy_tags || []).includes(n.tag)
      || (n.data?.legacy_tags || []).includes(data.tag));
    // Offline deliveries may arrive out of order. Never put older text/buttons back on top.
    if (matches.some(n => n.data?.nudge_id === data.nudge_id && (n.data?.revision || 0) > (data.revision || 0))) return;
    if (!data.revision && matches.some(n => n.data?.revision)) return;
    // A task moving into a newer time block must leave the older block's notification too.
    for (const update of data.notification_updates || []) {
      const old=visible.find(n=>n.data?.nudge_id===update.id);
      if (!old || (old.data?.revision || 0)>update.revision) continue;
      await self.registration.showNotification(update.title,{
        body:update.body,tag:old.tag,icon:"/icon-192.png",badge:"/badge.png",silent:true,renotify:false,
        data:{...old.data,title:update.title,body:update.body,revision:update.revision},
        actions:(old.data?.actions || []).slice(0,3).map(a=>({action:a.action,title:a.title})),
      });
    }
    const superseded=visible.filter(n=>(data.close_notifications || []).includes(n.data?.nudge_id));
    const same = matches.find(n => n.tag === data.tag && n.data?.nudge_id === data.nudge_id
      && n.title === data.title && n.body === (data.body || "")
      && n.data?.url === data.url && JSON.stringify(n.data?.actions || []) === JSON.stringify(data.actions || []));
    // Repeated delivery while it is still on the phone: don't redraw, buzz, or add anything.
    if (same) { [...matches.filter(n => n !== same),...superseded].forEach(n => n.close()); return; }
    // The tag replaces the current notification. Changed wording updates quietly while visible.
    await self.registration.showNotification(data.title, {
      body: data.body, icon: "/icon-192.png", badge: "/badge.png", tag: data.tag,
      renotify: false, silent: matches.length > 0 || superseded.length > 0, data,
      actions: (data.actions || []).slice(0, 3).map(a => ({ action:a.action, title:a.title })),
    });
    [...matches.filter(n => n.tag !== data.tag),...superseded].forEach(n => n.close());
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
      .then((r) => { if (!r.ok) throw new Error("Action was not saved"); return r.json(); })
      .then((res) => {
        if (btn.opens || res.open) return focusOrOpen(res.open || "/");
        // A plain dismiss gets no confirmation at all: a new notification popping up would disturb the
        // notification screen, and you couldn't clear several in a row.
        if (["ok", "notneeded", "ignore", "decline"].includes(btn.action)) return;
        // Quiet confirmation that replaces itself.
        return self.registration.showNotification(res.message || "Done", { tag: "cos-ack", silent: true, icon: "/icon-192.png" })
          .then(() => new Promise((r) => setTimeout(r, 4000)))
          .then(() => self.registration.getNotifications({ tag: "cos-ack" }))
          .then((ns) => ns.forEach((n) => n.close()));
      })
      .catch(() => focusOrOpen(data.url || "/")),
  );
});
