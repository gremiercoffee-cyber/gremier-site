/* Catalogue-priced suggestions. Original cart lines are replaced only when the
   customer explicitly books the configured bar. No checkout/payment interception. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else {root.CoffeeBarOffers=api;api.mount();}
})(typeof window==='undefined'?globalThis:window,function(){
  'use strict';
  const FULL='9361ff6e-4227-44cc-a23a-428a002f1f4c';
  const id=i=>String(i.base_product_id||i.product_id||i.id);
  const fingerprint=i=>JSON.stringify(i);
  const jugCount=p=>Number((p.name_en||'').match(/^(\d+)\s*[×x]\s*5/i)?.[1])||1;
  function eligible(items,catalog){
    const rows=items.map(i=>({i,p:catalog.find(p=>String(p.id)===id(i))})).filter(x=>x.p&&!x.i.is_subscription&&!x.p.is_coffee_bar);
    const jugs=rows.filter(({p})=>/5\s*(?:l\b|lit(?:er|re))|jerry|ג.?ריקן/i.test(p.name_en||'')&&p.category!=='syrups');
    const syrups=rows.filter(({p})=>p.category!=='coffeebars'&&(p.category==='syrups'||/syrup/i.test(p.name_en||'')));
    if(!jugs.length||!syrups.length)return null;
    const selected=[...jugs,...syrups].map(x=>x.i);
    const mix={house:0,colomb:0,decaf:0};
    jugs.forEach(({i,p})=>{const key=/house/i.test(p.name_en)?'house':/colomb/i.test(p.name_en)?'colomb':/decaf/i.test(p.name_en)?'decaf':null;if(key)mix[key]+=(Number(i.qty)||1)*jugCount(p);});
    return {rows:selected,guests:jugs.reduce((n,{i,p})=>n+(Number(i.qty)||1)*jugCount(p)*25,0),mix,
      caramel:syrups.some(({p})=>/caramel/i.test(p.name_en)),vanilla:syrups.some(({p})=>/vanilla/i.test(p.name_en)),
      subtotal:selected.reduce((n,i)=>n+Number(i.price)*Number(i.qty),0)};
  }
  function offers(items,catalog){
    const selection=eligible(items,catalog);if(!selection)return [];
    return [true].flatMap(full=>{
      const p=catalog.find(p=>p.id===FULL&&p.is_active!==false);if(!p)return [];
      const tiers=(p.variations||[]).find(v=>v.type==='guest_count'||(v.type==='choice'&&/guest/i.test(v.name||'')))?.options||[];
      const tier=tiers.find(t=>(Number(t.guests)||parseInt(t.label,10))===selection.guests);if(!tier)return [];
      const addons=(p.variations||[]).find(v=>v.type==='addons')?.items||[];
      let price=Number(tier.price), flavours=Object.values(selection.mix).filter(Boolean).length;
      if(selection.guests/25>Object.values(selection.mix).reduce((a,b)=>a+b,0))flavours++;
      if(full){
        for(const [key,re] of [['house',/house/i],['colomb',/colomb/i],['decaf',/decaf/i]]){
          const n=selection.mix[key];if(!n)continue;const a=addons.find(a=>a.per_jug&&re.test(a.name));if(!a)return [];price+=n*Number(a.price);
        }
        const extra=Math.max(0,flavours-1);if(extra){const a=addons.find(a=>/dispenser/i.test(a.name)&&Number(a.max)>=extra);if(!a)return [];price+=extra*Number(a.price);}
      }
      return [{...selection,full,price,difference:price-selection.subtotal}];
    });
  }
  const PACKS=['46dc3b6a-37a5-4c49-a12d-566a43fd4c39','9e1abc84-b3b8-40e0-a23c-3bfbeb8602f4'];
  function accessoryOffers(items,catalog){
    if(!items.length||items.some(i=>i.is_subscription||id(i)===FULL||PACKS.includes(id(i))))return [];
    const coffee=items.some(i=>{const p=catalog.find(p=>String(p.id)===id(i));return p&&['bottles','bulk','minis'].includes(p.category)&&!/syrup|סירופ/i.test((p.name_en||'')+(p.name_he||''));});
    return coffee?PACKS.map(key=>catalog.find(p=>p.id===key&&p.is_active!==false)).filter(Boolean):[];
  }
  function createSession(){
    let pending=null;
    return {
      start(offer){pending={...offer,original:offer.rows.map(i=>({id:i.id,fingerprint:fingerprint(i)}))};},
      current(){return pending;},cancel(){pending=null;},
      valid(items){return !pending||pending.original.every(x=>items.some(i=>i.id===x.id&&fingerprint(i)===x.fingerprint));},
      complete(product,items){if(!pending||product.id!==FULL)return false;
        // Caller validates before adding; adding can merge a pre-existing bar line.
        const ids=new Set(pending.original.map(i=>i.id));
        for(let n=items.length-1;n>=0;n--)if(ids.has(items[n].id))items.splice(n,1);
        pending=null;return true;
      }
    };
  }
  const session=createSession();let dismissed='';
  const he=()=>typeof lang!=='undefined'&&lang==='he';
  const T=(a,b)=>he()?b:a;
  const esc=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const catalog=()=>typeof products!=='undefined'?products:[];
  const basket=()=>typeof cart!=='undefined'?cart:[];
  function render(){
    document.querySelectorAll('.coffee-upgrade-offer').forEach(el=>el.remove());
    renderAccessories();
    const options=offers(basket(),catalog());
    if(!options.length||session.current()||dismissed===fingerprint(basket()))return;
    for(const parent of [document.getElementById('cartBody'),document.getElementById('checkoutFormView')]){
      if(!parent)continue;
      const card=document.createElement('section');card.className='coffee-upgrade-offer';
      card.innerHTML=`<button type="button" data-bar-dismiss aria-label="${T('Dismiss suggestion','סגירת ההצעה')}" class="bar-offer-close">×</button><h3>${T('Make it a coffee bar?','אולי להפוך את זה לבר קפה?')}</h3>${options.map(o=>`<div><strong>${T('Premium coffee bar','בר קפה פרימיום')}</strong><p>${T('Milk, cups, straws, a dispenser and all three syrups.','חלב, כוסות, קשיות, מתקן וכל שלושת הסירופים.')}</p><button type="button" data-bar-upgrade="${o.full?'full':'coffee'}">${T('Build it','לבניית הבר')} · ₪${o.price}${o.difference>0?` (+₪${Math.round(o.difference*100)/100})`:o.difference<0?` (−₪${Math.round(-o.difference*100)/100})`:''}</button></div>`).join('')}`;
      if(parent.id==='cartBody')parent.append(card);else parent.prepend(card);
    }
  }
  function renderAccessories(){
    document.querySelectorAll('.serving-pack-offer').forEach(el=>el.remove());
    const options=accessoryOffers(basket(),catalog());if(!options.length)return;
    for(const parent of [document.getElementById('cartBody'),document.getElementById('checkoutFormView')]){
      if(!parent)continue;
      const card=document.createElement('section');card.className='serving-pack-offer';
      card.innerHTML=`<h3>${T('Ready to serve?','מוכנים להגשה?')}</h3>${options.map(p=>`<div class="serving-pack-row"><img src="${esc(p.images?.[0]||'')}" alt=""><div><strong>${esc(he()?p.name_he:p.name_en)}</strong><p>${esc(he()?p.description_he:p.description_en)}</p><button type="button" data-serving-add="${esc(p.id)}">${T('Add','הוספה')} · ₪${Number(p.price).toFixed(Number(p.price)%1?2:0)}</button></div></div>`).join('')}`;
      if(parent.id==='cartBody')parent.append(card);else parent.prepend(card);
    }
  }
  function addServingPack(productId){
    if(!accessoryOffers(basket(),catalog()).some(p=>p.id===productId))return;
    if(typeof addToCart!=='function')return;
    // A changed basket invalidates the previous coupon quote; recalculate before payment.
    if(typeof appliedRedeem!=='undefined'&&appliedRedeem){
      if(typeof showToast==='function')showToast(T('Please add this from your cart before applying a coupon.','הוסיפו את המארז מהעגלה לפני החלת קופון.'));
      return;
    }
    addToCart(productId);
    if(typeof renderCartDrawer==='function')renderCartDrawer();
    const summary=document.getElementById('coSummary');
    if(summary){
      const p=catalog().find(p=>p.id===productId),line=document.createElement('div');line.className='order-line';
      const label=document.createElement('span');label.textContent=(he()?p.name_he:p.name_en)+' ×1';
      const amount=document.createElement('span');amount.textContent='₪'+Number(p.price);line.append(label,amount);
      const total=summary.querySelector('.order-total-line');if(total)total.before(line);
      if(typeof updateDeliveryPrice==='function')updateDeliveryPrice();
    }
    render();
  }
  function builderBanner(){return session.current()?`<div class="bb-upgrade-return"><span>${T('Your original cart is saved until you book this bar.','העגלה המקורית נשמרת עד שתזמינו את הבר.')}</span><button type="button" data-bar-return>${T('Back to my cart','חזרה לעגלה שלי')}</button></div>`:'';}
  function beforeAdd(p,items){
    if(p.id!==FULL||session.valid(items))return true;
    session.cancel();if(typeof showToast==='function')showToast(T('Your cart changed. Please review it before upgrading.','העגלה השתנתה. בדקו אותה לפני השדרוג.'));return false;
  }
  function completeUpgrade(p,items){const done=session.complete(p,items);if(done)document.querySelector('.bb-upgrade-return')?.remove();return done;}
  function mount(){
    for(const key of ['renderCartDrawer','openCheckoutUI']){
      const previous=window[key];if(typeof previous==='function')window[key]=function(){const result=previous.apply(this,arguments);render();return result;};
    }
    document.addEventListener('click',e=>{
      const pack=e.target.closest('[data-serving-add]');if(pack){addServingPack(pack.dataset.servingAdd);return;}
      const upgrade=e.target.closest('[data-bar-upgrade]');
      if(upgrade){const offer=offers(basket(),catalog()).find(o=>o.full===(upgrade.dataset.barUpgrade==='full'));if(!offer)return;
        session.start(offer);if(typeof closeCart==='function')closeCart(true);document.getElementById('checkoutOverlay')?.classList.remove('open');
        window.openCoffeeBarBuilder?.(offer);return;
      }
      if(e.target.closest('[data-bar-return]')){session.cancel();document.querySelector('.bb-upgrade-return')?.remove();if(typeof openCart==='function')openCart();return;}
      if(e.target.closest('[data-bar-dismiss]')){dismissed=fingerprint(basket());render();}
    });
  }
  return {eligible,offers,accessoryOffers,createSession,mount,builderBanner,beforeAdd,completeUpgrade};
});
