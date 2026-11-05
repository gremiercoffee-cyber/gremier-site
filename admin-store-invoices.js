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
  section.innerHTML=`<details class="rc-fold" open><summary><span class="rc-sec-ico" aria-hidden="true">🏪</span><h2>Store tax invoices</h2><span class="rc-sec-count" id="storeInvoiceCount"></span></summary><p class="fw-note">One invoice per month for each store, VAT (18%) on top. Tap a store to invoice it. When a store pays, issue its receipt below for the months paid.</p><p class="fw-note" id="storeInvoiceStatus" role="status"></p><div id="storeInvoiceList"></div><div id="storeInvoicePreview"></div><details class="fw-help"><summary>Issued invoices</summary><div id="storeInvoiceIssued"></div></details></details>`;
  host.querySelector('.page-header')?.after(section);if(!section.parentNode)host.prepend(section);
  drawer(section);
  return true;
 }
 // One store's invoices open in a drawer (bottom sheet on phones). It shows while #storeInvoicePreview has content,
 // so every existing "close" path (Close, issued, combined) closes it too.
 function drawer(section){
  const fresh=section.querySelector('#storeInvoicePreview');
  if(get('sinvDrawer')){fresh?.remove();return;}
  const d=document.createElement('div');d.id='sinvDrawer';d.className='rc-drawer';d.hidden=true;
  d.innerHTML='<div class="rc-drawer-bg"></div><aside class="rc-drawer-sheet" role="dialog" aria-modal="true" aria-label="Store tax invoices"><p class="rc-drawer-status" id="sinvDrawerStatus" role="status"></p></aside>';
  d.querySelector('aside').prepend(fresh);document.body.append(d);
  const close=()=>{const c=get('storeInvoiceCancel');if(c)c.click();else fresh.innerHTML='';};
  d.querySelector('.rc-drawer-bg').onclick=close;
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!d.hidden)close();});
  const mirror=()=>{const s=get('storeInvoiceStatus');get('sinvDrawerStatus').textContent=d.hidden?'':(s?.textContent||'');};
  new MutationObserver(()=>{const open=!!fresh.firstChild;d.hidden=!open;document.body.classList.toggle('rc-drawer-open',open);mirror();}).observe(fresh,{childList:true});
  const watch=()=>{const s=get('storeInvoiceStatus');if(s&&!s.dataset.mirrored){s.dataset.mirrored='1';new MutationObserver(mirror).observe(s,{childList:true,characterData:true,subtree:true});}};
  watch();setInterval(watch,2000);
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
   get('storeInvoiceList').innerHTML=rows.length?`<div class="rc-inv-list">${rows.map(r=>`<div class="rc-inv-card"><div class="rc-inv-top"><b>${esc(r.name)}</b>${r.customer?.tax_id?'':'<span class="rc-tag">Needs ח.פ.</span>'}</div><div class="rc-inv-months">${r.months.map(m=>`<span>${esc(month(m))}</span>`).join('')}</div><div class="rc-inv-foot"><span><small>Before VAT</small>${money(r.net)}</span><span><small>With VAT</small><b>${money(r.months.reduce((n,b)=>{const x=Math.round(Number(b.total)*100);return n+x+vatOn(x);},0))}</b></span><button class="rc-inv-open" data-invoice-open="${esc(r.id)}">${r.customer?.tax_id?'Open →':'Add details →'}</button></div></div>`).join('')}</div>`:'<div class="rc-allclear">Every unpaid month is already invoiced.</div>';
   if(get('storeInvoiceCount'))get('storeInvoiceCount').textContent=rows.length?rows.length+' to invoice':'all done';
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
   box.innerHTML=`<div class="sdw">
    <header class="sdw-head"><span class="sdw-av" aria-hidden="true">${esc((c.name||'?').trim()[0]||'?')}</span><div class="sdw-title"><small>Store tax invoices · חשבוניות מס</small><b>${esc(c.name||'Store')}</b></div><button type="button" class="plx-close" id="storeInvoiceCancel" aria-label="Close">✕</button></header>
    <div class="sdw-body">
     <details class="sdw-sec"${c.tax_id?'':' open'}><summary><span class="sdw-ico" aria-hidden="true">🏢</span><span class="sdw-sec-t"><b>Official details</b><small>${c.tax_id?'ח.פ. '+esc(c.tax_id)+(c.email?' · '+esc(c.email):''):'Add the ח.פ. to invoice this store'}</small></span></summary>
      <p class="fw-note">Exactly as they'll appear on the invoices. Saved to the store.</p>
      <div class="fw-form">${field('sinvName','Official name',c.name,'maxlength="100"')}${field('sinvTax','ח.פ. / עוסק',c.tax_id,'inputmode="numeric" maxlength="9"')}${field('sinvEmail','Email · for sending',c.email,'type="email" maxlength="50"')}${field('sinvAddress','Address · optional',c.address,'maxlength="100"')}</div>
      <button class="btn btn-outline btn-sm" id="sinvSave">Save details</button></details>
     ${p?`<section class="sdw-sec"><div class="sdw-sec-h"><span class="sdw-ico" aria-hidden="true">🗓️</span><span class="sdw-sec-t"><b>Months to invoice</b><small>Untick any month you don't want to invoice now</small></span></div>
      <div class="fw-months rc-monthcards">${p.months.map(m=>`<label class="fw-month"><input type="checkbox" class="sinv-month" value="${esc(m.id)}" checked aria-label="Invoice ${esc(m.label)}"><span>${esc(m.label)}<small>${money(m.net_minor)} + VAT ${money(m.vat_minor)}</small></span><strong>${money(m.gross_minor)}</strong></label>`).join('')}</div>
      <div class="sdw-quick"><button type="button" data-sinv-all>Select all</button><button type="button" data-sinv-none>Clear</button><span id="sinvPicked"></span></div></section>
     <section class="sdw-sec"><div class="sdw-sec-h"><span class="sdw-ico" aria-hidden="true">🧾</span><span class="sdw-sec-t"><b>How do you want to invoice them?</b><small>Pick one. The button at the bottom says exactly what will be issued.</small></span></div>
      <div class="sdw-modes" role="radiogroup" aria-label="How to invoice">
       <button type="button" role="radio" data-sinv-mode="separate"><span class="sdw-mode-ico" aria-hidden="true">📄</span><span><b>One invoice per month</b><small>Each ticked month gets its own חשבונית מס. Good when the store pays month by month.</small></span></button>
       <button type="button" role="radio" data-sinv-mode="combined"><span class="sdw-mode-ico" aria-hidden="true">🗂️</span><span><b>One invoice for all ticked months</b><small>A single חשבונית מס that lists every ticked month and is titled with their names. Good when they pay several months at once.</small></span></button>
       <button type="button" role="radio" data-sinv-mode="paid"><span class="sdw-mode-ico" aria-hidden="true">✅</span><span><b>Already paid · invoice + receipt</b><small>One חשבונית מס/קבלה for the ticked months, which are then marked paid. You review it on the next screen.</small></span></button>
      </div>
      <p class="sdw-next" id="sinvNext"></p>
      <div id="sinvIssueOpts"><label class="rc-toggle"><input type="checkbox" id="storeInvoiceEmail" ${p.customer.email?'':'disabled'}><span class="rc-switch" aria-hidden="true"></span><span>Email to ${esc(p.customer.email||'the store (add an email above)')}</span></label>
      <label class="fw-check sdw-confirm"><input type="checkbox" id="storeInvoiceOk"> I checked the store's name, ח.פ. and amounts. This creates official, numbered tax invoices in FinBot.</label></div></section>`:'<p class="sdw-empty">Add the store\'s ח.פ. above and save to see the months to invoice.</p>'}
     <div class="sdw-alt"><span class="sdw-ico" aria-hidden="true">💸</span><span class="sdw-sec-t"><b>Already received payment?</b><small>One חשבונית מס/קבלה for the total received, without picking months. Only when no tax invoice was issued for it.</small></span><button type="button" class="btn btn-outline btn-sm" id="storeInvoiceCombined">Combined →</button></div>
    </div>
    ${p?'<footer class="sdw-foot"><button class="rc-review" id="storeInvoiceIssue" disabled>Choose months</button></footer>':''}
   </div>`;
   get('storeInvoiceCombined').onclick=async()=>{
    if(box.dataset.dirty==='1'){status.textContent='Save the edited store details first.';return;}
    const b=get('storeInvoiceCombined');b.disabled=true;
    try{await root.GremierFinance.openStoreCombined(storeId);box.innerHTML='';current=null;status.textContent='';}
    catch(e){status.textContent=e.message;b.disabled=false;}
   };
   if(p)current={store_id:storeId,months:p.months};
   const issueBtn=get('storeInvoiceIssue'),ok=get('storeInvoiceOk');
   const chosen=()=>[...box.querySelectorAll('.sinv-month:checked')].map(i=>current.months.find(m=>m.id===i.value));
   let mode='separate';
   const refresh=()=>{
    if(!issueBtn)return;
    const list=chosen(),n=list.length,dirty=box.dataset.dirty==='1';
    const net=list.reduce((s,m)=>s+m.net_minor,0),sumGross=list.reduce((s,m)=>s+m.gross_minor,0),oneGross=net+vatOn(net);
    box.querySelectorAll('[data-sinv-mode]').forEach(b=>{const on=b.dataset.sinvMode===mode;b.classList.toggle('on',on);b.setAttribute('aria-checked',String(on));});
    if(get('sinvPicked'))get('sinvPicked').textContent=n?n+' of '+current.months.length+' ticked':'';
    get('sinvIssueOpts').hidden=mode==='paid';
    get('sinvNext').textContent=mode==='paid'?'When they pay later, nothing else is needed: the receipt is part of this document.'
     :'When the store pays, issue a קבלה (New document below) and tick the same months: it links to '+(mode==='combined'&&n>1?'this invoice':'their invoices')+' automatically.';
    let text='Choose months',ready=n>0&&!dirty;
    if(n&&mode==='paid')text='Continue · invoice + receipt for '+n+' month'+(n>1?'s':'')+' →';
    else if(n&&!ok.checked){text='Tick the check above to issue';ready=false;}
    else if(n&&mode==='combined'&&n>1)text='Issue 1 tax invoice for '+n+' months · '+money(oneGross);
    else if(n)text='Issue '+n+' tax invoice'+(n>1?'s':'')+' · '+money(sumGross);
    if(dirty&&n)text='Save the store details first';
    issueBtn.textContent=text;issueBtn.disabled=!ready;
   };
   box.querySelectorAll('[data-sinv-mode]').forEach(b=>b.onclick=()=>{mode=b.dataset.sinvMode;refresh();});
   box.querySelector('[data-sinv-all]')?.addEventListener('click',()=>{box.querySelectorAll('.sinv-month').forEach(i=>i.checked=true);refresh();});
   box.querySelector('[data-sinv-none]')?.addEventListener('click',()=>{box.querySelectorAll('.sinv-month').forEach(i=>i.checked=false);refresh();});
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
   status.textContent=`Issued one tax invoice for ${label}: ${r.invoice.document_number||'number not read'}.`;
   get('storeInvoicePreview').innerHTML='';current=null;
  }catch(e){status.textContent=e.message+' Do not issue these months again before checking FinBot.';}
  await load();
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
