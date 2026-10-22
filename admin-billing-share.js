/* Share original saved statements as separate files; never issues documents or sends messages. */
(function(root){
 'use strict';
 function outstanding(rows,store){return rows.filter(r=>r.store_id===store&&r.billed_at&&!r.paid_at&&!r.cancelled_at);}
 const total=rows=>rows.reduce((sum,r)=>sum+Math.round(Number(r.total||0)*100),0)/100;
 function selected(rows,ids){const wanted=new Set(ids);return rows.filter(r=>wanted.has(r.id));}
 function message(name,amount,all=true){const sum=Number(amount).toLocaleString('en-IL',{minimumFractionDigits:2,maximumFractionDigits:2});return all?`Hi ${name}, your outstanding balance is ₪${sum}. All unpaid statements are attached. Please arrange payment. Thank you!\n\nשלום ${name}, יתרת התשלום שלכם היא ₪${sum}. מצורפים כל החשבונות שטרם שולמו. נשמח להסדרת התשלום. תודה!`:`Hi ${name}, the attached unpaid statements total ₪${sum}. Please arrange payment. Thank you!\n\nשלום ${name}, סכום החשבונות המצורפים שטרם שולמו הוא ₪${sum}. נשמח להסדרת התשלום. תודה!`;}
 function phone(value){let n=String(value||'').replace(/\D/g,'');if(n.startsWith('00'))n=n.slice(2);if(n.startsWith('0'))n='972'+n.slice(1);return /^\d{10,15}$/.test(n)?n:'';}
 function filename(row,name){return `Gremier - ${name} - ${row.year}-${String(row.month).padStart(2,'0')} - statement.png`.replace(/[<>:"/\\|?*]/g,'-');}
 async function files(rows,name,fetcher=fetch){
  if(!rows.length)throw Error('Choose at least one statement.');
  if(rows.some(r=>!r.image_url))throw Error('Some selected statements have no saved PNG. Generate those statements first.');
  return Promise.all(rows.map(async row=>{const response=await fetcher(row.image_url);if(!response.ok)throw Error('Could not download a statement. Try again.');const blob=await response.blob();return new File([blob],filename(row,name),{type:blob.type||'image/png'});}));
 }
 const api={outstanding,total,selected,message,phone,filename,files};if(typeof module!=='undefined'&&module.exports)module.exports=api;
 if(!root.document)return;
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 let panel,urls=[];
 function close(){panel?.remove();panel=null;urls.forEach(url=>URL.revokeObjectURL(url));urls=[];}
 function download(file){const url=URL.createObjectURL(file);urls.push(url);const a=document.createElement('a');a.href=url;a.download=file.name;a.click();}
 const heading=name=>`<div class="billing-share-head"><h3>${esc(name)}</h3><button class="btn btn-outline btn-sm" data-share-close aria-label="Close">×</button></div>`;
 function wireClose(active){active.querySelector('[data-share-close]').onclick=close;}
 api.open=async function(storeId,choose=false){
  close();panel=document.createElement('dialog');panel.className='billing-share-dialog';panel.innerHTML=heading(choose?'Share multiple statements':'Share all unpaid statements')+'<p role="status">Loading statements…</p>';document.body.append(panel);wireClose(panel);panel.addEventListener('cancel',event=>{event.preventDefault();close();});panel.showModal();const active=panel;
  try{
   const rows=[];for(let start=0;;start+=1000){const result=await sb.from('store_billing').select('id,store_id,total,year,month,billed_at,paid_at,cancelled_at,image_url,stores(name,phone)').eq('store_id',storeId).order('year').order('month').order('id').range(start,start+999);if(result.error)throw result.error;rows.push(...(result.data||[]));if((result.data||[]).length<1000)break;}
   if(panel!==active)return;const unpaid=outstanding(rows,storeId);if(!unpaid.length)throw Error('No billed and unpaid statements for this store.');
   const store=typeof allStores!=='undefined'?allStores.find(s=>s.id===storeId):null,name=unpaid[0].stores?.name||store?.name||'Store',number=phone(store?.phone||unpaid[0].stores?.phone);
   async function prepare(chosen){
    if(!chosen.length)return;
    active.innerHTML=heading(name)+'<p role="status">Preparing original PNGs…</p>';wireClose(active);
    try{
     const attachments=await files(chosen,name);if(panel!==active)return;
     const text=message(name,total(chosen),chosen.length===unpaid.length);
     active.innerHTML=heading(name)+`<p>${chosen.length} separate PNGs · ₪${total(chosen).toFixed(2)}</p><ul class="billing-file-list">${attachments.map(file=>`<li>${esc(file.name)}</li>`).join('')}</ul><p class="billing-share-message" dir="auto">${esc(text)}</p><div class="fw-actions"><button class="btn btn-amber" data-share-file>Share ${chosen.length} statement${chosen.length===1?'':'s'}</button><button class="btn btn-outline" data-share-chat ${number?'':'disabled'}>Download & open WhatsApp</button><button class="btn btn-outline" data-share-download>Download PNGs</button><button class="btn btn-outline" data-change-selection>Change selection</button></div><p class="sales-note" role="status" data-share-status>${number?'':'Add a store phone number to open its WhatsApp chat.'}</p>`;
     wireClose(active);active.querySelector('[data-change-selection]').onclick=()=>pick(chosen.map(r=>r.id));
     active.querySelector('[data-share-download]').onclick=()=>attachments.forEach(download);
     active.querySelector('[data-share-chat]').onclick=()=>{attachments.forEach(download);root.open('https://wa.me/'+number+'?text='+encodeURIComponent(text),'_blank','noopener');};
     active.querySelector('[data-share-file]').onclick=async()=>{try{if(navigator.canShare?.({files:attachments})){await navigator.share({files:attachments,text,title:name+' · unpaid statements'});}else{attachments.forEach(download);active.querySelector('[data-share-status]').textContent='PNGs downloaded separately. Attach them together in WhatsApp. Your browser may ask you to allow multiple downloads.';}}catch(e){if(e.name!=='AbortError')active.querySelector('[data-share-status]').textContent='Could not share. Download the PNGs and attach them together in WhatsApp.';}};
    }catch(e){if(panel===active){active.innerHTML=heading(name)+`<p role="status">${esc(e.message||'Could not prepare statements.')}</p><button class="btn btn-outline" data-back-selection>Choose statements</button>`;wireClose(active);active.querySelector('[data-back-selection]').onclick=()=>pick(chosen.map(r=>r.id));}}
   }
   function pick(ids=unpaid.map(r=>r.id)){
    if(panel!==active)return;const checked=new Set(ids);
    active.innerHTML=heading(name)+`<p>Choose unpaid statements</p><div class="billing-statement-picker">${unpaid.map(row=>`<label><input type="checkbox" value="${esc(row.id)}" ${checked.has(row.id)?'checked':''}><span>${esc(new Date(row.year,row.month-1,1).toLocaleDateString('en-GB',{month:'long',year:'numeric'}))}</span><strong>₪${Number(row.total||0).toFixed(2)}</strong></label>`).join('')}</div><p role="status" data-selection-total></p><button class="btn btn-amber" data-prepare-selection>Continue</button>`;wireClose(active);
    const chosen=()=>selected(unpaid,[...active.querySelectorAll('input:checked')].map(input=>input.value));
    function update(){const list=chosen();active.querySelector('[data-selection-total]').textContent=`${list.length} selected · ₪${total(list).toFixed(2)}`;active.querySelector('[data-prepare-selection]').disabled=!list.length;}
    active.querySelectorAll('input').forEach(input=>input.onchange=update);active.querySelector('[data-prepare-selection]').onclick=()=>prepare(chosen());update();
   }
   if(choose)pick();else await prepare(unpaid);
  }catch(e){if(panel===active)active.querySelector('[role="status"]').textContent=e.message||'Could not load statements.';}
 };
 document.addEventListener('click',event=>{const button=event.target.closest('[data-bill-share],[data-bill-select]');if(button)api.open(button.dataset.billShare||button.dataset.billSelect,button.hasAttribute('data-bill-select'));});
 root.GremierBillingShare=api;
})(typeof window==='undefined'?globalThis:window);
