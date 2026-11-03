/* Store tax invoices (חשבונית מס) on the Receipts screen: one invoice per store per month, VAT on top.
   The store's official details are edited here and saved to the store. Issuing is official, so it
   always shows the invoices first and asks for confirmation. */
(function(root){
 'use strict';
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const sbc=()=>typeof sb!=='undefined'?sb:root.MAIN_SB||root.ADMIN_SB,get=id=>document.getElementById(id);
 const money=n=>new Intl.NumberFormat('en-IL',{style:'currency',currency:'ILS'}).format(n/100);
 const VAT=0.18,vatOn=n=>Math.round(n*VAT);
 const month=b=>new Date(b.year,b.month-1,1).toLocaleDateString('en-GB',{month:'short',year:'numeric'});
 const validTax=t=>/^\d{9}$/.test(t)&&t.split('').reduce((n,d,i)=>{const v=Number(d)*((i%2)+1);return n+(v>9?v-9:v);},0)%10===0;
 const errors={store_tax_id_required:'Add the store\'s ח.פ. / עוסק number first.',store_customer_missing:'This store has no saved customer details yet.',store_tax_id_invalid:'The store\'s saved ח.פ. isn\'t a valid number.',
  store_email_required:'Add the store\'s email first, or untick "Email them".',no_unpaid_months:'Nothing left to invoice for this store.',billing_changed_refresh_preview:'That month changed. Open the store again.',
  month_already_invoiced_refresh:'That month was just invoiced. Refresh.',invoice_number_digits:'Enter the invoice number (digits only).',month_not_invoiceable:'That month is paid, cancelled or already invoiced.'};
 async function call(body){
  const r=await sbc().functions.invoke('store-tax-invoices',{body});
  if(r.error||r.data?.error){const d=r.data||await r.error?.context?.json?.().catch(()=>null);throw Error(errors[d?.error]||d?.error||'Request failed. Refresh and try again.');}
  return r.data;
 }
 let current=null;
 function setup(){
  const host=get('tab-finance');if(!host||get('storeInvoices'))return false;
  const section=document.createElement('section');section.className='fw-panel';section.id='storeInvoices';
  section.innerHTML=`<h2>Store tax invoices · חשבוניות מס</h2><p class="fw-note">One invoice per month for each store, VAT (18%) on top of the store's price. When a store pays, issue its receipt below for the months paid: it names those months' invoices.</p><p class="fw-note" id="storeInvoiceStatus" role="status"></p><div id="storeInvoiceList"></div><div id="storeInvoicePreview"></div><details class="fw-help"><summary>Issued invoices</summary><div id="storeInvoiceIssued"></div></details>`;
  host.querySelector('.page-header')?.after(section);if(!section.parentNode)host.prepend(section);
  return true;
 }
 async function load(){
  setup();const status=get('storeInvoiceStatus');if(!status)return;
  try{
   const [bills,customers,invoices]=await Promise.all([
    sbc().from('store_billing').select('id,store_id,year,month,total,tax_invoice_id,stores(name)').is('paid_at',null).is('cancelled_at',null).gt('total',0).order('year').order('month'),
    sbc().from('receipt_customers').select('store_id,name,tax_id,email').not('store_id','is',null).is('archived_at',null),
    sbc().from('store_tax_invoices').select('id,store_id,customer_snapshot,billing_snapshot,net_minor,vat_minor,gross_minor,status,document_number,pdf_path,error_code,email_sent_at,email_error,issued_at,created_at').order('created_at',{ascending:false}).limit(200)]);
   if(bills.error||customers.error||invoices.error)throw Error('Could not load store invoices.');
   const byStore=new Map();
   for(const b of bills.data.filter(b=>!b.tax_invoice_id)){const s=byStore.get(b.store_id)||{name:b.stores?.name||'Store',months:[]};s.months.push(b);byStore.set(b.store_id,s);}
   const rows=[...byStore].map(([id,s])=>{const net=s.months.reduce((n,b)=>n+Math.round(Number(b.total)*100),0),c=customers.data.find(c=>c.store_id===id);return {id,...s,net,customer:c};}).sort((a,b)=>b.net-a.net);
   get('storeInvoiceList').innerHTML=rows.length?`<div class="table-wrap"><table><thead><tr><th>Store</th><th>Months not invoiced</th><th>Before VAT</th><th>With VAT</th><th></th></tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(r.name)}${r.customer?.tax_id?'':'<small>Needs ח.פ.</small>'}</td><td>${esc(r.months.map(month).join(', '))}</td><td>${money(r.net)}</td><td>${money(r.months.reduce((n,b)=>{const x=Math.round(Number(b.total)*100);return n+x+vatOn(x);},0))}</td><td><button class="btn btn-outline btn-sm" data-invoice-open="${esc(r.id)}">${r.customer?.tax_id?'Open':'Add details'}</button></td></tr>`).join('')}</tbody></table></div>`:'<p class="fw-note">Every unpaid month is already invoiced.</p>';
   get('storeInvoiceList').querySelectorAll('[data-invoice-open]').forEach(b=>b.onclick=()=>open(b.dataset.invoiceOpen,b));
   const label=i=>(i.billing_snapshot||[]).map(month).join(', ');
   get('storeInvoiceIssued').innerHTML=invoices.data.length?invoices.data.map(i=>`<div class="fw-row-card"><div><b>${esc(i.customer_snapshot?.name||'Store')}</b> · ${esc(label(i))} · ${money(i.gross_minor)} <small>${esc(i.status==='issued'?'חשבונית מס '+(i.document_number||'· number not read'):i.status==='needs_review'?'Needs review: '+(i.error_code||''):i.status)}${i.email_sent_at?' · emailed':i.email_error?' · email failed':''}</small></div><div class="fw-actions">${i.status==='issued'?`<button class="btn btn-outline btn-sm" data-invoice-pdf="${esc(i.id)}">Open PDF</button>`:''}${i.status==='issued'&&!i.document_number?`<button class="btn btn-outline btn-sm" data-invoice-number="${esc(i.id)}">Enter invoice number</button>`:''}${i.status==='needs_review'&&i.error_code!=='released'?`<button class="btn btn-outline btn-sm" data-invoice-release="${esc(i.id)}">Not in FinBot · free its month</button>`:''}</div></div>`).join(''):'<p class="fw-note">None yet.</p>';
   const act=(sel,fn)=>get('storeInvoiceIssued').querySelectorAll(sel).forEach(b=>b.onclick=async()=>{b.disabled=true;try{await fn(Object.values(b.dataset)[0]);}catch(e){status.textContent=e.message;b.disabled=false;}});
   act('[data-invoice-pdf]',async id=>{const r=await call({action:'pdf',id});root.open(r.url,'_blank','noopener');});
   act('[data-invoice-number]',async id=>{const n=root.prompt('Invoice number as shown on the PDF (חשבונית מס …)');if(!n)return;await call({action:'set_number',id,number:n.trim()});await load();});
   act('[data-invoice-release]',async id=>{if(!root.confirm('Only do this after checking in FinBot that this invoice was NOT created. Free its month for a new invoice?'))return;await call({action:'release',id,confirm_not_in_finbot:true});await load();});
  }catch(e){status.textContent=e.message;}
 }
 // One store: its official details (saved to the store) and an invoice per unpaid month.
 async function open(storeId,button){
  const status=get('storeInvoiceStatus'),box=get('storeInvoicePreview');if(button)button.disabled=true;status.textContent='Loading…';current=null;
  try{
   const r=await sbc().from('receipt_customers').select('id,name,tax_id,email,address').eq('store_id',storeId).is('archived_at',null).maybeSingle();
   if(r.error)throw Error('Could not load the store\'s details.');if(!r.data)throw Error(errors.store_customer_missing);
   const c=r.data;let p=null;
   if(c.tax_id){try{p=(await call({action:'preview',id:crypto.randomUUID(),store_id:storeId})).preview;}catch(e){if(e.message!==errors.no_unpaid_months)throw e;}}
   const field=(id,label,value,attrs='')=>`<label>${label}<input class="form-input" id="${id}" value="${esc(value||'')}" ${attrs}></label>`;
   box.innerHTML=`<div class="fw-review"><h3>Tax invoices for this store</h3>
    <p class="fw-note">The store's official details, exactly as they'll appear on its invoices. Changes are saved to the store.</p>
    <div class="fw-form">${field('sinvName','Official name',c.name,'maxlength="100"')}${field('sinvTax','ח.פ. / עוסק',c.tax_id,'inputmode="numeric" maxlength="9"')}${field('sinvEmail','Email · for sending',c.email,'type="email" maxlength="50"')}${field('sinvAddress','Address · optional',c.address,'maxlength="100"')}</div>
    <div class="fw-actions"><button class="btn btn-outline btn-sm" id="sinvSave">Save details</button></div>
    <div class="fw-panel" style="margin:16px 0"><h3>Already received payment?</h3><p class="fw-note">Issue one חשבונית מס/קבלה for the total received, without selecting months. Use this when no official tax invoice was issued for that payment.</p><button type="button" class="btn btn-outline" id="storeInvoiceCombined">Combined tax invoice + receipt · חשבונית מס/קבלה</button></div>
    ${p?`<h3>Months to invoice</h3><div class="table-wrap"><table><thead><tr><th></th><th>Month</th><th>Before VAT</th><th>VAT 18%</th><th>Invoice total</th></tr></thead><tbody>${p.months.map(m=>`<tr><td><input type="checkbox" class="sinv-month" value="${esc(m.id)}" checked aria-label="Invoice ${esc(m.label)}"></td><td>${esc(m.label)}</td><td>${money(m.net_minor)}</td><td>${money(m.vat_minor)}</td><td><strong>${money(m.gross_minor)}</strong></td></tr>`).join('')}</tbody></table></div>
    <label class="fw-check"><input type="checkbox" id="storeInvoiceEmail" ${p.customer.email?'':'disabled'}> Email them to ${esc(p.customer.email||'the store (add an email above)')}</label>
    <label class="fw-check"><input type="checkbox" id="storeInvoiceOk"> I checked the store's name, ח.פ. and amounts. Each ticked month becomes an official, numbered tax invoice in FinBot.</label>`:'<p class="fw-note">Add the store\'s ח.פ. and save to see its invoices.</p>'}
    <div class="fw-actions">${p?'<button class="btn btn-amber" id="storeInvoiceIssue" disabled>Separate tax invoices · one per month</button><button type="button" class="btn btn-outline" id="storeInvoiceTogether" disabled>Together · one חשבונית מס/קבלה</button>':''}<button class="btn btn-outline" id="storeInvoiceCancel">Close</button></div></div>`;
   get('storeInvoiceCombined').onclick=async()=>{
    if(box.dataset.dirty==='1'){status.textContent='Save the edited store details first.';return;}
    const b=get('storeInvoiceCombined');b.disabled=true;
    try{await root.GremierFinance.openStoreCombined(storeId);box.innerHTML='';current=null;status.textContent='';}
    catch(e){status.textContent=e.message;b.disabled=false;}
   };
   if(p)current={store_id:storeId,months:p.months};
   const issueBtn=get('storeInvoiceIssue'),ok=get('storeInvoiceOk');
   const chosen=()=>[...box.querySelectorAll('.sinv-month:checked')].map(i=>current.months.find(m=>m.id===i.value));
   const refresh=()=>{const together=get('storeInvoiceTogether');if(together)together.disabled=box.dataset.dirty==='1'||!chosen().length;if(!issueBtn)return;const list=chosen();issueBtn.textContent=list.length?`Separate: ${list.length} tax invoice${list.length>1?'s':''} · ${money(list.reduce((n,m)=>n+m.gross_minor,0))}`:'Choose months';issueBtn.disabled=!ok.checked||!list.length||box.dataset.dirty==='1';};
   box.dataset.dirty='0';
   for(const id of ['sinvName','sinvTax','sinvEmail','sinvAddress'])get(id).oninput=()=>{box.dataset.dirty='1';refresh();status.textContent='Save the details before issuing.';};
   box.querySelectorAll('.sinv-month').forEach(i=>i.onchange=refresh);if(ok)ok.onchange=refresh;refresh();
   get('sinvSave').onclick=async()=>{
    const v={name:get('sinvName').value.trim(),tax_id:get('sinvTax').value.trim(),email:get('sinvEmail').value.trim(),address:get('sinvAddress').value.trim()};
    if(!v.name)return status.textContent='Enter the official name.';
    if(!validTax(v.tax_id))return status.textContent='That ח.פ./עוסק number isn\'t valid (9 digits). Check for a mistyped digit.';
    if(v.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email))return status.textContent='That email doesn\'t look right.';
    get('sinvSave').disabled=true;
    const u=await sbc().from('receipt_customers').update({...v,updated_at:new Date().toISOString()}).eq('id',c.id);
    if(u.error){get('sinvSave').disabled=false;return status.textContent='Could not save the details. Try again.';}
    await open(storeId);load();status.textContent='Details saved.';
   };
   get('storeInvoiceCancel').onclick=()=>{current=null;box.innerHTML='';status.textContent='';};
   if(get('storeInvoiceTogether'))get('storeInvoiceTogether').onclick=async()=>{
    const b=get('storeInvoiceTogether');b.disabled=true;
    try{await root.GremierFinance.openStoreCombined(storeId,chosen().map(m=>m.id));box.innerHTML='';current=null;status.textContent='';}
    catch(e){status.textContent=e.message;b.disabled=false;}
   };
   if(issueBtn)issueBtn.onclick=()=>issue(chosen());
   status.textContent='';box.scrollIntoView?.({behavior:'smooth',block:'nearest'});
  }catch(e){status.textContent=e.message;}finally{if(button)button.disabled=false;}
 }
 // One invoice per month, one at a time; stops at the first problem so nothing is issued twice.
 async function issue(list){
  if(!current||!list.length)return;const status=get('storeInvoiceStatus'),btn=get('storeInvoiceIssue');btn.disabled=true;
  const email=!!get('storeInvoiceEmail')?.checked,done=[];
  try{
   for(const m of list){
    status.textContent=`Issuing ${done.length+1} of ${list.length} (${m.label})… don't close this page.`;
    const r=await call({action:'issue',id:crypto.randomUUID(),store_id:current.store_id,billing_id:m.id,gross_minor:m.gross_minor,email_requested:email,confirm:true});
    if(r.invoice?.status!=='issued')throw Error(`${m.label}: needs review. Check FinBot before trying again.`);
    done.push(`${m.label}: ${r.invoice.document_number||'number not read'}`);
   }
   status.textContent=`Issued ${done.length} tax invoice${done.length>1?'s':''}: ${done.join(' · ')}.`;
   get('storeInvoicePreview').innerHTML='';current=null;
  }catch(e){status.textContent=(done.length?`Issued: ${done.join(' · ')}. `:'')+e.message+' Do not issue that month again before checking FinBot.';}
  await load();
 }
 const original=root.GremierFinance?.load;
 if(root.GremierFinance&&original)root.GremierFinance.load=async(...a)=>{const r=await original(...a);load();return r;};
 const show=root.showTab;root.showTab=function(tab,...args){const r=show?.call(this,tab,...args);if(tab==='finance')load();return r;};
})(window);
