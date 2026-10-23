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
    setTimeout(() => toast(T('🎁 Your friend gave you ₪20 off your first order — added at checkout', '🎁 קיבלת מחבר/ה ₪20 הנחה להזמנה הראשונה — נוסף בקופה')), 1800);
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
    const text = T(`I love Gremier cold brew ☕ Here's ₪20 off your first order: ${link}`, `אני מת/ה על הקולד ברו של גרמייר ☕ הנה ₪20 הנחה להזמנה הראשונה שלך: ${link}`);
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
    const email = (typeof currentUser !== 'undefined' && currentUser?.email) || (get('gremier_checkout_details_v1') || {}).email;
    placeShareCard(view.querySelector('.confirm-sub'), email, 'refSuccess');
  }

  // ── Feedback: one click from the email (/?fb=<order>.<token>&r=1..5), or the card on a later visit ──
  function feedbackSheet(orderId, t, rating, refLink) {
    $('fbSheet')?.remove();
    const el = document.createElement('div');
    el.id = 'fbSheet';
    el.innerHTML = `<div class="fb-box" role="dialog" aria-modal="true">
      <button type="button" class="fb-x" aria-label="${T('Close', 'סגירה')}">×</button>
      <div class="fb-big">${['', '😞', '😕', '😐', '🙂', '😍'][rating]}</div>
      <h3>${T('Thank you so much!', 'תודה רבה!')}</h3>
      <p>${T('Anything you’d like to tell us? What did you like in your coffee?', 'רוצים לספר לנו עוד? מה אהבתם בקפה?')}</p>
      <textarea class="form-input" rows="3" maxlength="2000" placeholder="${T('Optional', 'לא חובה')}"></textarea>
      <button type="button" class="fb-send">${T('Send', 'שליחה')}</button>
      <div class="fb-ref"></div>
    </div>`;
    document.body.appendChild(el);
    const close = () => el.remove();
    el.addEventListener('click', (e) => { if (e.target === el || e.target.closest('.fb-x')) close(); });
    el.querySelector('.fb-send').addEventListener('click', async () => {
      const comment = el.querySelector('textarea').value.trim();
      if (comment) await engage({ action: 'feedback', order_id: orderId, t, rating, comment });
      el.querySelector('.fb-box').innerHTML = `<div class="fb-big">💛</div><h3>${T('Thanks — it really helps us', 'תודה — זה באמת עוזר לנו')}</h3><div class="fb-ref"></div><button type="button" class="fb-send">${T('Close', 'סגירה')}</button>`;
      el.querySelector('.fb-send').addEventListener('click', close);
      if (refLink) fillRef(el, refLink);
    });
    if (refLink) fillRef(el, refLink);
  }
  function fillRef(el, refLink) {
    const code = (refLink.match(/REF-[A-Z0-9]+/) || [''])[0];
    el.querySelector('.fb-ref').innerHTML = `<div class="ref-card" data-code="${esc(code)}" data-link="${esc(refLink)}">
      <div class="ref-text"><b>${T('Know someone who’d love it?', 'מכירים מישהו שיאהב?')}</b><span>${T('Give them ₪20 off — you get ₪20 when they order.', 'תנו להם ₪20 הנחה — ותקבלו ₪20 כשהם מזמינים.')}</span></div>
      <div class="ref-actions"><button type="button" data-ref="share">${T('Share', 'שיתוף')}</button><button type="button" data-ref="copy">${T('Copy link', 'העתקת קישור')}</button></div></div>`;
  }
  async function rate(orderId, t, rating, source) {
    const r = await engage({ action: 'feedback', order_id: orderId, t, rating, source });
    if (r.ok) feedbackSheet(orderId, t, rating, r.ref_link);
    else toast(T('That link didn’t work — thank you anyway!', 'הקישור לא עבד — תודה בכל זאת!'));
  }
  function arriveFromFeedbackEmail() {
    const p = new URLSearchParams(location.search);
    const fb = p.get('fb'), r = Number(p.get('r'));
    if (!fb || !(r >= 1 && r <= 5)) return;
    stripParams('fb', 'r');
    const [orderId, t] = fb.split('.');
    put('gremier_fb_done:' + orderId, 1);
    rate(orderId, t, r, 'email');
  }

  // Next visit: one small card, once per delivered order, only if the email wasn't answered.
  async function feedbackCard() {
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
    const card = document.createElement('div');
    card.id = 'fbCard';
    card.innerHTML = `<span>${T('How was your coffee?', 'איך היה הקפה?')}</span>
      <div class="fb-faces">${[5, 4, 3, 2, 1].map((n) => `<button type="button" data-r="${n}" aria-label="${n}/5">${['', '😞', '😕', '😐', '🙂', '😍'][n]}</button>`).join('')}</div>
      <button type="button" class="fb-x" aria-label="${T('Close', 'סגירה')}">×</button>`;
    card.addEventListener('click', (e) => {
      const b = e.target.closest('[data-r]');
      if (b) { card.remove(); rate(o.order_id, o.t, Number(b.dataset.r), 'site'); }
      else if (e.target.closest('.fb-x')) card.remove();
    });
    document.body.appendChild(card);
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
    wrap('openCheckout', () => setTimeout(applyReferralAtCheckout, 500));
    wrap('updateAccountPage', accountCard);
    wrap('showCheckoutResultUI', successCard);
    wrap('applyTranslations', () => { $('refAccount')?.remove(); $('refSuccess')?.remove(); accountCard(); });
    arriveFromReferral();
    arriveFromFeedbackEmail();
    setTimeout(feedbackCard, 4000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', hook);
  else hook();
})();
