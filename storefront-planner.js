/* Coffee Bars page: "Build your coffee bar". Pick guests, the bar and its options; a tray of
   photos fills in with what you've chosen, priced from the live products → "Order this"
   (opens the bar with every choice made) or WhatsApp. */
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
  const pname = (p) => (he() ? (p.name_he || p.name_en) : p.name_en);

  function suggestion() {
    const p = state.full ? premium() : basic();
    if (!p) return null;
    const tiers = tiersOf(p);
    const tier = tiers.find((t) => t.guests >= state.guests) || tiers[tiers.length - 1];
    if (!tier) return null;
    const addons = addonsOf(p);
    const lines = [];
    let total = tier.price;
    const plan = { product: p, tier, coffeeIdx: -1, liters: 0, litersIdx: -1, milkLiters: Math.floor(tier.guests / 10), qty: [], checks: [], dispensers: state.full ? 1 : 0, syrups: 0 };
    if (state.full) {
      const coffee = addons.findIndex((a) => a.group && state.coffee && new RegExp(state.coffee, 'i').test(a.name));
      if (coffee >= 0) { plan.coffeeIdx = coffee; total += Number(addons[coffee].price) || 0; lines.push(name(addons[coffee])); }
      const milk = addons.findIndex((a) => a.per_liter);
      const liters = state.milk === 'parve' ? plan.milkLiters : state.milk === 'half' ? Math.round(plan.milkLiters / 2) : 0;
      if (milk >= 0 && liters) { plan.litersIdx = milk; plan.liters = liters; total += liters * (Number(addons[milk].price) || 0); lines.push(T(`${liters}L parve milk`, `${liters} ל׳ חלב פרווה`)); }
      const disp = addons.findIndex((a) => /dispenser/i.test(a.name) && Number(a.max) > 1);
      const extra = Math.min(Math.max(0, state.points - 1), disp >= 0 ? Number(addons[disp].max) : 0);
      if (disp >= 0 && extra) { plan.qty.push([disp, extra]); plan.dispensers += extra; total += extra * (Number(addons[disp].price) || 0); lines.push(T(`${extra} extra dispenser${extra > 1 ? 's' : ''}`, `${extra} מתקנים נוספים`)); }
    } else {
      const disp = addons.findIndex((a) => /dispenser/i.test(a.name));
      if (disp >= 0 && state.dispenser) {
        if (Number(addons[disp].max) > 1) plan.qty.push([disp, 1]); else plan.checks.push(disp);
        plan.dispensers = 1;
        total += Number(addons[disp].price) || 0; lines.push(name(addons[disp]));
      }
      const syr = addons.findIndex((a) => /syrup/i.test(a.name) && Number(a.max) > 1);
      if (syr >= 0 && state.syrups) { const n = Math.min(state.syrups, Number(addons[syr].max)); plan.qty.push([syr, n]); plan.syrups = n; total += n * (Number(addons[syr].price) || 0); lines.push(T(`${n} syrup${n > 1 ? 's' : ''}`, `${n} סירופים`)); }
    }
    plan.lines = lines; plan.total = total;
    plan.tooBig = state.guests > tier.guests;
    return plan;
  }

  // ── The bar, live: the real products (cut out of their photos, in /bar) standing on a counter.
  //    Real-world heights in cm keep them in proportion; the whole bar zooms out as it grows.
  const PIC = { disp: 'dispenser', classic: 'jer_classic', house: 'jer_house', colomb: 'jer_colombia', caramel: 'caramel', vanilla: 'vanilla', sugar: 'sugar', milk: 'milk', cups: 'cups', straws: 'straws' };
  const src = (k) => `/bar/${PIC[k]}.webp?v=5`;
  const CM = { disp: 40, jug: 31, syrup: 23, milk: 24, cups: 30, straws: 27 };
  // Width ÷ height of each cut-out, so the bar can be measured before the photos load.
  const RATIO = { disp: 201 / 420, classic: 287 / 420, house: 286 / 420, colomb: 288 / 420, caramel: 166 / 420, vanilla: 163 / 420, sugar: 163 / 420, milk: 143 / 420, cups: 121 / 420, straws: 207 / 420 };
  // One 5-liter jug of cold brew per 25 guests.
  const jugsFor = (guests) => Math.max(1, Math.ceil(guests / 25));

  function tiles(plan) {
    if (!plan) return [];
    const coffee = state.full ? state.coffee : '';
    const coffeeName = { '': T('Classic', 'קלאסיק'), house: T('House Blend', 'האוס בלנד'), colomb: T('Colombian', 'קולומביה'), decaf: T('Decaf', 'נטול קפאין') }[coffee];
    const jugPic = coffee === 'house' ? 'house' : coffee === 'colomb' ? 'colomb' : 'classic';
    const t = [{ key: 'coffee', pic: jugPic, cm: CM.jug, n: jugsFor(plan.tier.guests), tag: coffee === 'decaf' ? T('Decaf', 'נטול') : '', title: T(`${coffeeName} cold brew`, `קולד ברו ${coffeeName}`), sub: T(`for ${plan.tier.guests} guests`, `ל-${plan.tier.guests} אורחים`), v: coffee }];
    if (plan.dispensers) t.push({ key: 'disp', pic: 'disp', cm: CM.disp, n: plan.dispensers, title: T('Dispenser', 'מתקן') });
    if (state.full) {
      t.push({ key: 'caramel', pic: 'caramel', cm: CM.syrup, title: T('Caramel syrup', 'סירופ קרמל') });
      t.push({ key: 'vanilla', pic: 'vanilla', cm: CM.syrup, title: T('Vanilla syrup', 'סירופ וניל') });
    }
    t.push({ key: 'sugar', pic: 'sugar', cm: CM.syrup, title: T('Sugar syrup', 'סירופ סוכר') });
    if (!state.full && plan.syrups) {
      t.push({ key: 'caramel', pic: 'caramel', cm: CM.syrup, title: T('Caramel syrup', 'סירופ קרמל') });
      if (plan.syrups > 1) t.push({ key: 'vanilla', pic: 'vanilla', cm: CM.syrup, title: T('Vanilla syrup', 'סירופ וניל') });
    }
    if (state.full) {
      // One 1-liter carton per 10 guests.
      const parve = plan.liters, dairy = Math.max(0, plan.milkLiters - parve);
      if (dairy) t.push({ key: 'milk', pic: 'milk', cm: CM.milk, n: dairy, title: T('Milk', 'חלב'), sub: T('1L cartons', 'קרטונים של ליטר') });
      if (parve) t.push({ key: 'parve', pic: 'milk', cm: CM.milk, n: parve, tag: T('Parve', 'פרווה'), title: T('Parve milk', 'חלב פרווה'), sub: T('1L cartons', 'קרטונים של ליטר') });
    }
    t.push({ key: 'cups', pic: 'cups', cm: CM.cups, title: T('Cups', 'כוסות') });
    t.push({ key: 'straws', pic: 'straws', cm: CM.straws, title: T('Straws', 'קשיות') });
    // Not on the table until they have their own clean photos (they stay in the list).
    const NO_PHOTO_YET = ['sugar', 'cups', 'straws'];
    return t.map((x) => ({ ...x, img: src(x.pic), scene: !NO_PHOTO_YET.includes(x.pic) }));
  }

  // What was on the counter last time: new things drop in, everything else slides to its new place.
  let shown = new Map();
  let lastTiles = [];
  let lastTotal = null;
  const PX = 3.4;   // px per cm before the bar is zoomed to fit
  function sceneHtml(plan) {
    const list = tiles(plan);
    lastTiles = list.map((x) => ({ ...x, isNew: !shown.has(x.key), changed: shown.has(x.key) && shown.get(x.key) !== `${x.n || 1}|${x.v || ''}` }));
    const groups = list.filter((x) => x.scene).map((x) => {
      const n = x.n || 1;
      const before = shown.get(x.key);
      const prevN = before ? Number(before.split('|')[0]) : 0;
      const sameLook = before && before.split('|')[1] === (x.v || '');
      // Many cartons or jugs: a second row behind the first, like a real table.
      const perRow = x.key === 'milk' || x.key === 'parve' ? 4 : 3;
      const items = Array.from({ length: n }, (_, i) => {
        const row = Math.floor(i / perRow), col = i % perRow;
        const fresh = !before || !sameLook || i >= prevN;
        return `<img class="bs-it${fresh ? ' drop' : ''}" data-k="${x.key}-${i}" src="${x.img}" alt="" style="height:${x.cm * PX}px;width:${Math.round(x.cm * PX * RATIO[x.pic])}px;--row:${row};--col:${col};--d:${fresh && before ? (i - prevN) * 70 : 0}ms" draggable="false">`;
      }).join('');
      const rows = Math.ceil(n / perRow);
      return `<div class="bs-g bs-${x.key}" data-g="${x.key}" style="--rows:${rows};--per:${Math.min(n, perRow)}" title="${esc(x.title)}">${items}${x.tag ? `<em class="bs-tag">${esc(x.tag)}</em>` : ''}</div>`;
    }).join('');
    shown = new Map(list.map((x) => [x.key, `${x.n || 1}|${x.v || ''}`]));
    const legend = list.map((x) => `<span>${x.n > 1 ? `<b>${x.n}×</b> ` : ''}${esc(x.title)}</span>`).join('');
    return `<div class="bs" id="bbScene"><div class="bs-wall"></div><div class="bs-stage" id="bbStage">${groups}</div><div class="bs-counter"><img class="bs-logo" src="/bar/table-logo.webp?v=1" alt="Gremier Coffee Co."></div></div>
      <div class="bs-legend">${legend}</div>`;
  }
  // Zoom the bar to fit, and slide things that moved (FLIP) instead of letting them jump.
  let prevRects = new Map();
  function layoutScene() {
    const scene = $('bbScene'), stage = $('bbStage');
    if (!scene || !stage) return;
    // Measure at full size (the products' real positions, back rows included), then zoom from
    // where it was to the new fit. Few things: close up; as the bar grows it zooms out.
    const prevZ = stage.style.getPropertyValue('--z') || '1';
    stage.style.transition = 'none';
    stage.style.setProperty('--z', 1);
    let left = Infinity, right = -Infinity;
    stage.querySelectorAll('.bs-it').forEach((el) => { const r = el.getBoundingClientRect(); left = Math.min(left, r.left); right = Math.max(right, r.right); });
    const width = Math.max(stage.scrollWidth, right - left);
    stage.style.setProperty('--z', prevZ);
    void stage.offsetWidth;
    stage.style.transition = '';
    const room = scene.clientHeight - parseFloat(getComputedStyle(stage).bottom) - 22;   // above the table
    const fit = Math.min(1.7, (scene.clientWidth - 28) / width, room / stage.scrollHeight);
    stage.style.setProperty('--z', fit.toFixed(3));
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const rects = new Map();
    stage.querySelectorAll('.bs-it').forEach((el) => {
      const r = el.getBoundingClientRect();
      rects.set(el.dataset.k, r);
      const old = prevRects.get(el.dataset.k);
      if (!old || reduce || el.classList.contains('drop')) return;
      const dx = old.left - r.left, dy = old.top - r.top, s = old.height / (r.height || 1);
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(s - 1) < 0.01) return;
      el.animate([{ transform: `translate(${dx}px, ${dy}px) scale(${s})` }, { transform: 'none' }], { duration: 520, easing: 'cubic-bezier(.2, .9, .3, 1)' });
    });
    prevRects = rects;
  }
  addEventListener('resize', () => requestAnimationFrame(layoutScene));

  // Until there are clean product photos for the scene (shot one by one on white), the bar is
  // shown with its real photo and an itemized list that updates as they choose. Set
  // SCENE_READY = true to switch the live scene on.
  const SCENE_READY = true;
  function barPhotoHtml(plan) {
    const list = tiles(plan);
    lastTiles = list.map((x) => ({ ...x, isNew: !shown.has(x.key), changed: shown.has(x.key) && shown.get(x.key) !== `${x.n || 1}|${x.v || ''}` }));
    const img = plan.product.images && plan.product.images[0];
    const rows = lastTiles.map((x) => `<li class="${x.isNew ? 'pop' : x.changed ? 'bump' : ''}"><span>${esc(x.title)}${x.sub ? ` <small>${esc(x.sub)}</small>` : ''}</span><b>${x.n > 1 ? x.n + '×' : '✓'}</b></li>`).join('');
    shown = new Map(list.map((x) => [x.key, `${x.n || 1}|${x.v || ''}`]));
    return `${img ? `<div class="bb-photo"><img src="${esc(typeof cloudinaryOptimize === 'function' ? cloudinaryOptimize(img, 900) : img)}" alt=""></div>` : ''}<ul class="bb-list">${rows}</ul>`;
  }

  // The total counts up or down to the new price.
  function animateTotal(to) {
    const el = $('bbTotal');
    const from = lastTotal;
    lastTotal = to;
    if (!el || from === null || from === to || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const t0 = performance.now(), dur = 450;
    el.parentElement.classList.remove('flash'); void el.offsetWidth; el.parentElement.classList.add('flash');
    const step = (t) => {
      const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3);
      el.textContent = Math.round(from + (to - from) * e);
      if (k < 1) requestAnimationFrame(step);
    };
    el.textContent = from;
    requestAnimationFrame(step);
  }

  // Phones: while the questions are on screen and the tray isn't, a strip above the tab bar
  // shows what's in the bar and the price; tapping it goes to the tray.
  function mini(plan) {
    let el = $('bbMini');
    if (!el) {
      el = document.createElement('button');
      el.type = 'button'; el.id = 'bbMini'; el.className = 'bb-mini';
      el.onclick = () => document.querySelector('#planner .bb-tray')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      document.body.appendChild(el);
    }
    if (!plan) { el.classList.remove('on'); return; }
    el.innerHTML = `<span class="bb-mini-pics">${lastTiles.filter((x) => x.img && x.scene).slice(0, 7).map((x) => `<span class="${x.isNew ? 'pop' : x.changed ? 'bump' : ''}"><img src="${esc(x.img)}" alt="">${x.n > 1 ? `<i>${x.n}</i>` : ''}</span>`).join('')}</span>
      <b>₪${plan.total}</b><span class="bb-mini-go">${T('View', 'לצפייה')}</span>`;
    if (lastTiles.some((x) => x.isNew || x.changed)) { el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); }
  }
  function syncMini() {
    const el = $('bbMini'), box = $('planner');
    if (!el) return;
    const tray = box?.querySelector('.bb-tray'), qs = box?.querySelector('.bb-qs');
    const onPage = !!document.getElementById('coffeebarsPage')?.classList.contains('active');
    if (!onPage || !tray || !qs || innerWidth > 760) { el.classList.remove('on'); document.body.classList.remove('bb-mini-on'); return; }
    const vh = innerHeight, q = qs.getBoundingClientRect(), t = tray.getBoundingClientRect();
    const qsOn = q.bottom > 80 && q.top < vh - 120;
    const trayOn = t.top < vh - 140;   // the tray's photos are coming into view
    el.classList.toggle('on', qsOn && !trayOn);
    document.body.classList.toggle('bb-mini-on', el.classList.contains('on'));
  }
  addEventListener('scroll', () => requestAnimationFrame(syncMini), { passive: true });
  addEventListener('resize', syncMini);
  function watch() { syncMini(); }

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
    const coffee = { colomb: 'Colombian', house: 'House Blend', decaf: 'Decaf', '': 'Classic' }[state.coffee] || 'Classic';
    const milk = { dairy: T('dairy', 'חלב רגיל'), parve: T('parve', 'פרווה'), half: T('half dairy, half parve', 'חצי רגיל, חצי פרווה') }[state.milk];
    const text = he()
      ? `היי! אני מתכנן/ת אירוע ל-${state.guests} אורחים. ${state.full ? `בר מלא, חלב ${milk}, קפה ${coffee}, ${state.points} עמדות הגשה.` : 'רק הקפה.'}${plan ? ` מה שבניתי באתר: ${plan.product.name_he || plan.product.name_en} ל-${plan.tier.guests} אורחים, ₪${plan.total}.` : ''} יש לי כמה שאלות:`
      : `Hi! I'm planning an event for ${state.guests} guests. ${state.full ? `Full bar, ${milk} milk, ${coffee} coffee, ${state.points} serving point${state.points > 1 ? 's' : ''}.` : 'Just the coffee.'}${plan ? ` What I built on the site: ${plan.product.name_en} for ${plan.tier.guests} guests, ₪${plan.total}.` : ''} I have a few questions:`;
    window.open(`https://wa.me/${WA}?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
  };

  const chips = (key, options) => `<div class="pl-chips" data-key="${key}">${options.map(([v, label]) => `<button type="button" data-v="${esc(v)}" class="${String(state[key]) === String(v) ? 'on' : ''}">${label}</button>`).join('')}</div>`;
  function barChoice() {
    const pick = (full, p, title, sub) => `<button type="button" class="bb-bar ${state.full === full ? 'on' : ''}" data-full="${full}">
        ${p && p.images && p.images[0] ? `<img src="${esc(typeof cloudinaryOptimize === 'function' ? cloudinaryOptimize(p.images[0], 200) : p.images[0])}" alt="">` : ''}
        <span><b>${title}</b><small>${sub}</small></span></button>`;
    return `<div class="bb-bars">${pick(true, premium(), T('Full bar', 'בר מלא'), T('Dispenser, milk, 3 syrups, cups', 'מתקן, חלב, 3 סירופים, כוסות'))}${pick(false, basic(), T('Just the coffee', 'רק הקפה'), T('Coffee, cups, sugar syrup', 'קפה, כוסות, סירופ סוכר'))}</div>`;
  }
  function render() {
    const box = $('planner');
    if (!box) return;
    $('bbStage')?.querySelectorAll('.bs-it').forEach((el) => prevRects.set(el.dataset.k, el.getBoundingClientRect()));
    const plan = suggestion();
    const tierChips = (plan ? tiersOf(plan.product) : []).map((t) => [t.guests, String(t.guests)]);
    box.innerHTML = `
      <div class="bb-head"><h2>${T('Build your coffee bar', 'בנו את בר הקפה שלכם')}</h2></div>
      <div class="bb-grid">
        <div class="bb-qs">
          <div class="pl-q"><label>${T('Guests', 'אורחים')}</label>
            <div class="pl-guests">${chips('guests', tierChips.length ? tierChips : [[25, '25'], [50, '50'], [75, '75'], [100, '100']])}<input type="number" min="5" max="500" inputmode="numeric" value="${state.guests}" id="plGuests" class="form-input" aria-label="${T('Number of guests', 'מספר אורחים')}"></div></div>
          <div class="pl-q"><label>${T('Bar', 'בר')}</label>${barChoice()}</div>
          ${state.full ? `
          <div class="pl-q"><label>${T('Coffee', 'קפה')}</label>${chips('coffee', [['', T('Classic', 'קלאסיק')], ['house', T('House Blend', 'האוס בלנד')], ['colomb', T('Colombian', 'קולומביה')], ['decaf', T('Decaf', 'נטול קפאין')]])}</div>
          <div class="pl-q"><label>${T('Milk', 'חלב')}</label>${chips('milk', [['dairy', T('Dairy', 'חלב רגיל')], ['parve', T('Parve', 'פרווה')], ['half', T('Half & half', 'חצי-חצי')]])}</div>
          <div class="pl-q"><label>${T('Serving stations', 'עמדות הגשה')}</label>${chips('points', [[1, '1'], [2, '2'], [3, '3'], [4, '4']])}</div>`
          : `
          <div class="pl-q"><label>${T('Dispenser', 'מתקן')}</label>${chips('dispenser', [['false', T('No', 'לא')], ['true', T('Add one', 'להוסיף')]])}</div>
          <div class="pl-q"><label>${T('Extra syrups', 'סירופים נוספים')}</label>${chips('syrups', [[0, '0'], [1, '1'], [2, '2']])}</div>`}
        </div>
        <aside class="bb-tray">
          <div class="bb-tray-title">${T('Your bar', 'הבר שלכם')}${plan ? `<span>${tiles(plan).reduce((n, x) => n + (x.n || 1), 0)} ${T('items', 'פריטים')}</span>` : ''}</div>
          ${plan ? (SCENE_READY ? sceneHtml(plan) : barPhotoHtml(plan)) : ''}
          ${plan ? `<div class="bb-sum">
            <div class="bb-sum-name">${esc(pname(plan.product))} · ${T(`${plan.tier.guests} guests`, `${plan.tier.guests} אורחים`)}</div>
            ${plan.tooBig ? `<div class="pl-r-note">${T('For a bigger event, message us and we’ll plan it together.', 'לאירוע גדול יותר כתבו לנו ונתכנן יחד.')}</div>` : ''}
            <button type="button" class="pl-order" onclick="plannerOrder()">${T('Order', 'להזמנה')} · ₪<span id="bbTotal">${plan.total}</span></button>
            <button type="button" class="bb-wa" onclick="plannerWhatsApp()">${T('Questions? Message us', 'שאלות? כתבו לנו')}</button>
          </div>` : ''}
        </aside>
      </div>`;
    if (plan) animateTotal(plan.total);
    layoutScene();
    mini(plan);
    watch();
  }

  document.addEventListener('click', (e) => {
    const box = $('planner');
    if (!box || !box.contains(e.target)) return;
    const bar = e.target.closest('.bb-bar');
    if (bar) { state.full = bar.dataset.full === 'true'; render(); return; }
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
    for (const fn of ['showPage', 'applyTranslations', 'renderCoffeeBarsPage', 'renderShop']) {
      const orig = window[fn];
      if (typeof orig === 'function') window[fn] = function () { const r = orig.apply(this, arguments); try { mount(); render(); } catch (_) {} return r; };
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', hook);
  else hook();
})();
