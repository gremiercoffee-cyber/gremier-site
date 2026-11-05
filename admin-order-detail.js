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
        <div class="od-total"><span>Total</span><span>₪${escHtml(o.total)}</span></div>
        ${o.notes ? `<p class="od-sub">Note: ${escHtml(o.notes)}</p>` : ''}
      </section>
      <section class="od-sec">
        <div class="od-sec-h"><h3>Customer</h3></div>
        ${o.customer_phone ? `<a class="od-contact" href="tel:${escAttr(o.customer_phone)}">${escHtml(o.customer_phone)}</a>` : ''}
        ${o.customer_email ? `<a class="od-contact" href="mailto:${escAttr(o.customer_email)}">${escHtml(o.customer_email)}</a>` : ''}
        ${!o.customer_phone && !o.customer_email ? '<p class="od-sub">No contact details</p>' : ''}
      </section>
      <div class="od-actions stack">
        ${paid && status !== 'fulfilled' ? `<button type="button" class="od-btn primary" onclick="markOrderFulfilled('${o.id}')">Mark fulfilled + email customer</button>` : ''}
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
          ${paid && di.payme_sale_id ? `<button type="button" class="od-btn" onclick="openPayMeRefund('${escAttr(di.payme_sale_id)}')">Refund via PayMe</button>` : ''}
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
    render();
    document.getElementById('orderModal').classList.add('open');
  };
  root.GremierOrder = {
    edit() { cur.editing = true; render(); document.querySelector('#orderModal .od-sec')?.scrollIntoView({ block: 'nearest' }); },
    cancel() { cur.editing = false; render(); },
    save,
  };
})(window);
