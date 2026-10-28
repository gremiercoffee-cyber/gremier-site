/* A short first-load brand reveal. Loading is never dependent on its animation. */
(function(root){
 'use strict';
 const key='gremier_last_open_v1',now=Date.now(),repeatWindow=15*60*1000;
 function shouldShow({last,now,search='',hash='',type='',framed=false}){
  const q=new URLSearchParams(search);
  const returning=['payment','payme_status','payme_sale_status','sale_status','payme_sale_id','code','error','cart','gift'].some(k=>q.has(k))||/access_token=|refresh_token=|checkout|payment/i.test(hash);
  return !framed&&!returning&&type!=='back_forward'&&(!last||now-last>repeatWindow);
 }
 if(typeof module==='object'&&module.exports){module.exports={shouldShow};return;}
 let last=0;try{last=Number(root.localStorage.getItem(key))||0;root.localStorage.setItem(key,String(now));}catch{}
 const on=shouldShow({last,now,search:root.location.search,hash:root.location.hash,type:root.performance?.getEntriesByType?.('navigation')?.[0]?.type,framed:root.parent!==root});
 let finished=false,preparing=false,timer;
 function dismiss(){
  if(finished)return;finished=true;clearTimeout(timer);
  const overlay=document.getElementById('gremierBoot');overlay?.setAttribute('aria-hidden','true');overlay?.classList.add('boot-leaving');
  document.documentElement.classList.remove('gremier-boot');
  root.setTimeout(()=>overlay?.remove(),320);
 }
 function waitForImage(img){return img.complete?Promise.resolve():new Promise(resolve=>{img.addEventListener('load',resolve,{once:true});img.addEventListener('error',resolve,{once:true});});}
 async function ready(){
  if(!on||finished||preparing)return;preparing=true;
  const images=[...document.querySelectorAll('.page.active img')].filter(img=>{const r=img.getBoundingClientRect();return r.width>0&&r.height>0&&r.top<root.innerHeight&&r.bottom>0;}).slice(0,8);
  await Promise.race([Promise.all(images.map(waitForImage)),new Promise(resolve=>root.setTimeout(resolve,1200))]);
  root.requestAnimationFrame(()=>root.requestAnimationFrame(dismiss));
 }
 root.GremierBoot={ready,dismiss};
 if(!on)return;
 document.documentElement.classList.add('gremier-boot');
 timer=root.setTimeout(dismiss,3500);
 document.addEventListener('click',event=>{if(event.target?.closest?.('#bootSkip'))dismiss();});
 root.addEventListener('pageshow',e=>{if(e.persisted)dismiss();});
})(typeof window==='object'?window:globalThis);
