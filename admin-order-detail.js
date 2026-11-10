/* The order card that opens from Orders: who, when and where, what they bought, then the next step.
   Everything rarely needed sits under "More". Delivery date, time and address can be changed here:
   the scheduled delivery, the order and the delivery queue are all updated together, and the customer
   is not contacted. Uses the admin page's globals (sb, allOrders, escHtml, escAttr, showToast...). */
(function (root) {
  'use strict';
  const TYPE_LABELS = { expedited: 'Expedited', event: 'Event', pickup: 'Pickup' };
  const JOB_COLS = 'id,date,time,done,delivery_type,private_address,cb_address,delivery_location,delivery_details';
  let cur = null;   // { id, job, editing, picker, startText, startPlace, startDetails }

  const prettyDay = (d) => new Date(String(d).slice(0, 10) + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  const orderOf = () => allOrders.find((x) => x.id === cur?.id);
  const infoOf = (o) => (o.delivery_info && typeof o.delivery_info === 'object' ? o.delivery_info : {});
  const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

  async function findJob(orderId) {
    const { data, error } = await sb.from('jobs').select(JOB_COLS).eq('website_order_id', orderId).eq('type', 'delivery').order('done').limit(1);
    if (error) throw error;
    return data?.[0] || null;
  }

  function whenAndWhere(o) {
    const di = infoOf(o), job = cur.job, pickup = String(di.delivery_type || '').toLowerCase() === 'pickup';
    const date = String(job?.date || di.delivery_date || '').slice(0, 10);
    const time = String(job?.time || di.event_time || '').slice(0, 5);
    const details = job?.delivery_details || di.address_details || null;
    const address = (job && (job.private_address || job.cb_address)) || o.delivery_address || '';
    const place = job?.delivery_location || di.address_place || null;
    return { di, pickup, date, time, details, address, place };
  }

  function deliverySection(o, canEdit) {
    const { di, pickup, date, time, details, address, place } = whenAndWhere(o);
    const type = TYPE_LABELS[String(di.delivery_type || '').toLowerCase()];
    const detailLine = root.GremierRoute?.detailsLine(details) || '';
    const onMap = root.GremierPlaces?.placeReady(place);
    const mapLine = pickup ? ''
      : onMap ? `<p class="od-map">Map: ${escHtml(place.source === 'pin' ? 'Pinned location' : place.label || address)}</p>`
      : `<p class="od-map warn">No map location yet, so this can't go on a route.${canEdit ? ' Tap Change to choose it.' : ''}</p>`;
    return `<section class="od-sec">
      <div class="od-sec-h"><h3>${pickup ? 'Pickup' : 'Delivery'}</h3>${canEdit ? '<button type="button" class="od-link" onclick="GremierOrder.edit()">Change</button>' : ''}</div>
      <p class="od-when">${date ? escHtml(prettyDay(date)) + (time ? ' · ' + escHtml(time) : '') : 'No date yet'}${type && !pickup ? ` <span class="od-tag">${escHtml(type)}</span>` : ''}</p>
      ${pickup ? '' : `<p class="od-addr">${escHtml(address || 'No address yet')}</p>`}
      ${detailLine ? `<p class="od-sub">${escHtml(detailLine)}</p>` : ''}
      ${mapLine}
    </section>`;
  }

  function editSection(o) {
    const { pickup, date, time, details } = whenAndWhere(o), d = details || {};
    const field = (id, label, value) => `<label class="od-field"><span>${label}</span><input class="form-input" id="${id}" value="${escAttr(value || '')}"></label>`;
    return `<section class="od-sec">
      <div class="od-sec-h"><h3>Change ${pickup ? 'pickup' : 'delivery'}</h3></div>
      <div class="od-row">
        <label class="od-field"><span>Date</span><input class="form-input" type="date" id="odDate" value="${escAttr(date)}"></label>
        <label class="od-field"><span>Time (optional)</span><input class="form-input" type="time" id="odTime" value="${escAttr(time)}"></label>
      </div>
      ${pickup ? '' : `<label class="od-field"><span>Address</span><input class="form-input" id="odAddr" placeholder="Search the street and number"></label>
      <div class="od-row">${field('odApt', 'Apartment', d.apartment)}${field('odFloor', 'Floor', d.floor)}${field('odEntrance', 'Entrance', d.entrance)}</div>
      ${field('odInstr', 'Delivery notes', d.instructions)}`}
      <p class="od-hint">Saving doesn't message the customer.</p>
      <div class="od-actions">
        <button type="button" class="od-btn primary" id="odSave" onclick="GremierOrder.save()">Save changes</button>
        <button type="button" class="od-btn" onclick="GremierOrder.cancel()">Cancel</button>
      </div>
    </section>`;
  }


  // ── Combine: two paid orders from the same customer go out as one delivery. ──
  // The other order's delivery is folded into this one's (its quantities added, its own stop removed
  // and kept for undo). Payments, receipts and totals stay as they were; fulfilling this order
  // fulfils both (notify-order-fulfilled), with one email listing everything.
  const digits = (p) => String(p || '').replace(/\D/g, '').slice(-9);
  const isOpenPaid = (x) => String(x.payment_status || '').toLowerCase() === 'paid' && !CLOSED_ORDER_STATUSES.includes(String(x.status || '').toLowerCase());
  const mainOf = (x) => infoOf(x).combined_into || null;
  const partsOf = (x) => (Array.isArray(infoOf(x).combined_orders) ? infoOf(x).combined_orders.map(String) : []);
  const shortItems = (x) => (x.items || []).filter((i) => i.category !== 'delivery_fee').map((i) => `${Number(i.qty) > 1 ? i.qty + '× ' : ''}${i.name_en || i.name_he || i.name || 'Item'}`).join(', ');
  const shortDay = (iso) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  function candidates(o) {
    if (!isOpenPaid(o) || mainOf(o)) return [];
    const email = String(o.customer_email || '').trim().toLowerCase(), phone = digits(o.customer_phone);
    return allOrders.filter((x) => x.id !== o.id && isOpenPaid(x) && !mainOf(x) && !partsOf(x).length
      && ((email && String(x.customer_email || '').trim().toLowerCase() === email) || (phone.length === 9 && digits(x.customer_phone) === phone)));
  }
  async function openJob(orderId) {
    const { data, error } = await sb.from('jobs').select('*').eq('website_order_id', orderId).eq('type', 'delivery').eq('done', false).limit(1);
    if (error) throw error;
    return data?.[0] || null;
  }
  const readInfo = async (id) => {
    const { data, error } = await sb.from('orders').select('delivery_info,status').eq('id', id).single();
    if (error) throw error;
    return { info: { ...(data.delivery_info || {}) }, status: data.status };
  };
  async function saveInfo(id, info) {
    const { data, error } = await sb.from('orders').update({ delivery_info: info, updated_at: new Date().toISOString() }).eq('id', id).select('id');
    if (error) throw error;
    if (!data?.length) throw new Error('The order could not be updated');
  }
  async function setQuantities(jobId, quantities) {
    const { data, error } = await sb.from('jobs').update({ quantities }).eq('id', jobId).select('id');
    if (error) throw error;
    if (!data?.length) throw new Error('The delivery could not be updated');
  }
  function combineSection(o) {
    const main = mainOf(o);
    if (main) {
      const m = cur.main;
      return `<section class="od-sec od-combined">
        <div class="od-sec-h"><h3>Combined</h3></div>
        <p class="od-sub">Goes out with order <b>#${escHtml(infoOf(o).combined_into_number ?? m?.order_number ?? '')}</b>, on its delivery. It's marked fulfilled together with it.</p>
        <div class="od-actions">
          <button type="button" class="od-btn" onclick="openOrderDetail('${escAttr(main)}')">Open #${escHtml(infoOf(o).combined_into_number ?? '')}</button>
          ${CLOSED_ORDER_STATUSES.includes(String(o.status || '').toLowerCase()) ? '' : `<button type="button" class="od-btn" onclick="GremierOrder.separate('${escAttr(main)}','${escAttr(o.id)}')">Separate again</button>`}
        </div>
      </section>`;
    }
    const parts = cur.parts || [], closed = CLOSED_ORDER_STATUSES.includes(String(o.status || '').toLowerCase());
    const partHtml = parts.map((p) => `<div class="od-item"><span><b>#${escHtml(p.order_number ?? '')}</b> · ${escHtml(shortItems(p) || 'No items')}<small>Ordered ${escHtml(shortDay(p.created_at))} · paid separately ₪${escHtml(p.total)}</small></span>
      ${closed ? '' : `<button type="button" class="od-link" onclick="GremierOrder.separate('${escAttr(o.id)}','${escAttr(p.id)}')">Separate</button>`}</div>`).join('');
    const options = closed ? [] : candidates(o);
    const optHtml = options.map((x) => `<div class="od-item"><span><b>#${escHtml(x.order_number ?? '')}</b> · ${escHtml(shortItems(x) || 'No items')}<small>Ordered ${escHtml(shortDay(x.created_at))} · ₪${escHtml(x.total)}</small></span>
      <button type="button" class="od-link" onclick="GremierOrder.combine('${escAttr(x.id)}')">Combine</button></div>`).join('');
    if (!partHtml && !optHtml) return '';
    return `<section class="od-sec od-combined">
      ${partHtml ? `<div class="od-sec-h"><h3>Combined orders</h3></div>${partHtml}<p class="od-sub">They go out in this delivery and are fulfilled with it.</p>` : ''}
      ${optHtml ? `<div class="od-sec-h"><h3>${partHtml ? 'Another open order' : 'Same customer, another open order'}</h3></div>${optHtml}<p class="od-sub">Combine to send them as one delivery, on this order's date and address. Payments stay separate.</p>` : ''}
    </section>`;
  }
  async function combine(otherId) {
    const o = orderOf(), y = allOrders.find((x) => x.id === otherId);
    if (!o || !y) return;
    if (!confirm(`Combine #${y.order_number} into #${o.order_number}?\n\nThey go out together as one delivery, on #${o.order_number}'s date and address, and the customer gets one "delivered" email. Payments and receipts stay separate. You can separate them again.`)) return;
    try {
      const [jx, jy] = await Promise.all([openJob(o.id), openJob(y.id)]);
      if (!jx || !jy) throw new Error('Both orders need a scheduled delivery that isn\u2019t done yet');
      const [ox, oy] = await Promise.all([readInfo(o.id), readInfo(y.id)]);
      if (ox.info.combined_into || oy.info.combined_into || (oy.info.combined_orders || []).length) throw new Error('One of these orders is already combined');
      const merged = { ...(jx.quantities || {}) };
      for (const [k, v] of Object.entries(jy.quantities || {})) merged[k] = (Number(merged[k]) || 0) + (Number(v) || 0);
      const now = new Date().toISOString();
      // The other order first keeps everything needed to undo, then the deliveries change.
      await saveInfo(y.id, { ...oy.info, combined_into: o.id, combined_into_number: o.order_number ?? null, combined_at: now, combined_job: jy });
      await setQuantities(jx.id, merged);
      await saveInfo(o.id, { ...ox.info, combined_orders: [...new Set([...(ox.info.combined_orders || []).map(String), y.id])] });
      const { error } = await sb.from('jobs').delete().eq('id', jy.id);
      if (error) throw error;
      await sb.from('pending_website_deliveries').update({ status: 'dismissed' }).eq('order_id', y.id);
      showToast(`Combined ✓ #${y.order_number} goes out with #${o.order_number}`);
      await afterChange(o.id);
    } catch (e) {
      console.error('combine orders:', e);
      showToast('Could not combine: ' + (e.message || e), 7000);
    }
  }
  async function separate(mainId, partId) {
    const m = allOrders.find((x) => x.id === mainId) || cur.main, p = allOrders.find((x) => x.id === partId) || (cur.parts || []).find((x) => x.id === partId);
    if (!confirm(`Separate #${p?.order_number ?? ''} from #${m?.order_number ?? ''}? It goes back to its own delivery, as it was before.`)) return;
    try {
      const [om, op] = await Promise.all([readInfo(mainId), readInfo(partId)]);
      if (CLOSED_ORDER_STATUSES.includes(String(op.status || '').toLowerCase())) throw new Error('That order is already fulfilled');
      const saved = op.info.combined_job, jx = await openJob(mainId);
      if (saved) {
        const { error } = await sb.from('jobs').insert({ ...saved, done: false });
        if (error) throw error;
        if (jx) {
          const left = { ...(jx.quantities || {}) };
          for (const [k, v] of Object.entries(saved.quantities || {})) { const n = (Number(left[k]) || 0) - (Number(v) || 0); if (n > 0) left[k] = n; else delete left[k]; }
          await setQuantities(jx.id, left);
        }
      }
      const { combined_into, combined_into_number, combined_at, combined_job, ...rest } = op.info;
      await saveInfo(partId, rest);
      await saveInfo(mainId, { ...om.info, combined_orders: (om.info.combined_orders || []).map(String).filter((x) => x !== partId) });
      await sb.from('pending_website_deliveries').update({ status: 'scheduled' }).eq('order_id', partId);
      showToast('Separated ✓ Each order has its own delivery again');
      await afterChange(cur.id);
    } catch (e) {
      console.error('separate orders:', e);
      showToast('Could not separate: ' + (e.message || e), 7000);
    }
  }
  async function afterChange(openId) {
    root.dispatchEvent(new CustomEvent('gremier:jobs-changed'));
    if (typeof loadOrders === 'function') await loadOrders();
    if (document.getElementById('orderModal')?.classList.contains('open')) await root.openOrderDetail(openId);
  }
  async function loadCombined(o) {
    cur.parts = []; cur.main = null;
    const ids = partsOf(o), main = mainOf(o);
    if (ids.length) { const { data } = await sb.from('orders').select('*').in('id', ids); cur.parts = (data || []).filter((x) => infoOf(x).combined_into === o.id); }
    if (main) cur.main = allOrders.find((x) => x.id === main) || null;
  }

  function render() {
    const o = orderOf();
    if (!o) return;
    const di = infoOf(o), status = String(o.status || '').toLowerCase();
    const paid = String(o.payment_status || '').toLowerCase() === 'paid';
    const closed = CLOSED_ORDER_STATUSES.includes(status);
    const canEdit = !closed && !cur.job?.done && !cur.jobUnknown;
    const items = (o.items || []).map((i) => {
      const extras = describeItemExtras(i);
      const extrasHtml = i.coffee_bar_configuration ? extras.split(' · ').map(escHtml).join('<br>') : escHtml(extras);
      return `<div class="od-item"><span>${escHtml(i.name_en || i.name_he || i.name || 'Item')}${Number(i.qty) > 1 ? ` <b>×${escHtml(i.qty)}</b>` : ''}${extras ? `<small>${extrasHtml}</small>` : ''}</span><span>₪${i.price * i.qty}</span></div>`;
    }).join('');
    const discount = orderDiscountLabel(o);
    const ordered = new Date(o.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    const statusWord = status === 'confirmed' || !status ? '' : ` · ${escHtml(status[0].toUpperCase() + status.slice(1))}`;
    const wa = o.customer_phone && typeof whatsAppShareHref === 'function' ? whatsAppShareHref(o.customer_phone, '') : '';
    const notified = !!di.order_notified_at;

    document.getElementById('orderModalContent').innerHTML = `<div class="od">
      <header class="od-head">
        <div>
          <h2>${escHtml(o.customer_name || 'Customer')}</h2>
          <p>#${escHtml(o.order_number ?? '')} · ${escHtml(ordered)} · <span class="od-pay${paid ? ' paid' : ''}">${paid ? 'Paid' : 'Not paid'}</span>${statusWord}</p>
        </div>
        <button type="button" class="od-x" onclick="closeOrderModal()" aria-label="Close">✕</button>
      </header>
      ${cur.editing ? editSection(o) : deliverySection(o, canEdit)}
      <section class="od-sec">
        <div class="od-sec-h"><h3>Items</h3></div>
        ${items}
        ${discount ? `<div class="od-item muted"><span>${escHtml(discount)}</span><span>${Number(o.discount) > 0 ? '−₪' + Number(o.discount).toFixed(2) : ''}</span></div>` : ''}
        ${Number(di.delivery_fee) > 0 && !(o.items || []).some((i) => i.category === 'delivery_fee') ? `<div class="od-item"><span>Delivery</span><span>₪${escHtml(di.delivery_fee)}</span></div>` : ''}
        <div class="od-total"><span>Total</span><span>₪${escHtml(o.total)}</span></div>
        ${Number(di.refunded_minor) > 0 ? `<div class="od-item muted"><span>Refunded</span><span>−₪${(Number(di.refunded_minor) / 100).toFixed(2).replace(/.00$/, '')}</span></div>` : ''}
        ${o.notes ? `<p class="od-sub">Note: ${escHtml(o.notes)}</p>` : ''}
      </section>
      ${combineSection(o)}
      <section class="od-sec">
        <div class="od-sec-h"><h3>Customer</h3></div>
        ${o.customer_phone ? `<a class="od-contact" href="tel:${escAttr(o.customer_phone)}">${escHtml(o.customer_phone)}</a>` : ''}
        ${o.customer_email ? `<a class="od-contact" href="mailto:${escAttr(o.customer_email)}">${escHtml(o.customer_email)}</a>` : ''}
        ${!o.customer_phone && !o.customer_email ? '<p class="od-sub">No contact details</p>' : ''}
      </section>
      <div class="od-actions stack">
        ${paid && status !== 'fulfilled' && !mainOf(o) ? `<button type="button" class="od-btn primary" onclick="markOrderFulfilled('${o.id}')">Mark fulfilled + email customer</button>` : ''}
        <div class="od-actions">
          ${wa ? `<a class="od-btn" href="${escAttr(wa)}" target="_blank" rel="noopener">WhatsApp</a>` : ''}
          ${o.customer_phone || o.customer_email ? `<button type="button" class="od-btn" onclick="adminMessageOrder('${o.id}')">Message</button>` : ''}
          ${o.customer_email ? `<button type="button" class="od-btn" onclick="sendCustomerReceipt('${o.id}')">Send receipt</button>` : ''}
        </div>
      </div>
      <details class="od-more">
        <summary>More</summary>
        <div class="od-row">
          <label class="od-field"><span>Order status</span><select class="form-input" onchange="updateOrderStatus('${o.id}',this.value)">${['pending', 'confirmed', 'fulfilled', 'cancelled'].map((s) => `<option ${o.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
          <label class="od-field"><span>Payment</span><select class="form-input" onchange="updatePaymentStatus('${o.id}',this.value)">${['unpaid', 'paid'].map((s) => `<option ${o.payment_status === s ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
        </div>
        ${di.fulfilled_notified_at ? '<p class="od-sub">Fulfillment email sent</p>' : ''}
        <div class="od-actions">
          ${paid ? `<button type="button" class="od-btn" onclick="sendOrderToGoogleSheet('${o.id}', ${notified})">${notified ? 'Re-send paid email' : 'Send paid email'}</button>` : ''}
          ${paid && (di.payme_sale_id || o.payment_method === 'payme') && o.payment_method !== 'gift_card' ? `<button type="button" class="od-btn" onclick="GremierRefunds.open('${o.id}')">Refund…</button>` : ''}
          ${paid && di.payme_sale_id ? `<button type="button" class="od-btn" onclick="openPayMeRefund('${escAttr(di.payme_sale_id)}')">Open in PayMe</button>` : ''}
          ${paid && o.payment_method === 'gift_card' && o.gift_card_code ? `<button type="button" class="od-btn" onclick="refundGiftCardOrder('${o.id}')">Refund to gift card</button>` : ''}
          <button type="button" class="od-btn danger" onclick="deleteOrder('${o.id}')">Delete order</button>
        </div>
      </details>
    </div>`;
    if (cur.editing) attachAddress(o);
  }

  function attachAddress(o) {
    const input = document.getElementById('odAddr'), P = root.GremierPlaces;
    cur.picker = null;
    if (!input) return;
    const { address, place, details } = whenAndWhere(o);
    cur.startText = address; cur.startPlace = place; cur.startDetails = details || {};
    if (!P) { input.value = address; return; }
    cur.picker = P.attach(input, { lang: () => (/[֐-׿]/.test(input.value) ? 'he' : 'en') });
    cur.picker.set({ text: address, place });
  }

  const typed = (id) => (document.getElementById(id)?.value || '').trim();

  async function save() {
    const o = orderOf();
    if (!o || !cur.editing) return;
    const { pickup, date: oldDate, time: oldTime } = whenAndWhere(o), job = cur.job;
    const date = typed('odDate'), time = typed('odTime');
    if (job && !date) return showToast('Choose a delivery date');
    const dateChanged = date !== oldDate || time !== oldTime;

    let address = null, place, details;
    if (!pickup) {
      const v = cur.picker ? cur.picker.value() : { text: typed('odAddr'), place: cur.startPlace };
      if (!same(v.text, cur.startText) || !same(v.place, cur.startPlace)) {
        if (!v.text) return showToast('Enter the delivery address');
        if (cur.picker && !cur.picker.ready()) return showToast(cur.picker.problem());
        place = v.place || null;
        address = place?.source === 'google' && place.label ? place.label.replace(/,\s*(Israel|ישראל)$/, '') : v.text;
      }
      const d = { apartment: typed('odApt'), floor: typed('odFloor'), entrance: typed('odEntrance'), instructions: typed('odInstr') };
      const before = cur.startDetails;
      if (Object.keys(d).some((k) => d[k] !== String(before[k] || ''))) details = d;
    }
    if (!dateChanged && address === null && details === undefined) { cur.editing = false; render(); return; }

    const button = document.getElementById('odSave');
    if (button) { button.disabled = true; button.textContent = 'Saving…'; }
    try {
      // Read the order fresh so a payment update that just arrived isn't overwritten.
      const { data: fresh, error: readError } = await sb.from('orders').select('delivery_info').eq('id', o.id).single();
      if (readError) throw readError;
      const info = { ...(fresh.delivery_info || {}) };
      if (dateChanged) {
        info.delivery_date = date || null;
        if (!job || info.delivery_type === 'event' || info.event_time) info.event_time = time || null;
      }
      if (address !== null) { info.address_entered = address; info.address_place = place; }
      if (details !== undefined) info.address_details = details;

      if (job) {
        const patch = {};
        if (dateChanged) { patch.date = date; patch.time = time || null; }
        if (address !== null) {
          patch.private_address = address; patch.delivery_location = place;
          if (job.delivery_type === 'coffeebar') patch.cb_address = address;
        }
        if (details !== undefined) patch.delivery_details = details;
        const { data, error } = await sb.from('jobs').update(patch).eq('id', job.id).select(JOB_COLS);
        if (error) throw error;
        if (!data?.length) throw new Error('The delivery could not be updated');
        cur.job = data[0];
      }
      const orderPatch = { delivery_info: info, updated_at: new Date().toISOString() };
      if (address !== null) orderPatch.delivery_address = address;
      const { data: saved, error: orderError } = await sb.from('orders').update(orderPatch).eq('id', o.id).select('id');
      if (orderError) throw orderError;
      if (!saved?.length) throw new Error('The order could not be updated');
      Object.assign(o, orderPatch);

      const pendingPatch = {};
      if (address !== null) pendingPatch.delivery_address = address;
      if (dateChanged) { pendingPatch.scheduled_date = date || null; pendingPatch.scheduled_time = time || null; }
      if (Object.keys(pendingPatch).length) {
        const { error } = await sb.from('pending_website_deliveries').update(pendingPatch).eq('order_id', o.id);
        if (error) console.warn('pending_website_deliveries update:', error);
      }
      cur.editing = false;
      showToast('Delivery updated ✓');
      render();
      root.dispatchEvent(new CustomEvent('gremier:jobs-changed'));
      if (typeof loadOrders === 'function') loadOrders();
    } catch (e) {
      console.error('order delivery save:', e);
      showToast('Could not save: ' + (e.message || e), 6000);
      if (button) { button.disabled = false; button.textContent = 'Save changes'; }
    }
  }

  root.openOrderDetail = async function openOrderDetail(id) {
    const o = allOrders.find((x) => x.id === id);
    if (!o) return;
    await loadOrderCouponDetails([o]);
    let job = null, jobUnknown = false;
    try { job = await findJob(id); } catch (e) { jobUnknown = true; console.warn('order delivery lookup:', e); }
    cur = { id, job, jobUnknown, editing: false, picker: null };
    try { await loadCombined(o); } catch (e) { console.warn('combined orders lookup:', e); }
    render();
    document.getElementById('orderModal').classList.add('open');
  };
  root.GremierOrder = {
    edit() { cur.editing = true; render(); document.querySelector('#orderModal .od-sec')?.scrollIntoView({ block: 'nearest' }); },
    cancel() { cur.editing = false; render(); },
    save, combine, separate,
  };
})(window);
