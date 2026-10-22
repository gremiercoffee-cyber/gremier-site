/* Combine saved, billed-but-unpaid statements; never issues documents or sends messages. */
(function(root){
 'use strict';
 function outstanding(rows,store){return rows.filter(r=>r.store_id===store&&r.billed_at&&!r.paid_at&&!r.cancelled_at);}
 const total=rows=>rows.reduce((sum,r)=>sum+Math.round(Number(r.total||0)*100),0)/100;
 function message(name,amount){const sum=Number(amount).toLocaleString('en-IL',{minimumFractionDigits:2,maximumFractionDigits:2});return `Hi ${name}, your outstanding balance is ₪${sum}. All unpaid statements are attached. Please arrange payment. Thank you!\n\nשלום ${name}, יתרת התשלום שלכם היא ₪${sum}. מצורפים כל החשבונות שטרם שולמו. נשמח להסדרת התשלום. תודה!`;}
 function phone(value){let n=String(value||'').replace(/\D/g,'');if(n.startsWith('00'))n=n.slice(2);if(n.startsWith('0'))n='972'+n.slice(1);return /^\d{10,15}$/.test(n)?n:'';}
 const api={outstanding,total,message,phone};if(typeof module!=='undefined'&&module.exports)module.exports=api;
 if(!root.document)return;
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 let panel,objectURL;
 function close(){panel?.remove();panel=null;if(objectURL)URL.revokeObjectURL(objectURL);objectURL=null;}
 function download(file){const a=document.createElement('a');a.href=objectURL;a.download=file.name;a.click();}
 function image(url){return new Promise((resolve,reject)=>{const img=new Image();img.crossOrigin='anonymous';img.onload=()=>resolve(img);img.onerror=()=>reject(Error('Could not load a statement image. Try again.'));img.src=url;});}
 async function combine(rows,name){
  const images=await Promise.all(rows.map(r=>image(r.image_url)));
  let width=1100;const heights=images.map(i=>i.naturalHeight/i.naturalWidth*width);const rawHeight=160+heights.reduce((a,b)=>a+b+24,0);const scale=Math.min(1,Math.sqrt(12000000/(width*rawHeight)),16000/rawHeight);
  const canvas=document.createElement('canvas');canvas.width=Math.floor(width*scale);canvas.height=Math.ceil(rawHeight*scale);const ctx=canvas.getContext('2d');if(!ctx)throw Error('Image export is unavailable.');ctx.scale(scale,scale);ctx.fillStyle='#fff';ctx.fillRect(0,0,width,rawHeight);ctx.fillStyle='#171717';ctx.font='bold 30px sans-serif';ctx.fillText(name,24,45,width-48);ctx.font='24px sans-serif';ctx.fillText('Outstanding: ₪'+total(rows).toFixed(2)+' · '+rows.length+' statements',24,90);let y=140;images.forEach((img,i)=>{ctx.drawImage(img,0,y,width,heights[i]);y+=heights[i]+24;});
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob)throw Error('Could not create the PNG.');return new File([blob],('Gremier - '+name+' - unpaid statements.png').replace(/[<>:"/\\|?*]/g,'-'),{type:'image/png'});
 }
 api.open=async function(storeId){
  close();panel=document.createElement('dialog');panel.className='billing-share-dialog';panel.innerHTML='<div class="billing-share-head"><h3>Share unpaid bills</h3><button class="btn btn-outline btn-sm" data-share-close aria-label="Close">×</button></div><p role="status">Preparing all unpaid statements…</p>';document.body.append(panel);panel.querySelector('[data-share-close]').onclick=close;panel.addEventListener('cancel',event=>{event.preventDefault();close();});panel.showModal();const active=panel;
  try{
   const rows=[];for(let start=0;;start+=1000){const result=await sb.from('store_billing').select('id,store_id,total,year,month,billed_at,paid_at,cancelled_at,image_url,stores(name,phone)').eq('store_id',storeId).order('year').order('month').order('id').range(start,start+999);if(result.error)throw result.error;rows.push(...(result.data||[]));if((result.data||[]).length<1000)break;}
   if(panel!==active)return;const unpaid=outstanding(rows,storeId);if(!unpaid.length)throw Error('No billed and unpaid statements for this store.');if(unpaid.some(r=>!r.image_url))throw Error('Some unpaid statements have no saved PNG. Generate those statements first so nothing is left out.');
   const store=typeof allStores!=='undefined'?allStores.find(s=>s.id===storeId):null,name=unpaid[0].stores?.name||store?.name||'Store',number=phone(store?.phone||unpaid[0].stores?.phone),text=message(name,total(unpaid)),file=await combine(unpaid,name);if(panel!==active)return;objectURL=URL.createObjectURL(file);
   active.innerHTML=`<div class="billing-share-head"><h3>${esc(name)}</h3><button class="btn btn-outline btn-sm" data-share-close aria-label="Close">×</button></div><p>${unpaid.length} unpaid statements · ₪${total(unpaid).toFixed(2)} · all time</p><img class="billing-share-preview" src="${objectURL}" alt="Combined unpaid statements"><p class="billing-share-message" dir="auto">${esc(text)}</p><div class="fw-actions"><button class="btn btn-amber" data-share-file>Share PNG</button><button class="btn btn-outline" data-share-chat ${number?'':'disabled'}>Download & open WhatsApp</button><button class="btn btn-outline" data-share-download>Download PNG</button></div><p class="sales-note" role="status" data-share-status>${number?'':'Add a store phone number to open its WhatsApp chat.'}</p>`;
   active.querySelector('[data-share-close]').onclick=close;active.querySelector('[data-share-download]').onclick=()=>download(file);
   active.querySelector('[data-share-chat]').onclick=()=>{download(file);root.open('https://wa.me/'+number+'?text='+encodeURIComponent(text),'_blank','noopener');};
   active.querySelector('[data-share-file]').onclick=async()=>{try{if(navigator.canShare?.({files:[file]})){await navigator.share({files:[file],text,title:name+' · unpaid statements'});}else{download(file);active.querySelector('[data-share-status]').textContent='PNG downloaded. Use “Download & open WhatsApp” to open the store chat, then attach the PNG.';}}catch(e){if(e.name!=='AbortError')active.querySelector('[data-share-status]').textContent='Could not share. Download the PNG and attach it in WhatsApp.';}};
  }catch(e){if(panel===active)active.querySelector('[role="status"]').textContent=e.message||'Could not prepare statements.';}
 };
 document.addEventListener('click',event=>{const button=event.target.closest('[data-bill-share]');if(button)api.open(button.dataset.billShare);});
 root.GremierBillingShare=api;
})(typeof window==='undefined'?globalThis:window);
