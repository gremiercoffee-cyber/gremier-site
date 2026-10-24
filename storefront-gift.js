/* Gift cards: the Gift Cards page (live card preview, To / From, message), buying through
   create-gift-card-order + PayMe, a "Gift cards" entry in the shop's categories, and
   ?gift=CODE links from the gift email, which apply the card at checkout by themselves. */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const he = () => typeof lang !== 'undefined' && lang === 'he';
  const T = (en, hebrew) => (he() ? hebrew : en);
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const validEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || '').trim());
  const AMOUNTS = [100, 150, 200, 300];
  const MIN = 50, MAX = 2000;
  const state = { amount: 150, custom: '', toName: '', toEmail: '', fromName: '', fromEmail: '', message: '' };

  const signedIn = () => typeof currentUser !== 'undefined' && !!currentUser;
  const amount = () => {
    const c = Math.round(Number(state.custom));
    return state.custom !== '' && c > 0 ? c : state.amount;
  };

  // ── The card itself (also what the email shows) ──
  function cardHtml() {
    const a = amount();
    return `<div class="gcx-card" aria-hidden="true">
      <div class="gcx-card-top" dir="ltr"><img src="/logo.png" alt=""><span>Gremier Coffee Co.</span></div>
      <div class="gcx-card-label">${T('Gift card', 'כרטיס מתנה')}</div>
      <div class="gcx-card-amount">₪${a > 0 ? a : '—'}</div>
      <div class="gcx-card-names">
        <span>${T('To', 'אל')}: <b>${esc(state.toName) || '…'}</b></span>
        <span>${T('From', 'מאת')}: <b>${esc(state.fromName) || '…'}</b></span>
      </div>
    </div>`;
  }
  function refreshCard() {
    const box = $('gcxPreview');
    if (box) box.innerHTML = cardHtml();
    const btn = $('gcxBuyBtn');
    if (btn && !btn.disabled) btn.textContent = buyLabel();
  }
  const buyLabel = () => T(`Continue to payment · ₪${amount()}`, `המשך לתשלום · ₪${amount()}`);

  function render() {
    const root = $('gcRoot');
    if (!root) return;
    if (signedIn()) {
      state.fromEmail = currentUser.email || state.fromEmail;
      if (!state.fromName) state.fromName = (currentUser.user_metadata?.full_name || '').split(' ')[0] || '';
    }
    root.innerHTML = `
      <div class="section-header">
        <div class="eyebrow">${T('Send a gift', 'שלחו מתנה')}</div>
        <div class="divider"></div>
        <h2 class="section-title">${T('Gift Cards', 'כרטיסי מתנה')}</h2>
        <p class="gcx-intro">${T('Give the gift of great cold brew. They choose what they love, and it arrives fresh at their door.', 'תנו מתנה של קולד ברו מעולה. הם בוחרים מה שהם אוהבים, וזה מגיע טרי עד הדלת.')}</p>
      </div>
      <div class="gcx">
        <div class="gcx-preview-col">
          <div id="gcxPreview">${cardHtml()}</div>
          <ul class="gcx-points">
            <li>✉️ ${T('Emailed to them right after payment', 'נשלח אליהם במייל מיד אחרי התשלום')}</li>
            <li>♾️ ${T('Never expires; the balance carries over', 'לא פג תוקף, והיתרה נשמרת')}</li>
            <li>☕ ${T('Good for anything on the site', 'למימוש על כל מה שבאתר')}</li>
          </ul>
        </div>
        <form class="gcx-form" onsubmit="event.preventDefault();gcxBuy()">
          <div class="gcx-label">${T('Amount', 'סכום')}</div>
          <div class="gcx-amounts">
            ${AMOUNTS.map((a) => `<button type="button" class="gcx-amt ${state.custom === '' && state.amount === a ? 'active' : ''}" onclick="gcxPick(${a})">₪${a}</button>`).join('')}
            <input class="gcx-amt gcx-custom ${state.custom !== '' ? 'active' : ''}" type="number" inputmode="numeric" min="${MIN}" max="${MAX}" placeholder="${T('Other', 'אחר')}" value="${esc(state.custom)}" oninput="gcxInput('custom', this.value)">
          </div>
          <div class="gcx-label">${T('To', 'אל')}</div>
          <div class="gcx-row">
            <input class="form-input" placeholder="${T('Their name', 'השם שלהם')}" value="${esc(state.toName)}" oninput="gcxInput('toName', this.value)" autocomplete="off">
            <input class="form-input" type="email" placeholder="${T('Their email', 'המייל שלהם')}" value="${esc(state.toEmail)}" oninput="gcxInput('toEmail', this.value)" autocomplete="off" dir="ltr">
          </div>
          <div class="gcx-label">${T('From', 'מאת')}</div>
          <div class="gcx-row ${signedIn() ? 'one' : ''}">
            <input class="form-input" placeholder="${T('Your name', 'השם שלכם')}" value="${esc(state.fromName)}" oninput="gcxInput('fromName', this.value)" autocomplete="name">
            ${signedIn() ? '' : `<input class="form-input" type="email" placeholder="${T('Your email (for the receipt)', 'המייל שלכם (לקבלה)')}" value="${esc(state.fromEmail)}" oninput="gcxInput('fromEmail', this.value)" autocomplete="email" dir="ltr">`}
          </div>
          <div class="gcx-label">${T('Message (optional)', 'הקדשה (לא חובה)')}</div>
          <textarea class="form-input" rows="3" maxlength="300" placeholder="${T('Happy birthday! Enjoy a coffee on me ☕', 'יום הולדת שמח! קפה עליי ☕')}" oninput="gcxInput('message', this.value)">${esc(state.message)}</textarea>
          <div id="gcxErr" class="gcx-err"></div>
          <button type="submit" class="btn btn-primary btn-full" id="gcxBuyBtn">${buyLabel()}</button>
          <p class="gcx-fine">🔒 ${T('Secure payment: card, bit, Apple Pay or Google Pay', 'תשלום מאובטח: כרטיס, bit, Apple Pay או Google Pay')}</p>
        </form>
      </div>
      <div class="gcx-steps">
        <div><b>1</b><span>${T('Pick an amount and write a few words', 'בוחרים סכום וכותבים כמה מילים')}</span></div>
        <div><b>2</b><span>${T('They get a gift card email with their code', 'הם מקבלים מייל עם כרטיס המתנה והקוד')}</span></div>
        <div><b>3</b><span>${T('One tap in the email applies it at checkout', 'לחיצה במייל, והכרטיס כבר מופעל בקופה')}</span></div>
      </div>`;
  }

  window.gcxPick = (a) => { state.amount = a; state.custom = ''; render(); };
  window.gcxInput = (k, v) => {
    state[k] = v;
    if (k === 'custom') document.querySelectorAll('.gcx-amt').forEach((b) => b.classList.toggle('active', b.classList.contains('gcx-custom') ? v !== '' : v === '' && b.textContent === `₪${state.amount}`));
    refreshCard();
  };

  window.gcxBuy = async function () {
    const err = (m) => { const el = $('gcxErr'); if (el) el.textContent = m; };
    const a = amount();
    if (!(a >= MIN && a <= MAX)) return err(T(`Choose an amount between ₪${MIN} and ₪${MAX}`, `בחרו סכום בין ₪${MIN} ל-₪${MAX}`));
    if (!validEmail(state.toEmail)) return err(T('Enter their email so we can send the gift card', 'הזינו את המייל שלהם כדי שנוכל לשלוח את הכרטיס'));
    if (!state.fromName.trim()) return err(T('Add your name, so they know who it\'s from', 'הוסיפו את השם שלכם, כדי שידעו ממי המתנה'));
    if (!signedIn() && !validEmail(state.fromEmail)) return err(T('Enter your email for the receipt', 'הזינו את המייל שלכם לקבלה'));
    err('');
    const btn = $('gcxBuyBtn');
    btn.disabled = true; btn.textContent = T('Redirecting to payment…', 'מעביר לתשלום…');
    try {
      const { data: { session } } = await getSessionSafe();
      const res = await fetch(`${SUPABASE_URL}/functions/v1/create-gift-card-order`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + (session?.access_token || SUPABASE_ANON_KEY) },
        body: JSON.stringify({
          amount: a,
          recipient_email: state.toEmail.trim(),
          recipient_name: state.toName.trim() || null,
          sender_name: state.fromName.trim(),
          message: state.message.trim() || null,
          customer_email: (signedIn() ? currentUser.email : state.fromEmail).trim(),
          customer_name: (signedIn() && currentUser.user_metadata?.full_name) || state.fromName.trim(),
          site_lang: he() ? 'he' : 'en',
        }),
      });
      const order = await res.json().catch(() => ({}));
      if (!res.ok || !order.id) throw new Error(order.error || 'order_failed');
      const pay = await callCreatePayment(order.id);
      sessionStorage.setItem('gremier_pending_order', order.id);
      // The return page keeps the shopping cart and says where the gift went.
      sessionStorage.setItem('gremier_pending_gift', JSON.stringify({ id: order.id, to: state.toName.trim() || state.toEmail.trim() }));
      if (pay.payme_sale_id) sessionStorage.setItem('gremier_payme_sale_' + order.id, pay.payme_sale_id);
      window.GremierPay ? GremierPay.open(pay.sale_url) : (window.location.href = pay.sale_url);
      btn.disabled = false; btn.textContent = buyLabel();
    } catch (e) {
      console.error(e);
      err(T('Something went wrong. Please try again, or message us on WhatsApp.', 'משהו השתבש. נסו שוב, או כתבו לנו בוואטסאפ.'));
      btn.disabled = false; btn.textContent = buyLabel();
    }
  };

  // Old entry points (amount buttons, "Buy a gift card") all lead to the page.
  window.gcSelectAmount = (a) => { state.amount = a; state.custom = ''; showPage('giftcards'); };
  window.openGiftCardPurchase = () => showPage('giftcards');
  window.renderGiftPage = render;

  // ── After paying for a gift card: say where it went ──
  function giftResult() {
    let info = null;
    try { info = JSON.parse(sessionStorage.getItem('gremier_gift_result') || 'null'); } catch (_) {}
    return info;
  }
  function decorateResult(kind) {
    const info = giftResult();
    if (!info || kind !== 'paid') return;
    sessionStorage.removeItem('gremier_gift_result');
    const icon = document.querySelector('#checkoutConfirmView .confirm-icon');
    if (icon) icon.textContent = '🎁';
    $('t-conf-title').textContent = T('Your gift card is on its way!', 'כרטיס המתנה בדרך!');
    $('t-conf-sub').textContent = T(`We've emailed it to ${info.to}. You'll get a receipt by email too.`, `שלחנו אותו במייל אל ${info.to}. גם אתם תקבלו קבלה במייל.`);
  }

  // ── ?gift=CODE (the button in the gift email): keep it and apply it at checkout ──
  const KEY = 'gremier_gift_code';
  function arriveWithGift() {
    const params = new URLSearchParams(location.search);
    const code = (params.get('gift') || '').trim().toUpperCase();
    if (!/^[A-Z0-9-]{6,40}$/.test(code)) return;
    try { localStorage.setItem(KEY, code); } catch (_) {}
    params.delete('gift');
    history.replaceState(history.state, '', location.pathname + (params.toString() ? '?' + params : '') + location.hash);
    const toast = () => typeof showToast === 'function' && showToast(T('🎁 Your gift card is saved. It applies at checkout.', '🎁 כרטיס המתנה נשמר. הוא יופעל בקופה.'));
    typeof whenLanguageSet === 'function' ? whenLanguageSet(toast) : setTimeout(toast, 1200);
  }
  function applySavedGift() {
    let code = null;
    try { code = localStorage.getItem(KEY); } catch (_) {}
    const input = $('coRedeemCode');
    if (!code || !input || input.value.trim() || (typeof appliedRedeem !== 'undefined' && appliedRedeem)) return;
    if (cart.some((i) => i.is_subscription)) return;
    input.value = code;
    Promise.resolve(applyRedeemCode()).then(() => {
      if (typeof appliedRedeem !== 'undefined' && appliedRedeem?.kind === 'gift_card') { try { localStorage.removeItem(KEY); } catch (_) {} }
    });
  }

  // ── Shop categories: one more entry that opens the Gift Cards page ──
  function shopEntry() {
    const f = $('catFilter');
    if (!f || f.querySelector('.fb-gift')) return;
    f.insertAdjacentHTML('beforeend', `<button class="filter-btn fb-gift" onclick="showPage('giftcards')"><span class="fb-ico" aria-hidden="true">🎁</span><span>${T('Gift Cards', 'כרטיסי מתנה')}</span></button>`);
  }

  function wrap(name, after) {
    const orig = window[name];
    if (typeof orig !== 'function') return;
    window[name] = function () { const r = orig.apply(this, arguments); try { after.apply(this, arguments); } catch (e) { console.error(e); } return r; };
  }
  function hook() {
    wrap('renderShop', shopEntry);
    wrap('showCheckoutResultUI', decorateResult);
    wrap('openCheckout', () => setTimeout(applySavedGift, 700));
    wrap('applyTranslations', () => { render(); $('catFilter')?.querySelector('.fb-gift')?.remove(); shopEntry(); });
    wrap('updateUserUI', render);
    arriveWithGift();
    render();
    shopEntry();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', hook);
  else hook();
})();
