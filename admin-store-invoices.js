/* Store tax invoices (חשבונית מס): a drawer opened from each store's billing card. VAT on top of store prices.
   The store's official details are edited here and saved to the store. Issuing is official, so it
   shows exactly what will be issued on the button. Stores that pay for what they sold skip the months. */
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
 // The drawer: opened from a store's card (Stores → Billing). It shows while #storeInvoicePreview has content,
 // so every "close" path (✕, outside tap, Esc, handing over to the receipt drawer) closes it.
 function drawer(){
  if(get('sinvDrawer'))return;
  const d=document.createElement('div');d.id='sinvDrawer';d.className='rc-drawer';d.hidden=true;
  d.innerHTML='<div class="rc-drawer-bg"></div><aside class="rc-drawer-sheet" role="dialog" aria-modal="true" aria-label="Store invoices and receipts"><div id="storeInvoicePreview"></div><p class="rc-drawer-status" id="storeInvoiceStatus" role="status"></p></aside>';
  document.body.append(d);
  const box=get('storeInvoicePreview'),close=()=>{current=null;box.innerHTML='';get('storeInvoiceStatus').textContent='';};
  d.querySelector('.rc-drawer-bg').onclick=close;
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!d.hidden)close();});
  new MutationObserver(()=>{const open=!!box.firstChild;d.hidden=!open;document.body.classList.toggle('rc-drawer-open',open||get('rcDrawer')?.hidden===false);}).observe(box,{childList:true});
 }
 // This store's issued tax invoices, with the follow-up tools (PDF, missing number, refused invoice).
 async function issued(storeId){
  const host=get('sinvIssued');if(!host)return;
  const r=await sbc().from('store_tax_invoices').select('id,billing_snapshot,gross_minor,status,document_number,error_code,email_sent_at,email_error,created_at').eq('store_id',storeId).order('created_at',{ascending:false}).limit(60);
  if(r.error){host.innerHTML='<p class="fw-note">Could not load issued invoices.</p>';return;}
  const label=i=>(i.billing_snapshot||[]).map(month).join(', ');
  if(get('sinvIssuedCount'))get('sinvIssuedCount').textContent=r.data.length||'';
  host.innerHTML=r.data.length?r.data.map(i=>`<div class="sdw-inv"><div><b>${esc(label(i)||'Invoice')}</b><small>${esc(i.status==='issued'?'חשבונית מס '+(i.document_number||'· number not read'):i.status==='needs_review'?'Needs review: '+(i.error_code||''):i.status)}${i.email_sent_at?' · emailed':i.email_error?' · email failed':''}</small></div><strong>${money(i.gross_minor)}</strong><div class="sdw-inv-actions">${i.status==='issued'?`<button class="btn btn-outline btn-sm" data-invoice-pdf="${esc(i.id)}">PDF</button>`:''}${i.status==='issued'&&!i.document_number?`<button class="btn btn-outline btn-sm" data-invoice-number="${esc(i.id)}">Enter number</button>`:''}${i.status==='needs_review'&&i.error_code!=='released'?`<button class="btn btn-outline btn-sm" data-invoice-release="${esc(i.id)}">Not in FinBot · free its month</button>`:''}</div></div>`).join(''):'<p class="fw-note">No tax invoices for this store yet.</p>';
  const status=get('storeInvoiceStatus');
  const act=(sel,fn)=>host.querySelectorAll(sel).forEach(b=>b.onclick=async()=>{b.disabled=true;try{await fn(Object.values(b.dataset)[0]);b.disabled=false;}catch(e){status.textContent=e.message;b.disabled=false;}});
  act('[data-invoice-pdf]',async id=>{const x=await call({action:'pdf',id});root.open(x.url,'_blank','noopener');});
  act('[data-invoice-number]',async id=>{const n=root.prompt('Invoice number as shown on the PDF (חשבונית מס …)');if(!n)return;await call({action:'set_number',id,number:n.trim()});await issued(storeId);});
  act('[data-invoice-release]',async id=>{if(!root.confirm('Only do this after checking in FinBot that this invoice was NOT created. Free its month for a new invoice?'))return;await call({action:'release',id,confirm_not_in_finbot:true});await open(storeId);});
 }
 // One store: its official details (saved to the store) and an invoice per unpaid month.
 async function open(storeId,button){
  drawer();const status=get('storeInvoiceStatus'),box=get('storeInvoicePreview');if(button)button.disabled=true;current=null;
  if(!box.firstChild)box.innerHTML='<div class="sdw"><div class="sdw-body"><div class="plk-empty"><div class="spinner"></div></div></div></div>';
  try{
   const r=await sbc().from('receipt_customers').select('id,name,tax_id,email,address').eq('store_id',storeId).is('archived_at',null).maybeSingle();
   if(r.error)throw Error('Could not load the store\'s details.');
   const storeName=(typeof allStores!=='undefined'?allStores:[]).find(s=>s.id===storeId)?.name||'Store';
   const c=r.data||{id:null,name:storeName,tax_id:'',email:'',address:''};let p=null;
   const bySales=!!(await sbc().from('stores').select('pays_for_sales').eq('id',storeId).maybeSingle()).data?.pays_for_sales;
   if(c.id&&c.tax_id&&!bySales){try{p=(await call({action:'preview',id:crypto.randomUUID(),store_id:storeId})).preview;}catch(e){if(e.message!==errors.no_unpaid_months)throw e;}}
   const field=(id,label,value,attrs='')=>`<label>${label}<input class="form-input" id="${id}" value="${esc(value||'')}" ${attrs}></label>`;
   box.innerHTML=`<div class="sdw">
    <header class="sdw-head"><span class="sdw-av" aria-hidden="true">${esc((c.name||'?').trim()[0]||'?')}</span><div class="sdw-title"><small>Invoices &amp; receipts · חשבוניות וקבלות</small><b>${esc(c.name||'Store')}</b></div><button type="button" class="plx-close" id="storeInvoiceCancel" aria-label="Close">✕</button></header>
    <div class="sdw-body">
     <details class="sdw-sec"${c.tax_id&&c.id?'':' open'}><summary><span class="sdw-ico" aria-hidden="true">🏢</span><span class="sdw-sec-t"><b>Official details</b><small>${c.tax_id?'ח.פ. '+esc(c.tax_id)+(c.email?' · '+esc(c.email):''):'Add the ח.פ. to issue invoices and receipts'}</small></span></summary>
      <p class="fw-note">Exactly as they'll appear on the invoices. Saved to the store.</p>
      <div class="fw-form">${field('sinvName','Official name',c.name,'maxlength="100"')}${field('sinvTax','ח.פ. / עוסק',c.tax_id,'inputmode="numeric" maxlength="9"')}${field('sinvEmail','Email · for sending',c.email,'type="email" maxlength="50"')}${field('sinvAddress','Address · optional',c.address,'maxlength="100"')}</div>
      <button class="btn btn-outline btn-sm" id="sinvSave">Save details</button></details>
     ${p?`<section class="sdw-sec"><div class="sdw-sec-h"><span class="sdw-ico" aria-hidden="true">🗓️</span><span class="sdw-sec-t"><b>Months</b></span></div>
      <div class="fw-months rc-monthcards">${p.months.map(m=>`<label class="fw-month"><input type="checkbox" class="sinv-month" value="${esc(m.id)}" checked aria-label="Invoice ${esc(m.label)}"><span>${esc(m.label)}<small>${money(m.net_minor)} + VAT ${money(m.vat_minor)}</small></span><strong>${money(m.gross_minor)}</strong></label>`).join('')}</div></section>
     <section class="sdw-sec"><div class="sdw-modes sdw-modes-compact" role="radiogroup" aria-label="Document">
       <button type="button" role="radio" data-sinv-mode="separate"><b>חשבונית מס</b><small>One per month</small></button>
       <button type="button" role="radio" data-sinv-mode="combined"><b>חשבונית מס</b><small>One for all</small></button>
       <button type="button" role="radio" data-sinv-mode="paid"><b>מס/קבלה</b><small>Already paid</small></button>
      </div>
      <p class="sdw-next" id="sinvNext" hidden></p>
      <div id="sinvIssueOpts">${p.customer.email?`<label class="rc-toggle"><input type="checkbox" id="storeInvoiceEmail"><span class="rc-switch" aria-hidden="true"></span><span>Email to ${esc(p.customer.email)}</span></label>`:''}</div></section>`:bySales&&c.id&&c.tax_id?'<p class="sdw-empty">This store pays for what it sold. Use “What they sold” below.</p>':'<p class="sdw-empty">Add the store\'s ח.פ. above and save.</p>'}
     <div class="sdw-pay-row"><button type="button" class="btn ${bySales?'btn-green':'btn-outline'}" id="storeInvoiceCombined"${c.id?'':' disabled'}>${bySales?'What they sold · מס/קבלה →':'Paid · מס/קבלה →'}</button><button type="button" class="btn btn-outline" id="sinvRecordPayment"${c.id?'':' disabled'}>Payment · קבלה →</button></div>
     <details class="sdw-sec"><summary><span class="sdw-ico" aria-hidden="true">🗂️</span><span class="sdw-sec-t"><b>Issued tax invoices <span class="rc-sec-count" id="sinvIssuedCount"></span></b><small>PDFs, missing numbers and refused invoices</small></span></summary><div id="sinvIssued"></div></details>
    </div>
    ${p?'<footer class="sdw-foot"><button class="rc-review" id="storeInvoiceIssue" disabled>Choose months</button></footer>':''}
   </div>`;
   get('sinvRecordPayment').onclick=async()=>{
    const b=get('sinvRecordPayment');b.disabled=true;
    try{await root.GremierFinance.openReceipt({storeId});box.innerHTML='';current=null;status.textContent='';}
    catch(e){status.textContent=e.message;b.disabled=false;}
   };
   issued(storeId);
   get('storeInvoiceCombined').onclick=async()=>{
    if(box.dataset.dirty==='1'){status.textContent='Save the edited store details first.';return;}
    const b=get('storeInvoiceCombined');b.disabled=true;
    try{await root.GremierFinance.openStoreCombined(storeId);box.innerHTML='';current=null;status.textContent='';}
    catch(e){status.textContent=e.message;b.disabled=false;}
   };
   if(p)current={store_id:storeId,months:p.months};
   const issueBtn=get('storeInvoiceIssue');
   const chosen=()=>[...box.querySelectorAll('.sinv-month:checked')].map(i=>current.months.find(m=>m.id===i.value));
   let mode='separate';
   const refresh=()=>{
    if(!issueBtn)return;
    const list=chosen(),n=list.length,dirty=box.dataset.dirty==='1';
    const net=list.reduce((s,m)=>s+m.net_minor,0),sumGross=list.reduce((s,m)=>s+m.gross_minor,0),oneGross=net+vatOn(net);
    box.querySelectorAll('[data-sinv-mode]').forEach(b=>{const on=b.dataset.sinvMode===mode;b.classList.toggle('on',on);b.setAttribute('aria-checked',String(on));});
    get('sinvIssueOpts').hidden=mode==='paid';
    let text='Choose months',ready=n>0&&!dirty;
    if(n&&mode==='paid')text='Continue · invoice + receipt for '+n+' month'+(n>1?'s':'')+' →';
    else if(n&&mode==='combined'&&n>1)text='Issue 1 tax invoice for '+n+' months · '+money(oneGross);
    else if(n)text='Issue '+n+' tax invoice'+(n>1?'s':'')+' · '+money(sumGross);
    if(dirty&&n)text='Save the store details first';
    issueBtn.textContent=text;issueBtn.disabled=!ready;
   };
   box.querySelectorAll('[data-sinv-mode]').forEach(b=>b.onclick=()=>{mode=b.dataset.sinvMode;refresh();});
   box.dataset.dirty='0';
   for(const id of ['sinvName','sinvTax','sinvEmail','sinvAddress'])get(id).oninput=()=>{box.dataset.dirty='1';refresh();status.textContent='Save the details before issuing.';};
   box.querySelectorAll('.sinv-month').forEach(i=>i.onchange=refresh);refresh();
   get('sinvSave').onclick=async()=>{
    const v={name:get('sinvName').value.trim(),tax_id:get('sinvTax').value.trim(),email:get('sinvEmail').value.trim(),address:get('sinvAddress').value.trim()};
    if(!v.name)return status.textContent='Enter the official name.';
    if(!validTax(v.tax_id))return status.textContent='That ח.פ./עוסק number isn\'t valid (9 digits). Check for a mistyped digit.';
    if(v.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email))return status.textContent='That email doesn\'t look right.';
    get('sinvSave').disabled=true;
    const u=c.id?await sbc().from('receipt_customers').update({...v,updated_at:new Date().toISOString()}).eq('id',c.id):await sbc().from('receipt_customers').insert({...v,store_id:storeId,updated_at:new Date().toISOString()});
    if(u.error){get('sinvSave').disabled=false;return status.textContent='Could not save the details. Try again.';}
    await open(storeId);status.textContent='Details saved.';
   };
   get('storeInvoiceCancel').onclick=()=>{current=null;box.innerHTML='';status.textContent='';};
   if(issueBtn)issueBtn.onclick=async()=>{
    const list=chosen();if(!list.length)return;
    if(mode==='separate')return issue(list);
    if(mode==='combined')return list.length>1?issueCombined(list):issue(list);
    issueBtn.disabled=true;
    try{await root.GremierFinance.openStoreCombined(storeId,list.map(m=>m.id));box.innerHTML='';current=null;status.textContent='';}
    catch(e){status.textContent=e.message;issueBtn.disabled=false;}
   };
   status.textContent='';
  }catch(e){status.textContent=e.message;}finally{if(button)button.disabled=false;}
 }
 // One invoice for several months: a single request; VAT on their total, like the server.
 async function issueCombined(list){
  if(!current||!list.length)return;const status=get('storeInvoiceStatus'),btn=get('storeInvoiceIssue');btn.disabled=true;
  const net=list.reduce((n,m)=>n+m.net_minor,0),label=list.map(m=>m.label).join(', ');
  try{
   status.textContent=`Issuing one tax invoice for ${label}… don't close this page.`;
   const r=await call({action:'issue',id:crypto.randomUUID(),store_id:current.store_id,billing_ids:list.map(m=>m.id),gross_minor:net+vatOn(net),email_requested:!!get('storeInvoiceEmail')?.checked,confirm:true});
   if(r.invoice?.status!=='issued')throw Error(`${label}: needs review. Check FinBot before trying again.`);
   const store=current.store_id;await open(store);
   status.textContent=`✓ Issued one tax invoice for ${label}: ${r.invoice.document_number||'number not read'}.`;
  }catch(e){status.textContent=e.message+' Do not issue these months again before checking FinBot.';}
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
   const store=current.store_id;await open(store);
   status.textContent=`✓ Issued ${done.length} tax invoice${done.length>1?'s':''}: ${done.join(' · ')}.`;
  }catch(e){status.textContent=(done.length?`Issued: ${done.join(' · ')}. `:'')+e.message+' Do not issue that month again before checking FinBot.';}
 }
 root.GremierStoreInvoices={open};
})(window);
