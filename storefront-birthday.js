/* Birthdays: an optional day + month at checkout and in My Account, for a 5% code in the customer's
   birthday month (sent by the daily birthday-codes job). Saved with proof: the login, the order, or the
   invite email's link. */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const he = () => typeof lang !== 'undefined' && lang === 'he';
  const T = (en, hebrew) => (he() ? hebrew : en);
  const KEY = 'gremier_birthday';
  const get = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (_) { return null; } };
  const put = (v) => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (_) {} };
  const MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const MONTHS_HE = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
  async function engage(body) {
    const { data: { session } } = typeof getSessionSafe === 'function' ? await getSessionSafe() : { data: {} };
    const res = await fetch(`${SUPABASE_URL}/functions/v1/engage`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + (session?.access_token || SUPABASE_ANON_KEY) }, body: JSON.stringify(body) });
    return res.ok ? res.json() : null;
  }
  const selects = (prefix, b) => `<select class="form-input" id="${prefix}Day" aria-label="${T('Day', 'יום')}"><option value="">${T('Day', 'יום')}</option>${Array.from({ length: 31 }, (_, i) => `<option ${b?.d === i + 1 ? 'selected' : ''}>${i + 1}</option>`).join('')}</select>
    <select class="form-input" id="${prefix}Month" aria-label="${T('Month', 'חודש')}"><option value="">${T('Month', 'חודש')}</option>${(he() ? MONTHS_HE : MONTHS_EN).map((m, i) => `<option value="${i + 1}" ${b?.m === i + 1 ? 'selected' : ''}>${m}</option>`).join('')}</select>`;
  const read = (prefix) => { const d = Number($(prefix + 'Day')?.value) || null, m = Number($(prefix + 'Month')?.value); return m ? { d, m } : null; };   // the day is optional

  // Checkout: under the email, optional.
  function placeCheckout() {
    const email = $('coEmail');
    if (!email) return;
    $('coBirthday')?.remove();
    const row = document.createElement('div');
    row.className = 'form-group bday-row'; row.id = 'coBirthday';
    row.innerHTML = `<label class="form-label">${T('Birthday', 'יום הולדת')} <span class="bday-opt">${T('optional · 5% off in your birthday month 🎂', 'לא חובה · 5% הנחה בחודש יום ההולדת 🎂')}</span></label><div class="bday-selects">${selects('coBday', get())}</div>`;
    (email.closest('.form-group') || email).after(row);
    row.addEventListener('change', () => { const b = read('coBday'); if (b) put({ ...b, pending: true }); });
  }
  // After paying: save it against the order (once).
  async function afterPaid() {
    const b = get(), orderId = (() => { try { return localStorage.getItem('gremier_last_order_id'); } catch (_) { return null; } })();
    if (!b?.pending || !orderId || b.order === orderId) return;
    const r = await engage({ action: 'birthday_save', order_id: orderId, month: b.m, day: b.d, lang: he() ? 'he' : 'en' });
    if (r?.ok) put({ d: b.d, m: b.m, order: orderId });
  }
  // My Account: see and change it.
  async function placeAccount() {
    const anchor = document.querySelector('#accountSignedIn .account-profile-card');
    if (!anchor || $('acctBirthday')) return;
    // Only for a signed-in customer (the page keeps the account card hidden, not removed, when signed out).
    const { data: { session } } = typeof getSessionSafe === 'function' ? await getSessionSafe() : { data: {} };
    if (!session?.access_token || $('acctBirthday')) return;
    const el = document.createElement('div');
    el.id = 'acctBirthday'; el.className = 'bday-account';
    anchor.insertAdjacentElement('afterend', el);
    const saved = await engage({ action: 'birthday_get' }).catch(() => null);
    const b = saved?.birthday ? { d: saved.birthday.day, m: saved.birthday.month } : get();
    el.innerHTML = `<div><b>🎂 ${T('Your birthday', 'יום ההולדת שלכם')}</b><small>${T('We’ll email you 5% off in your birthday month.', 'נשלח לכם 5% הנחה במייל בחודש יום ההולדת.')}</small></div>
      <div class="bday-selects">${selects('acBday', b)}<button type="button" class="btn btn-outline btn-sm" id="acBdaySave">${T('Save', 'שמירה')}</button></div><span class="bday-status" id="acBdayStatus" role="status"></span>`;
    $('acBdaySave').onclick = async () => {
      const v = read('acBday');
      if (!v) { $('acBdayStatus').textContent = T('Choose your birthday month.', 'בחרו את חודש יום ההולדת.'); return; }
      const r = await engage({ action: 'birthday_save', month: v.m, day: v.d, lang: he() ? 'he' : 'en' });
      $('acBdayStatus').textContent = r?.ok ? T('Saved ✓', 'נשמר ✓') : T('Couldn’t save. Try again.', 'לא נשמר. נסו שוב.');
      if (r?.ok) put(v);
    };
  }
  // From the birthday invite email: ?bday=<month>&inv=<invite id>. Save the month straight away,
  // then say thanks and offer to add the day (optional).
  async function fromInvite() {
    const q = new URLSearchParams(location.search), m = Number(q.get('bday')), inv = q.get('inv') || '';
    if (!(m >= 1 && m <= 12) || !/^[0-9a-f-]{36}$/i.test(inv)) return;
    const want = q.get('l');
    ['bday', 'inv', 'l'].forEach((k) => q.delete(k));
    history.replaceState(null, '', location.pathname + (q.toString() ? '?' + q : '') + location.hash);
    if ((want === 'he' || want === 'en') && typeof lang !== 'undefined' && lang !== want && typeof window.toggleLang === 'function') window.toggleLang();
    const r = await engage({ action: 'birthday_save', invite: inv, month: m, keep_day: true, lang: he() ? 'he' : 'en' }).catch(() => null);
    const month = (he() ? MONTHS_HE : MONTHS_EN)[m - 1];
    const now = new Date().getMonth() + 1;
    const wrap = document.createElement('div');
    wrap.className = 'bday-invite'; wrap.setAttribute('role', 'dialog'); wrap.setAttribute('aria-modal', 'true');
    wrap.innerHTML = r?.ok
      ? `<div class="bday-card"><button type="button" class="bday-x" aria-label="${T('Close', 'סגירה')}">×</button>
          <div class="bday-big">🎁</div><h3>${T('Your gift is set!', 'המתנה שמורה!')}</h3>
          <p>${m === now ? T('Your birthday is this month! Your 5% code is on its way to your email within a day.', 'יום ההולדת שלכם החודש! קוד ה-5% יגיע אליכם במייל תוך יום.')
            : T(`We’ll email you 5% off at the start of ${month}, good all month.`, `נשלח לכם 5% הנחה במייל בתחילת ${month}, בתוקף כל החודש.`)}</p>
          <div class="bday-day"><label>${T('Want to add the day too? (optional)', 'רוצים להוסיף גם את היום? (לא חובה)')}</label>
            <div class="bday-selects"><select class="form-input" id="invDay"><option value="">${T('Day', 'יום')}</option>${Array.from({ length: [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1] }, (_, i) => `<option ${r.day === i + 1 ? 'selected' : ''}>${i + 1}</option>`).join('')}</select><span>${month}</span></div>
            <span class="bday-status" id="invStatus" role="status"></span></div>
          <button type="button" class="btn btn-primary bday-shop">${T('Browse the shop', 'לחנות')}</button></div>`
      : `<div class="bday-card"><button type="button" class="bday-x" aria-label="${T('Close', 'סגירה')}">×</button>
          <div class="bday-big">🎂</div><h3>${T('That link didn’t work', 'הקישור לא עבד')}</h3>
          <p>${T('You can add your birthday in My Account, or at checkout.', 'אפשר להוסיף את יום ההולדת בחשבון שלי, או בקופה.')}</p>
          <button type="button" class="btn btn-primary bday-shop">${T('Browse the shop', 'לחנות')}</button></div>`;
    document.body.appendChild(wrap);
    const close = () => wrap.remove();
    wrap.addEventListener('click', (e) => { if (e.target === wrap || e.target.closest('.bday-x')) close(); });
    wrap.querySelector('.bday-shop').onclick = () => { close(); const s = document.getElementById('shop'); if (s) s.scrollIntoView({ behavior: 'smooth' }); };
    if (r?.ok) put({ d: r.day || null, m });
    $('invDay')?.addEventListener('change', async (e) => {
      const d = Number(e.target.value); if (!d) return;
      const s = await engage({ action: 'birthday_save', invite: inv, month: m, day: d, lang: he() ? 'he' : 'en' }).catch(() => null);
      $('invStatus').textContent = s?.ok ? T('Saved ✓', 'נשמר ✓') : T('Couldn’t save. Try again.', 'לא נשמר. נסו שוב.');
      if (s?.ok) put({ d, m });
    });
  }
  function hook() {
    if (document.readyState === 'complete') setTimeout(fromInvite, 700); else window.addEventListener('load', () => setTimeout(fromInvite, 700));
    const wrap = (fn, after) => { const orig = window[fn]; if (typeof orig === 'function') window[fn] = function () { const r = orig.apply(this, arguments); try { after(...arguments); } catch (_) {} return r; }; };
    wrap('openCheckoutUI', (view) => { if (view === undefined || view === 'form') setTimeout(placeCheckout, 60); });
    wrap('showCheckoutResultUI', (kind) => { if (!kind || kind === 'paid') afterPaid(); });
    const tryAccount = () => setTimeout(placeAccount, 300);
    wrap('showPage', (p) => { if (p === 'myorders' || p === 'account') tryAccount(); });
    wrap('updateAccountPage', tryAccount);
    if (typeof sb !== 'undefined') sb.auth.onAuthStateChange?.(() => { $('acctBirthday')?.remove(); tryAccount(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', hook); else hook();
})();
