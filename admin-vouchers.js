/* Vouchers: one-time codes for a specific item (free, or a set amount off) or a set amount off any order.
   Make one (and email it) or a batch (and print them as cards with the item's photo and a QR code).
   Vouchers are coupons with kind='voucher' and max_uses=1, so checkout and redemption work like any code;
   the free-item math is in supabase/functions/_shared/coupon-math.ts. Emails go through send-voucher.
   Uses the admin page's globals: sb, allProducts, showToast. */
(function (root) {
  'use strict';
  const SITE = 'https://gremiercoffee.co.il';
  const QR_LIB = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js';
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toast = (m) => root.showToast?.(m);
  const slug = (n) => String(n || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  const img = (u, w = 400) => (u && u.includes('/upload/') ? u.replace('/upload/', `/upload/f_auto,q_auto,w_${w}/`) : u || '');
  const money = (n) => '₪' + (Number(n) % 1 ? Number(n).toFixed(2) : Number(n));
  const products = () => (root.allProducts || (typeof allProducts !== 'undefined' ? allProducts : []) || [])
    .filter((p) => p.is_active !== false && !['giftcards', 'subscriptions'].includes(p.category) && !p.is_subscription);
  const productOf = (v) => (v.product_ids?.length ? (typeof allProducts !== 'undefined' ? allProducts : []).find((p) => String(p.id) === String(v.product_ids[0])) : null);
  let vouchers = [], usedOn = new Map(), loading = false, openBatches = new Set();

  /** "FREE" / "₪30 OFF", and what it's for. Same wording as the voucher email (send-voucher). */
  function words(v, he) {
    const p = productOf(v), name = p ? (he ? p.name_he || p.name_en : p.name_en || p.name_he) : '';
    const qty = Math.max(1, Number(v.free_qty) || 1);
    if (v.discount_type === 'free_item') return { big: he ? 'חינם' : 'FREE', what: (qty > 1 ? qty + ' × ' : '') + name, p };
    const amount = v.discount_type === 'percent' ? Number(v.discount_value) + '%' : money(v.discount_value);
    return { big: he ? `${amount} הנחה` : `${amount} OFF`, what: name || (he ? 'כל הזמנה' : 'any order'), p };
  }
  const linkOf = (v) => { const p = productOf(v); return `${SITE}/?coupon=${encodeURIComponent(v.code)}${p ? '#product=' + slug(p.name_en) : ''}`; };
  function status(v) {
    if (Number(v.uses_count) >= Number(v.max_uses || 1)) return { key: 'used', label: usedOn.get(v.id) ? 'Used · ' + usedOn.get(v.id) : 'Used' };
    if (v.expires_at && new Date(v.expires_at) < new Date()) return { key: 'expired', label: 'Expired' };
    if (!v.is_active) return { key: 'off', label: 'Turned off' };
    return { key: 'ready', label: v.emailed_to ? 'Emailed · ' + v.emailed_to : 'Not used yet' };
  }
  const usable = (v) => status(v).key === 'ready';

  // ── Loading and the list ──
  async function load() {
    if (loading) return;
    loading = true;
    const host = document.getElementById('vouchersList');
    if (host && !vouchers.length) host.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
    try {
      await catalog();
      const { data, error } = await sb.from('coupons').select('*').eq('kind', 'voucher').order('created_at', { ascending: false });
      if (error) throw error;
      vouchers = data || [];
      usedOn = new Map();
      const used = vouchers.filter((v) => Number(v.uses_count) > 0).map((v) => v.id);
      if (used.length) {
        const { data: r } = await sb.from('coupon_redemptions').select('coupon_id,order_id,redeemed_at,orders(order_number,customer_name)').in('coupon_id', used);
        for (const x of r || []) usedOn.set(x.coupon_id, [x.orders?.order_number != null ? '#' + x.orders.order_number : '', x.orders?.customer_name || ''].filter(Boolean).join(' '));
      }
      render();
    } catch (e) {
      console.error(e);
      if (host) host.innerHTML = '<p class="vc-empty">Could not load vouchers. Try again.</p>';
    } finally { loading = false; }
  }

  function render() {
    const host = document.getElementById('vouchersList');
    if (!host) return;
    if (!vouchers.length) { host.innerHTML = '<p class="vc-empty">No vouchers yet. Tap <b>+ New vouchers</b> to make one to email, or a batch to print.</p>'; return; }
    const groups = new Map();
    for (const v of vouchers) { const k = v.batch || 'single:' + v.id; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(v); }
    const stats = document.getElementById('voucherStats');
    if (stats) {
      const n = (k) => vouchers.filter((v) => status(v).key === k).length;
      stats.innerHTML = [['Ready to use', n('ready')], ['Used', n('used')], ['Expired / off', n('expired') + n('off')]].map(([l, x]) => `<div class="stat-card"><div class="stat-label">${l}</div><div class="stat-value">${x}</div></div>`).join('');
    }
    host.innerHTML = [...groups].map(([key, list]) => {
      const v0 = list[0], w = words(v0), batch = !!v0.batch;
      const used = list.filter((v) => status(v).key === 'used').length, ready = list.filter(usable).length;
      const until = v0.expires_at ? 'Valid until ' + new Date(v0.expires_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : 'No expiry';
      const open = !batch || openBatches.has(key);
      return `<div class="vc-group card">
        <div class="vc-head">
          ${w.p?.images?.[0] ? `<img class="vc-pic" src="${esc(img(w.p.images[0], 160))}" alt="">` : `<span class="vc-pic vc-amt">${esc(w.big.replace(' OFF', ''))}</span>`}
          <div class="vc-title"><b>${esc(w.big === 'FREE' ? 'Free ' + w.what : w.big.replace(' OFF', ' off') + ' ' + w.what)}</b>
            <small>${batch ? `${esc(v0.batch)} · ${list.length} voucher${list.length > 1 ? 's' : ''} · ${used} used · ` : ''}${esc(until)}${v0.recipient_name && !batch ? ' · for ' + esc(v0.recipient_name) : ''}</small></div>
          <div class="vc-acts">
            ${ready ? `<button class="btn btn-outline btn-sm" data-vc-print="${esc(key)}">🖨 Print${batch ? ' ' + ready : ''}</button>` : ''}
            ${batch ? `<button class="btn btn-outline btn-sm" data-vc-toggle="${esc(key)}">${open ? 'Hide codes' : 'Show codes'}</button>` : ''}
          </div>
        </div>
        ${open ? `<div class="vc-rows">${list.map(row).join('')}</div>` : ''}
      </div>`;
    }).join('');
  }
  function row(v) {
    const st = status(v), ok = st.key === 'ready';
    return `<div class="vc-row ${st.key}">
      <code class="vc-code">${esc(v.code)}</code>
      <span class="vc-st">${esc(st.label)}</span>
      <span class="vc-row-acts">
        ${ok ? `<button class="btn btn-sm btn-amber" data-vc-email="${v.id}">✉️ Email</button>
        <button class="btn btn-sm btn-outline" data-vc-copy="${v.id}">Copy link</button>
        <button class="btn btn-sm btn-outline" data-vc-print1="${v.id}">🖨</button>
        <button class="btn btn-sm btn-outline" data-vc-off="${v.id}" title="Turn off">Turn off</button>` : st.key === 'off' ? `<button class="btn btn-sm btn-outline" data-vc-on="${v.id}">Turn on</button>` : ''}
      </span>
    </div>`;
  }

  // ── New vouchers ──
  async function catalog() { if (typeof allProducts !== 'undefined' && !allProducts.length && typeof loadAllProducts === 'function') await loadAllProducts(); }
  async function openNew() {
    closeModal();
    await catalog();
    const list = products().sort((a, b) => String(a.category).localeCompare(String(b.category)) || String(a.name_en).localeCompare(String(b.name_en)));
    const cats = [...new Set(list.map((p) => p.category || 'other'))];
    const el = document.createElement('div');
    el.className = 'modal-backdrop open vc-modal'; el.id = 'voucherModal';
    el.innerHTML = `<div class="modal-box">
      <div class="modal-title">New vouchers</div>
      <div class="form-group"><label class="form-label">What it gives</label>
        <div class="vc-seg" role="radiogroup">
          <button type="button" class="on" data-kind="free">Free item</button>
          <button type="button" data-kind="item_off">₪ off an item</button>
          <button type="button" data-kind="order_off">₪ off any order</button>
        </div></div>
      <div class="form-group" id="vcProductWrap"><label class="form-label" for="vcProduct">Item</label>
        <div class="vc-prod"><img id="vcProductPic" alt=""><select class="form-input" id="vcProduct">${cats.map((c) => `<optgroup label="${esc(c)}">${list.filter((p) => (p.category || 'other') === c).map((p) => `<option value="${esc(p.id)}">${esc(p.name_en)} · ${money(p.price)}</option>`).join('')}</optgroup>`).join('')}</select></div></div>
      <div class="form-row-2">
        <div class="form-group" id="vcQtyWrap"><label class="form-label" for="vcQty">How many free</label><input class="form-input" id="vcQty" type="number" min="1" max="20" value="1"></div>
        <div class="form-group" id="vcAmountWrap" hidden><label class="form-label" for="vcAmount">Amount off (₪)</label><input class="form-input" id="vcAmount" type="number" min="1" step="1" placeholder="30"></div>
        <div class="form-group"><label class="form-label" for="vcUntil">Valid until <small>(optional)</small></label><input class="form-input" id="vcUntil" type="date"></div>
      </div>
      <div class="form-row-2">
        <div class="form-group"><label class="form-label" for="vcCount">How many vouchers</label><input class="form-input" id="vcCount" type="number" min="1" max="500" value="1"></div>
        <div class="form-group"><label class="form-label" for="vcBatch">Batch name <small>(for printing many)</small></label><input class="form-input" id="vcBatch" placeholder="e.g. Shuk stall, November"></div>
      </div>
      <div id="vcSendWrap">
        <div class="form-group"><label class="form-label" for="vcEmail">Email it to <small>(optional)</small></label><input class="form-input" id="vcEmail" type="email" placeholder="name@example.com"></div>
        <div class="form-row-2">
          <div class="form-group"><label class="form-label" for="vcName">Their name <small>(optional)</small></label><input class="form-input" id="vcName" placeholder="Dana"></div>
          <div class="form-group"><label class="form-label" for="vcLang">Email language</label><select class="form-input" id="vcLang"><option value="en">English</option><option value="he">עברית</option></select></div>
        </div>
        <div class="form-group"><label class="form-label" for="vcNote">Personal note <small>(optional)</small></label><textarea class="form-input" id="vcNote" rows="2" placeholder="Thanks for being a great customer!"></textarea></div>
      </div>
      <p class="vc-preview" id="vcPreview"></p>
      <div style="display:flex;gap:10px;margin-top:14px">
        <button class="btn btn-amber" id="vcCreate">Create</button>
        <button class="btn btn-outline" data-vc-close>Cancel</button>
      </div>
    </div>`;
    document.body.appendChild(el);
    el.addEventListener('click', (e) => { if (e.target === el || e.target.closest('[data-vc-close]')) closeModal(); });
    el.querySelectorAll('[data-kind]').forEach((b) => b.onclick = () => { el.querySelectorAll('[data-kind]').forEach((x) => x.classList.toggle('on', x === b)); sync(); });
    el.querySelectorAll('input,select,textarea').forEach((x) => x.addEventListener('input', sync));
    el.querySelector('#vcCreate').onclick = create;
    sync();
  }
  const kindNow = () => document.querySelector('#voucherModal [data-kind].on')?.dataset.kind || 'free';
  const val = (id) => document.getElementById(id)?.value.trim() || '';
  function sync() {
    const kind = kindNow(), many = Number(val('vcCount')) > 1;
    document.getElementById('vcProductWrap').hidden = kind === 'order_off';
    document.getElementById('vcQtyWrap').hidden = kind !== 'free';
    document.getElementById('vcAmountWrap').hidden = kind === 'free';
    document.getElementById('vcSendWrap').hidden = many;
    const p = products().find((x) => String(x.id) === val('vcProduct'));
    const pic = document.getElementById('vcProductPic');
    if (pic) { pic.src = p?.images?.[0] ? img(p.images[0], 120) : ''; pic.hidden = !p?.images?.[0] || kind === 'order_off'; }
    const v = draft();
    const w = v ? words(v) : null, count = Math.max(1, Number(val('vcCount')) || 1);
    document.getElementById('vcPreview').textContent = w ? `${count} voucher${count > 1 ? 's' : ''}: ${w.big === 'FREE' ? 'free ' + w.what : w.big.replace(' OFF', ' off') + ' ' + w.what}, one-time use each${many ? '. You can print them next.' : val('vcEmail') ? ', emailed to ' + val('vcEmail') + '.' : '.'}` : '';
  }
  /** The voucher as it will be saved (without its code), or null while the form is incomplete. */
  function draft() {
    const kind = kindNow(), pid = val('vcProduct'), amount = Number(val('vcAmount'));
    if (kind !== 'order_off' && !pid) return null;
    if (kind !== 'free' && !(amount > 0)) return null;
    const until = val('vcUntil');
    return {
      kind: 'voucher', discount_type: kind === 'free' ? 'free_item' : 'fixed', discount_value: kind === 'free' ? 0 : amount,
      applies_to: kind === 'order_off' ? 'all' : 'specific_products', product_ids: kind === 'order_off' ? null : [pid],
      free_qty: kind === 'free' ? Math.max(1, Math.min(20, Math.floor(Number(val('vcQty')) || 1))) : null,
      max_uses: 1, uses_count: 0, one_time_per_user: false, is_active: true, for_subscriptions: false, free_delivery: false,
      expires_at: until ? new Date(until + 'T23:59:59+02:00').toISOString() : null,
    };
  }
  function makeCode() {
    const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', b = new Uint8Array(8);
    crypto.getRandomValues(b);
    const s = [...b].map((x) => abc[x % abc.length]).join('');
    return `V-${s.slice(0, 4)}-${s.slice(4)}`;
  }
  async function create() {
    const base = draft();
    if (!base) return toast(kindNow() === 'free' ? 'Choose the item' : 'Enter the amount off');
    const count = Math.max(1, Math.min(500, Math.floor(Number(val('vcCount')) || 1)));
    const email = count === 1 ? val('vcEmail') : '';
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return toast('Check the email address');
    const send = { name: val('vcName'), lang: val('vcLang'), note: val('vcNote') };   // read now: the form closes before the email goes
    const btn = document.getElementById('vcCreate'); btn.disabled = true; btn.textContent = 'Creating…';
    const w = words(base);
    const batch = count > 1 ? (val('vcBatch') || `${w.big === 'FREE' ? 'Free ' + w.what : w.big.replace(' OFF', ' off') + ' ' + w.what} · ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`) : (val('vcBatch') || null);
    const description = `Voucher: ${w.big === 'FREE' ? 'free ' + w.what : w.big.replace(' OFF', ' off') + ' ' + w.what}`;
    try {
      let rows = Array.from({ length: count }, () => ({ ...base, code: makeCode(), batch, description, recipient_name: count === 1 ? val('vcName') || null : null }));
      let { data, error } = await sb.from('coupons').insert(rows).select('*');
      if (error && /duplicate|unique/i.test(error.message || '')) {   // a code clash (very rare): new codes, once more
        rows = rows.map((r) => ({ ...r, code: makeCode() }));
        ({ data, error } = await sb.from('coupons').insert(rows).select('*'));
      }
      if (error) throw error;
      vouchers = [...(data || []), ...vouchers];
      if (batch) openBatches.add(batch);
      closeModal();
      render();
      if (email) {
        await sendEmail(data[0], email, send.name, send.lang, send.note);
      } else toast(count > 1 ? `${count} vouchers created. Print them from the list.` : 'Voucher created ✓');
      load();
    } catch (e) {
      console.error(e);
      toast('Could not create the vouchers: ' + (e.message || e));
      btn.disabled = false; btn.textContent = 'Create';
    }
  }
  function closeModal() { document.getElementById('voucherModal')?.remove(); }

  // ── Email ──
  async function sendEmail(v, email, name, lang, note) {
    toast('Sending…');
    const { data, error } = await sb.functions.invoke('send-voucher', { body: { id: v.id, email, name, lang, note } });
    if (error || !data?.ok) { let msg = data?.error; try { msg = msg || (await error?.context?.json())?.error; } catch (_) {} toast('Could not send it: ' + (msg || error?.message || 'try again')); return false; }
    toast('Voucher emailed to ' + email + ' ✓');
    load();
    return true;
  }
  function openEmail(v) {
    closeModal();
    const w = words(v);
    const el = document.createElement('div');
    el.className = 'modal-backdrop open vc-modal'; el.id = 'voucherModal';
    el.innerHTML = `<div class="modal-box">
      <div class="modal-title">Email voucher ${esc(v.code)}</div>
      <p class="vc-preview">${esc(w.big === 'FREE' ? 'Free ' + w.what : w.big.replace(' OFF', ' off') + ' ' + w.what)}</p>
      <div class="form-group"><label class="form-label" for="vcEmail">Email</label><input class="form-input" id="vcEmail" type="email" placeholder="name@example.com" value="${esc(v.emailed_to || '')}"></div>
      <div class="form-row-2">
        <div class="form-group"><label class="form-label" for="vcName">Their name <small>(optional)</small></label><input class="form-input" id="vcName" value="${esc(v.recipient_name || '')}"></div>
        <div class="form-group"><label class="form-label" for="vcLang">Language</label><select class="form-input" id="vcLang"><option value="en">English</option><option value="he">עברית</option></select></div>
      </div>
      <div class="form-group"><label class="form-label" for="vcNote">Personal note <small>(optional)</small></label><textarea class="form-input" id="vcNote" rows="2"></textarea></div>
      <div style="display:flex;gap:10px;margin-top:14px"><button class="btn btn-amber" id="vcSend">Send</button><button class="btn btn-outline" data-vc-close>Cancel</button></div>
    </div>`;
    document.body.appendChild(el);
    el.addEventListener('click', (e) => { if (e.target === el || e.target.closest('[data-vc-close]')) closeModal(); });
    el.querySelector('#vcSend').onclick = async () => {
      const email = val('vcEmail');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return toast('Check the email address');
      const b = el.querySelector('#vcSend'); b.disabled = true; b.textContent = 'Sending…';
      if (await sendEmail(v, email, val('vcName'), val('vcLang'), val('vcNote'))) closeModal();
      else { b.disabled = false; b.textContent = 'Send'; }
    };
    el.querySelector('#vcEmail').focus();
  }

  // ── Print: cards with the item's photo, FREE / the amount, the code and a QR code to the site ──
  let qrReady = null;
  function loadQr() {
    if (root.qrcode) return Promise.resolve();
    return qrReady || (qrReady = new Promise((res, rej) => { const s = document.createElement('script'); s.src = QR_LIB; s.onload = res; s.onerror = () => { qrReady = null; rej(new Error('Could not load the QR code maker')); }; document.head.appendChild(s); }));
  }
  function qrSvg(text) { const q = root.qrcode(0, 'M'); q.addData(text); q.make(); return q.createSvgTag({ cellSize: 4, margin: 0, scalable: true }); }
  async function print(list, he) {
    list = list.filter(usable);
    if (!list.length) return toast('No unused vouchers to print');
    const win = root.open('', '_blank');
    if (!win) return toast('Allow pop-ups to print');
    win.document.write('<p style="font-family:sans-serif;padding:20px">Preparing the vouchers…</p>');
    try { await loadQr(); } catch (e) { win.close(); return toast(e.message); }
    const until = (v) => v.expires_at ? new Date(v.expires_at).toLocaleDateString(he ? 'he-IL' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
    const cards = list.map((v) => {
      const w = words(v, he), photo = w.p?.images?.[0];
      return `<div class="card">
        <div class="pic">${photo ? `<img src="${esc(img(photo, 500))}" alt="">` : `<div class="amt">${esc(w.big)}</div>`}</div>
        <div class="info">
          <div class="brand"><img src="${SITE}/logo.png" alt=""><span dir="ltr">Gremier Coffee Co.</span></div>
          <div class="label">${he ? 'שובר' : 'Voucher'}</div>
          <div class="big">${esc(w.big)}</div>
          <div class="what">${esc(w.what)}</div>
          <div class="codebox"><div class="qr">${qrSvg(linkOf(v))}</div><div><div class="cl">${he ? 'קוד' : 'Code'}</div><div class="code">${esc(v.code)}</div></div></div>
          <div class="small">${he ? 'סרקו או הזינו את הקוד בקופה ב־gremiercoffee.co.il' : 'Scan, or enter the code at checkout on gremiercoffee.co.il'} · ${he ? 'חד־פעמי' : 'One-time use'}${until(v) ? ` · ${he ? 'בתוקף עד' : 'Valid until'} ${esc(until(v))}` : ''}</div>
        </div></div>`;
    }).join('');
    win.document.open();
    win.document.write(`<!doctype html><html dir="${he ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><title>Gremier vouchers</title><style>
      @page { size: A4; margin: 10mm; }
      * { box-sizing: border-box; }
      body { margin: 0; font-family: Arial, Helvetica, sans-serif; color: #1a1a1a; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .sheet { display: grid; grid-template-columns: 1fr 1fr; gap: 6mm; }
      .card { display: flex; height: 64mm; border: 0.3mm dashed #b9ada0; border-radius: 4mm; overflow: hidden; break-inside: avoid; background: #fbf8f4; }
      .pic { width: 34%; background: #efe8de; display: flex; align-items: center; justify-content: center; }
      .pic img { width: 100%; height: 100%; object-fit: cover; }
      .amt { font-family: Georgia, serif; font-weight: bold; font-size: 20pt; text-align: center; padding: 3mm; color: #3a2a1a; }
      .info { flex: 1; padding: 3.5mm 4mm; display: flex; flex-direction: column; min-width: 0; }
      .brand { display: flex; align-items: center; gap: 2mm; font-family: Georgia, serif; font-size: 8pt; color: #5b4a3a; }
      .brand img { width: 6mm; height: 6mm; border-radius: 50%; }
      .label { margin-top: 2mm; font-size: 6.5pt; letter-spacing: .3em; text-transform: uppercase; color: #c8873a; }
      .big { font-family: Georgia, serif; font-weight: bold; font-size: 22pt; line-height: 1; }
      .what { font-size: 9pt; font-weight: bold; margin-top: 1mm; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .codebox { margin-top: auto; display: flex; align-items: center; gap: 3mm; }
      .qr { width: 17mm; height: 17mm; flex: none; } .qr svg { width: 100%; height: 100%; display: block; }
      .cl { font-size: 6pt; letter-spacing: .2em; text-transform: uppercase; color: #8a7c6e; }
      .code { font-family: 'Courier New', monospace; font-weight: bold; font-size: 10.5pt; letter-spacing: .03em; direction: ltr; unicode-bidi: isolate; white-space: nowrap; }
      .codebox > div:last-child { min-width: 0; }
      .small { margin-top: 1.5mm; font-size: 6.2pt; color: #6b6158; line-height: 1.3; }
      .bar { padding: 10px 0 14px; font-size: 14px; } @media print { .bar { display: none; } }
    </style></head><body><div class="bar">${list.length} voucher${list.length > 1 ? 's' : ''}, 8 to a page. <button onclick="print()">Print</button></div><div class="sheet">${cards}</div>
    <script>Promise.all([...document.images].map(i=>i.complete?0:new Promise(r=>{i.onload=i.onerror=r}))).then(()=>setTimeout(()=>print(),200));<\/script></body></html>`);
    win.document.close();
  }
  function askPrint(list) {
    closeModal();
    const el = document.createElement('div');
    el.className = 'modal-backdrop open vc-modal'; el.id = 'voucherModal';
    el.innerHTML = `<div class="modal-box"><div class="modal-title">Print ${list.filter(usable).length} voucher${list.filter(usable).length > 1 ? 's' : ''}</div>
      <p class="vc-preview">Cards are 8 to an A4 page, with a cutting line around each.</p>
      <div style="display:flex;gap:10px;margin-top:14px;flex-wrap:wrap"><button class="btn btn-amber" data-lang="en">Print in English</button><button class="btn btn-amber" data-lang="he">הדפסה בעברית</button><button class="btn btn-outline" data-vc-close>Cancel</button></div></div>`;
    document.body.appendChild(el);
    el.addEventListener('click', (e) => {
      if (e.target === el || e.target.closest('[data-vc-close]')) return closeModal();
      const b = e.target.closest('[data-lang]');
      if (b) { closeModal(); print(list, b.dataset.lang === 'he'); }
    });
  }

  // ── Actions ──
  async function setActive(id, on) {
    const { error } = await sb.from('coupons').update({ is_active: on, updated_at: new Date().toISOString() }).eq('id', id).eq('kind', 'voucher');
    if (error) return toast('Could not change it: ' + error.message);
    const v = vouchers.find((x) => x.id === id); if (v) v.is_active = on;
    render(); toast(on ? 'Voucher turned on' : 'Voucher turned off. It can no longer be used.');
  }
  document.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-vc-new],[data-vc-print],[data-vc-print1],[data-vc-toggle],[data-vc-email],[data-vc-copy],[data-vc-off],[data-vc-on]');
    if (!t) return;
    const byId = (id) => vouchers.find((v) => v.id === id);
    const group = (key) => vouchers.filter((v) => (v.batch || 'single:' + v.id) === key);
    if (t.dataset.vcNew !== undefined) return openNew();
    if (t.dataset.vcPrint) return askPrint(group(t.dataset.vcPrint));
    if (t.dataset.vcPrint1) return askPrint([byId(t.dataset.vcPrint1)].filter(Boolean));
    if (t.dataset.vcToggle) { const k = t.dataset.vcToggle; openBatches.has(k) ? openBatches.delete(k) : openBatches.add(k); return render(); }
    if (t.dataset.vcEmail) return openEmail(byId(t.dataset.vcEmail));
    if (t.dataset.vcCopy) { const v = byId(t.dataset.vcCopy); try { await navigator.clipboard.writeText(linkOf(v)); toast('Link copied: it opens the site with the code ready'); } catch (_) { toast(linkOf(v)); } return; }
    if (t.dataset.vcOff) { if (confirm('Turn off this voucher? It will stop working.')) setActive(t.dataset.vcOff, false); return; }
    if (t.dataset.vcOn) return setActive(t.dataset.vcOn, true);
  });

  // Load when the Vouchers screen opens.
  const tab = document.getElementById('tab-vouchers');
  if (tab) new MutationObserver(() => { if (tab.style.display !== 'none') load(); }).observe(tab, { attributes: true, attributeFilter: ['style'] });
  root.GremierVouchers = { load, words, linkOf, print };
})(window);
