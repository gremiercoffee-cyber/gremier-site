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
  function card(s) {
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
        ${s.can_pause ? `<label class="subm-pause">${T('Pause for', 'השהיה ל-')}<select class="form-input" data-months>${Array.from({ length: max }, (_, i) => `<option value="${i + 1}">${i + 1} ${i ? T('months', 'חודשים') : T('month', 'חודש')}</option>`).join('')}</select></label><button type="button" class="btn btn-outline btn-sm" data-act="pause">${T('Pause', 'השהיה')}</button>` : ''}
        ${s.can_resume ? `<button type="button" class="btn btn-primary btn-sm" data-act="resume">${T('Resume now', 'חידוש עכשיו')}</button>` : ''}
        ${s.can_cancel ? `<button type="button" class="subm-cancel" data-act="cancel">${T('Cancel subscription', 'ביטול המנוי')}</button>` : ''}
      </div><div class="subm-status" role="status"></div></div>`;
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
  async function act(b) {
    const el = b.closest('[data-sub]'), id = el.dataset.sub, what = b.dataset.act, out = el.querySelector('.subm-status');
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
