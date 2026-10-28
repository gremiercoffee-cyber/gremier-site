/* Referrals ("give ₪20, get ₪20") and "How was it?" feedback on the website.
   Server: supabase/functions/engage (public). */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const he = () => typeof lang !== 'undefined' && lang === 'he';
  const T = (en, hebrew) => (he() ? hebrew : en);
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const get = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (_) { return null; } };
  const put = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} };
  const REF = 'gremier_ref_v1';
  const toast = (m) => { if (typeof showToast === 'function') showToast(m); };
  // The site switches to Hebrew shortly after the page loads; anything we show waits for that.
  const whenLanguageSet = (fn) => {
    const go = () => setTimeout(fn, 500);
    if (document.readyState === 'complete') go(); else window.addEventListener('load', go, { once: true });
  };

  async function engage(body) {
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/engage`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY }, body: JSON.stringify(body),
      });
      return await res.json();
    } catch (_) { return {}; }
  }
  function stripParams(...names) {
    const params = new URLSearchParams(location.search);
    names.forEach((n) => params.delete(n));
    history.replaceState(history.state, '', location.pathname + (params.toString() ? '?' + params : '') + location.hash);
  }

  // ── Arriving from a friend's link: /?ref=REF-XXXXXX ──
  function arriveFromReferral() {
    const code = (new URLSearchParams(location.search).get('ref') || '').trim().toUpperCase();
    if (!/^REF-[A-Z0-9]{4,10}$/.test(code)) return;
    stripParams('ref');
    const before = get(REF);
    put(REF, { code, at: Date.now() });
    if (!before || before.code !== code) engage({ action: 'ref_event', code, kind: 'open' });   // once per browser
    whenLanguageSet(() => toast(T('🎁 Your friend gave you ₪20 off your first order — added at checkout', '🎁 קיבלת מחבר/ה ₪20 הנחה להזמנה הראשונה — נוסף בקופה')));
  }
  function storedRef() {
    const r = get(REF);
    return r && Date.now() - r.at < 60 * 864e5 ? r.code : null;
  }

  // Checkout: put the friend's code in once there's an email to check it against.
  let refTried = false;
  function applyReferralAtCheckout() {
    const code = storedRef();
    const field = $('coRedeemCode'), email = ($('coEmail')?.value || '').trim();
    if (!code || !field || refTried || !email || (typeof appliedRedeem !== 'undefined' && appliedRedeem)) return;
    refTried = true;
    field.value = code;
    if (typeof applyRedeemCode === 'function') {
      Promise.resolve(applyRedeemCode()).then(() => {
        // Not usable (not a first order / their own code): don't keep trying it.
        if (typeof appliedRedeem === 'undefined' || !appliedRedeem) { try { localStorage.removeItem(REF); } catch (_) {} }
        window.GremierCheckout?.render();
      });
    }
  }
  document.addEventListener('change', (e) => { if (e.target?.id === 'coEmail') applyReferralAtCheckout(); });

  // ── "Give ₪20, get ₪20" card ──
  async function shareCardHtml(email) {
    const r = await engage({ action: 'ref_code', email });
    if (!r.link) return '';
    return `<div class="ref-card" data-code="${esc(r.code)}" data-link="${esc(r.link)}">
      <div class="ref-text"><b>${T('Give ₪20, get ₪20', 'נותנים ₪20, מקבלים ₪20')}</b>
        <span>${T('Friends get ₪20 off their first order. When they order, you get ₪20.', 'חברים מקבלים ₪20 הנחה בהזמנה הראשונה. כשהם מזמינים, את/ה מקבל/ת ₪20.')}</span></div>
      <div class="ref-actions"><button type="button" data-ref="share">${T('Share', 'שיתוף')}</button><button type="button" data-ref="copy">${T('Copy link', 'העתקת קישור')}</button></div>
    </div>`;
  }
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('.ref-card [data-ref]');
    if (!b) return;
    const card = b.closest('.ref-card');
    const link = card.dataset.link, code = card.dataset.code;
    const text = T(`I love Gremier cold brew ☕ Here's ₪20 off your first order: ${link}`, `אני מת/ה על הקולד ברו של גרמיר ☕ הנה ₪20 הנחה להזמנה הראשונה שלך: ${link}`);
    if (b.dataset.ref === 'copy') {
      try { await navigator.clipboard.writeText(link); toast(T('Link copied ✓', 'הקישור הועתק ✓')); } catch (_) { prompt('', link); }
      engage({ action: 'ref_event', code, kind: 'share', via: 'copy' });
      return;
    }
    if (navigator.share) {
      try { await navigator.share({ text }); engage({ action: 'ref_event', code, kind: 'share', via: 'share' }); } catch (_) {}
    } else {
      window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
      engage({ action: 'ref_event', code, kind: 'share', via: 'whatsapp' });
    }
  });
  async function placeShareCard(anchor, email, id) {
    if (!anchor || !email || $(id)) return;
    const html = await shareCardHtml(email);
    if (!html || $(id)) return;
    const wrap = document.createElement('div');
    wrap.id = id;
    wrap.innerHTML = html;
    anchor.after(wrap);
  }
  function accountCard() {
    const u = typeof currentUser !== 'undefined' ? currentUser : null;
    if (!u?.email) { $('refAccount')?.remove(); return; }
    placeShareCard(document.querySelector('#accountSignedIn .account-points-card'), u.email, 'refAccount');
  }
  function successCard() {
    const view = $('checkoutConfirmView');
    if (!view || view.style.display === 'none') return;
    const signedIn = typeof currentUser !== 'undefined' && !!currentUser;
    const email = (signedIn && currentUser.email) || (get('gremier_checkout_details_v1') || {}).email;
    if (!signedIn && !$('acctInvite')) {
      // Accounts bring one-tap checkout, saved addresses, points and reorder: invite guests once they've paid.
      view.querySelector('.confirm-sub')?.insertAdjacentHTML('afterend', `<div id="acctInvite" class="acct-invite">
        <div><b>${T('Save your details for next time', 'שמרו את הפרטים לפעם הבאה')}</b>
        <span>${T('One-tap checkout, saved addresses and loyalty points.', 'תשלום בלחיצה, כתובות שמורות ונקודות מועדון.')}</span></div>
        <button type="button" onclick="handleAuthClick()">${T('Continue with Google', 'המשך עם Google')}</button></div>`);
    }
    placeShareCard($('acctInvite') || view.querySelector('.confirm-sub'), email, 'refSuccess');
  }

  // ── Kashrut: a small seal under "Add to cart" and in the footer; tap to see the certificate ──
  const kosherLabel = () => T('Kosher · Rabbi Shmuel Weiner', 'כשר · בהשגחת הרב שמואל ויינער');
  function kosherChip(cls) {
    return `<button type="button" class="kosher-chip ${cls || ''}" onclick="showKashrut()"><img src="/kashrut-sm.png" alt="" width="22" height="22">${kosherLabel()}</button>`;
  }
  window.showKashrut = function () {
    let el = $('kashrutView');
    if (!el) {
      el = document.createElement('div');
      el.id = 'kashrutView'; el.className = 'kashrut-view';
      el.onclick = () => el.classList.remove('open');
      document.body.appendChild(el);
    }
    el.innerHTML = `<div class="kashrut-card" role="dialog" aria-label="${T('Kashrut', 'כשרות')}"><img src="/kashrut.png" alt="${T('Kashrut certificate: Rabbi Shmuel Weiner, Khal Zichron Nosson Tzvi', 'תעודת כשרות: הרב שמואל ויינער, קהל זכרון נתן צבי')}">
      <p>${T('Under the supervision of Rabbi Shmuel Weiner, Rav of Khal Zichron Nosson Tzvi.', 'בהשגחת הרב שמואל ויינער, רב דקהל זכרון נתן צבי.')}</p>
      <button type="button" class="btn btn-outline btn-sm">${T('Close', 'סגירה')}</button></div>`;
    el.classList.add('open');
  };
  function placeFooterKosher() {
    const desc = $('t-ft-desc');
    if (!desc) return;
    $('ftKosher')?.remove();
    desc.insertAdjacentHTML('afterend', `<div id="ftKosher">${kosherChip('on-dark')}</div>`);
  }

  // ── Checkout: the terms they agree to by paying (payment providers ask for this) ──
  function placeTermsNote() {
    const btn = $('t-co-submit');
    if (!btn) return;
    $('coTerms')?.remove();
    btn.insertAdjacentHTML('afterend', `<p id="coTerms" class="co-terms">${T(
      'By continuing to payment you agree to our <a href="/terms.html" target="_blank" rel="noopener">Terms</a> and <a href="/terms.html#returns" target="_blank" rel="noopener">cancellation policy</a>.',
      'במעבר לתשלום אתם מסכימים ל<a href="/terms.html" target="_blank" rel="noopener">תקנון</a> ול<a href="/terms.html#returns" target="_blank" rel="noopener">מדיניות הביטולים</a>.')}</p>`);
  }

  // ── Trust line under "Add to cart" ──
  function trustHtml() {
    // (Delivery times are already in the box above the button.)
    return `<span>🔒 ${T('Secure payment', 'תשלום מאובטח')}: ${T('card', 'כרטיס')} · bit · Apple Pay · Google Pay</span>${kosherChip()}`;
  }
  function placeTrust() {
    const btn = $('pdAddBtn');
    if (!btn) return;
    let row = $('pdTrust');
    if (!row) { row = document.createElement('div'); row.id = 'pdTrust'; row.className = 'trust-row'; (btn.closest('.pd-actions, .pd-footer') || btn.parentElement).after(row); }
    row.innerHTML = trustHtml();
  }

  // ── Funnel steps: anonymous, one random id per browser ──
  function sid() {
    let id = get('gremier_sid');
    if (!/^[a-z0-9]{8,32}$/.test(id || '')) { id = (Math.random().toString(36).slice(2, 12) + Date.now().toString(36)).slice(0, 24); put('gremier_sid', id); }
    return id;
  }
  const track = (kind) => engage({ action: 'track', sid: sid(), kind });

  // ── Feedback: one click from the email (/?fb=<order>.<token>&r=1..5), or the card on a later visit ──
  function fillRef(el, refLink) {
    const code = (refLink.match(/REF-[A-Z0-9]+/) || [''])[0];
    el.querySelector('.fb-ref').innerHTML = `<div class="ref-card" data-code="${esc(code)}" data-link="${esc(refLink)}">
      <div class="ref-text"><b>${T('Know someone who’d love it?', 'מכירים מישהו שיאהב?')}</b><span>${T('Give them ₪20 off — you get ₪20 when they order.', 'תנו להם ₪20 הנחה — ותקבלו ₪20 כשהם מזמינים.')}</span></div>
      <div class="ref-actions"><button type="button" data-ref="share">${T('Share', 'שיתוף')}</button><button type="button" data-ref="copy">${T('Copy link', 'העתקת קישור')}</button></div></div>`;
  }
  // Rating and comment are submitted together, only after Send.
  function writeSheet(orderId, t, initialRating = 0, source = 'email') {
    $('fbSheet')?.remove();
    const el = document.createElement('div');
    el.id = 'fbSheet';
    el.innerHTML = `<div class="fb-box" role="dialog" aria-modal="true" aria-labelledby="fbTitle">
      <button type="button" class="fb-x" aria-label="${T('Close', 'סגירה')}">×</button>
      <h3 id="fbTitle">${T('How was your order?', 'איך הייתה ההזמנה?')}</h3>
      <div class="fb-order" aria-live="polite">${T('Loading your order…', 'טוענים את ההזמנה…')}</div>
      <div class="fb-pick" role="group" aria-label="${T('Rating', 'דירוג')}">${[5,4,3,2,1].map(n=>`<button type="button" data-r="${n}" aria-label="${n}/5" aria-pressed="${n===initialRating}" class="${n===initialRating?'on':''}">${['','😞','😕','😐','🙂','😍'][n]}</button>`).join('')}</div>
      <label class="fb-comment-label" for="fbComment">${T('Anything else? (optional)', 'רוצים להוסיף משהו? (לא חובה)')}</label>
      <textarea id="fbComment" class="form-input" rows="3" maxlength="2000" placeholder="${T('Tell us what you thought', 'ספרו לנו מה דעתכם')}"></textarea>
      <p class="fb-hint" role="alert" hidden></p>
      <button type="button" class="fb-send">${T('Send feedback', 'שליחת משוב')}</button>
    </div>`;
    document.body.appendChild(el);
    let rating = initialRating, submitting = false;
    const close = () => el.remove();
    engage({action:'feedback_context', order_id:orderId, t}).then(r=>{
      const box=el.querySelector('.fb-order');if(!box)return;
      if(!r.ok){box.textContent=T('Your order details could not be loaded.', 'לא הצלחנו לטעון את פרטי ההזמנה.');return;}
      box.innerHTML=`<b>${T('Order', 'הזמנה')} #${esc(r.order_number)}</b><ul>${(r.items||[]).map(i=>`<li>${esc(he()?(i.name_he||i.name_en):(i.name_en||i.name_he))} ×${esc(i.qty)}</li>`).join('')}</ul>`;
    });
    el.addEventListener('click', async e=>{
      if(e.target===el||e.target.closest('.fb-x'))return close();
      if(submitting)return;
      const face=e.target.closest('.fb-pick [data-r]');
      if(face){rating=Number(face.dataset.r);el.querySelectorAll('.fb-pick button').forEach(b=>{b.classList.toggle('on',b===face);b.setAttribute('aria-pressed',String(b===face));});el.querySelector('.fb-hint').hidden=true;return;}
      const send=e.target.closest('.fb-send');if(!send||send.classList.contains('fb-done'))return;
      const hint=el.querySelector('.fb-hint');
      if(!rating){hint.textContent=T('Choose a rating first.', 'בחרו דירוג קודם.');hint.hidden=false;return;}
      submitting=true;send.disabled=true;send.textContent=T('Sending…','שולחים…');hint.hidden=true;
      const comment=el.querySelector('textarea').value.trim();
      const r=await engage({action:'feedback',order_id:orderId,t,rating,comment,source});
      if(!r.ok){submitting=false;send.disabled=false;send.textContent=T('Send feedback','שליחת משוב');hint.textContent=T('Couldn’t send. Please try again—your message is still here.','השליחה נכשלה. נסו שוב — ההודעה נשמרה כאן.');hint.hidden=false;return;}
      put('gremier_fb_done:'+orderId,1);
      el.querySelector('.fb-box').innerHTML=`<div class="fb-big">💛</div><h3>${T('Thanks — it really helps us','תודה — זה באמת עוזר לנו')}</h3><div class="fb-ref"></div><button type="button" class="fb-send fb-done">${T('Close','סגירה')}</button>`;
      el.querySelector('.fb-done').addEventListener('click',close);
      if(r.ref_link)fillRef(el,r.ref_link);
    });
  }
  function arriveFromFeedbackEmail() {
    const p = new URLSearchParams(location.search);
    const fb = p.get('fb'), r = Number(p.get('r'));
    if (!fb || (!(r >= 1 && r <= 5) && p.get('write') !== '1')) return;
    stripParams('fb', 'r', 'write');
    const [orderId, t] = fb.split('.');
    put('gremier_fb_done:' + orderId, 1);
    whenLanguageSet(() => writeSheet(orderId, t, r >= 1 && r <= 5 ? r : 0, 'email'));
  }

  // Next visit: one small card, once per delivered order, only if the email wasn't answered.
  async function feedbackCard() {
    if ($('fbSheet')) return;
    let ids = (get('gremier_order_history_v1') || []).map((o) => o.id);
    const u = typeof currentUser !== 'undefined' ? currentUser : null;
    if (u && typeof sb !== 'undefined') {
      try {
        const { data } = await sb.from('orders').select('id').eq('user_id', u.id).eq('status', 'fulfilled').order('created_at', { ascending: false }).limit(5);
        ids = [...new Set([...(data || []).map((o) => o.id), ...ids])];
      } catch (_) {}
    }
    ids = ids.filter((id) => !get('gremier_fb_done:' + id)).slice(0, 10);
    if (!ids.length) return;
    const { pending } = await engage({ action: 'feedback_pending', order_ids: ids });
    const o = pending && pending[0];
    if (!o || $('fbCard')) return;
    put('gremier_fb_done:' + o.order_id, 1);   // shown once, answered or not
    writeSheet(o.order_id, o.t, 0, 'site');
  }

  function hook() {
    const wrap = (name, after) => {
      const orig = window[name];
      if (typeof orig !== 'function') return;
      window[name] = function () {
        const r = orig.apply(this, arguments);
        if (r && typeof r.then === 'function') return r.then((v) => { try { after(); } catch (_) {} return v; });
        try { after(); } catch (_) {}
        return r;
      };
    };
    wrap('openCheckout', () => { setTimeout(applyReferralAtCheckout, 500); track('checkout_open'); });
    wrap('addToCart', () => track('cart_add'));
    wrap('pdAddToCart', () => track('cart_add'));
    wrap('reorder', () => track('cart_add'));
    const submit = window.submitOrder;
    if (typeof submit === 'function') window.submitOrder = function () { track('pay_click'); return submit.apply(this, arguments); };
    wrap('openProductDrawerUI', placeTrust);
    wrap('updateAccountPage', accountCard);
    wrap('showCheckoutResultUI', successCard);
    wrap('applyTranslations', () => { $('refAccount')?.remove(); $('refSuccess')?.remove(); accountCard(); if ($('pdTrust')) placeTrust(); placeFooterKosher(); placeTermsNote(); });
    placeFooterKosher();
    placeTermsNote();
    arriveFromReferral();
    arriveFromFeedbackEmail();
    whenLanguageSet(() => setTimeout(feedbackCard, 3000));
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', hook);
  else hook();
})();
