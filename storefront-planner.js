/* Coffee Bars page: "Help me choose". A few questions → the right coffee bar with its options
   already set, priced from the live products → "Order this" (opens it pre-filled) or WhatsApp. */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const he = () => typeof lang !== 'undefined' && lang === 'he';
  const T = (en, hebrew) => (he() ? hebrew : en);
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const WA = '972552703413';
  const all = () => (typeof products !== 'undefined' && Array.isArray(products) ? products : []);
  const addonsOf = (p) => (typeof getProductAddons === 'function' ? getProductAddons(p) : []);
  const tiersOf = (p) => {
    const v = (p.variations || []).find((x) => x.type === 'choice' && /guest/i.test(x.name || '')) || (p.variations || []).find((x) => x.type === 'guest_count');
    return (v?.options || []).map((o) => ({ guests: parseInt(o.label, 10), price: Number(o.price) })).filter((t) => t.guests > 0).sort((a, b) => a.guests - b.guests);
  };
  // "Everything included" = the bar with a coffee choice / parve milk; "just the coffee" = the other one.
  const premium = () => all().find((p) => addonsOf(p).some((a) => a.per_liter || a.group)) || all().find((p) => /premium/i.test(p.name_en || ''));
  const basic = () => all().find((p) => typeof isCoffeeBarProduct === 'function' && isCoffeeBarProduct(p) && p !== premium() && tiersOf(p).length);

  const state = { guests: 50, full: true, milk: 'dairy', coffee: '', points: 1, dispenser: false, syrups: 0 };
  const name = (a) => (he() && a.name_he ? a.name_he : a.name);

  function suggestion() {
    const p = state.full ? premium() : basic();
    if (!p) return null;
    const tiers = tiersOf(p);
    const tier = tiers.find((t) => t.guests >= state.guests) || tiers[tiers.length - 1];
    if (!tier) return null;
    const addons = addonsOf(p);
    const lines = [];
    let total = tier.price;
    const plan = { product: p, tier, coffeeIdx: -1, liters: 0, litersIdx: -1, qty: [], checks: [] };
    if (state.full) {
      const coffee = addons.findIndex((a) => a.group && state.coffee && new RegExp(state.coffee, 'i').test(a.name));
      if (coffee >= 0) { plan.coffeeIdx = coffee; total += Number(addons[coffee].price) || 0; lines.push(name(addons[coffee])); }
      const milk = addons.findIndex((a) => a.per_liter);
      const max = Math.floor(tier.guests / 10);
      const liters = state.milk === 'parve' ? max : state.milk === 'half' ? Math.round(max / 2) : 0;
      if (milk >= 0 && liters) { plan.litersIdx = milk; plan.liters = liters; total += liters * (Number(addons[milk].price) || 0); lines.push(T(`${liters}L parve milk`, `${liters} ל׳ חלב פרווה`)); }
      const disp = addons.findIndex((a) => /dispenser/i.test(a.name) && Number(a.max) > 1);
      const extra = Math.min(Math.max(0, state.points - 1), disp >= 0 ? Number(addons[disp].max) : 0);
      if (disp >= 0 && extra) { plan.qty.push([disp, extra]); total += extra * (Number(addons[disp].price) || 0); lines.push(T(`${extra} extra dispenser${extra > 1 ? 's' : ''}`, `${extra} מתקנים נוספים`)); }
    } else {
      const disp = addons.findIndex((a) => /dispenser/i.test(a.name));
      if (disp >= 0 && state.dispenser) {
        if (Number(addons[disp].max) > 1) plan.qty.push([disp, 1]); else plan.checks.push(disp);
        total += Number(addons[disp].price) || 0; lines.push(name(addons[disp]));
      }
      const syr = addons.findIndex((a) => /syrup/i.test(a.name) && Number(a.max) > 1);
      if (syr >= 0 && state.syrups) { const n = Math.min(state.syrups, Number(addons[syr].max)); plan.qty.push([syr, n]); total += n * (Number(addons[syr].price) || 0); lines.push(T(`${n} syrup${n > 1 ? 's' : ''}`, `${n} סירופים`)); }
    }
    plan.lines = lines; plan.total = total;
    plan.tooBig = state.guests > tier.guests;
    return plan;
  }

  // Open the coffee bar with every choice already made, so they only check and book.
  window.plannerOrder = function () {
    const plan = suggestion();
    if (!plan || typeof openProductDrawer !== 'function') return;
    openProductDrawer(plan.product.id);
    setTimeout(() => {
      const sel = document.querySelector('#pdVariationsSection select');
      const idx = sel ? [...sel.options].findIndex((o) => parseInt(o.textContent, 10) === plan.tier.guests) : -1;
      const chip = document.querySelector(`.pd-guest-chips button[data-i="${idx}"]`);
      if (chip) chip.click(); else if (sel && idx >= 0) { sel.selectedIndex = idx; sel.dispatchEvent(new Event('change', { bubbles: true })); }
      setTimeout(() => {
        const group = plan.coffeeIdx >= 0 ? getProductAddons(plan.product)[plan.coffeeIdx].group : null;
        if (group && typeof pdPickGroup === 'function') pdPickGroup(group, plan.coffeeIdx);
        if (plan.litersIdx >= 0 && typeof pdSetLiters === 'function') pdSetLiters(plan.litersIdx, plan.liters);
        plan.qty.forEach(([i, n]) => typeof pdSetQty === 'function' && pdSetQty(i, n));
        plan.checks.forEach((i) => { const cb = document.querySelector(`#pdAddonsSection input[data-addon-idx="${i}"]`); if (cb && !cb.checked) { cb.checked = true; cb.dispatchEvent(new Event('change', { bubbles: true })); } });
        if (typeof pdUpdateDrawerPrice === 'function') pdUpdateDrawerPrice();
        if (typeof showToast === 'function') showToast(T('We set it up for you — check and book', 'הכנו לכם הכל — בדקו והזמינו'));
      }, 150);
    }, 700);
  };
  window.plannerWhatsApp = function () {
    const plan = suggestion();
    const coffee = { colombia: 'Colombian', house: 'House Blend', decaf: 'Decaf', '': 'Classic' }[state.coffee] || 'Classic';
    const milk = { dairy: T('dairy', 'חלב רגיל'), parve: T('parve', 'פרווה'), half: T('half dairy, half parve', 'חצי רגיל, חצי פרווה') }[state.milk];
    const text = he()
      ? `היי! אני מתכנן/ת אירוע ל-${state.guests} אורחים. ${state.full ? `בר מלא, חלב ${milk}, קפה ${coffee}, ${state.points} עמדות הגשה.` : 'רק הקפה.'}${plan ? ` ההצעה באתר: ${plan.product.name_he || plan.product.name_en} ל-${plan.tier.guests} אורחים, ₪${plan.total}.` : ''} יש לי כמה שאלות:`
      : `Hi! I'm planning an event for ${state.guests} guests. ${state.full ? `Full bar, ${milk} milk, ${coffee} coffee, ${state.points} serving point${state.points > 1 ? 's' : ''}.` : 'Just the coffee.'}${plan ? ` The site suggested: ${plan.product.name_en} for ${plan.tier.guests} guests, ₪${plan.total}.` : ''} I have a few questions:`;
    window.open(`https://wa.me/${WA}?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
  };

  const chips = (key, options) => `<div class="pl-chips" data-key="${key}">${options.map(([v, label]) => `<button type="button" data-v="${esc(v)}" class="${String(state[key]) === String(v) ? 'on' : ''}">${label}</button>`).join('')}</div>`;
  function render() {
    const box = $('planner');
    if (!box) return;
    const open = box.classList.contains('open');
    const plan = open ? suggestion() : null;
    box.innerHTML = `
      <div class="pl-head"><div><b>${T('Not sure which bar to pick?', 'לא בטוחים איזה בר לבחור?')}</b><span>${T('Answer a few questions and we’ll set up the right one for your event.', 'ענו על כמה שאלות ונכין לכם את הבר המתאים לאירוע.')}</span></div>
        ${open ? '' : `<button type="button" class="pl-start" data-act="open">${T('Help me choose', 'עזרו לי לבחור')}</button>`}</div>
      ${open ? `
      <div class="pl-q"><label>${T('How many guests?', 'כמה אורחים?')}</label>
        <div class="pl-guests"><input type="number" min="5" max="500" inputmode="numeric" value="${state.guests}" id="plGuests" class="form-input">${chips('guests', [[25, '25'], [50, '50'], [75, '75'], [100, '100']])}</div></div>
      <div class="pl-q"><label>${T('What do you need?', 'מה צריך?')}</label>
        ${chips('full', [['true', T('Everything included — dispenser, milk & syrups', 'הכל כלול — מתקן, חלב וסירופים')], ['false', T('Just the coffee essentials', 'רק הקפה והבסיס')]])}</div>
      ${state.full ? `
      <div class="pl-q"><label>${T('Milk', 'חלב')}</label>${chips('milk', [['dairy', T('Dairy', 'חלב רגיל')], ['parve', T('Parve', 'פרווה')], ['half', T('Half & half', 'חצי-חצי')]])}</div>
      <div class="pl-q"><label>${T('Coffee', 'קפה')}</label>${chips('coffee', [['', T('Classic', 'קלאסיק')], ['house', T('House Blend', 'האוס בלנד')], ['colomb', T('Colombian', 'קולומביה')], ['decaf', T('Decaf', 'נטול קפאין')]])}</div>
      <div class="pl-q"><label>${T('Serving points', 'עמדות הגשה')}</label>${chips('points', [[1, '1'], [2, '2'], [3, '3'], [4, '4']])}<small>${T('Each extra spot gets its own dispenser.', 'כל עמדה נוספת מקבלת מתקן משלה.')}</small></div>`
      : `
      <div class="pl-q"><label>${T('Add a dispenser?', 'להוסיף מתקן?')}</label>${chips('dispenser', [['false', T('No', 'לא')], ['true', T('Yes', 'כן')]])}</div>
      <div class="pl-q"><label>${T('Syrups (caramel or vanilla)', 'סירופים (קרמל או וניל)')}</label>${chips('syrups', [[0, '0'], [1, '1'], [2, '2']])}</div>`}
      ${plan ? `<div class="pl-result">
        <div class="pl-r-title">${T('We suggest', 'אנחנו ממליצים')}</div>
        <div class="pl-r-main"><b>${esc(he() ? (plan.product.name_he || plan.product.name_en) : plan.product.name_en)}</b> · ${T(`${plan.tier.guests} guests`, `${plan.tier.guests} אורחים`)}${plan.lines.length ? ` · ${plan.lines.map(esc).join(' · ')}` : ''}</div>
        ${plan.tooBig ? `<div class="pl-r-note">${T('For more guests than this, message us and we’ll plan it together.', 'לאירוע גדול יותר כתבו לנו ונתכנן יחד.')}</div>` : ''}
        <div class="pl-r-actions"><button type="button" class="pl-order" onclick="plannerOrder()">${T('Order this', 'להזמנה')} · ₪${plan.total}</button>
          <button type="button" class="pl-wa" onclick="plannerWhatsApp()">${T('Message us', 'כתבו לנו')}</button></div>
      </div>` : ''}` : ''}`;
  }

  document.addEventListener('click', (e) => {
    const box = $('planner');
    if (!box || !box.contains(e.target)) return;
    if (e.target.closest('[data-act="open"]')) { box.classList.add('open'); render(); return; }
    const b = e.target.closest('.pl-chips button');
    if (!b) return;
    const key = b.parentElement.dataset.key, v = b.dataset.v;
    state[key] = v === 'true' ? true : v === 'false' ? false : /^\d+$/.test(v) ? Number(v) : v;
    render();
  });
  document.addEventListener('input', (e) => {
    if (e.target.id !== 'plGuests') return;
    const n = parseInt(e.target.value, 10);
    if (n > 0) { state.guests = n; clearTimeout(render.t); render.t = setTimeout(() => { render(); const i = $('plGuests'); if (i) { i.focus(); try { i.setSelectionRange(i.value.length, i.value.length); } catch (_) {} } }, 500); }
  });

  function mount() {
    const page = $('coffeebarsPage');
    if (!page || $('planner')) return;
    const anchor = page.querySelector('.cbp-hero');
    if (!anchor) return;
    const box = document.createElement('section');
    box.id = 'planner';
    box.className = 'planner';
    anchor.after(box);
    render();
  }
  function hook() {
    mount();
    for (const name of ['showPage', 'applyTranslations', 'renderCoffeeBarsPage']) {
      const orig = window[name];
      if (typeof orig === 'function') window[name] = function () { const r = orig.apply(this, arguments); try { mount(); render(); } catch (_) {} return r; };
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', hook);
  else hook();
})();
