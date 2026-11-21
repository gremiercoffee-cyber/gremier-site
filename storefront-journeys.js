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
 // Owner and test browsers: never tracked, and their WhatsApp-link clicks aren't counted (functions/go reads the
 // cookie). Set automatically once the owner signs in here, or by opening any page with ?notrack=1 (?notrack=0 undoes it).
 const INTERNAL='gremier_internal';
 const markInternal=(on)=>{try{document.cookie=`${INTERNAL}=${on?1:0}; path=/; max-age=${on?400*86400:0}; secure; samesite=lax`;}catch{}};
 const isInternal=()=>{try{return /(?:^|;\s*)gremier_internal=1(?:;|$)/.test(document.cookie);}catch{return false;}};
 try{const u=new URL(location.href),n=u.searchParams.get('notrack');if(n!==null){markInternal(n!=='0');u.searchParams.delete('notrack');history.replaceState(history.state,'',u.pathname+u.search+u.hash);}}catch{}
 let visitor=null,session=null,currentProduct=null,internal=isInternal();
 const endpoint=()=>`${apiBase}/functions/v1/site-journeys`;
 function ensure(){
  if(internal||!allowed())return false;
  visitor=visitor||read(VISITOR)||crypto.randomUUID();write(VISITOR,visitor);
  session=read(SESSION,sessionStorage);
  if(!session||Date.now()-session.last>30*60000||Date.now()-session.start>12*3600000){queue=[];session={id:crypto.randomUUID(),start:Date.now(),last:Date.now()};lastView='';}
  session.last=Date.now();write(SESSION,session,sessionStorage);return true;
 }
 // Which WhatsApp post brought this visit. Kept for the visit, or a week for people who accepted analytics.
 const LINK='gremier_link_v1';
 function captureLink(){try{const url=new URL(location.href),code=url.searchParams.get('l');if(!/^[a-z0-9]{6,12}$/.test(code||''))return;sessionStorage.setItem(LINK,code);if(allowed())write(LINK,{code,at:Date.now()});url.searchParams.delete('l');history.replaceState(history.state,'',url.pathname+url.search+url.hash);}catch{}}
 function linkCode(){try{const now=sessionStorage.getItem(LINK);if(now)return now;}catch{}const saved=allowed()?read(LINK):null;return saved&&Date.now()-saved.at<7*86400000?saved.code:null;}
 // Which website sent this visit (just its name, e.g. thejerusalembutler.com), kept for the visit so the order
 // can say where it came from even when analytics were declined. Payment and sign-in pages don't count as a source.
 const FROM='gremier_from_v1';
 function captureFrom(){try{if(sessionStorage.getItem(FROM))return;const h=new URL(document.referrer).hostname.replace(/^www\./,'').toLowerCase();if(!h||h===location.hostname.replace(/^www\./,'')||/(^|\.)(payme\.io|paymeservice\.com|accounts\.google\.com|supabase\.co|gremiercoffee\.co\.il)$/.test(h))return;sessionStorage.setItem(FROM,h.slice(0,100));}catch{}}
 function cameFrom(){try{return sessionStorage.getItem(FROM)||null;}catch{return null;}}
 function context(){const base=ensure()?{visitor_id:visitor,session_id:session.id}:null,link_code=linkCode(),came_from=cameFrom();return link_code||came_from?{...base,...(link_code?{link_code}:{}),...(came_from?{came_from}:{})}:base;}
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
  if(lastView){active();finishView();}
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
   if(data.internal){internal=true;queue=[];markInternal(true);}
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
  el.innerHTML=`<strong>${T('Cookies & privacy','עוגיות ופרטיות')}</strong><p>${T('Allow cookies and similar storage for analytics? Signed-in visits may link to your account.','לאפשר עוגיות ואחסון דומה למדידת השימוש באתר? ביקורים בחיבור לחשבון עשויים להיות מקושרים אליו.')} <a href="/terms.html#privacy">${T('Privacy','פרטיות')}</a></p><div><button type="button" data-analytics-choice="accepted">${T('Accept','אישור')}</button><button type="button" data-analytics-choice="declined">${T('Decline','ללא מדידה')}</button></div>`;
  el.onclick=e=>{const choice=e.target.closest('[data-analytics-choice]')?.dataset.analyticsChoice;if(!choice)return;write(CONSENT,{value:choice,at:Date.now()});el.remove();
   if(choice==='accepted'){lastView='';currentView();flush();}else{queue=[];visitor=null;session=null;remove(VISITOR);remove(SESSION,sessionStorage);remove(LINK);lastView='';}
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
  wrap('setUser',([user])=>{const email=String(user?.email||(typeof currentUser!=='undefined'?currentUser?.email:'')||'').toLowerCase();if(['gremiercoffee@gmail.com','yonigrey@gmail.com'].includes(email)){internal=true;queue=[];markInternal(true);return;}track('member_signin');flush();});
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
 // ---- Where people click, get stuck and spend time (same consent; no typed text or values) ----
 // Labels come from the site's own buttons/sections, with digits, emails and links removed.
 let iq=[],isending=false,iCount=0,scrollMax=0,sectionTime=new Map(),visible=new Set(),observer=null,sectionTick=Date.now(),clicks=[],fieldsSeen=new Set(),errors=0;
 const INTERACTIVE='a,button,[role=button],[role=tab],[role=link],[role=option],[role=checkbox],[role=radio],input,select,textarea,label,summary,[onclick],[data-track]';
 const PRIVATE='#myordersPage,[data-private]';
 const clean=s=>String(s||'').replace(/\S+@\S+/g,'').replace(/https?:\/\/\S+/g,'').replace(/\d+([.,]\d+)?/g,'#').replace(/\s+/g,' ').trim().slice(0,48);
 const skip=c=>['page','active','open','section','show','visible','hidden','loading'].includes(c)||/^(t-|is-|has-)/.test(c);
 // A section's name: its data-section, id or class; otherwise its first heading; otherwise header/footer/nav.
 function sectionName(s){return clean(s.dataset?.section||s.id||[...s.classList].find(c=>!skip(c))||s.querySelector('h1,h2,h3')?.textContent||(['HEADER','FOOTER','NAV'].includes(s.tagName)?s.tagName.toLowerCase():''));}
 function region(el){const s=el.closest('[data-section],.page>div,.page>section,.drawer,[role=dialog],.overlay,header,footer,nav');return s?sectionName(s):'';}
 function label(el,dead=false){
  if(el.dataset?.track)return clean(el.dataset.track);
  const tag=el.tagName.toLowerCase();
  if(['input','select','textarea'].includes(tag))return tag+': '+clean(el.name||el.id||el.type||'field');
  const fn=/^\s*([A-Za-z_$][\w$]*)\s*\(/.exec(el.getAttribute('onclick')||'')?.[1];
  const priv=el.closest(PRIVATE);
  const text=priv?'':clean(el.getAttribute('aria-label')||el.getAttribute('title')||el.innerText||el.textContent);
  const img=el.tagName==='IMG'?el:el.querySelector?.('img');
  const name=text||(img?.alt?'image: '+clean(img.alt):'')||(el.id?'#'+clean(el.id):'')||(fn?fn+'()':'')||tag;
  return dead&&tag==='img'&&img?.alt?'image: '+clean(img.alt):name;
 }
 const target=(el,dead)=>{const r=region(el),l=label(el,dead);return (r&&r!==l?r+' › ':'')+l;};
 function interact(kind,targetText,value=0){
  if(internal||!allowed()||iCount>=800)return;iCount++;
  iq.push({id:crypto.randomUUID(),kind,page:currentPage,target:String(targetText||'').slice(0,100),value:Math.max(0,Math.min(3600,Math.round(value)||0))});
  if(iq.length>200)iq=iq.slice(-200);if(iq.length>=30)iflush();
 }
 async function iflush(){
  if(isending||!iq.length||!allowed()||!ensure())return;
  const batch=iq.splice(0,40),sid=session.id;isending=true;
  try{const r=await fetch(endpoint(),{method:'POST',headers:{'Content-Type':'application/json',apikey:publicKey},keepalive:true,body:JSON.stringify({action:'interact',consent:true,visitor_id:visitor,session_id:sid,events:batch})});
   const data=await r.json().catch(()=>({}));if(!r.ok||data.retry)iq.unshift(...batch.slice(0,200-iq.length));
  }catch{iq.unshift(...batch);}finally{isending=false;}
 }
 function onClick(e){
  if(!allowed()||internal||!(e.target instanceof Element))return;
  const el=e.target,hit=el.closest(INTERACTIVE),now=Date.now();
  // Three or more clicks in under a second on the same spot = frustration (counted once per burst).
  clicks=clicks.filter(c=>now-c.t<900&&Math.hypot(c.x-e.clientX,c.y-e.clientY)<40);clicks.push({t:now,x:e.clientX,y:e.clientY});
  if(clicks.length===3)interact('rage_click',target(hit||el,!hit));
  if(hit){if(!hit.matches('input,select,textarea')||hit.matches('[type=checkbox],[type=radio],[type=submit],[type=button]'))interact('click',target(hit));return;}
  // Not a link or button and doesn't look clickable: people expected something to happen.
  try{if(getComputedStyle(el).cursor!=='pointer')interact('dead_click',target(el,true));}catch{}
 }
 function onScroll(e){
  const t=e.target===document||e.target===document.documentElement||e.target===document.body?document.scrollingElement:e.target;
  if(!(t instanceof Element)||t.scrollHeight<t.clientHeight*1.3)return;
  const pct=(t.scrollTop+t.clientHeight)/t.scrollHeight*100;if(pct>scrollMax)scrollMax=pct;
 }
 function sectionsNow(){
  observer?.disconnect();visible.clear();if(!('IntersectionObserver' in root))return;
  observer=new IntersectionObserver(list=>{countSections();for(const x of list){const key=sectionName(x.target);if(!key)continue;if(x.isIntersecting&&(x.intersectionRatio>=.5||x.intersectionRect.height>=innerHeight*.5))visible.add(key);else visible.delete(key);}},{threshold:[0,.1,.25,.5,.75,1]});
  document.querySelectorAll('.page.active>div,.page.active>section,[data-section],.drawer.open section,[role=dialog] section').forEach(el=>{if(el.offsetHeight>120)observer.observe(el);});
 }
 function countSections(){
  const now=Date.now(),secs=Math.min(30,(now-sectionTick)/1000);sectionTick=now;
  if(document.visibilityState!=='visible'||now-lastInput>60000)return;
  for(const k of visible)sectionTime.set(k,(sectionTime.get(k)||0)+secs);
 }
 function finishView(){
  if(!allowed()||internal)return;
  if(scrollMax>0){const b=scrollMax>=95?100:Math.max(25,Math.floor(scrollMax/25)*25);interact('scroll','reached '+b+'%',b);}
  countSections();for(const [k,s] of sectionTime)if(s>=2)interact('section',k,Math.min(600,s));
  scrollMax=0;sectionTime=new Map();setTimeout(sectionsNow,400);
 }
 function onFocus(e){
  const el=e.target;if(!(el instanceof Element)||!el.matches('input,select,textarea')||!el.closest('#checkoutOverlay,.checkout,[data-checkout]'))return;
  const name=label(el);if(fieldsSeen.has(name))return;fieldsSeen.add(name);interact('field',name);
 }
 function onError(message){if(errors>=5)return;errors++;interact('js_error',clean(message)||'error');}
 // Microsoft Clarity (heatmaps and visit recordings), only after "Accept"; typed text is masked by Clarity.
 const CLARITY_ID=root.GREMIER_CLARITY_ID||'zg7jd2e9u2';
 function clarity(){
  if(!CLARITY_ID||internal||!allowed()||root.clarity?.loaded)return;
  root.clarity=root.clarity||function(){(root.clarity.q=root.clarity.q||[]).push(arguments);};root.clarity.loaded=true;
  const s=document.createElement('script');s.async=true;s.src='https://www.clarity.ms/tag/'+encodeURIComponent(CLARITY_ID);document.head.append(s);root.clarity('consent');
 }
 function startBehaviour(){
  document.addEventListener('click',onClick,{capture:true,passive:true});
  document.addEventListener('scroll',onScroll,{capture:true,passive:true});
  document.addEventListener('focusin',onFocus,{passive:true});
  root.addEventListener('error',e=>onError(e.message));root.addEventListener('unhandledrejection',e=>onError(e.reason?.message||'promise'));
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'){finishView();iflush();}else sectionTick=Date.now();});
  root.addEventListener('pagehide',()=>{finishView();iflush();});
  setInterval(()=>{countSections();iflush();},15000);
  setTimeout(sectionsNow,1500);clarity();
  document.addEventListener('click',e=>{if(e.target.closest?.('[data-analytics-choice="accepted"]'))setTimeout(clarity,50);else if(e.target.closest?.('[data-analytics-choice="declined"]')){iq=[];try{root.clarity?.('consent',false);}catch{}}},true);
 }
 captureLink();captureFrom();
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',startBehaviour);else startBehaviour();
 root.GremierJourneys={track,context,choices:()=>banner(true),flush};
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})(window);
