/* My Account: the customer's subscriptions. Pause for 1–6 months (those months aren't charged or
   delivered, then it resumes by itself), resume early, or cancel. All through PayMe, server-side. */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const he = () => typeof lang !== 'undefined' && lang === 'he';
  const T = (en, hebrew) => (he() ? hebrew : en);
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const day = (d) => d ? new Date(d + 'T12:00:00').toLocaleDateString(he() ? 'he-IL' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '—';
  async function engage(body) {
    const { data: { session } } = typeof getSessionSafe === 'function' ? await getSessionSafe() : { data: {} };
    if (!session?.access_token) return { error: 'sign_in_required' };
    const res = await fetch(`${SUPABASE_URL}/functions/v1/engage`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + session.access_token }, body: JSON.stringify(body) });
    return res.json().catch(() => ({ error: 'failed' }));
  }
  let max = 6;
  const subsById = new Map();
  // One-time extras: coffee and syrups a subscriber can add to their next box, at the normal price.
  const addable = () => (typeof products !== 'undefined' && window.GremierSubscriptionModel ? products.filter((p) => GremierSubscriptionModel.eligible(p) && Number(p.price) > 0) : []);
  function card(s) {
    subsById.set(String(s.sub_payme_id), s);
    const items = (s.items || []).map((i) => `${esc(he() ? i.name_he || i.name_en : i.name_en)} ×${i.qty}`).join(', ');
    const status = s.status === 'paused' ? T('Paused', 'מושהה') : s.active ? T('Active', 'פעיל') : s.cancelled ? T('Cancelled', 'בוטל') : esc(s.status_label);
    const next = s.status === 'paused'
      ? (s.paused_until ? T(`Paused · next charge and delivery ${day(s.paused_until)}`, `מושהה · החיוב והמשלוח הבאים ב-${day(s.paused_until)}`) : T('Paused', 'מושהה'))
      : s.active && s.next_date ? T(`Next charge ${day(s.next_date)}`, `החיוב הבא ב-${day(s.next_date)}`) : '';
    return `<div class="subm-card" data-sub="${esc(s.sub_payme_id)}">
      <div class="subm-top"><b>🔁 ${T('Your subscription', 'המנוי שלכם')}</b><span class="subm-pill subm-${esc(s.status)}">${status}</span></div>
      <div class="subm-line">${items}${s.price ? ` · ₪${Number(s.price).toFixed(2)} ${T('a month', 'לחודש')}` : ''}</div>
      ${next ? `<div class="subm-line">${next}</div>` : ''}
      <div class="subm-actions">
        ${s.active && s.next_box ? `<button type="button" class="btn btn-primary btn-sm" data-act="add">${T('Add to my next delivery', 'הוספה למשלוח הבא')}</button>` : ''}
        ${s.can_pause ? `<label class="subm-pause">${T('Pause for', 'השהיה ל-')}<select class="form-input" data-months>${Array.from({ length: max }, (_, i) => `<option value="${i + 1}">${i + 1} ${i ? T('months', 'חודשים') : T('month', 'חודש')}</option>`).join('')}</select></label><button type="button" class="btn btn-outline btn-sm" data-act="pause">${T('Pause', 'השהיה')}</button>` : ''}
        ${s.can_resume ? `<button type="button" class="btn btn-primary btn-sm" data-act="resume">${T('Resume now', 'חידוש עכשיו')}</button>` : ''}
        ${s.can_cancel ? `<button type="button" class="subm-cancel" data-act="cancel">${T('Cancel subscription', 'ביטול המנוי')}</button>` : ''}
      </div><div class="subm-add" hidden></div><div class="subm-status" role="status"></div></div>`;
  }
  async function place() {
    const anchor = document.querySelector('#accountSignedIn .account-profile-card');
    if (!anchor) return;
    let box = $('acctSubscriptions');
    if (!box) { box = document.createElement('div'); box.id = 'acctSubscriptions'; anchor.insertAdjacentElement('afterend', box); }
    const r = await engage({ action: 'my_subscriptions' }).catch(() => null);
    max = r?.max_pause_months || 6;
    const subs = (r?.subscriptions || []).filter((s) => !s.cancelled || Date.now() - new Date(s.started).getTime() < 60 * 864e5);
    box.innerHTML = r?.error ? `<p role="status">${T('Subscriptions could not load. Please refresh to try again.', 'לא ניתן לטעון את המנויים. רעננו ונסו שוב.')}</p>` : subs.length ? `<h3>${T('Your subscriptions', 'המנויים שלכם')}</h3>` + subs.map(card).join('') : ''; 
    box.querySelectorAll('[data-act]').forEach((b) => b.onclick = () => act(b));
  }
  function openAdd(el) {
    const box = el.querySelector('.subm-add'), s = subsById.get(el.dataset.sub), out = el.querySelector('.subm-status');
    if (!box.hidden) { box.hidden = true; return; }
    const picks = {}, list = addable();
    // A points, birthday or coupon code (or a gift card) for the one-time add-on, checked the same way as at checkout.
    let code = null, codeText = '', codeMsg = '', codeOk = false;
    const total = () => list.reduce((sum, p) => sum + Number(p.price) * (picks[p.id] || 0), 0);
    const toPay = () => Math.max(0, Math.round((total() - (code ? Number(code.discount) || 0 : 0)) * 100) / 100);
    const applyCode = async () => {
      const text = codeText.trim().toUpperCase();
      code = null;
      if (!text) { codeMsg = T('Enter a code', 'הזינו קוד'); codeOk = false; paint(); return; }
      codeMsg = T('Checking…', 'בודקים…'); codeOk = true; paint();
      const items = list.filter((p) => picks[p.id]).map((p) => ({ product_id: String(p.id), price: Number(p.price), qty: picks[p.id], category: p.category }));
      const call = (fn, body) => fetch(`${SUPABASE_URL}/functions/v1/${fn}`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + SUPABASE_ANON_KEY }, body: JSON.stringify(body) }).then((r) => r.json()).catch(() => ({}));
      try {
        const { data: { session } } = await getSessionSafe();
        const c = await call('validate-coupon', { code: text, cart_total: total(), items, subscription: false, user_id: session?.user?.id || null, email: session?.user?.email || null });
        if (c.valid) { code = { kind: 'coupon', code: c.code || text, discount: Number(c.discount) || 0 }; codeMsg = T(`Code applied: −₪${code.discount}`, `הקוד הופעל: −₪${code.discount}`); codeOk = true; paint(); return; }
        const g = await call('validate-gift-card', { code: text, cart_total: total() });
        if (g.valid) { code = { kind: 'gift_card', code: g.code || text, discount: Number(g.applied) || 0 }; codeMsg = T(`Gift card applied: −₪${code.discount}`, `כרטיס המתנה הופעל: −₪${code.discount}`); codeOk = true; paint(); return; }
        codeMsg = c.message || g.message || T('That code isn’t valid', 'הקוד לא תקין'); codeOk = false;
      } catch (_) { codeMsg = T('Couldn’t check the code. Try again.', 'לא הצלחנו לבדוק את הקוד. נסו שוב.'); codeOk = false; }
      paint();
    };
    const subTotal = () => Math.round(list.reduce((sum, p) => sum + (GremierSubscriptionModel.syrup(p) ? Number(p.price) : Number(p.price) * .9) * (picks[p.id] || 0), 0) * 100) / 100;
    const paint = () => {
      box.innerHTML = `<b>${T('What would you like to add?', 'מה להוסיף?')}</b>
        <p>${T(`Add it once and pay now: it comes with your next box, around ${day(s.next_box)}, with no delivery fee. Or add it to every delivery and save 10%; nothing is charged today.`, `אפשר להוסיף פעם אחת ולשלם עכשיו: זה יגיע עם הקופסה הבאה, בסביבות ${day(s.next_box)}, בלי דמי משלוח. או להוסיף לכל משלוח ולחסוך 10%; היום לא יחויב דבר.`)}</p>
        ${list.map((p) => `<div class="subm-add-row"><span>${esc(he() ? p.name_he || p.name_en : p.name_en)}</span><i>₪${Number(p.price)}</i>
          <button type="button" data-step="-1" data-id="${esc(p.id)}" aria-label="${T('Remove one', 'פחות אחד')}"${picks[p.id] ? '' : ' disabled'}>−</button><em>${picks[p.id] || 0}</em><button type="button" data-step="1" data-id="${esc(p.id)}" aria-label="${T('Add one', 'עוד אחד')}"${(picks[p.id] || 0) >= 20 ? ' disabled' : ''}>+</button></div>`).join('')}
        ${total() ? `<div class="subm-code"><input class="form-input" type="text" autocomplete="off" autocapitalize="characters" placeholder="${T('Points, birthday or gift card code', 'קוד נקודות, יום הולדת או כרטיס מתנה')}" value="${esc(codeText)}" aria-label="${T('Discount code for this delivery', 'קוד הנחה למשלוח הזה')}"><button type="button" class="btn btn-outline btn-sm subm-code-apply">${T('Apply', 'הפעלה')}</button></div>${codeMsg ? `<div class="subm-code-msg ${codeOk ? 'ok' : 'bad'}" role="status">${esc(codeMsg)}</div>` : ''}` : ''}
        <button type="button" class="btn btn-outline btn-sm subm-add-pay"${total() ? '' : ' disabled'}>${total() ? T(`This delivery only · pay ₪${toPay()}`, `רק למשלוח הבא · לתשלום ₪${toPay()}`) : T('Choose something to add', 'בחרו מה להוסיף')}</button>
        ${s.can_add_every_box && total() ? `<button type="button" class="btn btn-primary btn-sm subm-add-every">${T(`Every delivery, 10% off · +₪${subTotal()}`, `בכל משלוח, 10% הנחה · +₪${subTotal()}`)}</button>` : ''}`;
      box.querySelectorAll('[data-step]').forEach((b) => b.onclick = () => { picks[b.dataset.id] = Math.max(0, Math.min(20, (picks[b.dataset.id] || 0) + Number(b.dataset.step))); if (code && total()) applyCode(); else { code = null; codeMsg = ''; paint(); } });
      const input = box.querySelector('.subm-code input');
      if (input) { input.oninput = () => { codeText = input.value; }; input.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); applyCode(); } }; }
      const apply = box.querySelector('.subm-code-apply');
      if (apply) apply.onclick = () => applyCode();
      box.querySelector('.subm-add-pay').onclick = () => payAdd(el, picks, out, code);
      const every = box.querySelector('.subm-add-every');
      if (every) every.onclick = () => addEvery(el, picks, out);
    };
    box.hidden = false;
    paint();
  }
  // Every delivery: the server works out the new charge, the customer confirms it, and only then does it change.
  async function addEvery(el, picks, out) {
    const items = Object.entries(picks).filter(([, qty]) => qty > 0).map(([product_id, qty]) => ({ product_id, qty }));
    const buttons = el.querySelectorAll('.subm-add button');
    const done = (text) => { out.textContent = text; buttons.forEach((x) => { x.disabled = false; }); };
    buttons.forEach((x) => { x.disabled = true; });
    out.textContent = T('One moment…', 'רגע…');
    const base = { action: 'subscription_add_items', sub_payme_id: el.dataset.sub, items };
    const quote = await engage(base).catch(() => null);
    if (!quote?.ok) return done(T('That didn’t work: ', 'זה לא הצליח: ') + (quote?.error || T('try again', 'נסו שוב')));
    const free = quote.delivery_became_free ? T(' That includes free delivery from now on.', ' כולל משלוח חינם מעכשיו.') : '';
    if (!confirm(T(`Your subscription will go from ₪${quote.current} to ₪${quote.next} each delivery, starting with the charge on ${day(quote.next_charge)}.${free} Nothing is charged today. Confirm?`, `המנוי יעבור מ-₪${quote.current} ל-₪${quote.next} בכל משלוח, החל מהחיוב ב-${day(quote.next_charge)}.${free} היום לא יחויב דבר. לאשר?`))) return done('');
    const saved = await engage({ ...base, commit: true, expected_price: quote.next }).catch(() => null);
    if (!saved?.ok) return done(T('That didn’t work: ', 'זה לא הצליח: ') + (saved?.error || T('try again', 'נסו שוב')));
    out.textContent = T(`Added ✓ New charge ₪${saved.next} from ${day(saved.next_charge)}`, `נוסף ✓ החיוב החדש ₪${saved.next} החל מ-${day(saved.next_charge)}`);
    setTimeout(place, 2500);
  }
  async function payAdd(el, picks, out, code) {
    const items = Object.entries(picks).filter(([, qty]) => qty > 0).map(([product_id, qty]) => ({ product_id, qty }));
    const pay = el.querySelector('.subm-add-pay');
    pay.disabled = true;
    out.textContent = T('One moment…', 'רגע…');
    try {
      const { data: { session } } = await getSessionSafe();
      if (!session?.access_token) throw new Error(T('Please sign in again.', 'נא להתחבר שוב.'));
      const post = (fn, token, body) => fetch(`${SUPABASE_URL}/functions/v1/${fn}`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + token }, body: JSON.stringify(body) }).then((r) => r.json().then((j) => ({ ok: r.ok, j })));
      const order = await post('create-website-order', session.access_token, { items, subscription_addon: { sub_payme_id: el.dataset.sub }, coupon_code: code?.kind === 'coupon' ? code.code : null, gift_card_code: code?.kind === 'gift_card' ? code.code : null, site_lang: he() ? 'he' : 'en', analytics_context: window.GremierJourneys?.context() });
      if (!order.ok || !order.j.id) throw new Error(order.j.error || T('Please try again.', 'נסו שוב.'));
      try { localStorage.setItem('gremier_last_order_id', order.j.id); } catch (_) {}
      if (order.j.paid) { out.textContent = T('Added ✓ Paid in full with your gift card. It comes with your next box.', 'נוסף ✓ שולם במלואו בכרטיס המתנה. זה יגיע עם הקופסה הבאה.'); el.querySelector('.subm-add').hidden = true; pay.disabled = false; return; }
      const payment = await post('create-payment', SUPABASE_ANON_KEY, { order_id: order.j.id, language: he() ? 'he' : 'en' });
      const url = payment.j.sale_url || payment.j.redirect_url;
      if (!payment.ok || !url) throw new Error(payment.j.error || T('Please try again.', 'נסו שוב.'));
      window.GremierPay ? GremierPay.open(url) : (window.location.href = url);
      out.textContent = '';
      pay.disabled = false;
    } catch (e) {
      out.textContent = T('That didn’t work: ', 'זה לא הצליח: ') + e.message;
      pay.disabled = false;
    }
  }
  async function act(b) {
    const el = b.closest('[data-sub]'), id = el.dataset.sub, what = b.dataset.act, out = el.querySelector('.subm-status');
    if (what === 'add') { openAdd(el); return; }
    let body;
    if (what === 'pause') {
      const months = Number(el.querySelector('[data-months]').value);
      if (!confirm(T(`Pause for ${months} month${months > 1 ? 's' : ''}? You won't be charged or get deliveries in that time, and it starts again by itself.`, `להשהות ל-${months} ${months > 1 ? 'חודשים' : 'חודש'}? בזמן הזה לא יהיו חיובים ומשלוחים, ואחר כך המנוי יתחדש מעצמו.`))) return;
      body = { action: 'subscription_pause', sub_payme_id: id, months };
    } else if (what === 'resume') {
      body = { action: 'subscription_resume', sub_payme_id: id };
    } else {
      if (!confirm(T('Cancel your subscription? There will be no more charges or deliveries. You can always subscribe again later.', 'לבטל את המנוי? לא יהיו יותר חיובים ומשלוחים. תמיד אפשר להירשם שוב.'))) return;
      body = { action: 'subscription_cancel', sub_payme_id: id };
    }
    el.querySelectorAll('button,select').forEach((x) => x.disabled = true);
    out.textContent = T('One moment…', 'רגע…');
    const r = await engage(body).catch(() => null);
    if (r?.ok) {
      out.textContent = what === 'pause' ? T(`Paused ✓ Next charge ${day(r.next_charge)}`, `הושהה ✓ החיוב הבא ב-${day(r.next_charge)}`)
        : what === 'resume' ? T('Resumed ✓', 'חודש ✓') : T('Cancelled ✓', 'בוטל ✓');
      setTimeout(place, 1500);
    } else {
      out.textContent = T('That didn’t work: ', 'זה לא הצליח: ') + (r?.error || T('try again', 'נסו שוב'));
      el.querySelectorAll('button,select').forEach((x) => x.disabled = false);
    }
  }
  function hook() {
    const wrap = (fn, after) => { const orig = window[fn]; if (typeof orig === 'function') window[fn] = function () { const r = orig.apply(this, arguments); try { after(...arguments); } catch (_) {} return r; }; };
    const later = () => setTimeout(place, 400);
    wrap('updateAccountPage', later);
    wrap('showPage', (p) => { if (p === 'myorders' || p === 'account') later(); });
    if (typeof sb !== 'undefined') sb.auth.onAuthStateChange?.(() => { $('acctSubscriptions')?.remove(); later(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', hook); else hook();
})();
