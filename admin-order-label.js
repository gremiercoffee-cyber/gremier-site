/* Sticker labels for orders: one order per sticker, or two orders on one sticker split by a cut line.
   Draws the sticker as a picture (203 dpi, the usual thermal-printer resolution) and opens the phone's
   share sheet so it can go straight to the label printer's app (e.g. Nelko). Sharing or saving the picture marks the
   orders on it as printed (delivery_info.label_printed_at), so they leave the "print another order" list. */
(function (root) {
  'use strict';
  const DPMM = 8; // ≈203 dpi
  const SIZE_KEY = 'gremier_label_size';
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const hebrew = (t) => /[֐-׿]/.test(t);
  const info = (o) => (o && typeof o.delivery_info === 'object' && o.delivery_info) || {};
  const day = (d) => d ? new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }) : '';
  const TYPES = { regular: 'Regular', expedited: 'Expedited', event: 'Event', pickup: 'Pickup' };

  function readSize() {
    try { const s = JSON.parse(localStorage.getItem(SIZE_KEY)); if (s && s.w >= 20 && s.h >= 20 && s.w <= 300 && s.h <= 300) return s; } catch {}
    return { w: 102, h: 152 }; // 4×6" shipping label (Nelko)
  }
  const saveSize = (s) => { try { localStorage.setItem(SIZE_KEY, JSON.stringify(s)); } catch {} };
  const ordersList = () => (typeof allOrders !== 'undefined' && Array.isArray(allOrders) ? allOrders : []);

  // What goes on the label for one order: number, name, phone, when, where, items, note.
  function labelData(o) {
    const di = info(o), open = root.GremierOrder?.info?.(o.id);
    const type = String(di.delivery_type || '').toLowerCase(), pickup = type === 'pickup';
    const date = open?.date || String(di.delivery_date || '').slice(0, 10);
    const address = open ? open.address : (o.delivery_address || '');
    const details = root.GremierRoute?.detailsLine?.(open ? open.details : di.address_details) || '';
    const extras = (i) => (typeof describeItemExtras === 'function' ? describeItemExtras(i) : '');
    // Combined orders join the delivery once paid (same rule as the Orders calendar); unpaid ones aren't packed.
    // Printing from the label picker (not from the open order card): find the combined orders in the loaded orders.
    const paidPart = (x) => String(x.payment_status || '').toLowerCase() === 'paid';
    const partIds = Array.isArray(di.combined_orders) ? di.combined_orders.map(String) : [];
    const parts = open?.parts || ordersList().filter((x) => partIds.includes(String(x.id)) && info(x).combined_into === o.id);
    // A subscription box or a build-your-own pack is listed by what's inside it.
    const inside = (i) => {
      const list = Array.isArray(i.subscription_items) && i.subscription_items.length ? i.subscription_items : Array.isArray(i.pack_items) && i.pack_items.length ? i.pack_items : null;
      return list ? list.map((c) => ({ ...c, qty: (Number(c.qty) || 1) * (Number(i.qty ?? i.quantity ?? 1) || 1) })) : [i];
    };
    const items = [o, ...parts.filter(paidPart)].flatMap((x) => (x.items || [])).flatMap(inside)
      .filter((i) => i.category !== 'delivery_fee')
      .map((i) => ({ qty: Number(i.qty ?? i.quantity ?? 1) || 1, name: i.name_en || i.name_he || i.name || 'Item', extra: extras(i) }))
      // The same product from the box and a combined order is one line (2× House Blend, not 1× twice).
      .reduce((out, i) => { const same = out.find((x) => x.name === i.name && x.extra === i.extra); if (same) same.qty += i.qty; else out.push({ ...i }); return out; }, []);
    return {
      number: o.order_number != null ? '#' + o.order_number : '',
      name: o.customer_name || 'Customer', phone: o.customer_phone || '',
      // No delivery time on the sticker; the date is an estimate.
      when: [pickup ? 'Pickup' : TYPES[type] || 'Delivery', date ? (pickup ? day(date) : 'Estimated delivery: ' + day(date)) : ''].filter(Boolean).join(' · '),
      ...streetAndCity(pickup ? '' : address, di), details, items, pickup,
      contents: summary(items),
    };
  }

  // "BET SHEMESH, רבי ברכיה 8, Apt 1, Floor -4" → street "רבי ברכיה 8", city "BET SHEMESH". Apartment and floor
  // are on the details line, and a line in one language reads correctly (mixed lines get scrambled).
  function streetAndCity(address, di) {
    const parts = String(address || '').split(',').map((p) => p.trim()).filter((p) => p && !/^(apt|apartment|floor|entrance|דירה|קומה|כניסה)\b/i.test(p));
    const cities = [di.city_en, di.city_he].filter(Boolean).map((c) => String(c).trim().toLowerCase());
    let i = parts.findIndex((p) => cities.includes(p.toLowerCase()));
    if (i < 0 && parts.length > 1) i = parts.length - 1;
    const city = i >= 0 ? parts[i] : '';
    return { street: parts.filter((_, j) => j !== i).join(', '), city };
  }
  // What's in the package, in one short line: same items added up, at most four, then "+N more".
  function summary(items) {
    const byName = new Map();
    for (const i of items) byName.set(i.name, (byName.get(i.name) || 0) + i.qty);
    const list = [...byName].map(([name, qty]) => `${qty}× ${name}`);
    return list.length > 4 ? list.slice(0, 4).join(' · ') + ` · +${list.length - 4} more` : list.join(' · ');
  }
  // Wrap text into lines that fit the width.
  function wrap(ctx, text, width) {
    const words = String(text).split(/\s+/).filter(Boolean), lines = [];
    let line = '';
    for (const w of words) {
      const next = line ? line + ' ' + w : w;
      if (ctx.measureText(next).width <= width || !line) line = next; else { lines.push(line); line = w; }
    }
    if (line) lines.push(line);
    return lines;
  }

  // The logo for the top right corner, in pure black and white for thermal printers: the round logo's
  // light lines become black on white (its black background would print as a solid block).
  let logo = null;
  const logoReady = new Promise((resolve) => {
    if (typeof Image === 'undefined') return resolve();
    const img = new Image();
    img.onload = () => {
      try {
        const n = 256, c = document.createElement('canvas'); c.width = c.height = n;
        const g = c.getContext('2d');
        g.drawImage(img, 0, 0, n, n);
        const px = g.getImageData(0, 0, n, n), p = px.data, r = n / 2;
        for (let i = 0; i < p.length; i += 4) {
          const k = i / 4, dx = (k % n) - r + 0.5, dy = Math.floor(k / n) - r + 0.5;
          const light = 0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2];
          const v = dx * dx + dy * dy > (r - 1) * (r - 1) ? 255 : light > 110 ? 0 : 255;   // outside the circle: white
          p[i] = p[i + 1] = p[i + 2] = v; p[i + 3] = 255;
        }
        g.putImageData(px, 0, 0);
        logo = c;
      } catch (e) { console.warn('label logo:', e); }
      resolve();
    };
    img.onerror = () => resolve();
    img.src = '/logo.png';
  });

  // Lay out one order in a box; shrinks the text until everything fits.
  function drawOrder(ctx, d, x, y, w, h) {
    const pad = Math.round(Math.min(w, h) * 0.05), iw = w - pad * 2;
    // The logo sits in the top right corner; the lines beside it are kept short so they don't run into it.
    const ls = logo ? Math.round(Math.min(w, h) * 0.24) : 0, logoBottom = y + pad + ls;
    for (let scale = 2.2; scale > 0.25; scale -= 0.05) {
      const base = Math.max(14, Math.round(Math.min(w, h * 0.9) * 0.055 * scale)), ops = [];
      let cy = y + pad;
      const block = (text, size, weight = '400', gap = 0.35) => {
        if (!text) return;
        ctx.font = `${weight} ${size}px "DM Sans", Arial, sans-serif`;
        const room = (lineY) => (ls && lineY < logoBottom ? iw - ls - pad * 0.6 : iw);
        const lines = [];
        let cur = '', lineY = cy;
        for (const word of String(text).split(/\s+/).filter(Boolean)) {
          const next = cur ? cur + ' ' + word : word;
          if (!cur || ctx.measureText(next).width <= room(lineY)) cur = next;
          else { lines.push(cur); lineY += size * 1.18; cur = word; }
        }
        if (cur) lines.push(cur);
        for (const line of lines) { ops.push({ line, size, weight, y: cy }); cy += size * 1.18; }
        cy += size * gap;
      };
      // Made for the driver: who, phone, where in big bold text; what's inside and when stay small.
      block(d.number || 'Order', Math.round(base * 1.1), '800', 0.15);
      block(d.name, Math.round(base * 1.9), '800', 0.1);
      block(d.phone, Math.round(base * 1.9), '800', 0.3);
      block(d.pickup ? 'PICKUP' : (d.street || d.city ? d.street : 'No address'), Math.round(base * 1.6), '700', 0.05);
      if (!d.pickup) block(d.city, Math.round(base * 1.6), '700', 0.1);
      block(d.details, base, '400', 0.2);
      ops.push({ rule: true, y: cy }); cy += base * 0.5;
      block(d.contents, Math.round(base * 0.85), '400', 0.1);
      block(d.when, Math.round(base * 0.85), '400', 0);
      if (cy <= y + h - pad || scale <= 0.3) {
        ctx.fillStyle = '#000'; ctx.textBaseline = 'top';
        if (ls) { ctx.imageSmoothingEnabled = true; ctx.drawImage(logo, x + w - pad - ls, y + pad, ls, ls); }
        for (const op of ops) {
          if (op.rule) { ctx.fillRect(x + pad, op.y, iw, Math.max(2, Math.round(base * 0.08))); continue; }
          ctx.font = `${op.weight} ${op.size}px "DM Sans", Arial, sans-serif`;
          const rtl = hebrew(op.line);
          ctx.direction = rtl ? 'rtl' : 'ltr'; ctx.textAlign = rtl ? 'right' : 'left';
          ctx.fillText(op.line, rtl ? x + w - pad - (ls && op.y < logoBottom ? ls + pad * 0.6 : 0) : x + pad, op.y);
        }
        ctx.direction = 'ltr'; ctx.textAlign = 'left';
        return;
      }
    }
  }

  // The whole sticker: one order, or two halves (split across the longer side) with a dashed cut line.
  function draw(orders, size) {
    const W = Math.round(size.w * DPMM), H = Math.round(size.h * DPMM);
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
    const data = orders.map(labelData);
    if (data.length === 1) { drawOrder(ctx, data[0], 0, 0, W, H); return c; }
    const tall = H >= W;
    const boxes = tall ? [[0, 0, W, H / 2], [0, H / 2, W, H / 2]] : [[0, 0, W / 2, H], [W / 2, 0, W / 2, H]];
    data.forEach((d, i) => drawOrder(ctx, d, ...boxes[i].map(Math.round)));
    ctx.strokeStyle = '#000'; ctx.lineWidth = 3; ctx.setLineDash([18, 12]); ctx.beginPath();
    if (tall) { ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2); } else { ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, H); }
    ctx.stroke();
    return c;
  }

  // ── the sheet ──
  let state = null;
  function sheet() {
    let el = document.getElementById('labelSheet');
    if (el) return el;
    el = document.createElement('div'); el.id = 'labelSheet'; el.className = 'lbl-back'; el.hidden = true;
    el.innerHTML = '<div class="lbl-box" role="dialog" aria-modal="true" aria-labelledby="lblTitle"></div>';
    el.addEventListener('click', (e) => { if (e.target === el) close(); });
    document.body.append(el);
    const css = document.createElement('style');
    css.textContent = `.lbl-back{position:fixed;inset:0;z-index:400;background:rgba(0,0,0,.45);display:flex;align-items:flex-end;justify-content:center}
.lbl-back[hidden]{display:none}
.lbl-box{background:#fff;color:#121212;width:100%;max-width:520px;max-height:92vh;overflow:auto;border-radius:20px 20px 0 0;padding:18px 18px calc(18px + env(safe-area-inset-bottom))}
@media(min-width:700px){.lbl-back{align-items:center}.lbl-box{border-radius:20px}}
.lbl-head{display:flex;justify-content:space-between;align-items:center;gap:10px}.lbl-head h3{margin:0;font-size:1.1rem}
.lbl-x{border:0;background:#f1f1f1;border-radius:50%;width:34px;height:34px;font-size:1rem;cursor:pointer}
.lbl-q{margin:14px 0 8px;font-weight:700;font-size:.92rem}
.lbl-picks{display:grid;gap:6px;max-height:210px;overflow:auto}
.lbl-pick{display:flex;justify-content:space-between;gap:10px;text-align:left;border:1px solid #e3e3e3;background:#fff;border-radius:12px;padding:10px 12px;font:inherit;font-size:.86rem;cursor:pointer;color:inherit}
.lbl-pick small{color:#777}.lbl-pick[aria-pressed=true]{border-color:#121212;background:#f6f3ec;font-weight:700}
.lbl-search{width:100%;box-sizing:border-box;border:1px solid #e3e3e3;border-radius:10px;padding:9px 11px;font:inherit;font-size:.86rem;margin-bottom:6px}
.lbl-prev{margin:14px 0;display:flex;justify-content:center;background:#f4f4f4;border-radius:14px;padding:12px}
.lbl-prev img{max-width:100%;max-height:46vh;box-shadow:0 2px 10px #0002;background:#fff}
.lbl-size{display:flex;align-items:center;gap:6px;font-size:.8rem;color:#666;flex-wrap:wrap}
.lbl-size input{width:64px;border:1px solid #ddd;border-radius:8px;padding:6px;font:inherit}
.lbl-go{display:flex;gap:8px;margin-top:14px}.lbl-go button{flex:1;min-height:46px;border-radius:12px;font:inherit;font-weight:700;cursor:pointer;border:1px solid #121212;background:#fff;color:#121212}
.lbl-go .main{background:#121212;color:#fff}
.lbl-more{border:0;background:none;color:#555;text-decoration:underline;font:inherit;font-size:.82rem;padding:6px;cursor:pointer;justify-self:start}`;
    document.head.append(css);
    return el;
  }
  function close() { const el = document.getElementById('labelSheet'); if (el) el.hidden = true; state = null; }

  function others(first) {
    const q = (state.search || '').trim().toLowerCase();
    return ordersList().filter((o) => String(o.id) !== String(first.id)
      && String(o.payment_status) === 'paid' && !['fulfilled', 'completed', 'cancelled', 'refunded'].includes(String(o.status || '').toLowerCase())
      && !info(o).combined_into
      && (state.showPrinted || !info(o).label_printed_at)
      && (!q || String(o.customer_name || '').toLowerCase().includes(q) || String(o.order_number ?? '').includes(q)))
      .sort((a, b) => String(info(a).delivery_date || '9').localeCompare(String(info(b).delivery_date || '9')));
  }

  function paint() {
    const box = document.querySelector('#labelSheet .lbl-box');
    const first = state.orders[0], second = state.orders[1] || null, size = state.size;
    const pickRow = (o) => `<button type="button" class="lbl-pick" data-lbl-second="${esc(o.id)}" aria-pressed="${second && String(second.id) === String(o.id)}"><span>${o.order_number != null ? '#' + esc(o.order_number) + ' ' : ''}${esc(o.customer_name || 'Customer')}</span><small>${esc(day(String(info(o).delivery_date || '').slice(0, 10)) || 'No date')}${printed(o)}</small></button>`;
    const list = others(first);
    const printedCount = state.showPrinted ? 0 : (() => { state.showPrinted = true; const n = others(first).length - list.length; state.showPrinted = false; return n; })();
    const printed = (o) => info(o).label_printed_at ? ' · printed' : '';
    box.innerHTML = `<div class="lbl-head"><h3 id="lblTitle">Label · ${first.order_number != null ? '#' + esc(first.order_number) + ' ' : ''}${esc(first.customer_name || '')}${info(first).label_printed_at ? ' <small style="font-weight:600;color:#777">· printed</small>' : ''}</h3><button type="button" class="lbl-x" data-lbl-close aria-label="Close">✕</button></div>
      <p class="lbl-q">Print another order on the same sticker?</p>
      <div class="lbl-picks"><button type="button" class="lbl-pick" data-lbl-second="" aria-pressed="${!second}"><span>No, just this order</span><small>Whole sticker</small></button>
      ${list.length > 6 || state.search ? `<input class="lbl-search" id="lblSearch" placeholder="Find an order by name or number" value="${esc(state.search || '')}">` : ''}
      ${list.slice(0, 40).map(pickRow).join('') || (state.search ? '<small>No matching open orders.</small>' : '')}
      ${printedCount ? `<button type="button" class="lbl-more" data-lbl-printed>Show ${printedCount} already printed</button>` : ''}</div>
      <div class="lbl-prev"><img id="lblImg" alt="Label preview"></div>
      <div class="lbl-size">Sticker size <input type="number" id="lblW" min="20" max="300" value="${size.w}" aria-label="Width in mm"> × <input type="number" id="lblH" min="20" max="300" value="${size.h}" aria-label="Height in mm"> mm${second ? ' · cut along the dashed line' : ''}</div>
      <div class="lbl-go"><button type="button" class="main" data-lbl-share>Share to printer</button><button type="button" data-lbl-save>Save picture</button></div>`;
    state.canvas = draw(state.orders, size);
    document.getElementById('lblImg').src = state.canvas.toDataURL('image/png');
    const s = document.getElementById('lblSearch');
    if (s && state.focusSearch) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); }
  }

  const fileName = () => 'label-' + state.orders.map((o) => o.order_number ?? String(o.id).slice(0, 6)).join('-') + '.png';
  const blob = () => new Promise((res) => state.canvas.toBlob(res, 'image/png'));
  async function share() {
    const file = new File([await blob()], fileName(), { type: 'image/png' });
    if (navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file], title: 'Order label' }); markPrinted(); } catch (e) { if (e?.name !== 'AbortError') save(); }
    } else save();
  }
  async function save() {
    const url = URL.createObjectURL(await blob()), a = document.createElement('a');
    a.href = url; a.download = fileName(); document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    markPrinted();
  }
  // Stamp each order on the sticker as printed. Reads delivery_info fresh so other edits aren't overwritten.
  async function markPrinted() {
    if (!state || typeof sb === 'undefined') return;
    const now = new Date().toISOString(), orders = state.orders.slice();
    orders.forEach((o) => { o.delivery_info = { ...info(o), label_printed_at: now }; const l = ordersList().find((x) => String(x.id) === String(o.id)); if (l && l !== o) l.delivery_info = { ...info(l), label_printed_at: now }; });
    if (state) paint();
    try {
      for (const o of orders) {
        const { data, error } = await sb.from('orders').select('delivery_info').eq('id', o.id).maybeSingle();
        if (error) throw error;
        const di = (data && typeof data.delivery_info === 'object' && data.delivery_info) || {};
        const { error: e2 } = await sb.from('orders').update({ delivery_info: { ...di, label_printed_at: now } }).eq('id', o.id);
        if (e2) throw e2;
      }
    } catch (e) { console.warn('label printed mark failed', e); if (typeof showToast === 'function') showToast('Could not mark the label as printed'); }
  }

  document.addEventListener('click', (e) => {
    if (!state || !e.target.closest?.('#labelSheet')) return;
    if (e.target.closest('[data-lbl-close]')) return close();
    const pick = e.target.closest('[data-lbl-second]');
    if (pick) { const id = pick.dataset.lblSecond, o = ordersList().find((x) => String(x.id) === id); state.orders = o ? [state.orders[0], o] : [state.orders[0]]; state.focusSearch = false; return paint(); }
    if (e.target.closest('[data-lbl-printed]')) { state.showPrinted = true; return paint(); }
    if (e.target.closest('[data-lbl-share]')) return share();
    if (e.target.closest('[data-lbl-save]')) return save();
  });
  document.addEventListener('change', (e) => {
    if (!state || !['lblW', 'lblH'].includes(e.target.id)) return;
    const w = Number(document.getElementById('lblW').value), h = Number(document.getElementById('lblH').value);
    if (w >= 20 && h >= 20 && w <= 300 && h <= 300) { state.size = { w, h }; saveSize(state.size); paint(); }
  });
  document.addEventListener('input', (e) => {
    if (!state || e.target.id !== 'lblSearch') return;
    state.search = e.target.value; state.focusSearch = true; paint();
  });

  async function open(id) {
    let o = ordersList().find((x) => String(x.id) === String(id));
    if (!o && typeof sb !== 'undefined') { const { data } = await sb.from('orders').select('*').eq('id', id).maybeSingle(); o = data; }
    if (!o) { if (typeof showToast === 'function') showToast('Order not found'); return; }
    await logoReady;
    if (document.fonts?.load) { try { await Promise.all(['400', '600', '700', '800'].map((w) => document.fonts.load(`${w} 20px "DM Sans"`))); } catch {} }
    sheet().hidden = false;
    state = { orders: [o], size: readSize(), search: '' };
    paint();
  }
  root.GremierLabel = { open, close, draw, labelData };
})(window);
