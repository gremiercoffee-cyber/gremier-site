/* Store tax invoices (חשבונית מס) on the Receipts screen: one invoice per store for all its unpaid,
   not-yet-invoiced months, VAT on top. Issuing is official, so it always shows FinBot's preview first. */
(function(root){
 'use strict';
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const sbc=()=>typeof sb!=='undefined'?sb:root.MAIN_SB||root.ADMIN_SB,get=id=>document.getElementById(id);
 const money=n=>new Intl.NumberFormat('en-IL',{style:'currency',currency:'ILS'}).format(n/100);
 const VAT=0.18,vatOn=n=>Math.round(n*VAT);
 const month=b=>new Date(b.year,b.month-1,1).toLocaleDateString('en-GB',{month:'short',year:'numeric'});
 const errors={store_tax_id_required:'Add the store\'s ח.פ. / עוסק number first (Saved customers & store details).',store_customer_missing:'This store has no saved customer details yet.',
  store_email_required:'Add the store\'s email first, or untick "Email it".',no_unpaid_months:'Nothing left to invoice for this store.',billing_changed_refresh_preview:'The months changed. Preview again.',
  month_already_invoiced_refresh:'Some of these months were just invoiced. Refresh.',invoice_number_digits:'Enter the invoice number (digits only).'};
 async function call(body){
  const r=await sbc().functions.invoke('store-tax-invoices',{body});
  if(r.error||r.data?.error){const d=r.data||await r.error?.context?.json?.().catch(()=>null);throw Error(errors[d?.error]||d?.error||'Request failed. Refresh and try again.');}
  return r.data;
 }
 let pending=null;
 function setup(){
  const host=get('tab-finance');if(!host||get('storeInvoices'))return false;
  const section=document.createElement('section');section.className='fw-panel';section.id='storeInvoices';
  section.innerHTML=`<h2>Store tax invoices · חשבוניות מס</h2><p class="fw-note">One invoice per store for all its unpaid months, VAT (18%) on top of the store's price. When the store pays, issue its receipt below: it links to this invoice.</p><p class="fw-note" id="storeInvoiceStatus" role="status"></p><div id="storeInvoiceList"></div><div id="storeInvoicePreview"></div><details class="fw-help"><summary>Issued invoices</summary><div id="storeInvoiceIssued"></div></details>`;
  host.querySelector('.page-header')?.after(section);if(!section.parentNode)host.prepend(section);
  return true;
 }
 async function load(){
  setup();const status=get('storeInvoiceStatus');if(!status)return;status.textContent='Loading stores…';
  try{
   const [bills,customers,invoices]=await Promise.all([
    sbc().from('store_billing').select('id,store_id,year,month,total,tax_invoice_id,stores(name)').is('paid_at',null).is('cancelled_at',null).gt('total',0).order('year').order('month'),
    sbc().from('receipt_customers').select('store_id,name,tax_id,email').not('store_id','is',null).is('archived_at',null),
    sbc().from('store_tax_invoices').select('id,store_id,customer_snapshot,net_minor,vat_minor,gross_minor,status,document_number,pdf_path,error_code,email_sent_at,email_error,issued_at,created_at').order('created_at',{ascending:false}).limit(100)]);
   if(bills.error||customers.error||invoices.error)throw Error('Could not load store invoices.');
   const byStore=new Map();
   for(const b of bills.data.filter(b=>!b.tax_invoice_id)){const s=byStore.get(b.store_id)||{name:b.stores?.name||'Store',months:[]};s.months.push(b);byStore.set(b.store_id,s);}
   const rows=[...byStore].map(([id,s])=>{const net=s.months.reduce((n,b)=>n+Math.round(Number(b.total)*100),0),c=customers.data.find(c=>c.store_id===id);return {id,...s,net,vat:vatOn(net),customer:c};}).sort((a,b)=>b.net-a.net);
   get('storeInvoiceList').innerHTML=rows.length?`<div class="table-wrap"><table><thead><tr><th>Store</th><th>Months</th><th>Before VAT</th><th>VAT</th><th>Invoice total</th><th></th></tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(r.name)}${r.customer?.tax_id?'':'<small>Needs ח.פ.</small>'}</td><td>${esc(r.months.map(month).join(', '))}</td><td>${money(r.net)}</td><td>${money(r.vat)}</td><td><strong>${money(r.net+r.vat)}</strong></td><td><button class="btn btn-outline btn-sm" data-invoice-preview="${esc(r.id)}" ${r.customer?.tax_id?'':'disabled'}>Preview invoice</button></td></tr>`).join('')}</tbody></table></div>`:'<p class="fw-note">Every unpaid month is already invoiced.</p>';
   get('storeInvoiceList').querySelectorAll('[data-invoice-preview]').forEach(b=>b.onclick=()=>preview(b.dataset.invoicePreview,b));
   get('storeInvoiceIssued').innerHTML=invoices.data.length?invoices.data.map(i=>`<div class="fw-row-card"><div><b>${esc(i.customer_snapshot?.name||'Store')}</b> · ${money(i.gross_minor)} <small>${esc(i.status==='issued'?'חשבונית מס '+(i.document_number||'· number not read'):i.status==='needs_review'?'Needs review: '+(i.error_code||''):i.status)}${i.email_sent_at?' · emailed':i.email_error?' · email failed':''}</small></div><div class="fw-actions">${i.status==='issued'?`<button class="btn btn-outline btn-sm" data-invoice-pdf="${esc(i.id)}">Open PDF</button>`:''}${i.status==='issued'&&!i.document_number?`<button class="btn btn-outline btn-sm" data-invoice-number="${esc(i.id)}">Enter invoice number</button>`:''}${i.status==='needs_review'&&i.error_code!=='released'?`<button class="btn btn-outline btn-sm" data-invoice-release="${esc(i.id)}">Not in FinBot · free its months</button>`:''}</div></div>`).join(''):'<p class="fw-note">None yet.</p>';
   const act=(sel,fn)=>get('storeInvoiceIssued').querySelectorAll(sel).forEach(b=>b.onclick=async()=>{b.disabled=true;try{await fn(Object.values(b.dataset)[0]);}catch(e){status.textContent=e.message;b.disabled=false;}});
   act('[data-invoice-pdf]',async id=>{const r=await call({action:'pdf',id});root.open(r.url,'_blank','noopener');});
   act('[data-invoice-number]',async id=>{const n=root.prompt('Invoice number as shown on the PDF (חשבונית מס …)');if(!n)return;await call({action:'set_number',id,number:n.trim()});await load();});
   act('[data-invoice-release]',async id=>{if(!root.confirm('Only do this after checking in FinBot that this invoice was NOT created. Free its months for a new invoice?'))return;await call({action:'release',id,confirm_not_in_finbot:true});await load();});
   status.textContent='';
  }catch(e){status.textContent=e.message;}
 }
 async function preview(storeId,button){
  const status=get('storeInvoiceStatus'),box=get('storeInvoicePreview');button.disabled=true;status.textContent='Preparing preview…';
  try{
   const id=crypto.randomUUID(),r=await call({action:'preview',id,store_id:storeId});const p=r.preview;pending={id,store_id:storeId,gross_minor:p.gross_minor};
   box.innerHTML=`<div class="fw-review"><h3>חשבונית מס · ${esc(p.customer.name)}</h3><dl class="fw-review-grid"><div><dt>ח.פ.</dt><dd>${esc(p.customer.tax_id)}</dd></div>${p.months.map(m=>`<div><dt>${esc(m.label)}</dt><dd>${money(m.net_minor)}</dd></div>`).join('')}<div><dt>Before VAT</dt><dd>${money(p.net_minor)}</dd></div><div><dt>VAT 18%</dt><dd>${money(p.vat_minor)}</dd></div><div><dt>Total</dt><dd><strong>${money(p.gross_minor)}</strong></dd></div></dl>
    <label class="fw-check"><input type="checkbox" id="storeInvoiceEmail" ${p.customer.email?'':'disabled'}> Email it to ${esc(p.customer.email||'the store (no email saved)')}</label>
    <label class="fw-check"><input type="checkbox" id="storeInvoiceOk"> I checked the store's name, ח.פ. and amounts. This issues an official, numbered tax invoice in FinBot.</label>
    <div class="fw-actions"><button class="btn btn-amber" id="storeInvoiceIssue" disabled>Issue tax invoice</button><button class="btn btn-outline" id="storeInvoiceCancel">Cancel</button></div></div>`;
   get('storeInvoiceOk').onchange=()=>{get('storeInvoiceIssue').disabled=!get('storeInvoiceOk').checked;};
   get('storeInvoiceCancel').onclick=()=>{pending=null;box.innerHTML='';};
   get('storeInvoiceIssue').onclick=issue;status.textContent='';box.scrollIntoView?.({behavior:'smooth',block:'nearest'});
  }catch(e){status.textContent=e.message;}finally{button.disabled=false;}
 }
 async function issue(){
  if(!pending)return;const status=get('storeInvoiceStatus');get('storeInvoiceIssue').disabled=true;status.textContent='Issuing the tax invoice… don\'t press again.';
  try{
   const r=await call({action:'issue',...pending,email_requested:!!get('storeInvoiceEmail')?.checked,confirm:true});pending=null;get('storeInvoicePreview').innerHTML='';
   const i=r.invoice;status.textContent=i.status==='issued'?`Tax invoice ${i.document_number||'(number not read: enter it from the PDF)'} issued · ${money(i.gross_minor)}${i.email_sent_at?' · emailed':''}.`:'Needs review. Do not issue again; check FinBot.';
   await load();
  }catch(e){status.textContent=e.message+' Do not issue again before checking FinBot.';}
 }
 const original=root.GremierFinance?.load;
 if(root.GremierFinance&&original)root.GremierFinance.load=async(...a)=>{const r=await original(...a);load();return r;};
 const show=root.showTab;root.showTab=function(tab,...args){const r=show?.call(this,tab,...args);if(tab==='finance')load();return r;};
})(window);
