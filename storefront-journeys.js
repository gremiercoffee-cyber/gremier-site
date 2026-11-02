/* First-party, opt-in journeys. No typed text, addresses, query strings or payment data. */
(function(root){
 'use strict';
 if(root.GremierJourneys)return;
 const apiBase=typeof SUPABASE_URL!=='undefined'?SUPABASE_URL:'https://ayuzmwpmhncxrugsyxmw.supabase.co';
 const publicKey=typeof SUPABASE_ANON_KEY!=='undefined'?SUPABASE_ANON_KEY:'sb_publishable_UDYvyCRXZl3Ci9zIRKJhVQ_XdYKcUdn';
 const CONSENT='gremier_analytics_consent_v1',VISITOR='gremier_analytics_visitor_v1',SESSION='gremier_analytics_session_v1';
 const read=(key,storage=localStorage)=>{try{return JSON.parse(storage.getItem(key)||'null');}catch{return null;}};
 const write=(key,value,storage=localStorage)=>{try{storage.setItem(key,JSON.stringify(value));}catch{}};
 const remove=(key,storage=localStorage)=>{try{storage.removeItem(key);}catch{}};
 const he=()=>typeof lang!=='undefined'?lang==='he':document.documentElement.lang==='he',T=(en,hb)=>he()?hb:en;
 const allowed=()=>{const c=read(CONSENT);return c?.value==='accepted'&&Date.now()-c.at<180*86400000;};
 const names={home:'Home',shop:'Shop',coffeebars:'Coffee bars',myorders:'Account',giftcards:'Gift cards'};
 let queue=[],sending=false,currentPage='Home',lastView='',lastAction='',lastActionAt=0,lastInput=Date.now(),tickAt=Date.now();
 let visitor=null,session=null,currentProduct=null,internal=false;
 const endpoint=()=>`${apiBase}/functions/v1/site-journeys`;
 function ensure(){
  if(internal||!allowed())return false;
  visitor=visitor||read(VISITOR)||crypto.randomUUID();write(VISITOR,visitor);
  session=read(SESSION,sessionStorage);
  if(!session||Date.now()-session.last>30*60000||Date.now()-session.start>12*3600000){queue=[];session={id:crypto.randomUUID(),start:Date.now(),last:Date.now()};lastView='';}
  session.last=Date.now();write(SESSION,session,sessionStorage);return true;
 }
 function context(){return ensure()?{visitor_id:visitor,session_id:session.id}:null;}
 function track(kind,details={}){
  if(!ensure())return;
  const key=kind+JSON.stringify(details);
  if(kind!=='active'&&key===lastAction&&Date.now()-lastActionAt<700)return;
  lastAction=key;lastActionAt=Date.now();
  queue.push({id:crypto.randomUUID(),kind,page:details.page||currentPage,...details});
  if(queue.length>80)queue=queue.slice(-80);
  if(queue.length>=10||['checkout_open','pay_click'].includes(kind))flush();
 }
 function page(name,kind='page_view',extra={}){
  if(!allowed())return;
  ensure();const key=kind+name+String(extra.product_id||'');if(lastView===key)return;
  if(lastView)active();
  lastView=key;currentPage=name;currentProduct=extra.product_id||null;track(kind,{page:name,...extra});
 }
 async function flush(){
  if(sending||!allowed()||!queue.length||!ensure())return;
  const batch=queue.splice(0,20),sid=session.id;sending=true;
  try{
   const token=typeof lastAuthSession!=='undefined'?lastAuthSession?.access_token:null;
   const headers={'Content-Type':'application/json',apikey:publicKey,...(token?{Authorization:'Bearer '+token}:{})};
   const r=await fetch(endpoint(),{method:'POST',headers,keepalive:true,body:JSON.stringify({action:'collect',consent:true,visitor_id:visitor,session_id:sid,events:batch,
    device:/iPad|Tablet/i.test(navigator.userAgent)?'Tablet':/Mobile|Android/i.test(navigator.userAgent)?'Phone':'Computer',referrer:document.referrer,language:he()?'he':'en'})});
   const data=await r.json();
   if(data.internal){internal=true;queue=[];}
   else if(data.expired){remove(SESSION,sessionStorage);session=null;lastView='';}
   else if(!r.ok)queue.unshift(...batch);
  }catch{queue.unshift(...batch);}finally{sending=false;}
 }
 function active(leaving=false){
  const now=Date.now(),seconds=Math.min(30,Math.floor((now-tickAt)/1000));tickAt=now;
  if(seconds>0&&(document.visibilityState==='visible'||leaving)&&now-lastInput<60000&&allowed())track('active',{seconds,...(currentProduct?{product_id:currentProduct}:{})});
 }
 function mainPage(){return names[location.hash.slice(1)]||names[document.querySelector('.page.active')?.id?.replace('Page','').toLowerCase()]||(location.pathname.startsWith('/where-to-buy')?'Store locations':location.pathname.startsWith('/delivery/')?'Delivery information':location.pathname.startsWith('/terms')?'Privacy & terms':'Home');}
 function currentView(){
  const p=typeof pdCurrentProduct!=='undefined'?pdCurrentProduct:null;
  if(p?.id&&document.getElementById('pdDrawer')?.classList.contains('open'))page('Product','product_view',{product_id:p.id});
  else if(document.getElementById('checkoutOverlay')?.classList.contains('open'))page('Checkout','checkout_open');
  else if(document.getElementById('cartDrawer')?.classList.contains('open'))page('Cart','cart_open');
  else page(mainPage());
 }
 function banner(force=false){
  document.getElementById('analyticsConsent')?.remove();
  const pref=read(CONSENT);if(!force&&pref&&Date.now()-pref.at<180*86400000)return;
  const el=document.createElement('section');el.id='analyticsConsent';el.className='journey-consent';el.setAttribute('aria-label',T('Analytics choices','בחירת פרטיות'));
  el.innerHTML=`<strong>${T('Help us improve your coffee shop','עזרו לנו לשפר את החנות')}</strong><p>${T('With your permission, we use browser storage to remember visits and see which pages and products you use. If you sign in, visits can be linked to your membership. Shopping works either way.','באישורכם, נשתמש באחסון בדפדפן לזיהוי ביקורים ולמדידת שימוש בעמודים ובמוצרים. כשאתם מחוברים, ניתן לקשר ביקורים לחשבון המועדון. אפשר לקנות גם ללא אישור.')} <a href="/terms.html#privacy">${T('Privacy','פרטיות')}</a></p><div><button type="button" data-analytics-choice="accepted">${T('Accept analytics','אישור מדידה')}</button><button type="button" data-analytics-choice="declined">${T('Essential only','חיוני בלבד')}</button></div>`;
  el.onclick=e=>{const choice=e.target.closest('[data-analytics-choice]')?.dataset.analyticsChoice;if(!choice)return;write(CONSENT,{value:choice,at:Date.now()});el.remove();
   if(choice==='accepted'){lastView='';currentView();flush();}else{queue=[];visitor=null;session=null;remove(VISITOR);remove(SESSION,sessionStorage);lastView='';}
  };document.body.append(el);
 }
 function wrap(name,after){const fn=root[name];if(typeof fn!=='function')return;root[name]=function(...args){const result=fn.apply(this,args);if(result?.then)return result.then(value=>{try{after(args,value);}catch{}return value;});try{after(args,result);}catch{}return result;};}
 function cartSignature(){return typeof cart!=='undefined'?cart.reduce((n,i)=>n+(Number(i.qty)||0),0):0;}
 let cartCount=0;
 function start(){
  cartCount=cartSignature();
  wrap('showPage',([p])=>page(names[p]||'Home'));
  wrap('goToAbout',()=>page('About'));
  wrap('openProductDrawerUI',()=>{const p=typeof pdCurrentProduct!=='undefined'?pdCurrentProduct:null;if(p?.id)page('Product','product_view',{product_id:p.id});});
  wrap('closeProductDrawer',()=>page(mainPage()));
  wrap('openPackBuilder',([id],ok)=>{if(ok)page('6-pack builder','pack_builder',{product_id:id});});
  wrap('openCart',()=>{page('Cart','cart_open');});
  wrap('openCartUI',()=>page('Cart','cart_open'));
  wrap('closeCart',()=>page(mainPage()));
  wrap('openCheckout',()=>page('Checkout','checkout_open'));
  wrap('openCheckoutUI',([view])=>{if(!view||view==='form')page('Checkout','checkout_open');});
  wrap('closeCheckout',()=>page(mainPage()));
  const payment=root.callCreatePayment;
  if(typeof payment==='function')root.callCreatePayment=async function(...args){try{const r=await payment.apply(this,args);page('Payment');return r;}catch(e){track('payment_error',{page:'Checkout'});throw e;}};
  wrap('updateCartCount',()=>{const count=cartSignature();if(count>cartCount)track('cart_add');cartCount=count;});
  const submit=root.submitOrder;if(typeof submit==='function')root.submitOrder=function(...args){track('pay_click',{page:'Checkout'});return submit.apply(this,args);};
  wrap('setCategory',([category])=>track('category_view',{page:'Shop',category}));
  wrap('plannerStart',()=>page('Coffee bar builder','bar_builder'));
  wrap('setUser',()=>{track('member_signin');flush();});
  wrap('showCheckoutResultUI',()=>page('Order confirmation'));
  wrap('applyTranslations',()=>{if(document.getElementById('analyticsConsent'))banner(true);const link=document.getElementById('analyticsChoices');if(link)link.textContent=T('Privacy choices','העדפות פרטיות');});
  document.addEventListener('click',e=>{if(e.target.closest('#bbMini,#bbWorldOpen,[data-bb-start]'))page('Coffee bar builder','bar_builder');});
  for(const event of ['pointerdown','keydown','scroll'])document.addEventListener(event,()=>{lastInput=Date.now();},{passive:true});
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'){active(true);flush();}else{tickAt=Date.now();lastInput=Date.now();if(allowed())currentView();}});window.addEventListener('pagehide',()=>{active(true);flush();});
  setInterval(()=>{active();flush();},15000);
  window.addEventListener('storage',e=>{if(e.key===CONSENT&&!allowed()){queue=[];session=null;visitor=null;}});
  const footer=document.querySelector('footer')||document.querySelector('main')||document.body;if(footer){const button=document.createElement('button');button.id='analyticsChoices';button.type='button';button.className='journey-privacy-link';button.textContent=T('Privacy choices','העדפות פרטיות');button.onclick=()=>banner(true);footer.append(button);}
  const pref=read(CONSENT);if(pref&&Date.now()-pref.at>=180*86400000){remove(VISITOR);remove(SESSION,sessionStorage);visitor=null;session=null;}
  banner();if(allowed())currentView();
 }
 root.GremierJourneys={track,context,choices:()=>banner(true),flush};
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})(window);
