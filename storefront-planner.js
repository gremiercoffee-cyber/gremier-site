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
  const state = { guests: 50, full: true, milk: 'dairy', milkType: 'oat', parveLiters: null, mix: { house: 0, colomb: 0, decaf: 0 }, points: 1, dispenser: false, syrups: { caramel: false, vanilla: false } };
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
    const plan = { product: p, tier, jugs, mix: {}, classic: jugs, liters: 0, litersIdx: -1, milkLiters: Math.floor(tier.guests / 10), qty: [], checks: [], dispensers: state.full ? 1 : 0, syrups: 0, syrupFlavours: [] };
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
      const milkChoices = milkOptions(p);
      const milk = milkChoices.find(x=>x.key===state.milkType) || milkChoices[0];
      const wanted = state.parveLiters == null ? Math.round(plan.milkLiters / 2) : state.parveLiters;
      const liters = state.milk === 'dairy' ? 0 : Math.max(0,Math.min(plan.milkLiters,wanted));
      if (milk && liters) { plan.litersIdx = milk.index; plan.liters = liters; plan.milkType = milk.key; plan.milkName = name(milk.addon); total += liters * (Number(milk.addon.price) || 0); lines.push(`${liters}L ${plan.milkName}`); }
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
      for(const option of syrupOptions(p)){
        if(!state.syrups[option.key])continue;
        plan.checks.push(option.index);plan.syrupFlavours.push(option.key);
        total+=Number(option.addon.price)||0;lines.push(name(option.addon));
      }
      plan.syrups=plan.syrupFlavours.length;
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
    if(!state.full)for(const key of plan.syrupFlavours||[]){
      t.push({key,pic:key,title:key==='caramel'?T('Caramel syrup','סירופ קרמל'):T('Vanilla syrup','סירופ וניל')});
    }
    if (state.full) {
      // One 1-liter carton per 10 guests.
      const parve = plan.liters, dairy = Math.max(0, plan.milkLiters - parve);
      if (dairy) t.push({ key: 'milk', pic: 'milk', n: dairy, title: T('Milk', 'חלב'), sub: T('1L cartons', 'קרטונים של ליטר') });
      if (parve) t.push({ key: 'parve', pic: 'milk', n: parve, tag: plan.milkName, title: plan.milkName, sub: T('1L cartons', 'קרטונים של ליטר') });
    }
    t.push({ key: 'cups', pic: 'cups', n: plan.tier.guests, title: T('Cups', 'כוסות') });
    t.push({ key: 'straws', pic: 'straws', n: plan.tier.guests, title: T('Straws', 'קשיות') });
    return t;
  }

  let lastTotal = null;
  const MASTER = '/bar/studio/bar-master-v3.webp?v=1';
  function itemArt(item) {
    const r=item.region;
    const label=item.kind==='coffee'&&item.variant!=='classic'
      ? `<span class="bs-coffee-label bs-label-${item.variant}"><small>${item.variant==='house'?'MEDIUM ROAST':item.variant==='colomb'?'LIGHT ROAST':'CAFFEINE FREE'}</small><b>${item.variant==='house'?'House Blend':item.variant==='colomb'?'Colombia':'Decaf'}</b></span>` : '';
    const milkNames={oat:T('Oat','שיבולת שועל'),almond:T('Almond','שקדים'),soy:T('Soy','סויה'),parve:T('Parve','פרווה')};
    const parve=item.kind==='milk'&&item.variant!=='dairy'?`<span class="bs-parve-label">${esc(milkNames[item.variant]||item.variant)}</span>`:'';
    return `<div class="bs-art" style="width:${r.w}px;height:${352-r.y}px;transform:scale(${item.sx},${item.sy})"><div class="bs-window" style="width:${r.w}px;height:${397-r.y}px"><img class="bs-master" src="${MASTER}" alt="" style="left:${-r.x}px;top:${-r.y}px" draggable="false">${item.kind==='disp'?'<img class="bs-emblem" src="/bar/studio/brand-mark.svg?v=1" alt="">':''}${label}${parve}</div></div>`;
  }
  function sceneHtml(plan) {
    const list=tiles(plan);
    const layout=window.CoffeeBarScene.layout({classic:plan.classic,mix:plan.mix,dispensers:plan.dispensers,
      milkLiters:state.full?plan.milkLiters:0,parveLiters:plan.liters,milkType:plan.milkType,syrupFlavours:state.full?['caramel','vanilla']:plan.syrupFlavours,guests:plan.tier.guests});
    const ratio=layout.width/(352+layout.width*.135+32);
    const items=layout.items.map((item,index)=>`<div class="bs-object drop" data-instance="${item.id}" data-kind="${item.kind}" data-variant="${item.variant}" data-units="${item.units}" style="left:${item.x}px;bottom:${item.bottom}px;width:${item.w}px;height:${item.h}px;z-index:${item.z};--d:${Math.min(300,index*22)}ms">${itemArt(item)}</div>`).join('');
    const legend=list.map(x=>`<span>${x.n>1?`<b>${x.n}×</b> `:''}${esc(x.title)}</span>`).join('');
    return `<div class="bs bs-live" id="bbScene" style="--scene-ratio:${ratio}" role="img" aria-label="${esc(T('Your selected coffee bar','בר הקפה שבחרתם'))}"><div class="bs-wall"></div><div class="bs-stage" id="bbStage" data-width="${layout.width}" style="width:${layout.width}px">${items}</div><div class="bs-counter"><img class="bs-logo" src="/bar/studio/brand-mark.svg?v=1" alt="Gremier Coffee Co."></div></div><div class="bs-legend">${legend}</div>`;
  }
  // Retain each physical item, slide it into place, and animate only additions/swaps.
  function reconcileScene(previous,next){
    if(!previous||!next)return;
    const oldStage=previous.querySelector('.bs-stage'),newStage=next.querySelector('.bs-stage');
    const reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
    const pieces=new Map([...oldStage.querySelectorAll('.bs-object:not(.leaving)')].map(el=>[el.dataset.instance,el]));
    newStage.querySelectorAll('.bs-object').forEach(el=>{
      const old=pieces.get(el.dataset.instance);if(!old||old.dataset.variant!==el.dataset.variant)return;
      const before={x:parseFloat(old.style.left),bottom:parseFloat(old.style.bottom),w:parseFloat(old.style.width),h:parseFloat(old.style.height)};
      old.classList.remove('drop');old.style.cssText=el.style.cssText;old.dataset.units=el.dataset.units;
      old.querySelector('.bs-art').style.cssText=el.querySelector('.bs-art').style.cssText;
      const dx=before.x-parseFloat(el.style.left),dy=parseFloat(el.style.bottom)-before.bottom;
      const sx=before.w/parseFloat(el.style.width),sy=before.h/parseFloat(el.style.height);
      if(!reduce&&(Math.abs(dx)>.5||Math.abs(dy)>.5||Math.abs(sx-1)>.01||Math.abs(sy-1)>.01)){
        old.getAnimations().forEach(animation=>animation.cancel());
        old.animate([{transform:`translate(${dx}px,${dy}px) scale(${sx},${sy})`},{transform:'none'}],{duration:500,easing:'cubic-bezier(.22,1,.36,1)'});
      }
      el.replaceWith(old);pieces.delete(el.dataset.instance);
    });
    previous.style.setProperty('--scene-ratio',next.style.getPropertyValue('--scene-ratio'));
    oldStage.style.width=newStage.style.width;oldStage.dataset.width=newStage.dataset.width;
    if(newStage.style.getPropertyValue('--z'))oldStage.style.setProperty('--z',newStage.style.getPropertyValue('--z'));
    oldStage.replaceChildren(...newStage.childNodes);
    if(!reduce)pieces.forEach(el=>{
      el.classList.remove('drop');el.classList.add('leaving');oldStage.append(el);
      const fade=el.animate([{opacity:1,transform:'none'},{opacity:0,transform:'translateY(22px) scale(.96)'}],{duration:220,fill:'forwards'});fade.onfinish=()=>el.remove();
    });
    next.replaceWith(previous);
  }
  function layoutScene(){
    const scene=$('bbScene'),stage=$('bbStage');if(!scene||!stage)return;
    const room=scene.clientHeight-parseFloat(getComputedStyle(stage).bottom)-12;
    stage.style.setProperty('--z',Math.max(.1,Math.min(1.4,(scene.clientWidth-20)/Number(stage.dataset.width),room/352)).toFixed(3));
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
    const previous=el.querySelector('.bs');
    const scene=$('bbScene')?.cloneNode(true);if(!scene)return;
    scene.querySelectorAll('.leaving').forEach(node=>node.remove());
    const thumbStage=scene.querySelector('.bs-stage');
    const thumbHeight=700/Number(scene.style.getPropertyValue('--scene-ratio'));
    thumbStage.style.setProperty('--z',Math.min(680/Number(thumbStage.dataset.width),(thumbHeight-97)/352).toFixed(3));
    scene.removeAttribute('id');scene.removeAttribute('role');scene.removeAttribute('aria-label');scene.querySelectorAll('[id]').forEach(node=>node.removeAttribute('id'));
    const picture=document.createElement('span');picture.className='bb-thumb-picture';const world=document.createElement('span');world.className='bb-thumb-world';world.style.height=thumbHeight+'px';world.style.top=Math.max(0,(85-thumbHeight*.203)/2)+'px';world.append(scene);reconcileScene(previous,scene);picture.append(world);
    const label=document.createElement('span');label.className='bb-thumb-label';label.textContent=T('Your bar ↗','הבר שלכם ↗');el.replaceChildren(picture,label);
  }
  function syncMini(){
    const el=$('bbMini'),box=$('planner');if(!el)return;
    const scene=$('bbScene'),qs=box?.querySelector('.bb-qs'),onPage=$('coffeebarsPage')?.classList.contains('active');
    if(!onPage||!scene||!qs){el.classList.remove('on');document.body.classList.remove('bb-mini-on');return;}
    const q=qs.getBoundingClientRect(),t=scene.getBoundingClientRect(),vh=innerHeight;
    const choosing=q.bottom>90&&q.top<vh-100,fullVisible=t.top>=80&&t.bottom<=vh-85;
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
  window.openCoffeeBarBuilder = function(options={}) {
    state.guests=options.guests||25;state.full=options.full!==false;
    state.mix={house:0,colomb:0,decaf:0,...(options.mix||{})};state.points=1;state.dispenser=false;state.milk='dairy';state.parveLiters=null;
    state.syrups={caramel:!!options.caramel,vanilla:!!options.vanilla};
    if(typeof showPage==='function')showPage('coffeebars');
    render();$('planner')?.scrollIntoView({behavior:'smooth',block:'start'});
  };
  window.plannerWhatsApp = function () {
    const plan = suggestion();
    const coffee = plan ? [plan.classic ? `${plan.classic}× Classic` : '', ...FLAVOURS.filter(([k]) => plan.mix[k]).map(([k, , en]) => `${plan.mix[k]}× ${en}`)].filter(Boolean).join(' + ') + ' (5L)' : 'Classic';
    const milk = plan ? `${plan.milkLiters-plan.liters}L ${T('dairy','חלב רגיל')}${plan.liters?` + ${plan.liters}L ${plan.milkName}`:''}` : '';
    const text = he()
      ? `היי! אני מתכנן/ת אירוע ל-${state.guests} אורחים. ${state.full ? `בר מלא, חלב ${milk}, קפה ${coffee}, ${state.points} עמדות הגשה.` : 'רק הקפה.'}${plan ? ` מה שבניתי באתר: ${plan.product.name_he || plan.product.name_en} ל-${plan.tier.guests} אורחים, ₪${plan.total}.` : ''} יש לי כמה שאלות:`
      : `Hi! I'm planning an event for ${state.guests} guests. ${state.full ? `Full bar, ${milk} milk, ${coffee} coffee, ${state.points} serving point${state.points > 1 ? 's' : ''}.` : 'Just the coffee.'}${plan ? ` What I built on the site: ${plan.product.name_en} for ${plan.tier.guests} guests, ₪${plan.total}.` : ''} I have a few questions:`;
    window.open(`https://wa.me/${WA}?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
  };

  const chips = (key, options, current = state[key]) => `<div class="pl-chips" data-key="${key}">${options.map(([v, label]) => `<button type="button" data-v="${esc(v)}" class="${String(current) === String(v) ? 'on' : ''}">${label}</button>`).join('')}</div>`;
  let classicSwap = null;
  function coffeeOptions(plan) {
    const addons=addonsOf(plan.product);
    return FLAVOURS.map(([key,re,en,hb])=>({key,label:T(en,hb),addon:addons.find(a=>(a.per_jug||a.group)&&re.test(a.name))})).filter(x=>x.addon);
  }
  function swapClassic(key,mode) {
    const plan=suggestion();
    if(!plan||!coffeeOptions(plan).some(x=>x.key===key))return;
    if(mode==='restore'&&(plan.mix[key]||0)>0)state.mix[key]--;
    if(mode==='upgrade'&&plan.classic>0)state.mix[key]=(state.mix[key]||0)+1;
    classicSwap=null;
  }
  function coffeeHtml(plan) {
    if (!plan) return '';
    const options=coffeeOptions(plan);
    const row=(label,n,key,price)=>{
      const classic=key==='classic';
      const canAdd=classic?plan.classic<plan.jugs:plan.classic>0;
      const canRemove=n>0&&(!classic||options.length>0);
      return `<div class="bb-jug"><span class="bb-jug-name">${label} <small>${classic?T('included','כלול'):`+₪${price} ${T('per jug',"לג'ריקן")}`}</small></span><span class="bb-jug-step"><button type="button" data-jug="${key}" data-d="-1" ${canRemove?'':'disabled'} aria-label="${T('Fewer '+label,'פחות '+label)}">−</button><b>${n}</b><button type="button" data-jug="${key}" data-d="1" ${canAdd?'':'disabled'} aria-label="${T('More '+label,'עוד '+label)}">+</button></span></div>`;
    };
    const choices=classicSwap?options.filter(x=>classicSwap==='upgrade'||(plan.mix[x.key]||0)>0):[];
    const picker=choices.length?`<div class="bb-classic-picker" role="group" aria-label="${T('Swap coffee','החלפת קפה')}"><button type="button" class="bb-swap-close" data-close-swap aria-label="${T('Close coffee choices','סגירת אפשרויות הקפה')}">×</button>${choices.map(x=>`<button type="button" data-classic-swap="${x.key}" data-swap-mode="${classicSwap}">${classicSwap==='restore'?`${x.label} → ${T('Classic','קלאסיק')}`:`${T('Classic','קלאסיק')} → ${x.label} <small>+₪${Number(x.addon.price)||0}</small>`}</button>`).join('')}</div>`:'';
    return `<div class="bb-jugs">${row(T('Classic','קלאסיק'),plan.classic,'classic',0)}${picker}${options.map(x=>row(x.label,plan.mix[x.key]||0,x.key,Number(x.addon.price)||0)).join('')}</div>`;
  }
  function milkOptions(p) {
    return addonsOf(p).map((addon,index)=>({addon,index,key:addon.milk_type||'parve'})).filter(x=>x.addon.per_liter&&!x.addon.legacy_milk);
  }
  function milkHtml(plan) {
    const options=plan?milkOptions(plan.product):[];
    return chips('milk',[['dairy',T('Dairy','חלב רגיל')],['parve',T('Some parve','גם פרווה')]])+(state.milk==='dairy'?'':`
      <div class="bb-milk-options">${chips('milkType',options.map(x=>[x.key,esc(name(x.addon))]))}
      <div class="bb-milk-amount"><span>${T('Parve litres','ליטרים פרווה')} <small>+₪${Number(options.find(x=>x.key===state.milkType)?.addon.price||options[0]?.addon.price)||0}/${T('litre','ליטר')}</small></span>
      <div class="pd-l-step"><button type="button" data-milk-step="-1" aria-label="${T('Less parve milk','פחות חלב פרווה')}" ${!plan?.liters?'disabled':''}>−</button><b>${plan?.liters||0}</b><button type="button" data-milk-step="1" aria-label="${T('More parve milk','עוד חלב פרווה')}" ${plan?.liters>=plan?.milkLiters?'disabled':''}>+</button></div></div>
      <small class="bb-q-hint">${plan?T(`${plan.milkLiters-plan.liters}L dairy + ${plan.liters}L ${plan.milkName||'parve'}`,`${plan.milkLiters-plan.liters} ל׳ חלב רגיל + ${plan.liters} ל׳ ${plan.milkName||'פרווה'}`):''}</small></div>`);
  }
  function takeHomeHtml() {
    const available=all().filter(p=>!p.is_coffee_bar&&p.is_active!==false&&!/syrup|סירופ/i.test(p.name_en||p.name_he||''));
    const picks=[...available.filter(p=>p.category==='minis').slice(0,3),...available.filter(p=>p.category==='bottles').slice(0,3)];
    if(!picks.length)return '';
    return `<section class="bb-take-home"><h3>${T('Coffee for home, too?','קפה גם לבית?')}</h3><p>${T('Add a mini four-pack or a litre bottle for later.','הוסיפו מארז רביעיית מיני או בקבוק ליטר לאחר כך.')}</p><div class="bb-home-products">${picks.map(p=>`<button type="button" data-take-home="${esc(p.id)}">${p.images?.[0]?`<img src="${esc(p.images[0])}" alt="" loading="lazy">`:''}<span>${esc(pname(p))}<small>₪${Number(p.price)||0}</small></span><b>+</b></button>`).join('')}</div></section>`;
  }
  function syrupOptions(p) {
    return addonsOf(p).map((addon,index)=>({addon,index,key:addon.bar_syrup||(/^Caramel syrup$/i.test(addon.name)?'caramel':/^Vanilla syrup$/i.test(addon.name)?'vanilla':null)})).filter(x=>x.key==='caramel'||x.key==='vanilla');
  }
  function syrupHtml(plan) {
    if(!plan)return '';
    const options=syrupOptions(plan.product);
    if(!options.length)return `<small role="status">${T('Loading syrup choices…','טוען אפשרויות סירופ…')}</small>`;
    return `<div class="bb-syrup-choices">${options.map(x=>`<label><input type="checkbox" data-syrup="${x.key}" ${state.syrups[x.key]?'checked':''}><span>${esc(name(x.addon))}</span><small>+₪${Number(x.addon.price)||0}</small></label>`).join('')}</div>`;
  }
  function basicDispenserLabel(plan) {
    const addon=plan&&addonsOf(plan.product).find(a=>/dispenser/i.test(a.name));
    return T('Add one','להוסיף')+(addon?' · ₪'+(Number(addon.price)||0):'');
  }
  function barChoice() {
    const pick = (full, p, title, sub) => `<button type="button" class="bb-bar ${state.full === full ? 'on' : ''}" data-full="${full}">
        ${p && p.images && p.images[0] ? `<img src="${esc(typeof cloudinaryOptimize === 'function' ? cloudinaryOptimize(p.images[0], 200) : p.images[0])}" alt="">` : ''}
        <span><b>${title}</b><small>${sub}</small></span></button>`;
    return `<div class="bb-bars">${pick(true, premium(), T('Full bar', 'בר מלא'), T('Dispenser, milk, 3 syrups, cups', 'מתקן, חלב, 3 סירופים, כוסות'))}${pick(false, basic(), T('Just the coffee', 'רק הקפה'), T('Coffee, cups, straws & sugar syrup', 'קפה, כוסות, קשיות וסירופ סוכר'))}</div>`;
  }
  function render() {
    const box = $('planner');
    if (!box) return;
    const previousScene=$('bbScene');
    const plan = suggestion();
    const tierChips = (plan ? tiersOf(plan.product) : []).map((t) => [t.guests, String(t.guests)]);
    box.innerHTML = `
      ${window.CoffeeBarOffers?.builderBanner()||''}
      <div class="bb-head"><h2>${T('Build your coffee bar', 'בנו את בר הקפה שלכם')}</h2></div>
      <div class="bb-grid">
        <div class="bb-qs">
          <div class="pl-q"><label>${T('Guests', 'אורחים')}</label>
            <div class="pl-guests">${chips('guests', tierChips.length ? tierChips : [[25, '25'], [50, '50'], [75, '75'], [100, '100']])}<input type="number" min="5" max="500" inputmode="numeric" value="${state.guests}" id="plGuests" class="form-input" aria-label="${T('Number of guests', 'מספר אורחים')}"></div></div>
          <div class="pl-q"><label>${T('Bar', 'בר')}</label>${barChoice()}</div>
          ${state.full ? `
          <div class="pl-q"><label>${T('Coffee', 'קפה')} <small class="bb-q-note">${plan ? T(`${plan.jugs} × 5L jugs`, `${plan.jugs} ג'ריקנים של 5 ל׳`) : ''}</small></label>${coffeeHtml(plan)}</div>
          <div class="pl-q"><label>${T('Milk', 'חלב')}</label>${milkHtml(plan)}</div>
          <div class="pl-q"><label>${T('Serving stations', 'עמדות הגשה')}</label>${chips('points', [[1, '1'], [2, '2'], [3, '3'], [4, '4']], plan?.stations)}${plan && plan.flavours > state.points ? `<small class="bb-q-hint">${T(`Each coffee is served from its own dispenser, so ${plan.flavours} coffees means ${plan.flavours} stations.`, `כל סוג קפה מוגש ממתקן משלו, לכן ${plan.flavours} סוגים = ${plan.flavours} עמדות.`)}</small>` : ''}</div>`
          : `
          <div class="pl-q"><label>${T('Dispenser', 'מתקן')}</label>${chips('dispenser', [['false', T('No', 'לא')], ['true', basicDispenserLabel(plan)]])}</div>
          <div class="pl-q"><label>${T('Extra syrups', 'סירופים נוספים')}</label>${syrupHtml(plan)}</div>`}
        </div>
        <aside class="bb-tray">
          <div class="bb-tray-title">${T('Your bar', 'הבר שלכם')}</div>
          ${plan ? sceneHtml(plan) : ''}
          ${plan ? `<div class="bb-sum">
            <div class="bb-sum-name">${esc(pname(plan.product))} · ${T(`${plan.tier.guests} guests`, `${plan.tier.guests} אורחים`)}</div>
            ${plan.tooBig ? `<div class="pl-r-note">${T('For a bigger event, message us and we’ll plan it together.', 'לאירוע גדול יותר כתבו לנו ונתכנן יחד.')}</div>` : ''}
            <button type="button" class="pl-order" onclick="plannerOrder()">${T('Order', 'להזמנה')} · ₪<span id="bbTotal">${plan.total}</span></button>
            <button type="button" class="bb-wa" onclick="plannerWhatsApp()">${T('Questions? Message us', 'שאלות? כתבו לנו')}</button>
          </div>` : ''}
        </aside>
      </div>
      ${takeHomeHtml()}`;
    reconcileScene(previousScene,$('bbScene'));
    if (plan) animateTotal(plan.total);
    layoutScene();
    mini(plan);
    watch();
  }

  document.addEventListener('click', (e) => {
    const box = $('planner');
    if (!box || !box.contains(e.target)) return;
    const milkStep=e.target.closest('[data-milk-step]');
    if(milkStep){const plan=suggestion();state.parveLiters=Math.max(0,Math.min(plan.milkLiters,plan.liters+Number(milkStep.dataset.milkStep)));render();return;}
    const take=e.target.closest('[data-take-home]');
    if(take){openProductDrawer(take.dataset.takeHome);return;}
    const syrup=e.target.closest('input[data-syrup]');
    if(syrup){state.syrups[syrup.dataset.syrup]=syrup.checked;render();return;}
    const swap=e.target.closest('[data-classic-swap]');
    if(swap){swapClassic(swap.dataset.classicSwap,swap.dataset.swapMode);render();return;}
    if(e.target.closest('[data-close-swap]')){classicSwap=null;render();return;}
    const jug = e.target.closest('[data-jug]');
    if(jug){
      const k=jug.dataset.jug,d=Number(jug.dataset.d);classicSwap=null;
      if(k==='classic'){
        const plan=suggestion(),mode=d>0?'restore':'upgrade';
        const choices=coffeeOptions(plan).filter(x=>mode==='upgrade'||(plan.mix[x.key]||0)>0);
        if(choices.length===1)swapClassic(choices[0].key,mode);else if(choices.length)classicSwap=mode;
      }else state.mix[k]=Math.max(0,(state.mix[k]||0)+d);
      render();return;
    }
    classicSwap=null;
    const bar = e.target.closest('.bb-bar');
    if (bar) { state.full = bar.dataset.full === 'true'; render(); return; }
    const b = e.target.closest('.pl-chips button');
    if (!b) return;
    const key = b.parentElement.dataset.key, v = b.dataset.v;
    if(key==='milk'&&v!==state.milk)state.parveLiters=null;
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
