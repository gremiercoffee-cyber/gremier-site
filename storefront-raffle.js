/* Weekly Status raffle on the homepage. Shown only to people who arrive from a Status link
   (?raffle=...&source=status-N-F) while that raffle is open. Free entry: pick a product + a phone number,
   no account and no purchase. A raffle outage never affects the rest of the page. */
(function(root){
 'use strict';
 if(root.GremierRaffle)return;
 const API='https://gremier-status.gremiercoffee.workers.dev/api/public/raffles/';
 const KEY='gremier-raffle';
 let id='',source='';
 try{
  const p=new URL(location.href).searchParams;
  if(/^raffle_[\w-]{1,100}$/.test(p.get('raffle')||'')&&/^status-[1-9]\d?-[1-4]$/.test(p.get('source')||'')){id=p.get('raffle');source=p.get('source');sessionStorage.setItem(KEY,JSON.stringify({id,source}));}
  else{const saved=JSON.parse(sessionStorage.getItem(KEY)||'null');if(saved&&/^raffle_[\w-]{1,100}$/.test(saved.id||'')){id=saved.id;source=saved.source||'';}}
 }catch{}
 if(!id)return;
 // Follows the site's language (Hebrew or English), like the rest of the page.
 const he=()=>typeof lang!=='undefined'?lang==='he':document.documentElement.lang==='he',T=(en,hb)=>he()?hb:en;
 // When the draw is, broadly ("Thursday evening" / "יום חמישי בערב"), never a clock time.
 const endpoint=API+encodeURIComponent(id),date=v=>{const d=new Date(v),day=new Intl.DateTimeFormat(he()?'he-IL':'en-GB',{timeZone:'Asia/Jerusalem',weekday:'long'}).format(d),h=Number(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Jerusalem',hour:'2-digit',hourCycle:'h23'}).format(d));return day+' '+(h>=17?T('evening','בערב'):h>=12?T('afternoon','אחר הצהריים'):T('morning','בבוקר'));};
 const el=(tag,text,attrs={})=>{const n=document.createElement(tag);if(text)n.textContent=text;for(const [key,value]of Object.entries(attrs))n.setAttribute(key,value);return n;};
 // Consent-aware journeys only; never pass the phone number or anything typed.
 const track=kind=>{try{root.GremierJourneys?.track(kind,{page:'Home'});}catch{}};
 // Entering needs a site account (Google sign-in), so we know who each entrant is. Uses the page's own sign-in.
 const user=()=>{try{return typeof currentUser!=='undefined'?currentUser:null;}catch{return null;}};
 const token=async()=>{try{const s=await getSessionSafe();return s?.data?.session?.access_token||'';}catch{return '';}};
 const RESUME='gremier-raffle-resume';
 const api=async(path,body,auth)=>{const r=await fetch(endpoint+path,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json',...(auth?{Authorization:'Bearer '+auth}:{})}:{},body:body?JSON.stringify(body):undefined});const d=await r.json().catch(()=>({}));if(r.status===401){const e=Error(T('Please sign in to enter.','צריך להתחבר כדי להשתתף.'));e.signIn=true;throw e;}if(!r.ok)throw Error(r.status===400&&/phone/i.test(d.message||'')?T('Please check the phone number.','בדקו את מספר הטלפון.'):d.message||T('The giveaway is unavailable right now. Please try again.','ההגרלה לא זמינה כרגע. נסו שוב.'));return d;};
 let raffle,drawer,opener,previousFocus,scrollY,previousOverflow,chosen,openerState='plain',label=()=>{};
 // One more entry for messaging us on WhatsApp. The WhatsApp add-on credits the sender's number (never whoever shared the link).
 const WA='972552703413',waEntries=()=>raffle.whatsappEntries||1;
 const waLink=(text,cls)=>{const a=el('a',text,{class:cls,target:'_blank',rel:'noopener',href:'https://wa.me/'+WA+'?text='+encodeURIComponent(T('Hi! I’d like another entry into the giveaway raffle 🎟️','היי! אשמח לכרטיס נוסף בהגרלה 🎟️'))});return a;};
 function close(){if(!drawer?.open)return;drawer.close();document.body.style.overflow=previousOverflow;root.scrollTo(0,scrollY);previousFocus?.focus();}
 function productUrl(product){try{const u=new URL(product.url||'https://gremiercoffee.co.il/#shop');return u.protocol==='https:'&&/(^|\.)gremiercoffee\.co\.il$/.test(u.hostname)?u.href:'https://gremiercoffee.co.il/#shop';}catch{return 'https://gremiercoffee.co.il/#shop';}}
 function open(){
  if(!raffle||Date.now()>=Date.parse(raffle.cutoff)){if(opener)opener.hidden=true;return;}
  if(!drawer){
   drawer=el('dialog',null,{class:'gremier-raffle-drawer','aria-labelledby':'gremier-raffle-title'});document.body.append(drawer);
   drawer.addEventListener('cancel',e=>{e.preventDefault();close();});drawer.addEventListener('click',e=>{if(e.target===drawer)close();});
  }
  drawer.replaceChildren();drawer.dir=he()?'rtl':'ltr';const exit=el('button','✕',{type:'button','aria-label':T('Close','סגירה'),class:'gremier-raffle-x'});exit.onclick=close;
  drawer.append(exit,el('h2',T(raffle.prize,raffle.prizeHe||raffle.prize),{id:'gremier-raffle-title'}),el('p',T('Free to enter. The draw is on ','ההשתתפות בחינם. ההגרלה תתקיים ב')+date(raffle.draw_at||raffle.cutoff)+'.'));
  // Not signed in yet: one tap with Google, then they come straight back to this form.
  if(!user()){
   const why=el('p',T('Sign in to enter, so we know who you are if you win. It takes one tap.','התחברו כדי להשתתף, כדי שנדע מי אתם אם תזכו. זה לוקח רגע.'));
   const google=el('button',T('Continue with Google','המשך עם Google'),{type:'button',class:'gremier-raffle-go'});
   google.onclick=()=>{try{sessionStorage.setItem(RESUME,'1');}catch{}track('raffle_sign_in');try{signInWithGoogle();}catch{}};
   drawer.append(why,google);
   previousFocus=document.activeElement;scrollY=root.scrollY;previousOverflow=document.body.style.overflow;document.body.style.overflow='hidden';drawer.showModal();track('raffle_open');
   return;
  }
  const question=el('h3',T('Which would you pick?','מה הייתם בוחרים?'));
  const form=el('form'),cards=el('fieldset'),legend=el('legend',T(`Pick one for ${raffle.choiceEntries} entries`,`בחרו אחד וקבלו ${raffle.choiceEntries} כרטיסים`));cards.append(legend);
  for(const p of raffle.products){const label=el('label',null,{class:'gremier-raffle-card'}),radio=el('input',null,{type:'radio',name:'product',value:p.id,required:''});label.append(radio,el('span',p.name));cards.append(label);}
  const phoneLabel=el('label',T('Your WhatsApp number (so we can tell you if you win)','מספר הוואטסאפ שלכם (כדי שנוכל לבשר לכם אם זכיתם)')),phone=el('input',null,{type:'tel',name:'phone',autocomplete:'tel',inputmode:'tel',required:'',placeholder:'050-000-0000',dir:'ltr'});phoneLabel.append(phone);
  const submit=el('button',T('Enter','להשתתפות'),{type:'submit',class:'gremier-raffle-go'}),message=el('p','',{role:'status','aria-live':'polite'});
  const terms=el('p','',{class:'gremier-raffle-terms'}),link=el('a',T('Rules','תקנון'),{href:raffle.terms,target:'_blank',rel:'noopener'});terms.append(T('No purchase needed. ','לא צריך לקנות כלום. '),link);
  const phoneHint=el('p',T('Messages from this number on WhatsApp add to the same entry.','הודעות מהמספר הזה בוואטסאפ מצטרפות לאותה השתתפות.'),{class:'gremier-raffle-terms'});
  form.append(cards,phoneLabel,phoneHint,submit,message,terms);drawer.append(question,form);
  form.onsubmit=async e=>{
   e.preventDefault();if(!form.reportValidity())return;submit.disabled=true;message.textContent=T('Saving…','שומרים…');
   try{
    const productId=new FormData(form).get('product');chosen=raffle.products.find(p=>p.id===productId);
    const result=await api('/entry',{phone:phone.value,productId},await token());track('raffle_entry');form.replaceChildren();question.textContent=T('You’re in!','נרשמתם!');
    form.append(el('p',T(`${result.entries} entries for picking ${chosen.name}. Heart and reshare our Status for more.`,`${result.entries} כרטיסים על הבחירה ב-${chosen.name}. סמנו לב ושתפו את הסטטוס שלנו לעוד כרטיסים.`)));
    const view=el('a',T('See ','לצפייה ב-')+chosen.name,{href:productUrl(chosen),class:'gremier-raffle-go'});
    const more=waLink(T(`💬 Save our number & message us for ${waEntries()} more`,`💬 שמרו את המספר ושלחו לנו הודעה לעוד ${waEntries()}`),'gremier-raffle-wa');
    const done=el('button',T('Keep browsing','להמשיך לגלוש'),{type:'button'});done.onclick=close;form.append(view,more,done);
    openerState='entered';label();
   }catch(error){message.textContent=error.message;submit.disabled=false;if(error.signIn){close();setTimeout(open,0);}}
  };
  previousFocus=document.activeElement;scrollY=root.scrollY;previousOverflow=document.body.style.overflow;document.body.style.overflow='hidden';drawer.showModal();track('raffle_open');
 }
 api('').then(data=>{
  if(!data.active){try{sessionStorage.removeItem(KEY);}catch{}return;}
  raffle=data;opener=el('button',T('🎁 Enter this week’s giveaway','🎁 להשתתפות בהגרלה השבועית'),{class:'gremier-raffle-trigger',type:'button','aria-haspopup':'dialog'});opener.onclick=open;
  // Under the giveaway button: a handwritten note pointing down to a WhatsApp pill.
  const dock=el('div',null,{class:'gremier-raffle-dock'}),n=waEntries(),note=el('p',null,{class:'gremier-raffle-note'}),noteText=el('span');
  note.append(noteText);
  note.insertAdjacentHTML('beforeend','<svg width="26" height="30" viewBox="0 0 26 30" fill="none" aria-hidden="true"><path d="M6 3 C 3 12, 8 20, 14 26" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M8 24 L14 26 L14 19" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>');
  const pill=waLink('','gremier-raffle-wa'),row=el('div',null,{class:'gremier-raffle-row'});row.append(note,pill);dock.append(opener,row);document.body.append(dock);track('raffle_visit');
  // The page's chat bubble sits just above this card (CSS reads its height).
  try{new ResizeObserver(()=>document.documentElement.style.setProperty('--gremier-raffle-dock-h',dock.offsetHeight+'px')).observe(dock);}catch{}
  // The site picks Hebrew or English after it loads (and on the language button): keep every label in step.
  label=()=>{
   opener.textContent=openerState==='entered'?T('You’re entered ✓','נרשמתם להגרלה ✓'):openerState==='invite'?T('🎁 Enter this week’s free giveaway','🎁 להשתתפות בהגרלה החינמית'):T('🎁 Enter this week’s giveaway','🎁 להשתתפות בהגרלה השבועית');
   dock.dir=he()?'rtl':'ltr';noteText.textContent=T(`Save our number & message us for ${n===1?'another entry':n+' more entries'}!`,`שמרו את המספר שלנו ושלחו הודעה ${n===1?'לכרטיס נוסף':'לעוד '+n+' כרטיסים'}!`);
   pill.textContent=T('💬 WhatsApp us','💬 וואטסאפ');
   pill.href='https://wa.me/'+WA+'?text='+encodeURIComponent(T('Hi! I’d like another entry into the giveaway raffle 🎟️','היי! אשמח לכרטיס נוסף בהגרלה 🎟️'));
  };
  label();new MutationObserver(()=>label()).observe(document.documentElement,{attributes:true,attributeFilter:['lang']});
  // Once they scroll into the shop, the note folds away and the two buttons stay.
  root.addEventListener('scroll',()=>dock.classList.toggle('is-compact',root.scrollY>root.innerHeight*0.6),{passive:true});
  // Arriving from the "pick a product" frame: open the giveaway straight away. From the hero video's link (-3): keep the
  // homepage and its hero in view, and invite them with a highlighted button instead of covering the page.
  const fresh=!!new URL(location.href).searchParams.get('raffle');
  // Back from Google sign-in: reopen the giveaway once the account has loaded.
  let resume=false;try{resume=sessionStorage.getItem(RESUME)==='1';sessionStorage.removeItem(RESUME);}catch{}
  if(resume){let n=0;const wait=setInterval(()=>{if(user()||++n>40){clearInterval(wait);if(user())open();}},250);}
  if(/-2$/.test(source)&&fresh)setTimeout(open,600);
  if(/-3$/.test(source)&&fresh){opener.classList.add('is-invite');openerState='invite';label();}
 }).catch(()=>{});
 root.GremierRaffle={open,close};
})(window);
