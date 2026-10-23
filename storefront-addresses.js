/* My Addresses: saved delivery addresses (signed in: on the account, guests: this device).
   Checkout gets a "Ship to" picker and offers to save a new address; the cart's one-tap
   box can switch between them; the account page lists, edits and removes them. */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const he = () => typeof lang !== 'undefined' && lang === 'he';
  const T = (en, hebrew) => (he() ? hebrew : en);
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const get = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (_) { return null; } };
  const put = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} };
  const LOCAL = 'gremier_addresses_v1';
  const CK = 'gremier_checkout_details_v1';   // the details checkout and the one-tap box use
  const MAX = 10;
  const user = () => (typeof currentUser !== 'undefined' && currentUser) || null;
  const client = () => (typeof sb !== 'undefined' ? sb : null);
  const localKey = () => LOCAL + (user() ? ':' + user().id : '');

  let list = [];
  let loadedFor = null;

  // ── Address helpers ──
  const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const cityKey = (c) => (c ? norm(c.code || c.en || c.he) : '');
  const cityName = (c) => (c ? (he() ? (c.he || c.en) : (c.en || c.he)) : '');
  const complete = (a) => !!(a && norm(a.addr) && a.city && (a.aptNA || (norm(a.apt) && norm(a.floor))));
  const same = (a, b) => norm(a.addr) === norm(b.addr) && cityKey(a.city) === cityKey(b.city) && !!a.aptNA === !!b.aptNA
    && (a.aptNA || (norm(a.apt) === norm(b.apt) && norm(a.floor) === norm(b.floor)));
  const line = (a) => `${a.addr}${a.aptNA ? '' : `, ${T('Apt', 'דירה')} ${a.apt}, ${T('Floor', 'קומה')} ${a.floor}`}, ${cityName(a.city)}`;
  // "Home · Ramban 30, …"; when the name is just the street, the address alone.
  const optionText = (a) => (norm(a.label) && !norm(a.addr).startsWith(norm(a.label)) ? `${a.label} · ${line(a)}` : line(a));
  const s = (v, n) => String(v ?? '').trim().slice(0, n);
  function clean(a) {
    const c = a.city || {};
    return {
      id: a.id || (Date.now().toString(36) + Math.random().toString(36).slice(2, 7)),
      label: s(a.label, 30) || s(a.addr, 30),
      addr: s(a.addr, 120), apt: a.aptNA ? '' : s(a.apt, 10), floor: a.aptNA ? '' : s(a.floor, 10), aptNA: !!a.aptNA,
      city: { en: s(c.en, 60), he: s(c.he, 60), code: c.code != null ? String(c.code).slice(0, 10) : null, region: c.region ? s(c.region, 40) : null },
    };
  }
  function nextLabel(a) {
    if (!list.length) return T('Home', 'בית');
    return s(a.addr, 30);
  }

  // ── Storage ──
  async function load(force) {
    const key = user() ? user().id : 'guest';
    if (loadedFor === key && !force) return list;
    loadedFor = key;
    list = get(localKey()) || [];
    const u = user(), db = client();
    if (u && db) {
      try {
        const { data } = await db.from('profiles').select('saved_addresses').eq('id', u.id).maybeSingle();
        const remote = Array.isArray(data?.saved_addresses) ? data.saved_addresses : [];
        if (remote.length) list = remote;
        else {
          // First sign-in on this device: bring along addresses saved as a guest.
          const guest = get(LOCAL) || [];
          if (!list.length && guest.length) list = guest;
          if (list.length) persist();
        }
        put(localKey(), list);
      } catch (_) {}
    }
    // Customers from before this feature: the address they already use becomes their first one.
    if (!list.length) {
      const d = get(CK);
      if (complete(d)) { list = [clean({ ...d, label: T('Home', 'בית') })]; persist(); }
    }
    changed();
    return list;
  }
  function persist() {
    put(localKey(), list);
    const u = user(), db = client();
    if (u && db) db.from('profiles').update({ saved_addresses: list }).eq('id', u.id).then(() => {}, () => {});
  }
  function add(a) {
    if (!complete(a) || list.some((x) => same(x, a))) return;
    list = [clean({ ...a, label: a.label || nextLabel(a) }), ...list].slice(0, MAX);
    persist(); changed();
  }
  function changed() {
    try { decorate(); } catch (_) {}
    try { decorateExpress(); } catch (_) {}
    try { renderAccount(); } catch (_) {}
  }

  // ── Checkout form ──
  const val = (id) => ($(id)?.value || '').trim();
  function formAddress() {
    return { addr: val('coAddr'), apt: val('coApt'), floor: val('coFloor'), aptNA: !!$('coAptNA')?.checked,
      city: (typeof selectedCheckoutCity !== 'undefined' && selectedCheckoutCity) || null };
  }
  function fillForm(a) {
    if ($('coAddr')) $('coAddr').value = a ? a.addr : '';
    if ($('coApt')) $('coApt').value = a ? a.apt : '';
    if ($('coFloor')) $('coFloor').value = a ? a.floor : '';
    const na = $('coAptNA');
    if (na && na.checked !== !!(a && a.aptNA)) { na.checked = !!(a && a.aptNA); if (typeof toggleAptNA === 'function') toggleAptNA(); }
    if (a && a.city && typeof selectCheckoutCity === 'function') selectCheckoutCity(a.city);
    else if (!a) {
      try { selectedCheckoutCity = null; } catch (_) {}
      if ($('coCityInput')) $('coCityInput').value = '';
      if (typeof updateDeliveryPrice === 'function') updateDeliveryPrice();
    }
  }
  function pickerHtml(id, current) {
    const match = current ? list.find((x) => same(x, current)) : null;
    return `<select class="form-input co-addr-select" id="${id}" aria-label="${T('Ship to', 'משלוח אל')}">
      ${list.map((a) => `<option value="${esc(a.id)}" ${match && match.id === a.id ? 'selected' : ''}>${esc(optionText(a))}</option>`).join('')}
      <option value="new" ${match ? '' : 'selected'}>${T('+ New address', '+ כתובת חדשה')}</option>
    </select>`;
  }
  function onPick(value) {
    if (value === 'new') {
      fillForm(null);
      window.GremierCheckout?.edit();
    } else {
      const a = list.find((x) => x.id === value);
      if (a) fillForm(a);
      window.GremierCheckout?.render();
    }
    refreshSavePrompt();
  }
  function decorate() {
    const view = $('checkoutFormView');
    if (!view) return;
    const address = view.querySelector('.co-address');
    // "Ship to" in the address section
    if (address) {
      let pick = $('coAddrPick');
      if (!list.length) pick?.remove();
      else {
        if (!pick) {
          pick = document.createElement('div');
          pick.id = 'coAddrPick'; pick.className = 'co-addr-pick';
          address.querySelector('.co-sec-title')?.after(pick);
          pick.addEventListener('change', (e) => { if (e.target.id === 'coAddrSelect') onPick(e.target.value); });
        }
        pick.innerHTML = pickerHtml('coAddrSelect', formAddress());
      }
      // Offer to save a new address
      let row = $('coSaveAddrRow');
      if (!row) {
        row = document.createElement('label');
        row.id = 'coSaveAddrRow'; row.className = 'co-save-addr';
        row.innerHTML = `<input type="checkbox" id="coSaveAddr" checked><span></span>`;
        address.append(row);
      }
      row.querySelector('span').textContent = T('Save this address to My Addresses', 'לשמור את הכתובת ב"הכתובות שלי"');
    }
    // Compact "Deliver to" card: switch addresses without opening the form
    const card = $('coSavedCard');
    if (card && card.innerHTML && list.length >= 2 && !$('coSavedPick') && !$('shipPickup')?.checked) {
      const wrap = document.createElement('div');
      wrap.id = 'coSavedPick'; wrap.className = 'co-addr-pick co-addr-pick-compact';
      wrap.innerHTML = pickerHtml('coSavedSelect', formAddress());
      wrap.addEventListener('change', (e) => onPick(e.target.value));
      card.append(wrap);
    }
    refreshSavePrompt();
  }
  function refreshSavePrompt() {
    const row = $('coSaveAddrRow');
    if (!row) return;
    const a = formAddress();
    const show = !$('shipPickup')?.checked && complete(a) && !list.some((x) => same(x, a)) && list.length < MAX;
    row.style.display = show ? '' : 'none';
    // Keep the picker in step with what's typed.
    const sel = $('coAddrSelect');
    if (sel) { const m = list.find((x) => same(x, a)); sel.value = m ? m.id : 'new'; }
  }
  document.addEventListener('input', (e) => { if (/^co(Addr|Apt|Floor)$/.test(e.target?.id || '')) refreshSavePrompt(); });
  document.addEventListener('change', (e) => { if (e.target?.id === 'coAptNA' || e.target?.name === 'shipType') refreshSavePrompt(); });

  // ── Cart one-tap box: choose which saved address ──
  function decorateExpress() {
    const box = $('expressBox');
    if (!box || list.length < 2 || box.querySelector('.ex-addr-select')) return;
    const d = get(CK) || {};
    const sel = document.createElement('select');
    sel.className = 'ex-addr-select';
    sel.setAttribute('aria-label', T('Ship to', 'משלוח אל'));
    const match = list.find((x) => same(x, d));
    sel.innerHTML = list.map((a) => `<option value="${esc(a.id)}" ${match && match.id === a.id ? 'selected' : ''}>${esc(optionText(a))}</option>`).join('')
      + (match ? '' : `<option value="" selected>${esc(line(d))}</option>`);
    sel.addEventListener('change', () => {
      const a = list.find((x) => x.id === sel.value);
      if (!a) return;
      put(CK, { ...d, addr: a.addr, apt: a.apt, floor: a.floor, aptNA: a.aptNA, city: a.city });
      if (typeof renderCartDrawer === 'function') renderCartDrawer();
    });
    box.querySelector('.ex-addr')?.after(sel);
  }

  // ── Account: My Addresses ──
  let editing = null;   // address id being edited, or 'new'
  function renderAccount() {
    const anchor = $('t-acc-orders-title');
    if (!anchor || !user()) { $('accAddresses')?.remove(); return; }
    let sec = $('accAddresses');
    if (!sec) {
      sec = document.createElement('section');
      sec.id = 'accAddresses'; sec.className = 'acc-addresses';
      anchor.before(sec);
      sec.addEventListener('click', onAccountClick);
      sec.addEventListener('input', onCityInput);
    }
    const form = (a) => `
      <form class="addr-form" data-id="${esc(a ? a.id : 'new')}" onsubmit="return false">
        <label>${T('Name for this address', 'שם לכתובת')}<input class="form-input" name="label" maxlength="30" value="${esc(a ? a.label : '')}" placeholder="${T('Home, Work, Parents…', 'בית, עבודה, הורים…')}"></label>
        <label class="addr-city">${T('City', 'עיר')}<input class="form-input" name="city" autocomplete="off" value="${esc(a ? cityName(a.city) : '')}" data-city='${esc(JSON.stringify(a ? a.city : null))}' placeholder="${T('Start typing…', 'התחילו להקליד…')}"><ul class="addr-city-list" hidden></ul></label>
        <label>${T('Street and number', 'רחוב ומספר')}<input class="form-input" name="addr" maxlength="120" value="${esc(a ? a.addr : '')}"></label>
        <div class="addr-row"><label>${T('Apartment', 'דירה')}<input class="form-input" name="apt" maxlength="10" value="${esc(a ? a.apt : '')}"></label>
          <label>${T('Floor', 'קומה')}<input class="form-input" name="floor" maxlength="10" value="${esc(a ? a.floor : '')}"></label></div>
        <label class="addr-na"><input type="checkbox" name="aptNA" ${a && a.aptNA ? 'checked' : ''}> ${T('Private house (no apartment)', 'בית פרטי (ללא דירה)')}</label>
        <p class="addr-err" hidden></p>
        <div class="addr-actions"><button type="button" class="addr-btn primary" data-act="save">${T('Save', 'שמירה')}</button><button type="button" class="addr-btn" data-act="cancel">${T('Cancel', 'ביטול')}</button></div>
      </form>`;
    sec.innerHTML = `
      <div class="account-section-title">${T('My Addresses', 'הכתובות שלי')}</div>
      <div class="addr-list">
        ${list.map((a) => editing === a.id ? form(a) : `
          <div class="addr-card"><div class="addr-text"><b>${esc(a.label)}</b><span>${esc(line(a))}</span></div>
            <div class="addr-card-actions"><button type="button" class="addr-btn" data-act="edit" data-id="${esc(a.id)}">${T('Edit', 'עריכה')}</button>
            <button type="button" class="addr-btn danger" data-act="remove" data-id="${esc(a.id)}">${T('Remove', 'הסרה')}</button></div></div>`).join('')}
        ${!list.length && editing !== 'new' ? `<p class="addr-empty">${T('No saved addresses yet. Add one here, or save it when you check out.', 'עדיין אין כתובות שמורות. אפשר להוסיף כאן, או לשמור בקופה.')}</p>` : ''}
        ${editing === 'new' ? form(null) : (list.length < MAX ? `<button type="button" class="addr-add" data-act="add">${T('+ Add address', '+ הוספת כתובת')}</button>` : '')}
      </div>`;
  }
  function onAccountClick(e) {
    const btn = e.target.closest('[data-act]');
    const pick = e.target.closest('.addr-city-list li');
    if (pick) {
      const input = pick.closest('.addr-city').querySelector('input');
      const city = JSON.parse(pick.dataset.city);
      input.value = cityName(city); input.dataset.city = JSON.stringify(city);
      pick.parentElement.hidden = true;
      return;
    }
    if (!btn) return;
    const act = btn.dataset.act, id = btn.dataset.id;
    if (act === 'add') { editing = 'new'; renderAccount(); return; }
    if (act === 'edit') { editing = id; renderAccount(); return; }
    if (act === 'cancel') { editing = null; renderAccount(); return; }
    if (act === 'remove') {
      if (btn.dataset.sure !== '1') { btn.dataset.sure = '1'; btn.textContent = T('Remove?', 'להסיר?'); return; }
      list = list.filter((a) => a.id !== id); persist(); changed(); return;
    }
    if (act === 'save') {
      const f = btn.closest('form');
      const v = (n) => f.elements[n].value.trim();
      let city = null;
      try { city = JSON.parse(f.elements.city.dataset.city || 'null'); } catch (_) {}
      if (city && norm(cityName(city)) !== norm(v('city'))) city = null;   // typed over the chosen city
      const a = { id: f.dataset.id === 'new' ? undefined : f.dataset.id, label: v('label'), addr: v('addr'), apt: v('apt'), floor: v('floor'), aptNA: f.elements.aptNA.checked, city };
      const err = f.querySelector('.addr-err');
      const problem = !city ? T('Choose the city from the list.', 'בחרו עיר מהרשימה.')
        : !a.addr ? T('Enter the street and number.', 'הזינו רחוב ומספר.')
        : (!a.aptNA && (!a.apt || !a.floor)) ? T('Enter apartment and floor, or tick private house.', 'הזינו דירה וקומה, או סמנו בית פרטי.') : '';
      if (problem) { err.textContent = problem; err.hidden = false; return; }
      if (f.dataset.id === 'new') list = [clean({ ...a, label: a.label || nextLabel(a) }), ...list].slice(0, MAX);
      else list = list.map((x) => (x.id === f.dataset.id ? clean(a) : x));
      editing = null; persist(); changed();
    }
  }
  async function onCityInput(e) {
    if (e.target.name !== 'city') return;
    const ul = e.target.parentElement.querySelector('.addr-city-list');
    if (typeof loadIsraelCities === 'function') await loadIsraelCities();
    const found = typeof filterIsraelCities === 'function' ? filterIsraelCities(e.target.value).slice(0, 8) : [];
    ul.innerHTML = found.map((c) => `<li data-city='${esc(JSON.stringify(c))}'>${esc(cityName(c))}</li>`).join('');
    ul.hidden = !found.length;
  }

  // ── Hooks ──
  function hook() {
    const wrap = (name, after, before) => {
      const orig = window[name];
      if (typeof orig !== 'function') return;
      window[name] = function () {
        if (before) before.apply(this, arguments);
        const r = orig.apply(this, arguments);
        if (r && typeof r.then === 'function') return r.then((v) => { try { after(); } catch (_) {} return v; });
        try { after(); } catch (_) {}
        return r;
      };
    };
    wrap('openCheckout', () => { load().then(decorate); });
    wrap('renderCartDrawer', decorateExpress);
    wrap('selectCheckoutCity', refreshSavePrompt);
    wrap('updateAccountPage', () => { load().then(renderAccount); });
    wrap('applyTranslations', changed);
    // Save a new address the customer chose to keep, before heading to payment.
    wrap('submitOrder', () => {}, () => {
      const row = $('coSaveAddrRow');
      if (row && row.style.display !== 'none' && $('coSaveAddr')?.checked) add(formAddress());
    });
    load();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', hook);
  else hook();

  window.GremierAddresses = { load, decorate, list: () => list.slice() };
})();
