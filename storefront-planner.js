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
  // One premium package, with optional upgrades priced from the live catalogue.
  const premium = () => all().find((p) => addonsOf(p).some((a) => a.per_liter || a.group)) || all().find((p) => /premium/i.test(p.name_en || ''));

  // mix: how many 5L jugs of each upgrade coffee (the rest of the jugs are the included Classic).
  const state = { guests: 50, milk: 'dairy', milkMix: null, mix: { house: 0, colomb: 0, decaf: 0 }, points: 1, lids: false, syrups: { caramel: 0, vanilla: 0, sugar: 0 }, extras: {} };
  // Everyday products that can ride along with the bar at their full price.
  const extraProduct = (id) => all().find((p) => String(p.id) === String(id) && p.is_active !== false && !p.is_coffee_bar && ['bottles', 'minis', 'bulk'].includes(p.category));
  // The 5L jugs on their own (not the 3-jug pack): an extra jerry can of coffee for the bar.
  const jugProducts = () => all().filter((p) => p.category === 'bulk' && p.is_active !== false && /5\s*l/i.test(p.name_en || '') && !/3\s*[×x]/i.test(p.name_en || ''));
  const jugVariant = (p) => (/house/i.test(p.name_en || '') ? 'house' : /colomb/i.test(p.name_en || '') ? 'colomb' : /decaf/i.test(p.name_en || '') ? 'decaf' : 'classic');
  const FLAVOURS = [['house', /house/i, 'House Blend', 'האוס בלנד'], ['colomb', /colomb/i, 'Colombian', 'קולומביה'], ['decaf', /decaf/i, 'Decaf', 'נטול קפאין']];
  const name = (a) => (he() && a.name_he ? a.name_he : a.name);
  const pname = (p) => (he() ? (p.name_he || p.name_en) : p.name_en);

  function suggestion() {
    const p = premium();
    if (!p) return null;
    const tiers = tiersOf(p);
    const tier = tiers.find((t) => t.guests >= state.guests) || tiers[tiers.length - 1];
    if (!tier) return null;
    const addons = addonsOf(p);
    const lines = [];
    let total = tier.price;
    const jugs = jugsFor(tier.guests);
    const plan = { product: p, tier, jugs, mix: {}, classic: jugs, liters: 0, milk: [], milkLiters: Math.floor(tier.guests / 10), qty: [], checks: [], dispensers: 1, syrupCounts: {caramel:1,vanilla:1,sugar:1} };
    {
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
      if (state.milkMix == null && state.milk !== 'dairy' && milkChoices.length) state.milkMix = {[milkChoices[0].key]:Math.round(plan.milkLiters / 2)};
      if(state.milk==='all_parve' && milkChoices.length){
        const mix=state.milkMix||{}, normalized={};let remaining=plan.milkLiters;
        for(const choice of milkChoices){normalized[choice.key]=Math.min(remaining,Math.max(0,Math.floor(Number(mix[choice.key])||0)));remaining-=normalized[choice.key];}
        const preferred=milkChoices.find(c=>normalized[c.key]>0)||milkChoices[0];
        normalized[preferred.key]+=remaining;state.milkMix=normalized;
      }
      let milkLeft=plan.milkLiters;
      for(const choice of milkChoices){
        const liters=state.milk==='dairy'?0:Math.min(milkLeft,Math.max(0,Math.floor(Number(state.milkMix?.[choice.key])||0)));
        if(state.milk!=='dairy'&&state.milkMix)state.milkMix[choice.key]=liters;
        milkLeft-=liters;
        if(!liters)continue;
        plan.milk.push({...choice,liters,label:name(choice.addon)});plan.liters+=liters;
        total+=liters*(Number(choice.addon.price)||0);lines.push(`${liters}L ${name(choice.addon)}`);
      }
      const disp = addons.findIndex((a) => /dispenser/i.test(a.name) && Number(a.max) > 1);
      const extra = Math.min(Math.max(0, plan.stations - 1), disp >= 0 ? Number(addons[disp].max) : 0);
      if (disp >= 0 && extra) { plan.qty.push([disp, extra]); plan.dispensers += extra; total += extra * (Number(addons[disp].price) || 0); lines.push(T(`${extra} extra dispenser${extra > 1 ? 's' : ''}`, `${extra} מתקנים נוספים`)); }
    }
    for(const option of syrupOptions(p)){
      const n=Math.max(0,Math.min(Number(option.addon.max)||6,Math.floor(Number(state.syrups[option.key])||0)));
      state.syrups[option.key]=n;
      plan.syrupCounts[option.key]+=n;
      if(n){plan.qty.push([option.index,n]);total+=n*Number(option.addon.price);lines.push(`${n}× ${name(option.addon)}`);}
    }
    const lidIndex=addons.findIndex(a=>Number(a.bar_lids)>0);
    plan.lids=0;plan.lidPacks=0;plan.lidPrice=0;
    if(state.lids && lidIndex>=0){
      plan.lidPacks=Math.ceil(tier.guests/Number(addons[lidIndex].bar_lids));
      plan.lids=plan.lidPacks*Number(addons[lidIndex].bar_lids);
      plan.lidPrice=plan.lidPacks*Number(addons[lidIndex].price);
      plan.qty.push([lidIndex,plan.lidPacks]);total+=plan.lidPrice;lines.push(`${plan.lids} ${T('domed lids','מכסים קמורים')}`);
    }
    plan.extras = Object.entries(state.extras || {}).map(([id, qty]) => ({ p: extraProduct(id), qty: Number(qty) || 0 })).filter((x) => x.p && x.qty > 0)
      .map(({ p, qty }) => ({ product_id: String(p.id), name_en: p.name_en, name_he: p.name_he, price: Number(p.price) || 0, qty, jug: jugProducts().includes(p) ? jugVariant(p) : null }));
    for (const x of plan.extras) { total += x.price * x.qty; lines.push(`+${x.qty}× ${he() ? (x.name_he || x.name_en) : x.name_en}`); }
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
    for(const [key,en,hb] of [['caramel','Caramel syrup','סירופ קרמל'],['vanilla','Vanilla syrup','סירופ וניל'],['sugar','Sugar syrup','סירופ סוכר']])
      t.push({key,pic:key,n:plan.syrupCounts[key],title:T(en,hb)});
    {
      // One 1-liter carton per 10 guests.
      const parve = plan.liters, dairy = Math.max(0, plan.milkLiters - parve);
      if (dairy) t.push({ key: 'milk', pic: 'milk', n: dairy, title: T('Milk', 'חלב'), sub: T('1L cartons', 'קרטונים של ליטר') });
      for(const milk of plan.milk) t.push({key:'milk-'+milk.key,pic:'milk',n:milk.liters,tag:milk.label,title:milk.label,sub:T('1L cartons','קרטונים של ליטר')});
    }
    for (const x of plan.extras || []) t.push({ key: 'extra-' + x.product_id, n: x.qty, title: (x.jug ? T('Extra ', 'עוד ') : '') + (he() ? (x.name_he || x.name_en) : x.name_en) });
    t.push({ key: 'cups', pic: 'cups', n: plan.tier.guests, title: T('Cups', 'כוסות') });
    if(plan.lids)t.push({key:'lids',pic:'lids',n:plan.lids,title:T('Domed lids','מכסים קמורים')});
    t.push({ key: 'straws', pic: 'straws', n: plan.tier.guests, title: T('Straws', 'קשיות') });
    return t;
  }

  let lastTotal = null;
  const MASTER = '/bar/studio/bar-master-dark-v4.webp?v=1';
  function itemArt(item) {
    const r=item.region;
    if(item.kind==='lids')return `<div class="bs-art" style="width:${r.w}px;height:${352-r.y}px;transform:scale(${item.sx},${item.sy})"><img src="/bar/studio/domed-lids-stack-v1.webp" alt="" style="width:100%;height:100%;object-fit:contain;object-position:bottom" draggable="false"></div>`;
    const label=item.kind==='coffee'&&item.variant!=='classic'
      ? `<span class="bs-coffee-label bs-label-${item.variant}"><small>${item.variant==='house'?'MEDIUM ROAST':item.variant==='colomb'?'LIGHT ROAST':'CAFFEINE FREE'}</small><b>${item.variant==='house'?'House Blend':item.variant==='colomb'?'Colombia':'Decaf'}</b></span>` : '';
    const milkFrames={oat:{x:260,y:40,w:324,h:805},almond:{x:732,y:37,w:320,h:809},soy:{x:1197,y:38,w:322,h:808}};
    const frame=item.kind==='milk'?milkFrames[item.variant]:null;
    if(frame){
      const x=r.w/frame.w,y=(352-r.y)/frame.h;
      return `<div class="bs-art" style="width:${r.w}px;height:${352-r.y}px;transform:scale(${item.sx},${item.sy})"><div class="bs-window" style="width:${r.w}px;height:${352-r.y}px"><img class="bs-milk-sheet" src="/bar/studio/milk-cartons-v1.png" alt="" draggable="false" style="width:${1781*x}px;height:${883*y}px;left:${-frame.x*x}px;top:${-frame.y*y}px"></div></div>`;
    }
    return `<div class="bs-art" style="width:${r.w}px;height:${352-r.y}px;transform:scale(${item.sx},${item.sy})"><div class="bs-window" style="width:${r.w}px;height:${397-r.y}px"><img class="bs-master" src="${MASTER}" alt="" style="left:${-r.x}px;top:${-r.y}px" draggable="false">${item.kind==='disp'?'<img class="bs-emblem" src="/bar/studio/brand-mark.svg?v=1" alt="">':''}${label}</div></div>`;
  }
  function sceneHtml(plan) {
    const list=tiles(plan);
    const layout=window.CoffeeBarScene.layout({extraCoffee:(plan.extras||[]).flatMap(x=>x.jug?Array(x.qty).fill(x.jug):[]),classic:plan.classic,mix:plan.mix,dispensers:plan.dispensers,
      milkLiters:plan.milkLiters,parveLiters:plan.liters,milkMix:Object.fromEntries(plan.milk.map(m=>[m.key,m.liters])),syrupCounts:plan.syrupCounts,lids:plan.lids,guests:plan.tier.guests});
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
  addEventListener('resize', () => requestAnimationFrame(()=>{layoutScene();mini(suggestion());syncMini();}));

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
    const thumbWidth=el.clientWidth-14||142,thumbScale=thumbWidth/700,frameHeight=thumbWidth*.6;
    const picture=document.createElement('span');picture.className='bb-thumb-picture';picture.style.height=frameHeight+'px';const world=document.createElement('span');world.className='bb-thumb-world';world.style.height=thumbHeight+'px';world.style.transform=`scale(${thumbScale})`;world.style.top=Math.max(0,(frameHeight-thumbHeight*thumbScale)/2)+'px';world.append(scene);reconcileScene(previous,scene);picture.append(world);
    const label=document.createElement('span');label.className='bb-thumb-label';label.textContent=T('Your bar','הבר שלכם')+' · ₪'+plan.total+' ↗';el.replaceChildren(picture,label);
  }
  function syncMini(){
    const el=$('bbMini'),box=$('planner');if(!el)return;
    const scene=$('bbScene'),qs=box?.querySelector('.bb-qs'),onPage=$('coffeebarsPage')?.classList.contains('active');
    if(!onPage||!scene||!qs){el.classList.remove('on');document.body.classList.remove('bb-mini-on');return;}
    const q=qs.getBoundingClientRect(),t=box.querySelector('.bb-tray').getBoundingClientRect(),vh=innerHeight;
    const choosing=q.bottom>90&&q.top<vh-100,pastPreview=t.bottom<=96;
    const covered=!!document.querySelector('#pdDrawer.open,#cartDrawer.open,.modal-overlay.open');
    el.classList.toggle('on',choosing&&pastPreview&&!covered);document.body.classList.toggle('bb-mini-on',el.classList.contains('on'));
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
        if(typeof pdSetLiters==='function')plan.milk.forEach(milk=>pdSetLiters(milk.index,milk.liters));
        const isJug = ([i]) => !!getProductAddons(plan.product)[i]?.per_jug;
        [...plan.qty.filter((q) => !isJug(q)), ...plan.qty.filter(isJug)].forEach(([i, n]) => typeof pdSetQty === 'function' && pdSetQty(i, n));
        plan.checks.forEach((i) => { const cb = document.querySelector(`#pdAddonsSection input[data-addon-idx="${i}"]`); if (cb && !cb.checked) { cb.checked = true; cb.dispatchEvent(new Event('change', { bubbles: true })); } });
        if (typeof pdSetBarExtras === 'function') pdSetBarExtras(plan.extras);
        if (typeof pdUpdateDrawerPrice === 'function') pdUpdateDrawerPrice();
        if (typeof showToast === 'function') showToast(T('We set it up for you — check and book', 'הכנו לכם הכל — בדקו והזמינו'));
      }, 150);
    }, 700);
  };
  window.openCoffeeBarBuilder = function(options={}) {
    state.guests=options.guests||25;
    state.mix={house:0,colomb:0,decaf:0,...(options.mix||{})};state.points=1;state.milk='dairy';state.milkMix=null;
    state.syrups={caramel:0,vanilla:0,sugar:0};state.extras={};state.lids=false;
    if(typeof showPage==='function')showPage('coffeebars');
    render();$('planner')?.scrollIntoView({behavior:'smooth',block:'start'});
  };
  window.plannerWhatsApp = function () {
    const plan = suggestion();
    const coffee = plan ? [plan.classic ? `${plan.classic}× Classic` : '', ...FLAVOURS.filter(([k]) => plan.mix[k]).map(([k, , en]) => `${plan.mix[k]}× ${en}`)].filter(Boolean).join(' + ') + ' (5L)' : 'Classic';
    const milk = plan ? `${plan.milkLiters-plan.liters}L ${T('dairy','חלב רגיל')}${plan.milk.map(m=>` + ${m.liters}L ${m.label}`).join('')}` : '';
    const text = he()
      ? `היי! אני מתכנן/ת אירוע ל-${state.guests} אורחים. בר פרימיום, חלב ${milk}, קפה ${coffee}, ${state.points} עמדות הגשה.${plan ? ` מה שבניתי באתר: ${plan.product.name_he || plan.product.name_en} ל-${plan.tier.guests} אורחים, ₪${plan.total}. ${plan.lines.join(', ')}.` : ''} יש לי כמה שאלות:`
      : `Hi! I'm planning an event for ${state.guests} guests. Premium bar, ${milk} milk, ${coffee} coffee, ${state.points} serving point${state.points > 1 ? 's' : ''}.${plan ? ` What I built on the site: ${plan.product.name_en} for ${plan.tier.guests} guests, ₪${plan.total}. ${plan.lines.join(', ')}.` : ''} I have a few questions:`;
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
    const jugs=jugProducts(),extraJugs=(plan.extras||[]).filter(x=>x.jug);
    const extraRow=jugs.length?`<div class="bb-jug bb-jug-extra"><span class="bb-jug-name">${T('Extra 5L jerry can','ג׳ריקן 5 ל׳ נוסף')} <small>${T('more coffee, full price','עוד קפה, במחיר מלא')}</small></span><span class="bb-jug-step"><button type="button" data-extra-jug-remove ${extraJugs.length?'':'disabled'} aria-label="${T('Remove an extra jerry can','הסרת ג׳ריקן נוסף')}">−</button><b>${extraJugs.reduce((n,x)=>n+x.qty,0)}</b><button type="button" data-extra-jug aria-label="${T('Add an extra jerry can','הוספת ג׳ריקן נוסף')}">+</button></span></div>`:'';
    return `<div class="bb-jugs">${row(T('Classic','קלאסיק'),plan.classic,'classic',0)}${picker}${options.map(x=>row(x.label,plan.mix[x.key]||0,x.key,Number(x.addon.price)||0)).join('')}${extraRow}</div>`;
  }
  function milkOptions(p) {
    return addonsOf(p).map((addon,index)=>({addon,index,key:addon.milk_type||'parve'})).filter(x=>x.addon.per_liter&&!x.addon.legacy_milk);
  }
  function milkHtml(plan) {
    const options=plan?milkOptions(plan.product):[];
    const summary=plan?[(plan.milkLiters>plan.liters?T(`${plan.milkLiters-plan.liters}L dairy`,`${plan.milkLiters-plan.liters} ל׳ חלב רגיל`):null),...plan.milk.map(m=>T(`${m.liters}L ${m.label}`,`${m.liters} ל׳ ${m.label}`))].filter(Boolean).join(' + '):'';
    return chips('milk',[['dairy',T('Dairy','חלב רגיל')],['parve',T('Some parve','גם פרווה')],['all_parve',T('Parve','פרווה')]])+(state.milk==='dairy'?'':`
      <div class="bb-milk-options">${options.map(option=>{
        const liters=plan.milk.find(m=>m.key===option.key)?.liters||0;
        return `<div class="bb-milk-amount"><span>${esc(name(option.addon))}<small>+₪${Number(option.addon.price)||0}/${T('litre','ליטר')}</small></span>
        <div class="pd-l-step"><button type="button" data-milk-kind="${esc(option.key)}" data-milk-step="-1" aria-label="${esc(T('Less '+name(option.addon),'פחות '+name(option.addon)))}" ${!liters?'disabled':''}>−</button><b>${liters}</b><button type="button" data-milk-kind="${esc(option.key)}" data-milk-step="1" aria-label="${esc(T('More '+name(option.addon),'עוד '+name(option.addon)))}" ${(state.milk==='all_parve'?liters>=plan.milkLiters:plan.liters>=plan.milkLiters)?'disabled':''}>+</button></div></div>`;
      }).join('')}
      <small class="bb-q-hint">${esc(summary)}</small>${state.milk==='all_parve'?`<small class="bb-q-hint">${T('All milk is non-dairy. Adjusting a type swaps one litre.','כל החלב צמחי. שינוי סוג מחליף ליטר אחד.')}</small>`:''}</div>`);
  }
  function adjustMilk(kind,delta){
    const plan=suggestion();if(!plan||!milkOptions(plan.product).some(m=>m.key===kind))return;
    const current=plan.milk.find(m=>m.key===kind)?.liters||0;
    if(state.milk==='all_parve'){
      const options=milkOptions(plan.product),mix={...state.milkMix};
      const other=options.filter(x=>x.key!==kind).sort((a,b)=>(mix[b.key]||0)-(mix[a.key]||0))[0];
      if(!other)return;
      if(delta>0 && mix[other.key]>0){mix[other.key]--;mix[kind]++;}
      if(delta<0 && current>0){mix[kind]--;mix[other.key]=(mix[other.key]||0)+1;}
      state.milkMix=mix;return;
    }
    const next=Math.max(0,Math.min(current+Number(delta),current+plan.milkLiters-plan.liters));
    state.milkMix={...(state.milkMix||{}),[kind]:next};
  }
  function takeHomeHtml() {
    const available=all().filter(p=>!p.is_coffee_bar&&p.is_active!==false&&!/syrup|סירופ/i.test(p.name_en||p.name_he||''));
    const picks=[...available.filter(p=>p.category==='minis').slice(0,3),...available.filter(p=>p.category==='bottles').slice(0,3)];
    if(!picks.length)return '';
    return `<section class="bb-take-home"><h3>${T('Coffee for home, too?','קפה גם לבית?')}</h3><p>${T('Added to your coffee bar order and delivered with it.','נוסף להזמנת בר הקפה ומגיע איתו.')}</p><div class="bb-home-products">${picks.map(p=>{const n=Number(state.extras[p.id])||0;return `<div class="bb-home-product${n?' on':''}">${p.images?.[0]?`<img src="${esc(p.images[0])}" alt="" loading="lazy">`:''}<span>${esc(pname(p))}<small>₪${Number(p.price)||0}</small></span>${n?`<span class="bb-home-step"><button type="button" data-take-home="${esc(p.id)}" data-d="-1" aria-label="${esc(T('One less','אחד פחות'))}">−</button><b>${n}</b><button type="button" data-take-home="${esc(p.id)}" data-d="1" aria-label="${esc(T('One more','עוד אחד'))}">+</button></span>`:`<button type="button" class="bb-home-add" data-take-home="${esc(p.id)}" data-d="1" aria-label="${esc(T('Add to my coffee bar','הוספה לבר הקפה'))}">+</button>`}</div>`;}).join('')}</div></section>`;
  }
  function syrupOptions(p) {
    return addonsOf(p).map((addon,index)=>({addon,index,key:addon.bar_syrup})).filter(x=>['caramel','vanilla','sugar'].includes(x.key)&&Number(x.addon.max)>1);
  }
  function lidsHtml(plan){
    const addon=addonsOf(plan.product).find(a=>Number(a.bar_lids)>0);if(!addon)return '';
    const packs=Math.ceil(plan.tier.guests/Number(addon.bar_lids)),price=packs*Number(addon.price);
    return `<div class="pl-q"><h2>${T('Would you like domed lids for your cups?','האם תרצו מכסים קמורים לכוסות?')}</h2><label class="bb-lids-choice"><input type="checkbox" data-bar-lids ${state.lids?'checked':''}><img src="/bar/studio/domed-lids-stack-v1.webp" alt="" loading="lazy"><span>${T(`Add ${packs*Number(addon.bar_lids)} clear domed lids`,`הוסיפו ${packs*Number(addon.bar_lids)} מכסים קמורים שקופים`)}<small>${T('Optional · ₪10 per 25 guests','תוספת לבחירה · ₪10 לכל 25 אורחים')}</small></span><b>+₪${price}</b></label></div>`;
  }
  function syrupHtml(plan) {
    if(!plan)return '';
    return syrupOptions(plan.product).map(x=>{
      const n=Number(state.syrups[x.key])||0;
      return `<div class="bb-jug"><span class="bb-jug-name">${esc(name(x.addon))} <small>+₪${Number(x.addon.price)}</small></span><span class="bb-jug-step"><button type="button" data-syrup="${x.key}" data-syrup-step="-1" aria-label="${esc(T('Less '+name(x.addon),'פחות '+name(x.addon)))}" ${n?'':'disabled'}>−</button><b>${n}</b><button type="button" data-syrup="${x.key}" data-syrup-step="1" aria-label="${esc(T('More '+name(x.addon),'עוד '+name(x.addon)))}" ${n>=Number(x.addon.max)?'disabled':''}>+</button></span></div>`;
    }).join('');
  }
  function renderHero(plan){
    const hero=document.querySelector('#coffeebarsPage .cbp-hero');if(!hero)return;
    const subKey=he()?'cb_hero_sub_he':'cb_hero_sub';
    const intro=(typeof siteSettings!=='undefined'&&siteSettings[subKey])||T("Premium cold brew for your birthday, corporate event, or any occasion — we'll help you choose the right amount for your guest count.",'קולד ברו פרימיום ליום הולדת, אירוע עסקי או כל אירוע — נעזור לכם לבחור את הכמות הנכונה למספר האורחים.');
    const content=`<div class="bb-intro-copy"><h1 class="cbp-hero-title">${T('Gremier <em>Coffee Bars</em>','גרמייר <em>ברי קפה</em>')}</h1><p class="cbp-hero-sub" id="t-cbp-hero-sub">${esc(intro)}</p></div>`;
    if(hero.dataset.builderIntro!==content){hero.innerHTML=content;hero.dataset.builderIntro=content;}
    hero.classList.add('bb-intro');
  }
  function render() {
    const box = $('planner');
    if (!box) return;
    const previousScene=$('bbScene');
    const plan = suggestion();
    // The page shows once the builder can draw (until then its older content stays hidden, so it
    // never flashes); with products loaded but no bar product, it shows as it is.
    $('coffeebarsPage')?.classList.toggle('bb-ready', !!plan || all().length > 0);
    renderHero(plan);
    const tierChips = (plan ? tiersOf(plan.product) : []).map((t) => [t.guests, String(t.guests)]);
    box.innerHTML = `
      ${window.CoffeeBarOffers?.builderBanner()||''}
      <div class="bb-grid">
          <div class="pl-q bb-guest-start"><h2>${T('How many guests are you expecting?', 'כמה אורחים צפויים להגיע?')}</h2>
            <div class="pl-guests">${chips('guests', tierChips.length ? tierChips : [[25, '25'], [50, '50'], [75, '75'], [100, '100']])}<input type="number" min="5" max="500" inputmode="numeric" value="${state.guests}" id="plGuests" class="form-input" aria-label="${T('Number of guests', 'מספר אורחים')}"></div></div>
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
        <h2 class="bb-build-title">${T('Now let’s build your coffee bar','עכשיו בואו נבנה את בר הקפה שלכם')}</h2>
        <div class="bb-qs">
          <div class="pl-q"><h2>${T('Which coffee would you like?', 'איזה קפה תרצו לבחור?')} <small class="bb-q-note">${plan ? T(`${plan.jugs} × 5L jugs`, `${plan.jugs} ג'ריקנים של 5 ל׳`) : ''}</small></h2>${coffeeHtml(plan)}</div>
          <div class="pl-q"><h2>${T('Which milk would you like?', 'איזה חלב תרצו לבחור?')}</h2>${milkHtml(plan)}</div>
          <div class="pl-q"><h2>${T('How many serving stations would you like?', 'כמה עמדות הגשה תרצו?')}</h2>${chips('points', [[1, '1'], [2, '2'], [3, '3'], [4, '4']], plan?.stations)}${plan && plan.flavours > state.points ? `<small class="bb-q-hint">${T(`Each coffee is served from its own dispenser, so ${plan.flavours} coffees means ${plan.flavours} stations.`, `כל סוג קפה מוגש ממתקן משלו, לכן ${plan.flavours} סוגים = ${plan.flavours} עמדות.`)}</small>` : ''}</div>
          ${plan?lidsHtml(plan):''}
          <div class="pl-q"><h2>${T('Would you like any extra syrups?','האם תרצו להוסיף עוד סירופים?')} <small class="bb-q-note">${T('One of each already included','אחד מכל סוג כבר כלול')}</small></h2>${syrupHtml(plan)}</div>
        </div>
      </div>
      ${takeHomeHtml()}
      ${plan ? `<section class="bb-booking" aria-label="${T('Order your coffee bar','הזמנת בר הקפה שלכם')}">
        <div><span>${T(`Coffee bar · ${plan.tier.guests} guests`,`בר קפה · ${plan.tier.guests} אורחים`)}</span><strong>₪${plan.total}</strong></div>
        <button type="button" class="pl-order" onclick="plannerOrder()">${T('Order your coffee bar','להזמנת בר הקפה שלכם')}</button>
        ${plan.tooBig?`<small>${T('For a bigger event, message us and we’ll plan it together.','לאירוע גדול יותר כתבו לנו ונתכנן יחד.')}</small>`:''}
      </section>` : ''}`;
    reconcileScene(previousScene,$('bbScene'));
    if (plan) animateTotal(plan.total);
    layoutScene();
    mini(plan);
    watch();
  }

  // "+" on an extra jerry can asks first: it's a whole extra 5L of coffee at the full price.
  function confirmExtraJug(){
    const jugs=jugProducts();if(!jugs.length)return;
    let el=$('bbJugConfirm');
    if(!el){el=document.createElement('div');el.id='bbJugConfirm';el.className='bb-confirm';document.body.appendChild(el);
      el.addEventListener('click',(ev)=>{
        if(ev.target===el||ev.target.closest('[data-jug-cancel]')){el.classList.remove('open');return;}
        const pick=ev.target.closest('[data-jug-pick]');
        if(pick){const id=pick.dataset.jugPick;state.extras[id]=Math.min(20,(Number(state.extras[id])||0)+1);el.classList.remove('open');render();
          const p=extraProduct(id);if(p&&typeof showToast==='function')showToast(T(`Extra jerry can added: ${pname(p)} +₪${Number(p.price)||0}`,`נוסף ג׳ריקן: ${pname(p)} +₪${Number(p.price)||0}`));}
      });
    }
    const plan=suggestion();
    el.innerHTML=`<div class="bb-confirm-box" role="dialog" aria-modal="true" aria-labelledby="bbJugConfirmTitle">
      <h3 id="bbJugConfirmTitle">${T('Add an extra jerry can?','להוסיף ג׳ריקן נוסף?')}</h3>
      <p>${T(`You're about to add an extra 5L jerry can of cold brew to your order, on top of the ${plan?.jugs||''} already included, at the full price. Is that what you want?`,`אתם עומדים להוסיף להזמנה ג׳ריקן קולד ברו נוסף של 5 ל׳, מעבר ל-${plan?.jugs||''} שכבר כלולים, במחיר מלא. זה מה שרציתם?`)}</p>
      <div class="bb-confirm-picks">${jugs.map(p=>`<button type="button" data-jug-pick="${esc(p.id)}">${p.images?.[0]?`<img src="${esc(p.images[0])}" alt="">`:''}<span>${esc(pname(p))}</span><b>+₪${Number(p.price)||0}</b></button>`).join('')}</div>
      <button type="button" class="bb-confirm-cancel" data-jug-cancel>${T('No, cancel','לא, ביטול')}</button></div>`;
    el.classList.add('open');
    el.querySelector('[data-jug-pick]')?.focus();
  }

  document.addEventListener('click', (e) => {
    const box = $('planner');
    if (!box || !box.contains(e.target)) return;
    const milkStep=e.target.closest('[data-milk-step]');
    if(milkStep){adjustMilk(milkStep.dataset.milkKind,Number(milkStep.dataset.milkStep));render();return;}
    const take=e.target.closest('[data-take-home]');
    if(take){
      const id=take.dataset.takeHome,d=Number(take.dataset.d)||1,p=extraProduct(id);if(!p)return;
      state.extras[id]=Math.max(0,Math.min(20,(Number(state.extras[id])||0)+d));if(!state.extras[id])delete state.extras[id];
      if(d>0&&typeof showToast==='function')showToast(T(`Added to your coffee bar: ${pname(p)} +₪${Number(p.price)||0}`,`נוסף לבר הקפה: ${pname(p)} +₪${Number(p.price)||0}`));
      render();return;
    }
    if(e.target.closest('[data-extra-jug]')){confirmExtraJug();return;}
    if(e.target.closest('[data-extra-jug-remove]')){
      const plan=suggestion(),last=(plan?.extras||[]).filter(x=>x.jug).pop();
      if(last){state.extras[last.product_id]--;if(!state.extras[last.product_id])delete state.extras[last.product_id];render();}
      return;
    }
    if(e.target.matches('[data-bar-lids]')){state.lids=e.target.checked;render();return;}
    const syrup=e.target.closest('[data-syrup-step]');
    if(syrup){state.syrups[syrup.dataset.syrup]=Math.max(0,(Number(state.syrups[syrup.dataset.syrup])||0)+Number(syrup.dataset.syrupStep));render();return;}
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
