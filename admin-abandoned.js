// Abandoned checkouts: website orders that started payment but were never paid.
// - A pop-up card on any admin screen (one at a time, "1 of N"), with WhatsApp, Later and Dismiss.
// - Later / WhatsApp hide the pop-up; the checkout stays listed in Notifications and on Orders.
// - Dismiss is instant (no confirm): the card goes at once and the order is marked cancelled behind it.
// An order only counts after GRACE_MIN (the customer may still be paying), and not if the same
// customer paid a later order.
(function (root) {
  'use strict';
  const GRACE_MIN = 20, MAX_DAYS = 30, POLL_MS = 120000;
  const LATER_KEY = 'gremier_abandoned_later', MSG_KEY = 'gremier_abandoned_messaged';
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const readSet = (k) => { try { return JSON.parse(localStorage.getItem(k) || '{}'); } catch (_) { return {}; } };
  const mark = (k, id) => { const s = readSet(k); s[id] = Date.now(); try { localStorage.setItem(k, JSON.stringify(s)); } catch (_) {} };

  let items = [];                 // open abandoned checkouts, newest first
  let loaded = false, loading = false;

  const later = () => readSet(LATER_KEY), messaged = () => readSet(MSG_KEY);
  const popupQueue = () => { const l = later(), m = messaged(); return items.filter((o) => !l[o.id] && !m[o.id]); };
  const digits = (p) => String(p || '').replace(/\D/g, '').replace(/^972/, '0');

  async function load() {
    if (loading || typeof sb === 'undefined') return;
    loading = true;
    try {
      const { data: { session } } = await sb.auth.getSession();
      if (!session) return;                       // not signed in yet; the quick retry below tries again
      const now = Date.now();
      const until = new Date(now - GRACE_MIN * 60000).toISOString();
      const since = new Date(now - MAX_DAYS * 86400000).toISOString();
      const [open, paid] = await Promise.all([
        sb.from('orders').select('id,order_number,customer_name,customer_phone,customer_email,items,total,created_at,source,delivery_info')
          .neq('payment_status', 'paid').not('status', 'in', '(cancelled,fulfilled,refunded)')
          .neq('source', 'payment_link').lt('created_at', until).gte('created_at', since)
          .order('created_at', { ascending: false }).limit(50),
        sb.from('orders').select('customer_phone,customer_email,created_at').eq('payment_status', 'paid').gte('created_at', since).limit(1000),
      ]);
      if (open.error) throw open.error;
      const paidRows = paid.data || [];
      // Same customer paid afterwards (often a second try) → not abandoned.
      items = (open.data || []).filter((o) => !paidRows.some((p) => p.created_at > o.created_at
        && ((digits(o.customer_phone) && digits(p.customer_phone) === digits(o.customer_phone))
          || (o.customer_email && String(p.customer_email || '').toLowerCase() === String(o.customer_email).toLowerCase()))));
      loaded = true;
      renderAll();
    } catch (e) {
      console.warn('abandoned checkouts:', e.message || e);
    } finally { loading = false; }
  }

  function ago(iso) {
    const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (mins < 60) return mins + 'm ago';
    const h = Math.round(mins / 60);
    if (h < 24) return h + 'h ago';
    return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  }
  function waHref(o) {
    const first = String(o.customer_name || '').trim().split(/\s+/)[0] || '';
    const he = (o.delivery_info && o.delivery_info.lang === 'he') || /[֐-׿]/.test(o.customer_name || '');
    const text = he
      ? `היי ${first}, ראיתי שהתחלת הזמנה באתר של גרמיר קופי ולא הספקת לסיים. אפשר לעזור במשהו?`
      : `Hi ${first}, I saw you started an order on the Gremier Coffee website but didn't get to finish. Can I help with anything?`;
    return typeof whatsAppShareHref === 'function' ? whatsAppShareHref(o.customer_phone, encodeURIComponent(text)) : '';
  }

  function card(o, where) {
    const products = (o.items || []).filter((i) => i.category !== 'delivery_fee');
    const list = products.map((i) => `${(i.qty || 1) > 1 ? i.qty + '× ' : ''}${i.name_en || i.name_he || i.name || 'Item'}`).join(', ');
    const imgs = products.map((i) => (typeof orderItemImage === 'function' ? orderItemImage(i) : '')).filter(Boolean).slice(0, 3);
    const thumbs = imgs.length ? imgs.map((s) => `<img src="${esc(s)}" alt=""/>`).join('') : '<span>🛒</span>';
    const was = messaged()[o.id] ? '<span class="plk-tag paid">Messaged</span>' : later()[o.id] ? '<span class="plk-tag">Later</span>' : '';
    const wa = o.customer_phone ? waHref(o) : '';
    const id = esc(o.id);
    return `<div class="oc-card ab-card" data-ab="${id}">
      <div class="oc-top" onclick="GremierAbandoned.open('${id}')" role="button" tabindex="0" title="Open order">
        <div class="plk-thumbs">${thumbs}</div>
        <div class="oc-main">
          <span class="oc-name">${esc(o.customer_name || o.customer_phone || 'Customer')}</span>
          <span class="oc-items">${esc(list || 'No items')}</span>
          <span class="oc-tags"><span>${o.order_number ? '#' + esc(o.order_number) + ' · ' : ''}${ago(o.created_at)}</span>${was}</span>
        </div>
        <div class="oc-total">₪${Number(o.total || 0).toFixed(0)}</div>
      </div>
      <div class="oc-actions">
        ${wa ? `<a class="oc-btn wa" href="${esc(wa)}" target="_blank" rel="noopener" onclick="GremierAbandoned.messaged('${id}')">💬 WhatsApp</a>` : ''}
        ${where === 'popup' ? `<button type="button" class="oc-btn" onclick="GremierAbandoned.later('${id}')">Later</button>` : ''}
        <button type="button" class="oc-btn" onclick="GremierAbandoned.dismiss('${id}')">✕ Dismiss</button>
      </div>
    </div>`;
  }

  function appVisible() {
    const app = document.getElementById('appScreen');
    return app && getComputedStyle(app).display !== 'none';
  }
  function renderPopup() {
    let pop = document.getElementById('abPop');
    const queue = appVisible() ? popupQueue() : [];
    if (!queue.length) { if (pop) pop.remove(); return; }
    if (!pop) {
      pop = document.createElement('div');
      pop.id = 'abPop';
      pop.setAttribute('role', 'alertdialog');
      pop.setAttribute('aria-label', 'Abandoned checkout');
      document.body.appendChild(pop);
    }
    pop.innerHTML = `<div class="ab-pop-head"><span class="ab-pop-label">🛒 Abandoned checkout</span>${queue.length > 1 ? `<span class="ab-pop-n">1 of ${queue.length}</span>` : ''}</div>${card(queue[0], 'popup')}`;
  }
  // Listed in the notifications panel (top) and on the Orders screen.
  function renderLists() {
    const html = items.length ? `<h3 class="ab-list-h">🛒 Abandoned checkouts <span>${items.length}</span></h3><div class="oc-list">${items.map((o) => card(o, 'list')).join('')}</div>` : '';
    let inPanel = document.getElementById('abNotifList');
    const notifList = document.getElementById('notifList');
    if (!inPanel && notifList) {
      inPanel = document.createElement('div');
      inPanel.id = 'abNotifList';
      notifList.parentNode.insertBefore(inPanel, notifList);
    }
    if (inPanel) inPanel.innerHTML = html;
    const onOrders = document.getElementById('abandonedOrdersPanel');
    if (onOrders) onOrders.innerHTML = html;
    if (typeof updateNotifBadge === 'function') updateNotifBadge();
  }
  function renderAll() { renderPopup(); renderLists(); }

  function remove(id) { items = items.filter((o) => o.id !== id); renderAll(); }

  const api = {
    load, renderAll,
    count: () => items.length,
    open(id) {
      const o = items.find((x) => x.id === id);
      if (!o) return;
      if (typeof allOrders !== 'undefined' && !allOrders.some((x) => x.id === id)) allOrders.push(o);
      if (typeof closeNotificationsPanel === 'function') closeNotificationsPanel();
      if (typeof openOrderDetail === 'function') openOrderDetail(id);
    },
    later(id) { mark(LATER_KEY, id); renderAll(); },
    messaged(id) { mark(MSG_KEY, id); setTimeout(renderAll, 0); },   // let the WhatsApp link open first
    async dismiss(id) {
      const o = items.find((x) => x.id === id);
      remove(id);
      const { error } = await sb.from('orders').update({ status: 'cancelled', updated_at: new Date().toISOString() }).eq('id', id);
      if (error) {
        if (o) { items = [o, ...items]; renderAll(); }
        if (typeof showToast === 'function') showToast('Could not dismiss: ' + error.message, 6000);
      }
    },
  };
  root.GremierAbandoned = api;

  const css = document.createElement('style');
  css.textContent = `
#abPop{position:fixed;right:20px;bottom:20px;z-index:350;width:min(400px,calc(100vw - 24px));background:#fff;border-radius:20px;padding:12px;box-shadow:0 18px 50px rgba(0,0,0,.24),0 0 0 1px rgba(0,0,0,.06);animation:abIn .22s ease-out}
#abPop .oc-card{border:0;box-shadow:none;padding:4px 2px 2px}
.ab-pop-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:2px 4px 8px}
.ab-pop-label{font-size:.72rem;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#a3691c;background:rgba(224,160,48,.16);padding:4px 10px;border-radius:999px}
.ab-pop-n{font-size:.74rem;font-weight:700;color:var(--text2)}
.ab-list-h{display:flex;align-items:center;gap:8px;margin:4px 0 10px;font-size:.8rem;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--text2)}
.ab-list-h span{font-size:.7rem;letter-spacing:0;padding:1px 8px;border-radius:999px;background:var(--bg3);color:var(--cream2)}
#abNotifList{padding:12px 14px 4px}
#abNotifList:empty{display:none}
body:has(.modal-backdrop.open) #abPop,body:has(.modal.open) #abPop,body:has(#orderModal.open) #abPop,body:has(#msgSheet.open) #abPop,body:has(.notif-panel.open) #abPop,body:has(.nav-drawer.open) #abPop,body:has([role=dialog][aria-modal=true]) #abPop,body:has(div[style*="position: fixed"][style*="inset: 0"]) #abPop{display:none}
@keyframes abIn{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}
@media (max-width:768px){#abPop{left:12px;right:12px;width:auto;bottom:calc(74px + env(safe-area-inset-bottom))}}`;
  document.head.appendChild(css);

  // Check now, every couple of minutes, and whenever the app comes back to the front.
  setTimeout(load, 2500);
  const quick = setInterval(() => { if (loaded) clearInterval(quick); else load(); }, 10000);
  setInterval(() => { if (!document.hidden) load(); }, POLL_MS);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
})(window);
