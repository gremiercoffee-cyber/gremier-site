// Orders screen: paid orders still to fulfill and scheduled deliveries, on a calendar (admin-orders-calendar.js).
// A delivery made for a website order shares that order's card; combined orders are one card.
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
  /** Calendar entries for a list of open orders plus the scheduled deliveries (shared with the Dashboard strip). */
  function buildEntries(orders) {
    const dl = root.__gremierDeliveries || null;
    const stores = dl ? dl.stores : [];
    const jobs = dl ? dl.jobs.filter((j) => !j.done) : [];
    const today = isoDay(new Date());

    // Combined orders (admin "Combine") show as one card: the main order with the others' items and totals.
    const info = (o) => (o.delivery_info && typeof o.delivery_info === 'object' ? o.delivery_info : {});
    const allPaid = orders.filter(isPaid), paidIds = new Set(allPaid.map((o) => o.id));
    const partsFor = (o) => (Array.isArray(info(o).combined_orders) ? info(o).combined_orders : []).map((id) => orders.find((x) => x.id === id && info(x).combined_into === o.id)).filter(Boolean);
    const paid = allPaid.filter((o) => !(info(o).combined_into && paidIds.has(info(o).combined_into))).map((o) => {
      const parts = partsFor(o), paidParts = parts.filter(isPaid);
      return parts.length ? { ...o, order_label: [o, ...parts].map((p) => (p.order_number != null ? '#' + p.order_number : 'an order') + (isPaid(p) ? '' : ' (unpaid)')).join(' + '), items: [...(o.items || []), ...paidParts.flatMap((p) => p.items || [])], total: [o, ...paidParts].reduce((s, x) => s + Number(x.total || 0), 0) } : o;
    });
    const orderIds = new Set(paid.map((o) => o.id));
    const jobForOrder = new Map(jobs.filter((j) => j.websiteOrderId && orderIds.has(j.websiteOrderId)).map((j) => [j.websiteOrderId, j]));
    const imgOf = (i) => (typeof orderItemImage === 'function' ? orderItemImage(i) : '');
    const extras = (i) => (typeof describeItemExtras === 'function' ? describeItemExtras(i) : '');
    // Everything to deliver, one line per product (the same product from combined orders adds up).
    const mergeItems = (list) => {
      const out = new Map();
      // A subscription box or a pack is listed by what's inside it.
      const flat = list.flatMap((i) => { const inside = Array.isArray(i.subscription_items) && i.subscription_items.length ? i.subscription_items : Array.isArray(i.pack_items) && i.pack_items.length ? i.pack_items : null; return inside ? inside.map((c) => ({ ...c, qty: (Number(c.qty) || 1) * (Number(i.qty) || 1) })) : [i]; });
      for (const i of flat) {
        if (i.category === 'delivery_fee') continue;
        const label = i.name_en || i.name_he || i.name || 'Item', note = extras(i) || i._note || '', k = label + '|' + note;
        const cur = out.get(k) || { label, note, qty: 0, img: imgOf(i) };
        cur.qty += Number(i.qty) || 1; out.set(k, cur);
      }
      return [...out.values()];
    };
    // Call / Text / WhatsApp buttons for a phone number.
    const contact = (phone) => {
      const digits = String(phone || '').replace(/[^\d+]/g, '');
      if (digits.replace(/\D/g, '').length < 7) return [];
      const num = /^972/.test(digits) ? '+' + digits : digits;
      const wa = typeof whatsAppShareHref === 'function' ? whatsAppShareHref(phone, '') : '';
      return [
        { label: '📞 Call', cls: 'contact', href: 'tel:' + num, same: true },
        { label: '✉️ Text', cls: 'contact', href: 'sms:' + num, same: true },
        wa ? { label: '💬 WhatsApp', cls: 'wa contact', href: wa } : null,
      ];
    };
    // A delivery made for a website order that isn't in the open orders list: show that order's real
    // products (from the loaded order, else from the delivery's label "Website Order — name — A x1, B x2").
    const orderLookup = (id) => (typeof allOrders !== 'undefined' ? allOrders.find((x) => x.id === id) : null);
    const productByName = (name) => (typeof allProducts !== 'undefined' ? allProducts.find((p) => p.name_en === name || p.name_en === name.replace(/\s*\([^()]*\)$/, '')) : null);
    const itemsFromLabel = (label) => {
      const list = String(label || '').split(' — ').slice(2).join(' — ');
      const out = [];
      for (const m of list.matchAll(/(.+?) x(\d+)(?: \(([^()]*(?:\([^()]*\)[^()]*)*)\))?(?:, |$)/g)) {
        const p = productByName(m[1].trim());
        out.push({ name_en: m[1].trim(), qty: Number(m[2]), product_id: p?.id, category: p?.category, _note: m[3] || '' });
      }
      return out;
    };
    const labelOf = (x) => (x.order_number != null ? '#' + x.order_number : 'Unpaid order');
    const entries = [
      ...paid.map((o) => {
        const job = jobForOrder.get(o.id) || null, di = info(o), parts = partsFor(o);
        const all = [o, ...parts.filter(isPaid)], waiting = parts.filter((p) => !isPaid(p));
        const date = (job && job.date) || String(di.delivery_date || '').slice(0, 10);
        const dType = String(di.delivery_type || '').toLowerCase();
        const type = job?.deliveryType === 'coffeebar' ? 'coffeebar' : dType === 'pickup' && !(job && (job.privateAddress || job.cbAddress)) ? 'pickup' : 'delivery';
        const address = (job && (job.deliveryType === 'coffeebar' ? job.cbAddress || job.privateAddress : job.privateAddress || job.cbAddress)) || o.delivery_address || all.map((x) => x.delivery_address).find(Boolean) || '';
        const phone = o.customer_phone || job?.customerPhone || '';
        const needsFulfil = !['fulfilled', 'cancelled'].includes(String(o.status || '').toLowerCase());
        return {
          key: 'o:' + o.id, kind: 'order', type, date, time: (job && job.time) || di.event_time || '', name: o.customer_name || 'Customer',
          address, city: [di.city_en, di.city_he], labels: all.map(labelOf).concat(waiting.map(labelOf)),
          // o.items already holds the paid combined orders' items (see `paid` above); adding `all` again counted them twice.
          items: mergeItems(o.items || []),
          unpaidParts: waiting.length ? `${waiting.map(labelOf).join(', ')} (${waiting.reduce((s, x) => s + Number(x.total || 0), 0).toFixed(0)}₪) joins this delivery once it's paid.` : '',
          move: (day) => moveTo({ orderId: o.id, jobId: job?.id }, day),
          actions: [
            { label: 'Full order', cls: 'primary', run: () => root.openOrderDetail?.(o.id) },
            ...contact(phone),
            job ? { label: '✓ Delivered', cls: 'done', run: () => root.GremierBoard.checkoff(job.id) }
              : needsFulfil && typeof confirmFulfillOrder === 'function' ? { label: '✓ Fulfilled', cls: 'done', run: () => confirmFulfillOrder(o.id) } : null,
          ].filter(Boolean),
        };
      }),
      ...jobs.filter((j) => !(j.websiteOrderId && orderIds.has(j.websiteOrderId))).map((j) => {
        const qty = Object.entries(j.quantities || {}).filter(([, n]) => Number(n) > 0);
        const web = j.websiteOrderId || null, order = web ? orderLookup(web) : null;
        const fromOrder = order ? mergeItems(order.items || []) : web ? mergeItems(itemsFromLabel(j.label)) : [];
        return {
          key: 'j:' + j.id, kind: 'job', type: j.deliveryType === 'store' ? 'store' : j.deliveryType === 'coffeebar' ? 'coffeebar' : 'delivery',
          date: j.date || '', time: j.time || '', name: jobName(j), address: jobAddress(j, stores), city: [],
          labels: order?.order_number != null ? ['#' + order.order_number] : [],
          items: fromOrder.length ? fromOrder : qty.map(([pid, n]) => ({ label: productLabel(pid), qty: Number(n), img: root.getProductImage ? root.getProductImage(pid) : '' })),
          unpaidParts: '',
          move: (day) => moveTo({ orderId: web, jobId: j.id }, day),
          actions: [
            web ? { label: 'Full order', cls: 'primary', run: () => root.openOrderDetail?.(web) }
              : { label: '✎ Edit', cls: 'primary', run: () => root.GremierBoard.edit(j.id) },
            ...contact(j.customerPhone || order?.customer_phone),
            { label: '✓ Delivered', cls: 'done', run: () => root.GremierBoard.checkoff(j.id) },
            web ? { label: '✎', cls: 'icon', run: () => root.GremierBoard.edit(j.id) } : null,
            { label: '🗑 Delete', cls: 'icon', run: () => root.GremierBoard.remove(j.id) },
          ].filter(Boolean),
        };
      }),
    ];
    for (const e of entries) e.late = !!e.date && e.date < today;
    return entries;
  }
  function render() {
    const body = document.getElementById('ordersBody');
    if (!body || orders === null) return;
    const dl = root.__gremierDeliveries || null;
    const entries = buildEntries(orders);

    const count = document.getElementById('ordersOpenCount');
    if (count) count.textContent = entries.length || '';
    if (!dl && !waitedForDeliveries && !entries.length) body.innerHTML = '<div class="plk-empty"><div class="spinner"></div></div>';
    else if (root.GremierCalendar) root.GremierCalendar.render(body, entries);
    renderUnpaid();
  }

  // Unpaid open orders under "Waiting for payment", skipping ones a payment-link card already shows.
  function renderUnpaid() {
    const box = document.getElementById('ordersUnpaidBody');
    if (!box || orders === null) return;
    const shown = root.__plkOrderIds || new Set();
    const unpaid = orders.filter((o) => !isPaid(o) && !shown.has(o.id));
    const label = (o) => { const d = o.delivery_info || {}; return d.combined_into ? { ...o, order_label: `Goes with #${d.combined_into_number ?? ''}` } : o; };
    box.innerHTML = unpaid.map((o) => orderRowHtml(label(o), { unpaid: true })).join('');
    box.hidden = !unpaid.length;
    const head = document.getElementById('plkWaitingHead');
    if (head) head.hidden = !(unpaid.length || document.getElementById('payLinksOneTimeBody')?.children.length);
  }

  /** Drag a card to another day: the scheduled delivery, the order and the delivery queue all move together
   *  (like changing the date in the order card); the time stays, the customer isn't contacted. */
  async function moveTo({ orderId, jobId }, day) {
    const date = day || null;
    // Show it on the new day at once; save in the background, and put it back if saving fails.
    const job = jobId && date ? root.__gremierDeliveries?.jobs?.find((x) => x.id === jobId) : null;
    const local = orderId ? [orders || [], typeof allOrders !== 'undefined' ? allOrders : []].flatMap((l) => l.filter((x) => x.id === orderId)) : [];
    const before = { job: job?.date, info: local.map((x) => x.delivery_info) };
    if (job) job.date = date;
    for (const x of local) x.delivery_info = { ...(x.delivery_info || {}), delivery_date: date };
    render();
    // Saves run one after another, so a quick Undo can't land before the move it undoes.
    const run = saveQueue.then(() => save());
    saveQueue = run.catch(() => {});
    pending++;
    try { await run; } catch (err) {
      if (job) job.date = before.job;
      local.forEach((x, n) => { x.delivery_info = before.info[n]; });
      render();
      throw err;
    } finally { pending--; }
    // Reload the schedule once the last queued move is saved (an earlier reload would show the card jump back).
    if (!pending) root.dispatchEvent(new CustomEvent('gremier:jobs-changed'));

    async function save() {
      if (jobId && date) {
        const { data, error } = await sb.from('jobs').update({ date }).eq('id', jobId).select('id');
        if (error) throw error;
        if (!data?.length) throw new Error('The delivery could not be moved');
      }
      if (orderId) {
        // Read the order fresh so a payment update that just arrived isn't overwritten.
        const { data: fresh, error } = await sb.from('orders').select('delivery_info').eq('id', orderId).maybeSingle();
        if (error) throw error;
        if (fresh) {
          const info = { ...(fresh.delivery_info || {}), delivery_date: date };
          const { error: saveError } = await sb.from('orders').update({ delivery_info: info, updated_at: new Date().toISOString() }).eq('id', orderId);
          if (saveError) throw saveError;
          const { error: queueError } = await sb.from('pending_website_deliveries').update({ scheduled_date: date }).eq('order_id', orderId);
          if (queueError) console.warn('pending_website_deliveries update:', queueError);
        }
      }
    }
  }
  let saveQueue = Promise.resolve(), pending = 0;

  const act = (name) => (id) => {
    const a = root.__gremierDeliveryActions;
    if (a && a[name]) a[name](id);
    else if (typeof showToast === 'function') showToast('Deliveries are still loading — try again in a moment');
  };
  root.addEventListener('gremier:deliveries-changed', render);
  root.GremierBoard = {
    setOrders(list) { orders = list || []; render(); },
    render, renderUnpaid, entriesFor: (list) => buildEntries(list || []),
    checkoff: act('checkoff'), edit: act('edit'), remove: act('remove'),
  };
})(window);
