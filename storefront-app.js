/* The shop as an app: installs to the home screen (manifest.json, sw.js) and sends notifications
   (Web Push) — order confirmed, on the way, delivered, and the other updates we email.
   Where it's offered: after paying, on the account page, and "Get the app" in the menu. */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const he = () => typeof lang !== 'undefined' && lang === 'he';
  const T = (en, hebrew) => (he() ? hebrew : en);
  const get = (k) => { try { return localStorage.getItem(k); } catch (_) { return null; } };
  const put = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (_) {} };
  // Same key pair as the admin app's notifications (the server signs with its private half).
  const VAPID = 'BFIXYUWDzcaT0UMZKvCI39mt9hi-bwtSJCpcJXBQaRbFVI9AJ70Mg5qJ_2ZQw9_Fq189Knc49EATRWzNL2tOgUM';

  const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const pushSupported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  let installPrompt = null;
  let subscribed = false;

  // ── Service worker (app shell, cache, notifications) ──
  function registerWorker() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js').then(async (reg) => {
      const sub = pushSupported ? await reg.pushManager.getSubscription() : null;
      subscribed = !!sub && Notification.permission === 'granted';
      if (subscribed) {
        put('gremier_push_endpoint', sub.endpoint);
        // Once a day, refresh the device's language and link (e.g. after signing in).
        if (Date.now() - Number(get('gremier_push_synced') || 0) > 864e5) save(sub);
      }
      refresh();
    }).catch((e) => console.warn('Service worker failed:', e));
  }
  addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installPrompt = e; refresh(); });
  addEventListener('appinstalled', () => { installPrompt = null; refresh(); });

  function keyBytes(b64) {
    const pad = '='.repeat((4 - (b64.length % 4)) % 4);
    const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
  }
  async function save(sub) {
    const { data: { session } } = typeof getSessionSafe === 'function' ? await getSessionSafe() : { data: {} };
    const res = await fetch(`${SUPABASE_URL}/functions/v1/engage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + (session?.access_token || SUPABASE_ANON_KEY) },
      body: JSON.stringify({ action: 'push_subscribe', subscription: sub.toJSON(), lang: he() ? 'he' : 'en', order_id: get('gremier_last_order_id') || undefined }),
    });
    if (res.ok) put('gremier_push_synced', String(Date.now()));
    return res.ok;
  }

  // ── Turn notifications on / off ──
  window.appEnableNotifications = async function () {
    if (!pushSupported) return;
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { refresh(); return; }
      const reg = await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID) });
      put('gremier_push_endpoint', sub.endpoint);
      subscribed = true;
      const ok = await save(sub);
      refresh();
      if (typeof showToast === 'function') showToast(ok ? T('🔔 Notifications are on', '🔔 ההתראות פועלות') : T('Could not turn on notifications. Try again.', 'לא הצלחנו להפעיל התראות. נסו שוב.'));
    } catch (e) {
      console.warn('Notifications:', e);
      if (typeof showToast === 'function') showToast(T('Could not turn on notifications. Try again.', 'לא הצלחנו להפעיל התראות. נסו שוב.'));
    }
  };
  window.appDisableNotifications = async function () {
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        fetch(`${SUPABASE_URL}/functions/v1/engage`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + SUPABASE_ANON_KEY }, body: JSON.stringify({ action: 'push_unsubscribe', endpoint: sub.endpoint }) }).catch(() => {});
        // The admin app on this same device uses this subscription too: keep it, just unlink it here.
      }
    } catch (_) {}
    subscribed = false;
    put('gremier_push_endpoint', null);
    refresh();
  };
  window.appInstall = async function () {
    if (!installPrompt) return openSheet();
    installPrompt.prompt();
    const choice = await installPrompt.userChoice.catch(() => null);
    installPrompt = null;
    refresh();
    // Installed from the browser: offer notifications right away (they work in the app too).
    if (choice?.outcome === 'accepted' && pushSupported && Notification.permission === 'default') setTimeout(appEnableNotifications, 400);
  };

  // ── The card (same in every place it's shown) ──
  function state() {
    if (subscribed && Notification.permission === 'granted') return 'on';
    if (pushSupported && Notification.permission === 'denied') return 'blocked';
    if (ios && !standalone()) return 'ios';                    // iPhone: notifications need the home-screen app
    if (installPrompt && !standalone()) return 'install';
    if (pushSupported) return 'enable';
    return 'none';
  }
  const SHARE_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12M7 8l5-5 5 5"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg>';
  function cardHtml(context) {
    const s = state();
    const lead = context === 'order'
      ? T('Want to know when your coffee is on the way?', 'רוצים לדעת כשהקפה בדרך?')
      : T('Get the Gremier app', 'הורידו את האפליקציה של גרמיר');
    if (s === 'on') return context === 'account'
      ? `<div class="app-card on"><div class="app-ico">🔔</div><div class="app-txt"><b>${T('Notifications are on', 'ההתראות פועלות')}</b><span>${T('We’ll let you know when your coffee is on the way.', 'נעדכן אתכם כשהקפה בדרך.')}</span></div><button type="button" class="app-link" onclick="appDisableNotifications()">${T('Turn off', 'כיבוי')}</button></div>`
      : '';
    if (s === 'blocked') return context === 'account'
      ? `<div class="app-card"><div class="app-ico">🔕</div><div class="app-txt"><b>${T('Notifications are blocked', 'ההתראות חסומות')}</b><span>${T('Allow notifications for gremiercoffee.co.il in your browser or phone settings.', 'אפשרו התראות עבור gremiercoffee.co.il בהגדרות הדפדפן או הטלפון.')}</span></div></div>`
      : '';
    if (s === 'ios') return `<div class="app-card"><div class="app-ico"><img src="/icon-192.png" alt=""></div><div class="app-txt"><b>${lead}</b>
        <span>${T('Add Gremier to your home screen and get a notification when your coffee is on the way.', 'הוסיפו את גרמיר למסך הבית וקבלו התראה כשהקפה בדרך.')}</span>
        <ol class="app-steps"><li>${T('Tap', 'לחצו על')} <i class="app-share">${SHARE_ICON}</i> ${T('Share at the bottom of Safari', 'שיתוף בתחתית ספארי')}</li><li>${T('Choose “Add to Home Screen”', 'בחרו "הוספה למסך הבית"')}</li><li>${T('Open Gremier from your home screen and turn on notifications', 'פתחו את גרמיר ממסך הבית והפעילו התראות')}</li></ol></div></div>`;
    if (s === 'install') return `<div class="app-card"><div class="app-ico"><img src="/icon-192.png" alt=""></div><div class="app-txt"><b>${lead}</b>
        <span>${T('Order in a tap, and get a notification when your coffee is on the way.', 'מזמינים בלחיצה, ומקבלים התראה כשהקפה בדרך.')}</span></div>
        <div class="app-btns"><button type="button" class="app-btn" onclick="appInstall()">${T('Install the app', 'להתקנת האפליקציה')}</button>${pushSupported ? `<button type="button" class="app-link" onclick="appEnableNotifications()">${T('Just notifications', 'רק התראות')}</button>` : ''}</div></div>`;
    if (s === 'enable') return `<div class="app-card"><div class="app-ico">🔔</div><div class="app-txt"><b>${context === 'order' ? lead : T('Get notified about your orders', 'קבלו התראות על ההזמנות')}</b>
        <span>${T('We’ll send a notification when your coffee is on the way and when it’s delivered.', 'נשלח התראה כשהקפה יוצא אליכם וכשהוא נמסר.')}</span></div>
        <div class="app-btns"><button type="button" class="app-btn" onclick="appEnableNotifications()">${T('Turn on notifications', 'להפעלת התראות')}</button></div></div>`;
    return '';
  }

  function place(id, anchor, where, context) {
    $(id)?.remove();
    if (!anchor) return;
    const html = cardHtml(context);
    if (!html) return;
    anchor.insertAdjacentHTML(where, `<div id="${id}" class="app-slot">${html}</div>`);
  }
  function onConfirm(kind) {
    if (kind !== 'paid') return;
    const view = $('checkoutConfirmView');
    place('appOrder', view?.querySelector('.confirm-sub'), 'afterend', 'order');
  }
  function onAccount() {
    const wrap = document.querySelector('#myordersPage .account-page-wrap');
    place('appAccount', wrap, 'afterbegin', 'account');
  }
  function refresh() {
    if ($('appOrder')) onConfirm('paid');
    if ($('myordersPage')?.classList.contains('active')) onAccount();
    menuItem();
    if ($('appSheet')?.classList.contains('open')) fillSheet();
  }

  // ── "Get the app" in the menu, and the sheet it opens ──
  function menuItem() {
    const menu = $('mobileMenu');
    if (!menu) return;
    const show = !standalone() && ['install', 'ios', 'enable'].includes(state());
    let a = $('mmApp');
    if (!show) { a?.remove(); return; }
    if (!a) {
      a = document.createElement('a');
      a.id = 'mmApp';
      a.onclick = () => { if (typeof closeMobileMenu === 'function') closeMobileMenu(); openSheet(); };
      menu.appendChild(a);
    }
    a.textContent = T('📲 Get the app', '📲 הורדת האפליקציה');
  }
  function fillSheet() {
    const box = $('appSheet')?.querySelector('.app-sheet-body');
    if (box) box.innerHTML = cardHtml('menu') || `<p class="app-none">${T('Notifications are on. You’re all set!', 'ההתראות פועלות. הכל מוכן!')}</p>`;
  }
  function openSheet() {
    let el = $('appSheet');
    if (!el) {
      el = document.createElement('div');
      el.id = 'appSheet';
      el.className = 'app-sheet';
      el.innerHTML = '<div class="app-sheet-box" role="dialog" aria-modal="true"><button type="button" class="app-sheet-x" aria-label="Close">×</button><div class="app-sheet-body"></div></div>';
      el.addEventListener('click', (e) => { if (e.target === el || e.target.closest('.app-sheet-x')) el.classList.remove('open'); });
      document.body.appendChild(el);
    }
    fillSheet();
    el.classList.add('open');
  }
  window.openAppSheet = openSheet;

  // First time the installed app opens: offer notifications once.
  function firstLaunch() {
    if (!standalone() || get('gremier_app_asked') || state() !== 'enable') return;
    put('gremier_app_asked', '1');
    setTimeout(openSheet, 1500);
  }

  function wrap(name, after) {
    const orig = window[name];
    if (typeof orig !== 'function') return;
    window[name] = function () { const r = orig.apply(this, arguments); try { after.apply(this, arguments); } catch (e) { console.error(e); } return r; };
  }
  function hook() {
    wrap('showCheckoutResultUI', onConfirm);
    wrap('updateAccountPage', onAccount);
    wrap('applyTranslations', refresh);
    // The notifications follow the shop's language.
    wrap('toggleLang', () => { if (subscribed) navigator.serviceWorker.ready.then((r) => r.pushManager.getSubscription()).then((x) => x && save(x)).catch(() => {}); });
    if (document.readyState === 'complete') registerWorker(); else addEventListener('load', registerWorker);
    menuItem();
    const ready = () => firstLaunch();
    typeof whenLanguageSet === 'function' ? whenLanguageSet(ready) : setTimeout(ready, 1500);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', hook);
  else hook();
})();
