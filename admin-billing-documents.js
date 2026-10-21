/* Private store document archive. Never issues or regenerates documents. */
(function(root){
 'use strict';
 const normalize=v=>String(v??'').normalize('NFKC').toLowerCase().replace(/[\p{P}\p{S}]/gu,' ').replace(/\s+/g,' ').trim();
 const period=b=>`${b.year}-${String(b.month).padStart(2,'0')}`;
 const filename=(name,extension)=>name.replace(/[<>:"/\\|?*\u0000-\u001f]/g,'-').replace(/[. ]+$/,'').slice(0,180)+'.'+extension;
 function documents(bills,receipts,stores){
  const names=new Map(stores.map(s=>[s.id,s.name]));
  return [...bills.filter(b=>b.image_url).map(b=>{
   const store=b.stores?.name||names.get(b.store_id)||'Unknown store',month=period(b);
   return {id:b.id,kind:'statement',store_id:b.store_id,store,months:[month],date:month+'-01',amount_minor:Math.round(Number(b.total)*100),url:b.image_url,name:`${store} · ${month} · חשבון עסקה`,reference:''};
  }),...receipts.filter(r=>r.status==='issued'&&r.store_id).map(r=>{
   const store=names.get(r.store_id)||r.customer_snapshot?.name||'Unknown store',months=[...new Set((r.billing_snapshot||[]).map(period))].sort();
   const reference=r.document_reference||r.id.slice(0,8);
   return {id:r.id,kind:'receipt',store_id:r.store_id,store,months,date:r.payment_date,amount_minor:Number(r.amount_minor),reference,name:`${store} · ${months.join(', ')||r.payment_date} · קבלה ${reference}`};
  })].sort((a,b)=>b.date.localeCompare(a.date)||a.name.localeCompare(b.name));
 }
 function search(rows,{store='',query='',type=''}={}){
  const words=normalize(query).split(' ').filter(Boolean);
  return rows.filter(r=>(!store||r.store_id===store)&&(!type||r.kind===type)&&words.every(w=>normalize([r.name,r.store,r.reference,r.date,...r.months,r.kind,r.kind==='statement'?'חשבון עסקה statement invoice':'קבלה receipt'].join(' ')).includes(w)));
 }
 const api={documents,search,filename};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
 if(!root.document)return;
 const get=id=>document.getElementById(id),client=()=>typeof sb!=='undefined'?sb:root.MAIN_SB||root.ADMIN_SB;
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const money=n=>new Intl.NumberFormat('en-IL',{style:'currency',currency:'ILS'}).format(n/100);
 let rows=[],sequence=0;
 function setup(){
  if(get('billingDocumentFilters'))return;
  const filters=document.createElement('div');filters.id='billingDocumentFilters';filters.hidden=true;
  filters.innerHTML='<div class="sales-controls"><label>Search all time<input id="billingDocumentSearch" class="form-input" type="search" placeholder="Store, month, receipt number…"></label><label>Store<select class="form-input" id="billingDocumentStore"><option value="">All stores</option></select></label><label>Documents<select class="form-input" id="billingDocumentType"><option value="">All documents</option><option value="statement">חשבונות עסקה</option><option value="receipt">Receipts · קבלות</option></select></label></div><p id="billingDocumentStatus" class="sales-note" role="status"></p>';
  get('sdBillingBody').before(filters);
  ['billingDocumentSearch','billingDocumentStore','billingDocumentType'].forEach(id=>get(id).addEventListener(id.endsWith('Search')?'input':'change',render));
 }
 async function pages(table,columns){
  const out=[];for(let start=0;start<100000;start+=1000){const r=await client().from(table).select(columns).order('id').range(start,start+999);if(r.error||!Array.isArray(r.data))throw Error('Could not load store documents. Try again.');out.push(...r.data);if(r.data.length<1000)return out;}throw Error('Document limit reached.');
 }
 api.load=async function(store=''){
  setup();const seq=++sequence;get('billingDocumentFilters').hidden=false;get('billingDocumentStatus').textContent='Loading documents…';get('sdBillingBody').innerHTML='';
  try{
   const [bills,receipts,stores]=await Promise.all([pages('store_billing','id,store_id,year,month,total,image_url,stores(name)'),pages('business_receipts','id,store_id,status,customer_snapshot,amount_minor,payment_date,document_reference,billing_snapshot'),pages('stores','id,name')]);
   if(seq!==sequence||get('billingDocumentFilters').hidden)return;
   rows=documents(bills,receipts,stores);
   get('billingDocumentStore').innerHTML='<option value="">All stores</option>'+stores.sort((a,b)=>a.name.localeCompare(b.name)).map(s=>`<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('');
   get('billingDocumentStore').value=store;render();
  }catch(e){if(seq===sequence)get('billingDocumentStatus').textContent=e.message;}
 };
 function render(){
  const shown=search(rows,{store:get('billingDocumentStore').value,query:get('billingDocumentSearch').value,type:get('billingDocumentType').value});
  get('billingDocumentStatus').textContent=`${shown.length} documents · all time`;
  get('sdBillingBody').innerHTML=shown.map(r=>`<article class="card billing-document"><div><h4>${esc(r.name)}</h4><p>${esc(r.date)} · ${money(r.amount_minor)}</p></div><div class="fw-actions"><button class="btn btn-outline btn-sm" data-document-open="${esc(r.kind+':'+r.id)}">Open</button><button class="btn btn-outline btn-sm" data-document-download="${esc(r.kind+':'+r.id)}">Download</button></div></article>`).join('')||'<div class="empty-state">No saved documents match this search.</div>';
  get('sdBillingBody').querySelectorAll('[data-document-open],[data-document-download]').forEach(button=>button.onclick=()=>open(button,!!button.dataset.documentDownload));
 }
 async function open(button,download){
  const key=button.dataset.documentOpen||button.dataset.documentDownload,r=rows.find(r=>r.kind+':'+r.id===key);if(!r)return;
  button.disabled=true;
  // Open a blank window during the click so asynchronous signed URLs are not blocked.
  const tab=download?null:root.open('about:blank','_blank');
  if(tab)tab.opener=null;
  try{
   let url=r.url;
   if(r.kind==='receipt'){
    const result=await client().functions.invoke('business-receipts',{body:{action:'pdf',id:r.id}});
    if(result.error||!result.data?.url)throw Error('Could not open the receipt PDF. Try again.');url=result.data.url;
   }
   if(download){const response=await fetch(url);if(!response.ok)throw Error('Document download failed.');const blob=await response.blob(),local=URL.createObjectURL(blob),a=document.createElement('a');a.href=local;a.download=filename('Gremier - '+r.name+(r.kind==='receipt'?' - '+r.date:''),r.kind==='receipt'?'pdf':'png');a.click();setTimeout(()=>URL.revokeObjectURL(local),60000);}
   else if(tab)tab.location.href=url;
   else throw Error('Allow pop-ups to open this document, or use Download.');
  }catch(e){tab?.close();get('billingDocumentStatus').textContent=e.message;}finally{button.disabled=false;}
 }
 root.GremierBillingDocuments=api;
})(typeof window==='undefined'?globalThis:window);
