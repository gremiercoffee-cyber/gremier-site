/* Home destinations and category shelves; existing product cards own all purchase actions. */
(function(root){
 'use strict';
 const specs=[
  ['bottles','Liter bottles','בקבוקי ליטר','Your fridge staple','הקפה שתמיד במקרר'],
  ['minis','Mini four-packs','מארזי מיני','Small bottles. Big favourites.','בקבוקים קטנים. טעם גדול.'],
  ['bulk','Wholesale','סיטונאי','More of your favourite','יותר מהקפה האהוב עליכם'],
  ['syrups','Syrups','סירופים','Make it your own','בדיוק בטעם שלכם']
 ];
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function groups(list,category,he){
  const known=new Set(specs.map(s=>s[0]));
  const result=specs.map(s=>({key:s[0],title:s[he?2:1],caption:s[he?4:3],items:list.filter(p=>category(p)===s[0])})).filter(s=>s.items.length);
  const other=list.filter(p=>!known.has(category(p))&&category(p)!=='coffeebars');
  if(other.length)result.push({key:'extras',title:he?'עוד מהקולקציה':'More from Gremier',caption:'',items:other});
  return result;
 }
 function pages(items){const out=[];for(let i=0;i<items.length;i+=4)out.push(items.slice(i,i+4));return out;}
 function renderShop(grid,list,category,card,he){
  grid.classList.add('shop-shelves');
  const shelves=groups(list,category,he);
  grid.innerHTML=shelves.map(s=>{
   const batches=pages(s.items),multi=batches.length>1;
   return `<section class="shop-shelf" id="shop-shelf-${s.key}" aria-labelledby="shelf-title-${s.key}"><header class="shelf-heading"><div><div class="shelf-eyebrow">${esc(s.caption)}</div><h2 id="shelf-title-${s.key}">${esc(s.title)}</h2></div><div class="shelf-actions">${multi?`<button type="button" class="shelf-expand" aria-expanded="false">${he?'לכל '+s.items.length+' המוצרים':'View all '+s.items.length} ↗</button><div class="shelf-arrows"><button type="button" data-shelf-prev aria-label="${esc((he?'הקודם: ':'Previous ')+s.title)}" disabled>${he?'→':'←'}</button><button type="button" data-shelf-next aria-label="${esc((he?'עוד: ':'More ')+s.title)}">${he?'←':'→'}</button></div>`:`<span class="shelf-count">${s.items.length} ${he?'מוצרים':'products'}</span>`}</div></header><div class="shelf-track" dir="${he?'rtl':'ltr'}" tabindex="0" role="region" aria-label="${esc(s.title)}">${batches.map(batch=>`<div class="shelf-page product-grid">${batch.map(card).join('')}</div>`).join('')}</div>${multi?`<div class="shelf-dots" aria-hidden="true">${batches.map((_,i)=>`<span class="${i?'':'active'}"></span>`).join('')}</div>`:''}</section>`;
  }).join('')+`<aside class="shop-bar-route"><div><h2>${he?'מארחים בקרוב?':'Have a crowd coming?'}</h2><p>${he?'בנו עמדת קפה מלאה לפי מספר האורחים.':'Build a complete coffee bar around your guest count.'}</p></div><a href="#coffeebars" onclick="event.preventDefault();showPage('coffeebars')">${he?'בנו את עמדת הקפה ←':'Build your coffee bar →'}</a></aside>`;
  grid.querySelectorAll('.shop-shelf').forEach(shelf=>{
   const track=shelf.querySelector('.shelf-track'),prev=shelf.querySelector('[data-shelf-prev]'),next=shelf.querySelector('[data-shelf-next]'),expand=shelf.querySelector('.shelf-expand');
   const update=()=>{const step=track.clientWidth+20,pos=Math.abs(track.scrollLeft),page=Math.round(pos/step);if(prev)prev.disabled=pos<3;if(next)next.disabled=pos+track.clientWidth>=track.scrollWidth-3;shelf.querySelectorAll('.shelf-dots span').forEach((dot,i)=>dot.classList.toggle('active',i===page));};
   const move=direction=>track.scrollBy({left:(he?-1:1)*direction*(track.clientWidth+20),behavior:root.matchMedia?.('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
   prev?.addEventListener('click',()=>move(-1));next?.addEventListener('click',()=>move(1));track.addEventListener('scroll',update,{passive:true});
   track.addEventListener('keydown',e=>{if(e.target!==track)return;if(e.key==='ArrowRight'||e.key==='ArrowLeft'){e.preventDefault();move((e.key==='ArrowRight'?1:-1)*(he?-1:1));}});
   if(expand){const label=expand.textContent;expand.onclick=()=>{const open=expand.getAttribute('aria-expanded')!=='true';expand.setAttribute('aria-expanded',String(open));shelf.classList.toggle('shelf-expanded',open);expand.textContent=open?(he?'הצג פחות ↑':'Show less ↑'):label;};}
  });
 }
 function jump(category){const el=category==='all'?document.getElementById('catFilter'):document.getElementById('shop-shelf-'+category);if(el)el.scrollIntoView({block:'start',behavior:root.matchMedia?.('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});}
 function home(products,he,optimize){
  document.querySelectorAll('[data-discovery-en]').forEach(el=>el.textContent=el.getAttribute(he?'data-discovery-he':'data-discovery-en'));
  const host=document.getElementById('discoveryBottles');if(!host)return;
  const names=['House Blend Medium Roast','Classic Dark Roast','Colombia Light Roast'];
  const selected=names.map(n=>products.find(p=>p.name_en===n&&p.images?.length)).filter(Boolean);
  if(selected.length)host.innerHTML=selected.map(p=>`<img src="${esc(optimize(p.images[0],400))}" alt="${esc(he?(p.name_he||p.name_en):p.name_en)}" decoding="async" draggable="false">`).join('');
 }
 const api={groups,pages,renderShop,jump,home};
 if(typeof module==='object'&&module.exports)module.exports=api;else root.GremierDiscovery=api;
})(typeof window==='object'?window:globalThis);
