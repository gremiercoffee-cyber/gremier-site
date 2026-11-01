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
  const state = { guests: 50, milk: 'dairy', milkMix: null, mix: { house: 0, colomb: 0, decaf: 0 }, points: 1, lids: false, syrups: { caramel: 0, vanilla: 0, sugar: 0 }, extras: {}, deliveryMode: 'event', deliveryDate: '', deliveryTime: '' };
  // Everyday products that can ride along with the bar at their full price.
  const extraProduct = (id) => all().find((p) => String(p.id) === String(id) && p.is_active !== false && !p.is_coffee_bar && ['bottles', 'minis', 'bulk'].includes(p.category));
  // The 5L jugs on their own (not the 3-jug pack): an extra jerry can of coffee for the bar.
  const jugProducts = () => all().filter((p) => p.category === 'bulk' && p.is_active !== false && /5\s*l/i.test(p.name_en || '') && !/3\s*[×x]/i.test(p.name_en || ''));
  const jugVariant = (p) => (/house/i.test(p.name_en || '') ? 'house' : /colomb/i.test(p.name_en || '') ? 'colomb' : /decaf/i.test(p.name_en || '') ? 'decaf' : 'classic');
  const FLAVOURS = [['house', /house/i, 'House Blend', 'האוס בלנד'], ['colomb', /colomb/i, 'Colombian', 'קולומביה'], ['decaf', /decaf/i, 'Decaf', 'נטול קפאין']];
  const name = (a) => (he() && a.name_he ? a.name_he : a.name);
  const pname = (p) => (he() ? (p.name_he || p.name_en) : p.name_en);

  // A bar's choices as a short link code, and back. Only known fields with sane values are taken.
  const toCode=()=>{const j=JSON.stringify({g:state.guests,m:state.milk,mm:state.milkMix,x:state.mix,p:state.points,l:state.lids,s:state.syrups,e:state.extras,d:[state.deliveryMode,state.deliveryDate,state.deliveryTime]});return btoa(unescape(encodeURIComponent(j))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');};
  function fromCode(code){
    try{
      const j=JSON.parse(decodeURIComponent(escape(atob(String(code).replace(/-/g,'+').replace(/_/g,'/')))));
      const n=(v,max)=>Math.max(0,Math.min(max,Math.round(Number(v)||0)));
      const counts=(o,keys,max)=>Object.fromEntries(keys.map(k=>[k,n(o?.[k],max)]));
      return {guests:Math.max(5,n(j.g,500)),milk:['dairy','parve','all_parve'].includes(j.m)?j.m:'dairy',milkMix:j.mm&&typeof j.mm==='object'?j.mm:null,
       mix:counts(j.x,['house','colomb','decaf'],40),points:Math.max(1,n(j.p,4)),lids:j.l===true,syrups:counts(j.s,['caramel','vanilla','sugar'],20),
       deliveryMode:['before','pickup'].includes(j.d?.[0])?j.d[0]:'event',deliveryDate:/^\d{4}-\d{2}-\d{2}$/.test(j.d?.[1]||'')?j.d[1]:'',deliveryTime:/^\d{2}:\d{2}$/.test(j.d?.[2]||'')?j.d[2]:'',
       extras:Object.fromEntries(Object.entries(j.e&&typeof j.e==='object'?j.e:{}).filter(([k])=>/^[\w-]{1,64}$/.test(k)).map(([k,v])=>[k,n(v,20)]).filter(([,v])=>v>0))};
    }catch{return null;}
  }
  let shared=(()=>{try{const c=new URLSearchParams(location.search).get('bar');return c?fromCode(c):null;}catch{return null;}})(),sharedShown=false;
  const toCheckout=(()=>{try{return new URLSearchParams(location.search).get('go')==='checkout';}catch{return false;}})();
  // "Share your coffee bar": choose the kind of link, then share it.
  window.plannerShare=function(){
    let el=$('bbShareSheet');
    if(!el){el=document.createElement('div');el.id='bbShareSheet';el.className='bb-confirm';document.body.appendChild(el);
      el.addEventListener('click',(ev)=>{if(ev.target===el||ev.target.closest('[data-share-cancel]')){el.classList.remove('open');return;}
        const pick=ev.target.closest('[data-share-kind]');if(pick){el.classList.remove('open');shareLink(pick.dataset.shareKind==='checkout');}});}
    el.innerHTML=`<div class="bb-confirm-box bb-share-box" role="dialog" aria-modal="true" aria-labelledby="bbShareTitle">
      <h3 id="bbShareTitle">${T('Share your coffee bar','שיתוף בר הקפה')}</h3>
      <button type="button" class="bb-share-opt" data-share-kind="bar"><b>${T('Link to this coffee bar','קישור לבר הקפה')}</b><span>${T('Opens the bar exactly like this. They can still change things, then book.','פותח את הבר בדיוק כך. אפשר עדיין לשנות ואז להזמין.')}</span></button>
      <button type="button" class="bb-share-opt" data-share-kind="checkout"><b>${T('Link straight to checkout','קישור ישר לקופה')}</b><span>${T('Opens checkout with this bar in the cart. They just choose delivery and pay.','פותח את הקופה עם הבר בעגלה. רק בוחרים משלוח ומשלמים.')}</span></button>
      <button type="button" class="bb-confirm-cancel" data-share-cancel>${T('Cancel','ביטול')}</button></div>`;
    el.classList.add('open');el.querySelector('[data-share-kind]')?.focus();
  };
  async function shareLink(checkout){
    // A checkout link leaves delivery to them unless a date was already chosen here.
    const url=location.origin+'/?bar='+toCode()+(checkout?'&go=checkout':'')+'#coffeebars',plan=suggestion();
    const text=plan?(checkout?T(`Your coffee bar for ${plan.tier.guests} guests. Choose delivery and pay here:`,`בר הקפה שלכם ל-${plan.tier.guests} אורחים. בוחרים משלוח ומשלמים כאן:`)
      :T(`Coffee bar for ${plan.tier.guests} guests. Open it to check and book:`,`בר קפה ל-${plan.tier.guests} אורחים. פתחו כדי לבדוק ולהזמין:`)):'';
    try{if(navigator.share){await navigator.share({title:'Gremier coffee bar',text,url});return;}}catch(e){if(e&&e.name==='AbortError')return;}
    try{await navigator.clipboard.writeText(url);if(typeof showToast==='function')showToast(T('Link copied. Paste it in WhatsApp or anywhere.','הקישור הועתק. הדביקו בוואטסאפ או בכל מקום.'));}
    catch{window.prompt(T('Copy this link:','העתיקו את הקישור:'),url);}
  }

  // Delivery: at the event (date + arrival time → event delivery), before it (a date; within two days
  // of today that's expedited on that date, otherwise regular on that date), or pickup (free, a date).
  // Filled into checkout.
  const isoDay=(n=0)=>{const d=new Date(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jerusalem'}).format(new Date())+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);};
  const shipFor=()=>state.deliveryMode==='event'?'event':state.deliveryMode==='pickup'?'pickup':(state.deliveryDate&&state.deliveryDate<=isoDay(2)?'expedited':'regular');
  function deliveryHtml(){
    const before=state.deliveryMode==='before',pickup=state.deliveryMode==='pickup',ship=shipFor();
    return `<div class="pl-q bb-delivery"><h2>${T('How do you want us to deliver it?','איך תרצו שנביא את זה?')}</h2>
      ${chips('deliveryMode',[['event',T('At the event','לאירוע')],['before',T('Before it','לפני האירוע')],['pickup',T('Pickup · free','איסוף · חינם')]])}
      <div class="bb-del-fields">
        <label>${pickup?T('Pickup date','תאריך האיסוף'):before?T('Delivery date','תאריך המשלוח'):T('Event date','תאריך האירוע')}<input type="date" class="form-input" id="plDelDate" min="${isoDay(1)}" value="${esc(state.deliveryDate)}"></label>
        ${before||pickup?'':`<label>${T('Arrival time','שעת הגעה')}<input type="time" class="form-input" id="plDelTime" value="${esc(state.deliveryTime)}"></label>`}
      </div>
      <small class="bb-q-hint">${pickup?T('Free: you collect it from us. We’ll be in touch to set the pickup time and place.','חינם: אוספים מאיתנו. ניצור קשר כדי לתאם שעה ומקום לאיסוף.')
        :!state.deliveryDate?T('Choose a date. The delivery fee for your area is added at checkout.','בחרו תאריך. דמי המשלוח לאזור שלכם יתווספו בקופה.')
        :ship==='event'?T('Event delivery: we arrive at your event at that time.','משלוח לאירוע: נגיע לאירוע בשעה הזו.')
        :ship==='expedited'?T('That’s within two days, so it’s expedited delivery on that date.','זה בתוך יומיים, אז זה משלוח מהיר בתאריך הזה.')
        :T('Regular delivery on that date.','משלוח רגיל בתאריך הזה.')}</small></div>`;
  }
  // When checkout opens for a coffee bar, it starts with the delivery chosen here.
  function fillCheckoutDelivery(){
    const d=(()=>{try{return JSON.parse(localStorage.getItem('gremier_bar_delivery')||'null');}catch{return null;}})();
    if(!d||!d.date||typeof cart==='undefined'||!cart.some(i=>i.is_coffee_bar||all().find(p=>String(p.id)===String(i.base_product_id||i.id))?.is_coffee_bar))return;
    const set=(id,v)=>{const el=$(id);if(el)el.value=v||'';};
    const radio=$(d.ship==='event'?'shipEvent':d.ship==='pickup'?'shipPickup':d.ship==='expedited'?'shipExpedited':'shipRegular');if(!radio||radio.disabled)return;
    radio.checked=true;
    // Pickup has no date field at checkout: the date goes in the order notes.
    if(d.ship==='pickup'){const n=$('coNotes'),line=T(`Pickup on ${d.date}`,`איסוף ב-${d.date}`);if(n&&!n.value.includes(line))n.value=n.value?`${line}
${n.value}`:line;}
    else if(d.ship==='event'){set('coEventDate',d.date);set('coEventTime',d.time);}
    else if(d.ship==='expedited'){const p=$('priorityDate');if(p)p.checked=true;set('coDeliveryDate',d.date);if(typeof toggleDatePicker==='function')toggleDatePicker();}
    else set('coRegularDate',d.date);
    if(typeof toggleExpeditedOptions==='function')toggleExpeditedOptions();
    if(d.ship==='expedited'&&typeof toggleDatePicker==='function')toggleDatePicker();
    if(typeof updateDeliveryPrice==='function')updateDeliveryPrice();
  }

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
    // The builder keeps the scene pinned in view, so no floating thumbnail there.
    if(!onPage||!scene||!qs||building_()){el.classList.remove('on');document.body.classList.remove('bb-mini-on');return;}
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
  window.plannerOrder = function (options={}) {
    const plan = suggestion();
    if (!plan || typeof openProductDrawer !== 'function') return;
    const chosen=!!state.deliveryDate&&(state.deliveryMode!=='event'||!!state.deliveryTime);
    // Opening the same checkout link again: the bar is already in the cart, just go to checkout.
    if(options.deliveryAtCheckout&&typeof cart!=='undefined'&&cart.some(i=>String(i.base_product_id||'')===String(plan.product.id)&&Math.round(i.price)===Math.round(plan.total))){if(typeof openCheckout==='function')openCheckout();return;}
    if(!chosen&&options.deliveryAtCheckout){try{localStorage.removeItem('gremier_bar_delivery');}catch{}}
    else if(!chosen){
      if(!document.querySelector('#planner .bb-delivery')){bstep='delivery';render();}
      const q=document.querySelector('#planner .bb-delivery');q?.scrollIntoView({behavior:'smooth',block:'center'});q?.classList.add('bb-attention');setTimeout(()=>q?.classList.remove('bb-attention'),1600);
      if(typeof showToast==='function')showToast(state.deliveryMode==='event'?T('Choose the event date and arrival time first','בחרו קודם תאריך ושעת הגעה'):state.deliveryMode==='pickup'?T('Choose the pickup date first','בחרו קודם תאריך איסוף'):T('Choose the delivery date first','בחרו קודם תאריך משלוח'));
      return;
    }
    if(chosen)try{localStorage.setItem('gremier_bar_delivery',JSON.stringify({ship:shipFor(),date:state.deliveryDate,time:state.deliveryMode==='event'?state.deliveryTime:'',at:Date.now()}));}catch{}
    // The product window does the pricing and the cart line; it works hidden, and is shown only if
    // its price doesn't match the builder's (then the customer checks it there).
    document.body.classList.add('pd-silent');
    const btns=[...document.querySelectorAll('#planner .pl-order')];btns.forEach(x=>{x.disabled=true;x.dataset.label=x.innerHTML;x.textContent=T('Getting your checkout ready…','מכינים את הקופה…');});
    const done=()=>{document.body.classList.remove('pd-silent');btns.forEach(x=>{x.disabled=false;if(x.dataset.label)x.innerHTML=x.dataset.label;});};
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
        const ready=typeof pdGetVariationPrice==='function'&&typeof pdGetAddonsTotal==='function'&&typeof pdCurrentProduct!=='undefined'&&pdCurrentProduct
          &&Math.round(pdGetVariationPrice(pdCurrentProduct)+pdGetAddonsTotal())===Math.round(plan.total);
        if(!ready||typeof pdAddToCart!=='function'){done();if(typeof showToast==='function')showToast(T('Please check your coffee bar and add it to the cart','בדקו את בר הקפה והוסיפו לעגלה'));return;}
        const count=cart.length;pdAddToCart();
        if(cart.length===count&&!cart.some(i=>String(i.base_product_id||i.id).startsWith(String(plan.product.id)))){done();return;}
        if(typeof openCheckout==='function')openCheckout();
        setTimeout(done,400);
      }, 150);
    }, 700);
  };
  window.openCoffeeBarBuilder = function(options={}) {
    state.guests=options.guests||25;
    state.mix={house:0,colomb:0,decaf:0,...(options.mix||{})};state.points=1;state.milk='dairy';state.milkMix=null;
    state.syrups={caramel:0,vanilla:0,sugar:0};state.extras={};state.lids=false;
    if(typeof showPage==='function')showPage('coffeebars');
    window.plannerStart('bar');
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
  // Coffee as a grid of jerry cans: a photo, the name, the price note and − count +. It starts with all
  // the cans as Classic (2 for 50 guests); + on another coffee swaps a Classic can over. Last tile: an extra can.
  function coffeeHtml(plan) {
    if (!plan) return '';
    const options=coffeeOptions(plan),jugs=jugProducts();
    const pic=(key)=>{const p=jugs.find(j=>jugVariant(j)===key)||jugs.find(j=>jugVariant(j)==='classic');return p?.images?.[0]||'';};
    const tile=(label,n,key,note,attrs,extra)=>{
      const img=pic(key);
      return `<div class="bb-jug-tile${n?' on':''}${extra?' extra':''}"><div class="bb-jug-pic">${img?`<img src="${esc(img)}" alt="" loading="lazy">`:''}${key==='decaf'&&!jugs.some(j=>jugVariant(j)==='decaf')?`<em>${T('Decaf','נטול')}</em>`:''}${n?`<i>${n}</i>`:''}</div>
        <b>${label}</b><small>${note}</small><span class="bb-jug-step">${attrs}</span></div>`;
    };
    const step=(key,n,canRemove,canAdd,label)=>`<button type="button" data-jug="${key}" data-d="-1" ${canRemove?'':'disabled'} aria-label="${T('Fewer '+label,'פחות '+label)}">−</button><b>${n}</b><button type="button" data-jug="${key}" data-d="1" ${canAdd?'':'disabled'} aria-label="${T('More '+label,'עוד '+label)}">+</button>`;
    const choices=classicSwap?options.filter(x=>classicSwap==='upgrade'||(plan.mix[x.key]||0)>0):[];
    const picker=choices.length?`<div class="bb-classic-picker" role="group" aria-label="${T('Swap coffee','החלפת קפה')}"><button type="button" class="bb-swap-close" data-close-swap aria-label="${T('Close coffee choices','סגירת אפשרויות הקפה')}">×</button>${choices.map(x=>`<button type="button" data-classic-swap="${x.key}" data-swap-mode="${classicSwap}">${classicSwap==='restore'?`${x.label} → ${T('Classic','קלאסיק')}`:`${T('Classic','קלאסיק')} → ${x.label} <small>+₪${Number(x.addon.price)||0}</small>`}</button>`).join('')}</div>`:'';
    const extraN=(plan.extras||[]).filter(x=>x.jug).reduce((n,x)=>n+x.qty,0);
    const tiles=[tile(T('Classic','קלאסיק'),plan.classic,'classic',T('included','כלול'),step('classic',plan.classic,plan.classic>0&&options.length>0,plan.classic<plan.jugs,T('Classic','קלאסיק'))),
      ...options.map(x=>{const n=plan.mix[x.key]||0;return tile(x.label,n,x.key,`+₪${Number(x.addon.price)||0} ${T('a can','לג׳ריקן')}`,step(x.key,n,n>0,plan.classic>0,x.label));}),
      jugs.length?tile(T('Extra can','ג׳ריקן נוסף'),extraN,'classic',T('more coffee, full price','עוד קפה, מחיר מלא'),`<button type="button" data-extra-jug-remove ${extraN?'':'disabled'} aria-label="${T('Remove an extra jerry can','הסרת ג׳ריקן נוסף')}">−</button><b>${extraN}</b><button type="button" data-extra-jug aria-label="${T('Add an extra jerry can','הוספת ג׳ריקן נוסף')}">+</button>`,true):''];
    return `<div class="bb-jug-grid">${tiles.join('')}</div>${picker}`;
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
  // Coffee for home: a strip of a few products, and "See all our coffee" opens a picker of everything we
  // sell (photo, price, + / stepper). Ready-made products only (not the build-your-own 6-packs).
  const homeProducts=()=>all().filter(p=>extraProduct(p.id)&&!(p.variations||[]).some(v=>v.type==='pack'));
  function homeCard(p){
    const n=Number(state.extras[p.id])||0;
    return `<div class="bb-home-product${n?' on':''}">${p.images?.[0]?`<img src="${esc(p.images[0])}" alt="" loading="lazy">`:''}<span>${esc(pname(p))}<small>₪${Number(p.price)||0}</small></span>${n?`<span class="bb-home-step"><button type="button" data-take-home="${esc(p.id)}" data-d="-1" aria-label="${esc(T('One less','אחד פחות'))}">−</button><b>${n}</b><button type="button" data-take-home="${esc(p.id)}" data-d="1" aria-label="${esc(T('One more','עוד אחד'))}">+</button></span>`:`<button type="button" class="bb-home-add" data-take-home="${esc(p.id)}" data-d="1" aria-label="${esc(T('Add to my coffee bar','הוספה לבר הקפה'))}">+</button>`}</div>`;
  }
  function takeHomeHtml() {
    const available=homeProducts().filter(p=>!/syrup|סירופ/i.test(p.name_en||p.name_he||''));
    const picks=[...available.filter(p=>p.category==='minis').slice(0,3),...available.filter(p=>p.category==='bottles').slice(0,3)];
    if(!picks.length)return '';
    const more=homeProducts().filter(p=>!picks.includes(p)&&Number(state.extras[p.id])>0).length;
    return `<section class="bb-take-home"><h3>${T('Want some coffee for home?','רוצים גם קפה לבית?')}</h3><p>${T('Added to your coffee bar order and delivered with it.','נוסף להזמנת בר הקפה ומגיע איתו.')}</p><div class="bb-home-products">${picks.map(homeCard).join('')}
      <button type="button" class="bb-home-more" data-picker="open"><span aria-hidden="true">☕</span><b>${T('See all our coffee','לכל הקפה שלנו')}</b><small>${more?T(`${more} more added`,`עוד ${more} נוספו`):T('Bottles, minis, 5L, syrups','בקבוקים, מיני, 5 ל׳, סירופים')}</small></button></div></section>`;
  }
  let pickerOpen=false;
  function pickerHtml(){
    if(!pickerOpen)return '';
    const list=homeProducts(),syrup=p=>/syrup|סירופ/i.test(p.name_en||p.name_he||'');
    const groups=[[T('Liter bottles','בקבוקי ליטר'),list.filter(p=>p.category==='bottles'&&!syrup(p))],[T('Minis','מיני'),list.filter(p=>p.category==='minis')],
      [T('5 litres','5 ליטר'),list.filter(p=>p.category==='bulk')],[T('Syrups','סירופים'),list.filter(syrup)]].filter(g=>g[1].length);
    return `<div class="bbx-sheet" data-picker="close"><div class="bbx-sheet-box" role="dialog" aria-modal="true" aria-label="${T('All our coffee','כל הקפה שלנו')}">
      <div class="bbx-sheet-head"><b>${T('All our coffee','כל הקפה שלנו')}</b><button type="button" class="bbx-sheet-x" data-picker="close" aria-label="${T('Close','סגירה')}">×</button></div>
      <div class="bbx-sheet-body">${groups.map(([title,items])=>`<h4>${title}</h4><div class="bbx-sheet-grid">${items.map(homeCard).join('')}</div>`).join('')}</div>
      <button type="button" class="bbx-cta" data-picker="close"><span>${T('Done','סיום')}</span><b>₪${suggestion()?.total||''}</b></button></div></div>`;
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
  // The Coffee Bars page shows a short intro and "Start building your coffee bar"; that opens the builder
  // as its own page (a history entry, so Back returns): the scene (large) with the questions beside it on
  // desktop and under it on phones. Three steps, fading between them: guests → your coffee bar (what's
  // included, delivery, Book) → upgrades (optional questions, one open at a time).
  let building = false, bstep = 'guests', prevStep = null, openUp = null, shownStep = null;
  const building_ = () => building || !!history.state?.bbBuild;
  window.plannerStart = function (to = 'guests') {
    building = true; bstep = to; openUp = null;
    history.pushState({ ...(history.state || {}), bbBuild: true }, '', location.href);
    render(); scrollTo({ top: 0, behavior: 'auto' });
  };
  addEventListener('popstate', () => { building = !!history.state?.bbBuild; if (!building) shownStep = null; setTimeout(render, 0); });
  function goStep(to) { if (to === bstep) return; if (to === 'delivery') prevStep = bstep; openUp = null; bstep = to; render(); const panel = document.querySelector('#planner .bbx-panel'); if (panel && panel.getBoundingClientRect().top < 60) panel.scrollIntoView({ behavior: 'smooth', block: 'start' }); }

  function introHtml(plan) {
    const from = plan ? Math.min(...tiersOf(plan.product).map((t) => t.price)) : null;
    return `<div class="bbx-intro">
      <img class="bbx-banner" src="/hero/09-coffee-bar-900.webp?v=20261103d" srcset="/hero/09-coffee-bar-900.webp?v=20261103d 900w, /hero/09-coffee-bar.webp?v=20261103d 1536w" sizes="(max-width:700px) 100vw, 640px" alt="${T('A Gremier coffee bar set up at an event', 'בר קפה של גרמיר באירוע')}" decoding="async">
      <ul class="bbx-points"><li>${T('Cold brew in 5-litre jerry cans, dispensers, milk, syrups, cups and straws', 'קולד ברו בג׳ריקנים של 5 ליטר, מתקנים, חלב, סירופים, כוסות וקשיות')}</li>
        <li>${T('Sized for your guest count, ready to pour', 'לפי מספר האורחים, מוכן למזיגה')}</li>
        <li>${T('Delivered to your event, or free pickup', 'משלוח לאירוע, או איסוף עצמי חינם')}</li></ul>
      <button type="button" class="bbx-start" data-bb-start>${T('Start building your coffee bar', 'התחילו לבנות את בר הקפה')}</button>
      ${from ? `<small class="bbx-from">${T(`From ₪${from} · takes about a minute`, `החל מ-₪${from} · לוקח בערך דקה`)}</small>` : ''}
    </div>`;
  }
  function includedHtml(plan) {
    return `<ul class="bbx-included">${tiles(plan).map((x) => `<li><b>${x.n > 1 ? x.n + '×' : '✓'}</b> ${esc(x.title)}${x.sub ? ` <small>${esc(x.sub)}</small>` : ''}</li>`).join('')}</ul>`;
  }
  function stepHtml(plan, tierChips) {
    if (bstep === 'guests' || !plan) return `<div class="bbx-step" data-step="guests">
      <h2>${T('How many guests do you have?', 'כמה אורחים יהיו?')}</h2>
      <div class="pl-guests">${chips('guests', tierChips.length ? tierChips : [[25, '25'], [50, '50'], [75, '75'], [100, '100']])}<input type="number" min="5" max="500" inputmode="numeric" value="${state.guests}" id="plGuests" class="form-input" aria-label="${T('Number of guests', 'מספר אורחים')}"></div>
      <small class="bb-q-hint">${T('Pick the closest number, or type your own.', 'בחרו את המספר הקרוב, או הקלידו.')}</small>
      ${plan ? `<button type="button" class="bbx-cta" data-go="bar"><span>${T('See my coffee bar', 'לבר הקפה שלי')}</span><b>₪${plan.total} ›</b></button>
      <button type="button" class="bbx-options" data-go="opt-coffee"><span class="bbx-spark" aria-hidden="true">✨</span><span><strong>${T('Show me more options', 'הראו לי עוד אפשרויות')}</strong><small>${T('Other coffees · Parve milk · More stations · Domed lids · Extra syrups', 'קפה אחר · חלב פרווה · עוד עמדות · מכסים קמורים · עוד סירופים')}</small></span><i aria-hidden="true">›</i></button>` : ''}</div>`;
    const total = `₪<span id="bbTotal">${plan.total}</span>`;
    const back = (to, label) => `<button type="button" class="bbx-back" data-go="${to}">‹ ${label}</button>`;
    if (bstep === 'bar') return `<div class="bbx-step" data-step="bar">
      <h2>${T(`Your coffee bar for ${plan.tier.guests} guests`, `בר הקפה שלכם ל-${plan.tier.guests} אורחים`)}</h2>
      <p class="bbx-lead">${T('Everything you need, ready to pour:', 'כל מה שצריך, מוכן למזיגה:')}</p>
      ${includedHtml(plan)}
      ${plan.tooBig ? `<div class="pl-r-note">${T('For a bigger event, message us and we’ll plan it together.', 'לאירוע גדול יותר כתבו לנו ונתכנן יחד.')}</div>` : ''}
      <button type="button" class="bbx-cta" data-go="delivery"><span>${T('Looks perfect, let’s book it', 'נראה מושלם, בואו נזמין')}</span><b>${total} ›</b></button>
      <button type="button" class="bbx-options" data-go="opt-coffee"><span class="bbx-spark" aria-hidden="true">✨</span><span><strong>${T('Show me more options', 'הראו לי עוד אפשרויות')}</strong><small>${T('Other coffees · Parve milk · More stations · Domed lids · Extra syrups', 'קפה אחר · חלב פרווה · עוד עמדות · מכסים קמורים · עוד סירופים')}</small></span><i aria-hidden="true">›</i></button>
      <div class="bbx-actions bbx-only-back">${back('guests', T('Guests', 'אורחים'))}</div></div>`;
    // Options: three short pages, each moving on to the next, then delivery.
    const OPTS = ['opt-coffee', 'opt-milk', 'opt-extras'];
    const oi = OPTS.indexOf(bstep);
    if (oi >= 0) {
      const lids = lidsHtml(plan), syrups = syrupHtml(plan);
      const body = oi === 0 ? `<h2>${T('Coffee & serving stations', 'קפה ועמדות הגשה')}</h2>
          <p class="bbx-lead">${T(`You have ${plan.jugs} jerry can${plan.jugs > 1 ? 's' : ''} of 5 litres. Tap + on a coffee to swap a can to it.`, `יש לכם ${plan.jugs} ג׳ריקנים של 5 ליטר. לחצו + על קפה כדי להחליף ג׳ריקן אליו.`)}</p>
          ${coffeeHtml(plan)}
          <h3 class="bbx-sub">${T('Serving stations', 'עמדות הגשה')}</h3>
          ${chips('points', [[1, '1'], [2, '2'], [3, '3'], [4, '4']], plan.stations)}
          <small class="bb-q-hint">${plan.flavours > 1 ? T(`Each coffee has its own dispenser, so your ${plan.flavours} coffees come with ${plan.flavours} stations (added for you).`, `לכל קפה מתקן משלו, אז ${plan.flavours} הקפה שלכם מגיעים עם ${plan.flavours} עמדות (נוספו אוטומטית).`) : T('Expecting a big crowd? Add stations so guests don’t queue.', 'מצפים לקהל גדול? הוסיפו עמדות כדי שלא יהיו תורים.')}</small>`
        : oi === 1 ? `<h2>${T('Which milk?', 'איזה חלב?')}</h2>
          <p class="bbx-lead">${T(`${plan.milkLiters} litres of milk come with your bar. Choose dairy, parve, or a mix.`, `${plan.milkLiters} ליטר חלב מגיעים עם הבר. בחרו חלב רגיל, פרווה, או שילוב.`)}</p>${milkHtml(plan)}`
        : `<h2>${T('Syrups & lids', 'סירופים ומכסים')}</h2>
          <p class="bbx-lead">${T('One caramel, one vanilla and one sugar syrup are included. Add more if you like.', 'סירופ קרמל, וניל וסוכר אחד מכל סוג כלולים. אפשר להוסיף עוד.')}</p>
          ${syrups}${lids ? `<h3 class="bbx-sub">${T('Domed lids', 'מכסים קמורים')}</h3>${lids}` : ''}`;
      const last = oi === OPTS.length - 1;
      return `<div class="bbx-step" data-step="${bstep}">
        <div class="bbx-dots" aria-label="${T(`Option ${oi + 1} of 3`, `אפשרות ${oi + 1} מתוך 3`)}">${OPTS.map((_, j) => `<i class="${j <= oi ? 'on' : ''}"></i>`).join('')}</div>
        ${body}
        <button type="button" class="bbx-cta" data-go="${last ? 'delivery' : OPTS[oi + 1]}"><span>${last ? T('Done, now delivery', 'סיימתי, למשלוח') : T('Next', 'הבא')}</span><b>${total} ›</b></button>
        <div class="bbx-actions bbx-only-back">${back(oi ? OPTS[oi - 1] : 'bar', oi ? T('Back', 'חזרה') : T('My bar', 'הבר שלי'))}${last ? '' : `<button type="button" class="bbx-link" data-go="delivery">${T('Skip to delivery', 'דלגו למשלוח')}</button>`}</div></div>`;
    }
    // Delivery, then one gentle "anything else?" (coffee for home), then Book.
    const home = takeHomeHtml();
    return `<div class="bbx-step" data-step="delivery">
      ${deliveryHtml()}
      ${home ? `<div class="bbx-extra bbx-home">${home}</div>` : ''}
      <button type="button" class="pl-order bbx-cta bbx-book" onclick="plannerOrder()"><span>${T('Book my coffee bar', 'להזמנת בר הקפה')}</span><b>${total}</b></button>
      <div class="bbx-actions bbx-only-back">${back(/^opt-/.test(prevStep || '') ? prevStep : 'bar', /^opt-/.test(prevStep || '') ? T('Options', 'אפשרויות') : T('My bar', 'הבר שלי'))}</div>
      <button type="button" class="bbx-share" onclick="plannerShare()"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/></svg>${T('Share this bar', 'שיתוף הבר')}</button></div>`;
  }

  function render() {
    const box = $('planner');
    if (!box) return;
    if (shared && all().length) { Object.assign(state, shared); shared = null; sharedShown = true; building = true; bstep = 'bar'; }
    const previousScene = $('bbScene');
    const plan = suggestion();
    const page = $('coffeebarsPage');
    page?.classList.toggle('bb-ready', !!plan || all().length > 0);
    renderHero(plan);
    tidyPackages(plan);
    const on = building_();
    page?.classList.toggle('bb-building', on);
    if (!on) { box.innerHTML = introHtml(plan); mini(null); syncMini(); return; }
    if (!plan) bstep = 'guests';
    const tierChips = (plan ? tiersOf(plan.product) : []).map((t) => [t.guests, String(t.guests)]);
    const sheetWasOpen = !!box.querySelector('.bbx-sheet'), sheetScroll = box.querySelector('.bbx-sheet-body')?.scrollTop || 0;
    box.innerHTML = `
      ${window.CoffeeBarOffers?.builderBanner() || ''}
      <div class="bbx-top"><button type="button" class="bbx-exit" data-bb-exit>${T('‹ Coffee bars', '‹ ברי קפה')}</button><span>${T('Build your coffee bar', 'בונים בר קפה')}</span></div>
      ${sharedShown ? `<div class="bb-shared">${T('✨ This coffee bar was set up for you. Check it, change anything you like, and press <b>Book</b>.', '✨ בר הקפה הזה הוכן בשבילכם. בדקו, שנו מה שתרצו, ולחצו <b>להזמנה</b>.')}</div>` : ''}
      <div class="bbx">
        <aside class="bbx-scene bb-tray">
          ${plan ? sceneHtml(plan) : ''}
          ${plan ? `<div class="bbx-price"><span>${esc(pname(plan.product))} · ${T(`${plan.tier.guests} guests`, `${plan.tier.guests} אורחים`)}</span><strong>₪${plan.total}</strong></div>` : ''}
        </aside>
        <div class="bbx-panel bb-qs">${stepHtml(plan, tierChips)}</div>
      </div>${plan && bstep === 'delivery' ? pickerHtml() : ''}`;
    // The picker keeps its place while items are added (and only animates when it opens).
    const sheet = box.querySelector('.bbx-sheet');
    if (sheet) { if (sheetWasOpen) sheet.classList.add('stay'); sheet.querySelector('.bbx-sheet-body').scrollTop = sheetScroll; }
    else document.body.classList.remove('bbx-sheet-on');
    reconcileScene(previousScene, $('bbScene'));
    if (plan) animateTotal(plan.total);
    layoutScene();
    mini(plan);
    watch();
    // Each step fades in (no sliding) when it changes.
    const st = box.querySelector('.bbx-step');
    if (st && shownStep !== bstep) { if (shownStep !== null) st.animate([{ opacity: 0, transform: 'scale(.985)' }, { opacity: 1, transform: 'none' }], { duration: 320, easing: 'cubic-bezier(.2,.7,.2,1)' }); shownStep = bstep; }
  }

  // The current bar in a few lines, for the assistant.
  window.plannerSummary = () => {
    const plan = suggestion(); if (!plan) return '';
    const milk = state.milk === 'dairy' ? 'dairy milk' : plan.milk.map((m) => `${m.liters}L ${m.addon?.name || m.key}`).join(', ') || state.milk;
    const del = state.deliveryMode === 'event' ? `delivered to the event${state.deliveryDate ? ` on ${state.deliveryDate}${state.deliveryTime ? ' at ' + state.deliveryTime : ''}` : ''}` : state.deliveryMode === 'pickup' ? `pickup${state.deliveryDate ? ' on ' + state.deliveryDate : ''} (free)` : `delivered before the event${state.deliveryDate ? ' on ' + state.deliveryDate : ''}`;
    const where = !building_() ? 'on the Coffee Bars intro' : bstep === 'guests' ? 'choosing the number of guests' : bstep === 'bar' ? 'looking at their standard coffee bar (what is included), choosing between booking it and seeing more options' : bstep === 'delivery' ? 'choosing delivery, then booking (with an optional take-home coffee add-on)' : bstep === 'opt-coffee' ? 'choosing coffee types and serving stations' : bstep === 'opt-milk' ? 'choosing the milk' : 'choosing extra syrups and domed lids';
    return [`Guests: ${state.guests} (package tier ${plan.tier.guests})`, `Coffee: ${plan.jugs} × 5L jerry cans (${plan.classic} Classic${Object.entries(plan.mix).map(([k, n]) => `, ${n} ${k}`).join('')})`,
      `Milk: ${milk} (${plan.milkLiters}L)`, `Serving stations: ${plan.stations}`, `Domed lids: ${state.lids ? 'yes' : 'no'}`, `Syrups: caramel ${plan.syrupCounts.caramel}, vanilla ${plan.syrupCounts.vanilla}, sugar ${plan.syrupCounts.sugar} (one of each included)`,
      `Delivery: ${del}`, `Total so far: ₪${plan.total}`, `The customer is ${where}.`].join('\n');
  };

  // The builder is the way to order the bar itself; the list below it keeps only the separate pieces.
  function tidyPackages(plan){
    const grid=$('cbpPackages');if(!grid||!plan)return;
    grid.querySelectorAll('.product-card').forEach(c=>{const p=all().find(x=>String(x.id)===c.dataset.productId);c.hidden=!!p&&(p.is_coffee_bar&&!(p.variations||[]).some(v=>v.type==='serving_pack'))&&String(p.id)===String(plan.product.id);});
    const title=$('t-cbp-title'),intro=$('t-cbp-intro');
    if(title)title.textContent=T('Just need some pieces?','צריכים רק חלק?');
    if(intro)intro.textContent=T('Extra cups, syrups or a dispenser, on their own.','כוסות, סירופים או דיספנסר נוספים, בנפרד.');
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
    if(e.target.closest('[data-bb-start]')){window.plannerStart('guests');return;}
    const pk=e.target.closest('[data-picker]');
    if(pk&&(pk.dataset.picker==='open'||e.target===pk||pk.tagName==='BUTTON')){pickerOpen=pk.dataset.picker==='open';document.body.classList.toggle('bbx-sheet-on',pickerOpen);render();return;}
    if(e.target.closest('[data-bb-exit]')){if(history.state?.bbBuild)history.back();else{building=false;render();}return;}
    const go=e.target.closest('[data-go]');
    if(go){goStep(go.dataset.go);return;}
    const up=e.target.closest('[data-up]');
    if(up){openUp=openUp===up.dataset.up?null:up.dataset.up;render();return;}
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
    if(key==='guests'&&bstep==='guests'){clearTimeout(goStep.t);goStep.t=setTimeout(()=>goStep('bar'),450);}
  });
  document.addEventListener('change',(e)=>{
    if(e.target.id==='plDelDate'){state.deliveryDate=e.target.value;render();}
    else if(e.target.id==='plDelTime'){state.deliveryTime=e.target.value;render();}
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
    const openCo=window.openCheckoutUI;
    if(typeof openCo==='function')window.openCheckoutUI=function(view){const r=openCo.apply(this,arguments);if(view===undefined||view==='form')setTimeout(fillCheckoutDelivery,80);return r;};
    const openPd=window.openProductDrawer;
    if(typeof openPd==='function')window.openProductDrawer=function(){const d=$('pdDrawer');if(d){d.classList.remove('pd-from-builder');d.querySelector('.pd-bar-summary')?.remove();}return openPd.apply(this,arguments);};
    for (const fn of ['showPage', 'applyTranslations', 'renderCoffeeBarsPage', 'renderShop']) {
      const orig = window[fn];
      if (typeof orig === 'function') window[fn] = function () { const r = orig.apply(this, arguments); try { mount(); render(); } catch (_) {} return r; };
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', hook);
  else hook();
  if(shared){let tries=0;const t=setInterval(()=>{if(all().length&&typeof showPage==='function'){clearInterval(t);showPage('coffeebars');render();$('planner')?.scrollIntoView({block:'start'});
    if(toCheckout){
      // Once only: a refresh or going back keeps the bar link but doesn't add it again.
      try{const u=new URL(location.href);u.searchParams.delete('go');history.replaceState(history.state,'',u.pathname+u.search+u.hash);}catch{}
      setTimeout(()=>window.plannerOrder({deliveryAtCheckout:true}),300);
    }}else if(++tries>40)clearInterval(t);},250);}
})();
