/* Message a customer about an order: pick a template, edit it, then email it (admin-tools
   message_customer) and/or open WhatsApp / SMS with the same text to the order's phone. */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // Templates: {name} = customer's first name, {n} = order number. Add more here.
  const TEMPLATES = [
    {
      key: 'on_the_way', label: '🚚 On the way',
      en: "Hi {name}, your Gremier Coffee order #{n} is on the way! Please be ready to receive it from the driver, who will be in touch with you.\n\nGremier Coffee",
      he: 'היי {name}, ההזמנה שלך מגרמייר קופי (#{n}) בדרך אליך! נא להיות זמינים לקבל אותה מהשליח, שייצור איתך קשר.\n\nגרמייר קופי',
    },
    {
      key: 'today', label: '📅 Arriving today',
      en: 'Hi {name}, your Gremier Coffee delivery (order #{n}) is expected today. Please be ready to answer the driver if he calls and to receive the delivery from him.\n\nGremier Coffee',
      he: 'היי {name}, המשלוח שלך מגרמייר קופי (הזמנה #{n}) צפוי להגיע היום. נא להיות זמינים לענות לשליח אם יתקשר ולקבל ממנו את המשלוח.\n\nגרמייר קופי',
    },
  ];

  const findOrder = (id) => {
    const lists = [typeof allOrders !== 'undefined' ? allOrders : null, window.allOrders];
    for (const l of lists) { const o = Array.isArray(l) && l.find((x) => x.id === id); if (o) return o; }
    return null;
  };
  const firstName = (o) => String(o.customer_name || '').trim().split(/\s+/)[0] || '';
  const prefersHebrew = (o) => (o.delivery_info && o.delivery_info.lang === 'he') || /[֐-׿]/.test(o.customer_name || '');
  // 050-123-4567 → 972501234567 for wa.me / sms
  function intlPhone(p) {
    let d = String(p || '').replace(/\D/g, '');
    if (d.startsWith('00')) d = d.slice(2);
    if (d.startsWith('0')) d = '972' + d.slice(1);
    return d;
  }
  const fill = (t, o, lang) => t[lang].replace(/\{name\}/g, firstName(o)).replace(/\{n\}/g, o.order_number ?? '');

  let state = null;   // { o, lang, tpl }

  function sheet() {
    let el = $('msgSheet');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'msgSheet';
    el.innerHTML = `<div class="msg-box" role="dialog" aria-modal="true" aria-labelledby="msgTitle">
      <div class="msg-head"><div><h3 id="msgTitle"></h3><small id="msgSub"></small></div><button type="button" class="msg-x" aria-label="Close">×</button></div>
      <div class="msg-templates" id="msgTemplates"></div>
      <div class="msg-lang" id="msgLang"><button type="button" data-lang="he">עברית</button><button type="button" data-lang="en">English</button></div>
      <textarea id="msgText" class="form-input" rows="6"></textarea>
      <div class="msg-actions" id="msgActions"></div>
      <p class="msg-status" id="msgStatus" role="status"></p>
    </div>`;
    document.body.appendChild(el);
    el.addEventListener('click', (e) => {
      if (e.target === el || e.target.closest('.msg-x')) return close();
      const t = e.target.closest('[data-tpl]');
      if (t) { state.tpl = TEMPLATES.find((x) => x.key === t.dataset.tpl); return render(true); }
      const l = e.target.closest('[data-lang]');
      if (l) { state.lang = l.dataset.lang; return render(true); }
      const a = e.target.closest('[data-send]');
      if (a) send(a.dataset.send);
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && el.classList.contains('open')) close(); });
    return el;
  }
  function close() { $('msgSheet')?.classList.remove('open'); }

  function render(refill) {
    const { o, lang, tpl } = state;
    $('msgTitle').textContent = `Message ${o.customer_name || 'customer'}`;
    $('msgSub').textContent = [`Order #${o.order_number}`, o.customer_phone, o.customer_email].filter(Boolean).join(' · ');
    $('msgTemplates').innerHTML = TEMPLATES.map((t) => `<button type="button" data-tpl="${t.key}" class="${t === tpl ? 'on' : ''}">${esc(t.label)}</button>`).join('');
    $('msgLang').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.lang === lang));
    const text = $('msgText');
    text.dir = lang === 'he' ? 'rtl' : 'ltr';
    if (refill) text.value = fill(tpl, o, lang);
    const phone = intlPhone(o.customer_phone), email = !!o.customer_email;
    const pre = email ? 'Email + ' : '';
    $('msgActions').innerHTML = [
      phone ? `<button type="button" class="msg-btn wa" data-send="wa">${pre}WhatsApp</button>` : '',
      phone ? `<button type="button" class="msg-btn" data-send="sms">${pre}SMS</button>` : '',
      email ? `<button type="button" class="msg-btn ${phone ? '' : 'primary'}" data-send="email">Email only</button>` : '',
    ].join('') || '<p class="msg-status">This order has no phone number or email.</p>';
    $('msgStatus').textContent = '';
  }

  async function send(how) {
    const { o, lang } = state;
    const text = $('msgText').value.trim();
    if (!text) return;
    const phone = intlPhone(o.customer_phone);
    // Open WhatsApp / SMS first, inside the tap: browsers block windows opened after a wait.
    if (how === 'wa' && phone) window.open(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
    if (how === 'sms' && phone) location.href = `sms:+${phone}?&body=${encodeURIComponent(text)}`;
    if (!o.customer_email) { $('msgStatus').textContent = how === 'wa' ? 'Opened WhatsApp.' : 'Opened Messages.'; return; }
    const status = $('msgStatus');
    status.textContent = 'Sending email…';
    try {
      const subject = lang === 'he' ? `ההזמנה שלך מגרמייר קופי #${o.order_number}` : `Your Gremier Coffee order #${o.order_number}`;
      const { res, data } = await callAdminFunction('admin-tools', { action: 'message_customer', order_id: o.id, text, subject });
      if (!res.ok || !data.ok) throw new Error(data.error || data.detail || res.status);
      status.textContent = `✓ Emailed to ${o.customer_email}`;
      if (typeof showToast === 'function') showToast('Message emailed ✓');
    } catch (e) {
      status.textContent = `Email failed: ${e.message || e}`;
    }
  }

  window.adminMessageOrder = function (id) {
    const o = findOrder(id);
    if (!o) return typeof showToast === 'function' && showToast('Order not found — refresh the list');
    state = { o, lang: prefersHebrew(o) ? 'he' : 'en', tpl: TEMPLATES[0] };
    sheet().classList.add('open');
    render(true);
  };

  const style = document.createElement('style');
  style.textContent = `
    #msgSheet { position:fixed; inset:0; z-index:400; display:none; align-items:center; justify-content:center; background:rgba(0,0,0,.45); padding:16px; }
    #msgSheet.open { display:flex; }
    #msgSheet .msg-box { width:100%; max-width:460px; max-height:92vh; overflow:auto; background:#fff; border-radius:18px; padding:18px; box-shadow:0 20px 60px rgba(0,0,0,.3); display:flex; flex-direction:column; gap:12px; }
    #msgSheet .msg-head { display:flex; justify-content:space-between; gap:10px; align-items:flex-start; }
    #msgSheet h3 { margin:0; font-size:1.05rem; }
    #msgSheet small { color:var(--text2); font-size:.76rem; }
    #msgSheet .msg-x { width:34px; height:34px; border:none; border-radius:50%; background:#f1f2f4; font-size:1.2rem; cursor:pointer; flex:0 0 auto; }
    #msgSheet .msg-templates, #msgSheet .msg-lang { display:flex; flex-wrap:wrap; gap:6px; }
    #msgSheet .msg-templates button, #msgSheet .msg-lang button { padding:8px 13px; border-radius:999px; border:1px solid #d6dae0; background:#fff; font-size:.8rem; cursor:pointer; color:#1a1a1a; }
    #msgSheet .msg-templates button.on, #msgSheet .msg-lang button.on { background:#1a1a1a; border-color:#1a1a1a; color:#fff; }
    #msgSheet .msg-lang button { padding:5px 11px; font-size:.74rem; }
    #msgSheet textarea { width:100%; min-height:130px; border-radius:12px; font-size:15px; line-height:1.5; resize:vertical; }
    #msgSheet .msg-actions { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
    #msgSheet .msg-btn { padding:12px; border-radius:12px; border:1px solid #d6dae0; background:#fff; font-weight:600; font-size:.86rem; cursor:pointer; color:#1a1a1a; }
    #msgSheet .msg-btn.wa { grid-column:1 / -1; background:#25D366; border-color:#25D366; color:#fff; }
    #msgSheet .msg-btn.primary { grid-column:1 / -1; background:#1a1a1a; border-color:#1a1a1a; color:#fff; }
    #msgSheet .msg-status { margin:0; font-size:.8rem; color:#2c6e49; min-height:1em; }
    @media (max-width:640px) { #msgSheet { align-items:flex-end; padding:0; } #msgSheet .msg-box { max-width:none; border-radius:18px 18px 0 0; padding-bottom:calc(18px + env(safe-area-inset-bottom)); } }`;
  document.head.appendChild(style);
})();
