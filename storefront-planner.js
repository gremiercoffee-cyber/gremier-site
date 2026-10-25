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

  // mix: how many 5L jugs of each upgrade coffee (the rest of the jugs are the included Classic).
  const state = { guests: 50, full: true, milk: 'dairy', mix: { house: 0, colomb: 0, decaf: 0 }, points: 1, dispenser: false, syrups: 0 };
  const FLAVOURS = [['house', /house/i, 'House Blend', 'האוס בלנד'], ['colomb', /colomb/i, 'Colombian', 'קולומביה'], ['decaf', /decaf/i, 'Decaf', 'נטול קפאין']];
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
    const jugs = jugsFor(tier.guests);
    const plan = { product: p, tier, jugs, mix: {}, classic: jugs, liters: 0, litersIdx: -1, milkLiters: Math.floor(tier.guests / 10), qty: [], checks: [], dispensers: state.full ? 1 : 0, syrups: 0 };
    if (state.full) {
      // Coffee: some jugs upgraded (₪ per 5L jug), the rest Classic. Each coffee gets its own dispenser.
      let left = jugs;
      for (const [k, re] of FLAVOURS) {
        const idx = addons.findIndex((a) => (a.per_jug || a.group) && re.test(a.name));
        const n = Math.min(left, state.mix[k] || 0);
        state.mix[k] = n;
        if (idx < 0 || !n) continue;
        left -= n; plan.mix[k] = n;
        const each = Number(addons[idx].price) || 0;
        if (addons[idx].per_jug) { plan.qty.push([idx, n]); total += n * each; } else { plan.groupPick = idx; total += each; }
        lines.push(`${n}× ${name(addons[idx])}`);
      }
      plan.classic = left;
      plan.flavours = Object.keys(plan.mix).length + (left > 0 ? 1 : 0);
      plan.stations = Math.max(state.points, plan.flavours);
      const milk = addons.findIndex((a) => a.per_liter);
      const liters = state.milk === 'parve' ? plan.milkLiters : state.milk === 'half' ? Math.round(plan.milkLiters / 2) : 0;
      if (milk >= 0 && liters) { plan.litersIdx = milk; plan.liters = liters; total += liters * (Number(addons[milk].price) || 0); lines.push(T(`${liters}L parve milk`, `${liters} ל׳ חלב פרווה`)); }
      const disp = addons.findIndex((a) => /dispenser/i.test(a.name) && Number(a.max) > 1);
      const extra = Math.min(Math.max(0, plan.stations - 1), disp >= 0 ? Number(addons[disp].max) : 0);
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

  // One 5-liter jug of cold brew per 25 guests.
  const jugsFor = (guests) => Math.max(1, Math.ceil(guests / 25));

  function tiles(plan) {
    if (!plan) return [];
    const t = [];
    const jugTile = (k, n, label, labelHe, pic, tag) => t.push({ key: 'coffee-' + k, pic, n, tag, title: T(`${label} cold brew`, `קולד ברו ${labelHe}`), sub: T('5L jugs', "ג'ריקנים של 5 ל׳") });
    if (plan.classic) jugTile('classic', plan.classic, 'Classic', 'קלאסיק', 'classic', '');
    if (plan.mix.house) jugTile('house', plan.mix.house, 'House Blend', 'האוס בלנד', 'house', '');
    if (plan.mix.colomb) jugTile('colomb', plan.mix.colomb, 'Colombian', 'קולומביה', 'colomb', '');
    if (plan.mix.decaf) jugTile('decaf', plan.mix.decaf, 'Decaf', 'נטול קפאין', 'classic', T('Decaf', 'נטול'));
    if (plan.dispensers) t.push({ key: 'disp', pic: 'disp', n: plan.dispensers, title: T('Dispenser', 'מתקן') });
    if (state.full) {
      t.push({ key: 'caramel', pic: 'caramel', title: T('Caramel syrup', 'סירופ קרמל') });
      t.push({ key: 'vanilla', pic: 'vanilla', title: T('Vanilla syrup', 'סירופ וניל') });
    }
    t.push({ key: 'sugar', pic: 'sugar', title: T('Sugar syrup', 'סירופ סוכר') });
    if (!state.full && plan.syrups) {
      t.push({ key: 'caramel', pic: 'caramel', title: T('Caramel syrup', 'סירופ קרמל') });
      if (plan.syrups > 1) t.push({ key: 'vanilla', pic: 'vanilla', title: T('Vanilla syrup', 'סירופ וניל') });
    }
    if (state.full) {
      // One 1-liter carton per 10 guests.
      const parve = plan.liters, dairy = Math.max(0, plan.milkLiters - parve);
      if (dairy) t.push({ key: 'milk', pic: 'milk', n: dairy, title: T('Milk', 'חלב'), sub: T('1L cartons', 'קרטונים של ליטר') });
      if (parve) t.push({ key: 'parve', pic: 'milk', n: parve, tag: T('Parve', 'פרווה'), title: T('Parve milk', 'חלב פרווה'), sub: T('1L cartons', 'קרטונים של ליטר') });
    }
    t.push({ key: 'cups', pic: 'cups', title: T('Cups', 'כוסות') });
    t.push({ key: 'straws', pic: 'straws', title: T('Straws', 'קשיות') });
    return t;
  }

  // What was on the counter last time: new things drop in, everything else slides to its new place.
  let shown = new Map();
  let lastTotal = null;
  // Every visual comes from one photograph: same camera, lighting and ground plane.
  // These non-overlapping windows reveal products without reassembling their perspective.
  const MASTER = '/bar/studio/bar-master-v3.webp?v=1';
  const WINDOWS = {coffee:[0,21.65],disp:[21.65,41.5],caramel:[41.5,50.95],vanilla:[50.95,60.38],sugar:[60.38,69.7],milk:[69.7,79.95],cups:[79.95,88.65],straws:[88.65,100]};
  function sceneHtml(plan) {
    const list=tiles(plan);
    const visual=[{key:'coffee',n:plan.jugs,title:T('Cold brew','קולד ברו')}];
    for(const key of ['disp','caramel','vanilla','sugar']){
      const item=list.find(x=>x.key===key);if(item)visual.push(item);
    }
    const milk=list.filter(x=>x.key==='milk'||x.key==='parve');
    if(milk.length)visual.push({key:'milk',n:milk.reduce((sum,x)=>sum+(x.n||1),0),title:T('Milk','חלב')});
    visual.push(...list.filter(x=>x.key==='cups'||x.key==='straws'));
    const groups=visual.map((x,index)=>{
      const [left,right]=WINDOWS[x.key];
      return `<div class="bs-piece${shown.has(x.key)?'':' drop'}" data-g="${x.key}" style="--cut-left:${left}%;--cut-right:${100-right}%;--d:${index*35}ms" title="${esc(x.title)}"><img class="bs-master" src="${MASTER}" alt="" draggable="false">${x.key==='disp'?'<img class="bs-emblem" src="/bar/studio/brand-mark.svg?v=1" alt="">':''}</div>`;
    }).join('');
    const markers=visual.filter(x=>(x.n||1)>1).map(x=>{
      const [left,right]=WINDOWS[x.key];
      return `<span class="bs-quantity" style="left:${(left+right)/2}%">×${x.n}</span>`;
    }).join('');
    shown=new Map(visual.map(x=>[x.key,String(x.n||1)]));
    const legend=list.map(x=>`<span>${x.n>1?`<b>${x.n}×</b> `:''}${esc(x.title)}</span>`).join('');
    return `<div class="bs bs-live" id="bbScene" role="img" aria-label="${esc(T('Your selected coffee bar','בר הקפה שבחרתם'))}"><div class="bs-wall"></div><div class="bs-stage" id="bbStage">${groups}<div class="bs-quantities">${markers}</div></div><div class="bs-counter"><img class="bs-logo" src="/bar/studio/brand-mark.svg?v=1" alt="Gremier Coffee Co."></div></div><div class="bs-legend">${legend}</div>`;
  }
  function reconcileScene(previous,next){
    if(!previous||!next)return;
    const oldStage=previous.querySelector('.bs-stage'),newStage=next.querySelector('.bs-stage');
    const pieces=new Map([...oldStage.querySelectorAll('.bs-piece:not(.leaving)')].map(el=>[el.dataset.g,el]));
    newStage.querySelectorAll('.bs-piece').forEach(el=>{
      const old=pieces.get(el.dataset.g);if(!old)return;
      old.classList.remove('drop');old.style.cssText=el.style.cssText;el.replaceWith(old);pieces.delete(el.dataset.g);
    });
    oldStage.replaceChildren(...newStage.childNodes);
    if(!matchMedia('(prefers-reduced-motion: reduce)').matches)pieces.forEach(el=>{
      el.classList.remove('drop');el.classList.add('leaving');oldStage.append(el);
      const fade=el.animate([{opacity:1},{opacity:0}],{duration:220,fill:'forwards'});fade.onfinish=()=>el.remove();
    });
    next.replaceWith(previous);
  }
  function layoutScene(){
    const scene=$('bbScene'),stage=$('bbStage');if(!scene||!stage)return;
    const room=scene.clientHeight-parseFloat(getComputedStyle(stage).bottom)-12;
    stage.style.setProperty('--z',Math.max(.1,Math.min(1.4,(scene.clientWidth-20)/800,room/352)).toFixed(3));
  }
  addEventListener('resize', () => requestAnimationFrame(layoutScene));

  // The total counts up or down to the new price.
  let totalFrame;
  function animateTotal(to) {
    cancelAnimationFrame(totalFrame);
    const el = $('bbTotal');
    const from = lastTotal;
    lastTotal = to;
    if (!el || from === null || from === to || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const t0 = performance.now(), dur = 450;
    el.parentElement.classList.remove('flash'); void el.offsetWidth; el.parentElement.classList.add('flash');
    const step = (t) => {
      const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3);
      el.textContent = Math.round(from + (to - from) * e);
      if (k < 1) totalFrame = requestAnimationFrame(step);
    };
    el.textContent = from;
    totalFrame = requestAnimationFrame(step);
  }

  // A live picture-in-picture, never a second bottom toolbar.
  function mini(plan){
    let el=$('bbMini');
    if(!el){el=document.createElement('button');el.type='button';el.id='bbMini';el.className='bb-mini planner';el.onclick=()=>document.querySelector('#planner .bb-tray')?.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'});document.body.appendChild(el);}
    if(!plan){el.classList.remove('on');return;}
    el.setAttribute('aria-label',T('View your coffee bar','צפו בבר הקפה שלכם'));
    const scene=$('bbScene')?.cloneNode(true);if(!scene)return;
    scene.removeAttribute('id');scene.removeAttribute('role');scene.removeAttribute('aria-label');scene.querySelectorAll('[id]').forEach(node=>node.removeAttribute('id'));
    el.replaceChildren();const picture=document.createElement('span');picture.className='bb-thumb-picture';const world=document.createElement('span');world.className='bb-thumb-world';world.append(scene);picture.append(world);el.append(picture);
    const label=document.createElement('span');label.className='bb-thumb-label';label.textContent=T('Your bar ↗','הבר שלכם ↗');el.append(label);
  }
  function syncMini(){
    const el=$('bbMini'),box=$('planner');if(!el)return;
    const scene=$('bbScene'),qs=box?.querySelector('.bb-qs'),onPage=$('coffeebarsPage')?.classList.contains('active');
    if(!onPage||!scene||!qs){el.classList.remove('on');document.body.classList.remove('bb-mini-on');return;}
    const q=qs.getBoundingClientRect(),t=scene.getBoundingClientRect(),vh=innerHeight;
    const choosing=q.bottom>90&&q.top<vh-100,fullVisible=t.top<vh-120&&t.bottom>120;
    const covered=!!document.querySelector('#pdDrawer.open,#cartDrawer.open,.modal-overlay.open');
    el.classList.toggle('on',choosing&&!fullVisible&&!covered);document.body.classList.toggle('bb-mini-on',el.classList.contains('on'));
  }
  addEventListener('scroll',()=>requestAnimationFrame(syncMini),{passive:true});
  addEventListener('resize',syncMini);
  const watchedOverlays = new WeakSet();
  function watch(){
    document.querySelectorAll('#pdDrawer,#cartDrawer,.modal-overlay').forEach(el=>{
      if(watchedOverlays.has(el))return;
      new MutationObserver(syncMini).observe(el,{attributes:true,attributeFilter:['class']});watchedOverlays.add(el);
    });
    syncMini();
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
        if (plan.groupPick != null && typeof pdPickGroup === 'function') pdPickGroup(getProductAddons(plan.product)[plan.groupPick].group, plan.groupPick);
        if (plan.litersIdx >= 0 && typeof pdSetLiters === 'function') pdSetLiters(plan.litersIdx, plan.liters);
        const isJug = ([i]) => !!getProductAddons(plan.product)[i]?.per_jug;
        [...plan.qty.filter((q) => !isJug(q)), ...plan.qty.filter(isJug)].forEach(([i, n]) => typeof pdSetQty === 'function' && pdSetQty(i, n));
        plan.checks.forEach((i) => { const cb = document.querySelector(`#pdAddonsSection input[data-addon-idx="${i}"]`); if (cb && !cb.checked) { cb.checked = true; cb.dispatchEvent(new Event('change', { bubbles: true })); } });
        if (typeof pdUpdateDrawerPrice === 'function') pdUpdateDrawerPrice();
        if (typeof showToast === 'function') showToast(T('We set it up for you — check and book', 'הכנו לכם הכל — בדקו והזמינו'));
      }, 150);
    }, 700);
  };
  window.plannerWhatsApp = function () {
    const plan = suggestion();
    const coffee = plan ? [plan.classic ? `${plan.classic}× Classic` : '', ...FLAVOURS.filter(([k]) => plan.mix[k]).map(([k, , en]) => `${plan.mix[k]}× ${en}`)].filter(Boolean).join(' + ') + ' (5L)' : 'Classic';
    const milk = { dairy: T('dairy', 'חלב רגיל'), parve: T('parve', 'פרווה'), half: T('half dairy, half parve', 'חצי רגיל, חצי פרווה') }[state.milk];
    const text = he()
      ? `היי! אני מתכנן/ת אירוע ל-${state.guests} אורחים. ${state.full ? `בר מלא, חלב ${milk}, קפה ${coffee}, ${state.points} עמדות הגשה.` : 'רק הקפה.'}${plan ? ` מה שבניתי באתר: ${plan.product.name_he || plan.product.name_en} ל-${plan.tier.guests} אורחים, ₪${plan.total}.` : ''} יש לי כמה שאלות:`
      : `Hi! I'm planning an event for ${state.guests} guests. ${state.full ? `Full bar, ${milk} milk, ${coffee} coffee, ${state.points} serving point${state.points > 1 ? 's' : ''}.` : 'Just the coffee.'}${plan ? ` What I built on the site: ${plan.product.name_en} for ${plan.tier.guests} guests, ₪${plan.total}.` : ''} I have a few questions:`;
    window.open(`https://wa.me/${WA}?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
  };

  const chips = (key, options, current = state[key]) => `<div class="pl-chips" data-key="${key}">${options.map(([v, label]) => `<button type="button" data-v="${esc(v)}" class="${String(current) === String(v) ? 'on' : ''}">${label}</button>`).join('')}</div>`;
  function coffeeHtml(plan) {
    if (!plan) return '';
    const p = plan.product, addons = addonsOf(p);
    const priceOf = (re) => Number(addons.find((a) => (a.per_jug || a.group) && re.test(a.name))?.price) || 0;
    const row = (label, n, k, re) => `<div class="bb-jug">
        <span class="bb-jug-name">${label}${k ? ` <small>+₪${priceOf(re)} ${T('per jug', "לג'ריקן")}</small>` : ` <small>${T('included', 'כלול')}</small>`}</span>
        ${k ? `<span class="bb-jug-step"><button type="button" data-jug="${k}" data-d="-1" ${n ? '' : 'disabled'} aria-label="${T('Fewer', 'פחות')}">−</button><b>${n}</b><button type="button" data-jug="${k}" data-d="1" ${plan.classic ? '' : 'disabled'} aria-label="${T('More', 'עוד')}">+</button></span>` : `<span class="bb-jug-step"><b>${n}</b></span>`}
      </div>`;
    return `<div class="bb-jugs">${row(T('Classic', 'קלאסיק'), plan.classic, '', null)}${FLAVOURS.map(([k, re, en, hb]) => row(T(en, hb), plan.mix[k] || 0, k, re)).join('')}</div>`;
  }
  function barChoice() {
    const pick = (full, p, title, sub) => `<button type="button" class="bb-bar ${state.full === full ? 'on' : ''}" data-full="${full}">
        ${p && p.images && p.images[0] ? `<img src="${esc(typeof cloudinaryOptimize === 'function' ? cloudinaryOptimize(p.images[0], 200) : p.images[0])}" alt="">` : ''}
        <span><b>${title}</b><small>${sub}</small></span></button>`;
    return `<div class="bb-bars">${pick(true, premium(), T('Full bar', 'בר מלא'), T('Dispenser, milk, 3 syrups, cups', 'מתקן, חלב, 3 סירופים, כוסות'))}${pick(false, basic(), T('Just the coffee', 'רק הקפה'), T('Coffee, cups, sugar syrup', 'קפה, כוסות, סירופ סוכר'))}</div>`;
  }
  function render() {
    const box = $('planner');
    if (!box) return;
    const previousScene=$('bbScene');
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
          <div class="pl-q"><label>${T('Coffee', 'קפה')} <small class="bb-q-note">${plan ? T(`${plan.jugs} × 5L jugs`, `${plan.jugs} ג'ריקנים של 5 ל׳`) : ''}</small></label>${coffeeHtml(plan)}</div>
          <div class="pl-q"><label>${T('Milk', 'חלב')}</label>${chips('milk', [['dairy', T('Dairy', 'חלב רגיל')], ['parve', T('Parve', 'פרווה')], ['half', T('Half & half', 'חצי-חצי')]])}</div>
          <div class="pl-q"><label>${T('Serving stations', 'עמדות הגשה')}</label>${chips('points', [[1, '1'], [2, '2'], [3, '3'], [4, '4']], plan?.stations)}${plan && plan.flavours > state.points ? `<small class="bb-q-hint">${T(`Each coffee is served from its own dispenser, so ${plan.flavours} coffees means ${plan.flavours} stations.`, `כל סוג קפה מוגש ממתקן משלו, לכן ${plan.flavours} סוגים = ${plan.flavours} עמדות.`)}</small>` : ''}</div>`
          : `
          <div class="pl-q"><label>${T('Dispenser', 'מתקן')}</label>${chips('dispenser', [['false', T('No', 'לא')], ['true', T('Add one', 'להוסיף')]])}</div>
          <div class="pl-q"><label>${T('Extra syrups', 'סירופים נוספים')}</label>${chips('syrups', [[0, '0'], [1, '1'], [2, '2']])}</div>`}
        </div>
        <aside class="bb-tray">
          <div class="bb-tray-title">${T('Your bar', 'הבר שלכם')}${plan ? `<span>${tiles(plan).reduce((n, x) => n + (x.n || 1), 0)} ${T('items', 'פריטים')}</span>` : ''}</div>
          ${plan ? sceneHtml(plan) : ''}
          ${plan ? `<div class="bb-sum">
            <div class="bb-sum-name">${esc(pname(plan.product))} · ${T(`${plan.tier.guests} guests`, `${plan.tier.guests} אורחים`)}</div>
            ${plan.tooBig ? `<div class="pl-r-note">${T('For a bigger event, message us and we’ll plan it together.', 'לאירוע גדול יותר כתבו לנו ונתכנן יחד.')}</div>` : ''}
            <button type="button" class="pl-order" onclick="plannerOrder()">${T('Order', 'להזמנה')} · ₪<span id="bbTotal">${plan.total}</span></button>
            <button type="button" class="bb-wa" onclick="plannerWhatsApp()">${T('Questions? Message us', 'שאלות? כתבו לנו')}</button>
          </div>` : ''}
        </aside>
      </div>`;
    reconcileScene(previousScene,$('bbScene'));
    if (plan) animateTotal(plan.total);
    layoutScene();
    mini(plan);
    watch();
  }

  document.addEventListener('click', (e) => {
    const box = $('planner');
    if (!box || !box.contains(e.target)) return;
    const jug = e.target.closest('[data-jug]');
    if (jug) { const k = jug.dataset.jug; state.mix[k] = Math.max(0, (state.mix[k] || 0) + Number(jug.dataset.d)); render(); return; }
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
