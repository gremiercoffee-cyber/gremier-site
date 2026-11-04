// Orders screen "Active" list: paid orders still to fulfill and scheduled deliveries, together as one
// card list grouped by delivery date. A delivery made for a website order shares that order's card.
// Unpaid orders go under "Waiting for payment" with the payment links (unless a link already shows them).
// When nothing is left, one green "All done" tick replaces the list.
// Delivery jobs come from the schedule (react-1.jsx publishes window.__gremierDeliveries and
// window.__gremierDeliveryActions); order cards are drawn by orderRowHtml() in admin.html.
(function (root) {
  'use strict';
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let orders = null;          // open (not fulfilled/cancelled/refunded) orders from the Orders list
  let waitedForDeliveries = false;   // stop showing a spinner if the schedule never loads
  setTimeout(() => { waitedForDeliveries = true; render(); }, 8000);

  const isPaid = (o) => String(o.payment_status || '').toLowerCase() === 'paid';
  const pad = (n) => String(n).padStart(2, '0');
  const isoDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  function dayLabel(key) {
    if (key === 'overdue') return 'Overdue';
    if (key === 'nodate') return 'No delivery date';
    const now = new Date(), today = isoDay(now);
    const tom = new Date(now); tom.setDate(now.getDate() + 1);
    const pretty = new Date(key + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
    if (key === today) return `Today · ${pretty}`;
    if (key === isoDay(tom)) return `Tomorrow · ${pretty}`;
    return pretty;
  }

  function productLabel(pid) {
    const dyn = root.__OPS_DYNAMIC_PRODUCTS__ && root.__OPS_DYNAMIC_PRODUCTS__[pid];
    if (dyn && dyn.label) return dyn.label;
    return String(pid).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }
  function jobName(j) {
    if (j.deliveryType === 'store') return j.storeName || 'Store';
    if (j.deliveryType === 'coffeebar') return j.cbName || j.privateName || 'Coffee bar';
    return j.privateName || 'Delivery';
  }
  function jobAddress(j, stores) {
    if (j.deliveryType === 'store') {
      const s = (stores || []).find((x) => String(x.name || '').trim().toLowerCase() === String(j.storeName || '').trim().toLowerCase());
      return s ? [s.public_address, s.public_city].filter(Boolean).join(', ') : '';
    }
    return (j.deliveryType === 'coffeebar' ? j.cbAddress : j.privateAddress) || j.privateAddress || j.cbAddress || '';
  }
  const detailsLine = (d) => (root.GremierRoute && d ? root.GremierRoute.detailsLine(d) : '');

  // A delivery with no website order behind it (store runs, coffee bars, private deliveries).
  function jobCard(j, stores, overdue) {
    const qty = Object.entries(j.quantities || {}).filter(([, n]) => Number(n) > 0);
    const items = qty.map(([pid, n]) => `${Number(n) > 1 ? n + '× ' : ''}${productLabel(pid)}`).join(', ');
    const thumbs = qty.slice(0, 3).map(([pid]) => (root.getProductImage ? root.getProductImage(pid) : '')).filter(Boolean);
    const thumbHtml = thumbs.length ? thumbs.map((src) => `<img src="${esc(src)}" alt=""/>`).join('') : '<span>🚚</span>';
    const kind = j.deliveryType === 'store' ? 'Store' : j.deliveryType === 'coffeebar' ? 'Coffee bar' : 'Delivery';
    const tags = [
      `<span class="plk-tag">${kind}</span>`,
      j.time ? `<span>${esc(String(j.time).slice(0, 5))}</span>` : '',
      j.deliveryType === 'coffeebar' && j.people ? `<span>· ${esc(j.people)} people</span>` : '',
      overdue ? `<span class="plk-tag warn">Was due ${esc(new Date(j.date + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }))}</span>` : '',
    ].join('');
    const address = jobAddress(j, stores), details = detailsLine(j.deliveryDetails);
    const wa = j.customerPhone && typeof whatsAppShareHref === 'function' ? whatsAppShareHref(j.customerPhone, '') : '';
    const id = esc(j.id);
    return `<div class="oc-card todo${overdue ? ' late' : ''}" data-job-id="${id}">
      <div class="oc-top" onclick="GremierBoard.edit('${id}')" role="button" tabindex="0" title="Edit delivery">
        <div class="plk-thumbs">${thumbHtml}</div>
        <div class="oc-main">
          <span class="oc-name">${esc(jobName(j))}</span>
          <span class="oc-items">${esc(items || 'No items listed')}</span>
          <span class="oc-tags">${tags}</span>
        </div>
      </div>
      <div class="oc-actions">
        ${wa ? `<a class="oc-btn wa" href="${esc(wa)}" target="_blank" rel="noopener">💬 WhatsApp</a>` : ''}
        <button type="button" class="oc-btn" onclick="GremierBoard.edit('${id}')">✎ Edit</button>
        <button type="button" class="oc-btn done" onclick="GremierBoard.checkoff('${id}')">✓ Delivered</button>
        <button type="button" class="oc-btn icon" onclick="GremierBoard.remove('${id}')" aria-label="Delete delivery" title="Delete delivery">🗑</button>
      </div>
      ${address || details ? `<div class="oc-addr"><span aria-hidden="true">📍</span><span>${esc([address, details].filter(Boolean).join(' · '))}</span></div>` : ''}
    </div>`;
  }

  function render() {
    const body = document.getElementById('ordersBody');
    if (!body || orders === null) return;
    const dl = root.__gremierDeliveries || null;
    const stores = dl ? dl.stores : [];
    const jobs = dl ? dl.jobs.filter((j) => !j.done) : [];
    const today = isoDay(new Date());

    const paid = orders.filter(isPaid);
    const orderIds = new Set(paid.map((o) => o.id));
    const jobForOrder = new Map(jobs.filter((j) => j.websiteOrderId && orderIds.has(j.websiteOrderId)).map((j) => [j.websiteOrderId, j]));
    const entries = [
      ...paid.map((o) => {
        const job = jobForOrder.get(o.id) || null;
        const date = (job && job.date) || String((o.delivery_info && o.delivery_info.delivery_date) || '').slice(0, 10);
        return { date, time: (job && job.time) || (o.delivery_info && o.delivery_info.event_time) || '', html: (late) => orderRowHtml(o, { job, stores, late }) };
      }),
      ...jobs.filter((j) => !(j.websiteOrderId && orderIds.has(j.websiteOrderId)))
        .map((j) => ({ date: j.date || '', time: j.time || '', html: (late) => jobCard(j, stores, late) })),
    ];

    const count = document.getElementById('ordersOpenCount');
    if (count) count.textContent = entries.length || '';
    if (!entries.length) {
      body.innerHTML = dl || waitedForDeliveries
        ? `<div class="ob-done"><span class="ob-done-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="34" height="34"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg></span><b>All done</b><small>No orders to fulfill and no deliveries scheduled.</small></div>`
        : '<div class="plk-empty"><div class="spinner"></div></div>';
    } else {
      const groups = new Map();
      for (const e of entries) {
        const key = !e.date ? 'nodate' : e.date < today ? 'overdue' : e.date;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(e);
      }
      const keys = [...groups.keys()].sort((a, b) => (a === 'overdue' ? -1 : b === 'overdue' ? 1 : a === 'nodate' ? 1 : b === 'nodate' ? -1 : a.localeCompare(b)));
      body.innerHTML = keys.map((k) => {
        const list = groups.get(k).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
        return `<div class="ob-day${k === 'overdue' ? ' late' : ''}"><h3 class="ob-day-h">${esc(dayLabel(k))}<span>${list.length}</span></h3>${list.map((e) => e.html(k === 'overdue')).join('')}</div>`;
      }).join('');
    }
    renderUnpaid();
  }

  // Unpaid open orders under "Waiting for payment", skipping ones a payment-link card already shows.
  function renderUnpaid() {
    const box = document.getElementById('ordersUnpaidBody');
    if (!box || orders === null) return;
    const shown = root.__plkOrderIds || new Set();
    const unpaid = orders.filter((o) => !isPaid(o) && !shown.has(o.id));
    box.innerHTML = unpaid.map((o) => orderRowHtml(o, { unpaid: true })).join('');
    box.hidden = !unpaid.length;
    const head = document.getElementById('plkWaitingHead');
    if (head) head.hidden = !(unpaid.length || document.getElementById('payLinksOneTimeBody')?.children.length);
  }

  const act = (name) => (id) => {
    const a = root.__gremierDeliveryActions;
    if (a && a[name]) a[name](id);
    else if (typeof showToast === 'function') showToast('Deliveries are still loading — try again in a moment');
  };
  root.addEventListener('gremier:deliveries-changed', render);
  root.GremierBoard = {
    setOrders(list) { orders = list || []; render(); },
    render, renderUnpaid,
    checkoff: act('checkoff'), edit: act('edit'), remove: act('remove'),
  };
})(window);
