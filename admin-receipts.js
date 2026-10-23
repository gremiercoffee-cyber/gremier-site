/* Receipt review and the one-click 2026 reconciliation report. Admin access only. */
(function(root){
 'use strict';
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const money=v=>new Intl.NumberFormat('en-IL',{style:'currency',currency:'ILS'}).format(v);
 const client=()=>typeof sb!=='undefined'?sb:root.MAIN_SB||root.ADMIN_SB;
 const byId=id=>document.getElementById(id);
 let rows=[],receiptMap=new Map(),report=null,sequence=0;
 async function pages(query){const out=[];for(let n=0;n<100000;n+=1000){const {data,error}=await query().range(n,n+999);if(error||!Array.isArray(data))throw Error('Receipt report unavailable');out.push(...data);if(data.length<1000)return out;}throw Error('Select a smaller reporting period');}
 async function call(action,args={}){const {data,error}=await client().functions.invoke('finbot-receipts',{body:{action,...args}});if(error||data?.error)throw Error(data?.error||'Receipt service unavailable');return data;}
 const date=value=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jerusalem',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));
 function setup(){
  const host=byId('tab-orders');if(!host||byId('receiptPanel'))return;
  const box=document.createElement('section');box.id='receiptPanel';box.className='card';box.style.marginBottom='20px';
  box.innerHTML=`<div class="receipt-card-head"><div><h3>Receipts · קבלות</h3><p id="receiptAutomationState">Loading settings…</p></div><span data-action-menu="Order receipt tools"><button class="btn btn-outline btn-sm" id="receiptRefresh">Refresh status</button><button class="btn btn-outline btn-sm" id="receipt2026">Review 2026 receipts</button><button class="btn btn-outline btn-sm" id="receiptExport" disabled>Export accountant CSV</button><button class="btn btn-outline btn-sm" id="receiptTestToggle">Test and review a receipt</button><button class="btn btn-outline btn-sm" id="receiptDisable">Pause automatic receipts</button></span></div>
    <p id="receiptReportSummary" role="status" class="receipt-status"></p>
    <details id="receiptReportDetails" class="receipt-details"><summary>2026 receipt review</summary><p class="receipt-help" id="receiptReportNote"></p><label class="receipt-view">Show<select class="form-input" id="receiptView"><option value="missing">Without a linked receipt</option><option value="all">All paid 2026 orders</option></select></label><div id="receiptReportRows" class="table-wrap"></div></details>
    <details id="receiptTestDetails" class="receipt-details" hidden><summary>Test and review a receipt</summary><p style="font-size:.78rem;line-height:1.6">Choose a real paid order that has never received a receipt. A live test creates an official קבלה and sends its PDF only to the business owner for review. Historical orders are never issued receipts automatically. The receipt date is today; verify the actual payment date.</p>
    <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:end"><label>Order number <input class="form-input" id="receiptOrderNumber" placeholder="#123"></label><label>Actual payment date <input class="form-input" id="receiptPaymentDate" type="date"></label><button class="btn btn-outline btn-sm" id="receiptPreview">Preview data · no issuance</button><button class="btn btn-outline btn-sm" id="receiptIssueTest">Issue ONE real test receipt</button></div><pre id="receiptPreviewData" style="white-space:pre-wrap;font-size:.74rem;max-height:300px;overflow:auto"></pre>
    <button class="btn btn-outline btn-sm" id="receiptApprove">I reviewed the test PDF and email · enable future receipts</button><p id="receiptTestResult" role="status" style="font-size:.8rem"></p></details>`;
  host.appendChild(box); // below the orders: they're why you open this page
  byId('receiptRefresh').onclick=()=>load();
  byId('receipt2026').onclick=()=>{byId('receiptReportDetails').open=true;load(true);};
  byId('receiptReportDetails').ontoggle=()=>{if(byId('receiptReportDetails').open)load(true);};
  byId('receiptTestToggle').onclick=()=>{const d=byId('receiptTestDetails');d.hidden=false;d.open=true;d.scrollIntoView({behavior:'smooth',block:'nearest'});};
  byId('receiptExport').onclick=exportMissing;
  byId('receiptView').onchange=()=>load(true);
  byId('receiptDisable').onclick=()=>run(async()=>{await call('disable');await load();});
  byId('receiptPreview').onclick=()=>run(async()=>{const o=await chosen();const d=await call('preview',{order_id:o.id,payment_date:byId('receiptPaymentDate').value});byId('receiptPreviewData').textContent=JSON.stringify(d,null,2);});
  byId('receiptIssueTest').onclick=()=>run(async()=>{const o=await chosen();if(!confirm(`Create ONE OFFICIAL קבלה for paid order #${o.order_number} (${money(o.total)})? Confirm no receipt has already been issued manually. This is a real document, not a sandbox sample. Only the owner receives the test email.`))return;const d=await call('issue_test',{order_id:o.id,payment_date:byId('receiptPaymentDate').value,confirm_real_receipt:true});byId('receiptTestResult').textContent=d.receipt?.pdf_path?'Receipt issued. Check the PDF and owner email before enabling automation.':JSON.stringify(d);await load();});
  byId('receiptApprove').onclick=()=>run(async()=>{const o=await chosen();if(!confirm('Have you reviewed the official test receipt and test email? Enable receipts for new eligible PayMe payments from now on?'))return;await call('approve_enable',{order_id:o.id,reviewed_pdf_and_email:true});await load();});
  box.addEventListener('click',event=>{const b=event.target.closest('[data-receipt-action]');if(!b)return;run(async()=>{const id=b.dataset.orderId,action=b.dataset.receiptAction;
    if(action==='pdf'){const d=await call('pdf',{order_id:id});window.open(d.url,'_blank','noopener');}
    if(action==='retry_pdf'){await call('retry_pdf',{order_id:id});await load(true);}
    if(action==='test_email'){await call('send_test_email',{order_id:id});await load(true);}
    if(action==='manual'){const ref=prompt('Existing official receipt number (link only; creates no document):');if(!ref)return;const paid=prompt('Actual payment date, YYYY-MM-DD:');if(!paid)return;await call('link_manual',{order_id:id,document_reference:ref,payment_date:paid});await load(true);}
  });});
 }
 async function run(fn){try{await fn();}catch(e){byId('receiptTestResult').textContent=e.message;byId('receiptReportSummary').textContent=e.message;}}
 async function chosen(){const n=byId('receiptOrderNumber').value.replace(/^#/,'').trim();if(!/^\d+$/.test(n))throw Error('Enter the order number first');const {data,error}=await client().from('orders').select('*').eq('order_number',Number(n)).single();if(error)throw Error('Order not found');return data;}
 async function load(showReport=false){
  setup();if(!byId('receiptPanel'))return;const token=++sequence;report=null;byId('receiptExport').disabled=true;
  byId('receiptReportSummary').textContent='Loading receipt status…';byId('receiptReportRows').innerHTML='';
  try{
   const results=await Promise.all([
    call('settings'),pages(()=>client().from('orders').select('*').eq('payment_status','paid').gte('created_at','2026-01-01T00:00:00+03:00').lt('created_at','2027-01-01T00:00:00Z').order('created_at').order('id')),
    pages(()=>client().from('order_receipts').select('order_id,status,document_reference,pdf_path,is_test,error_code,test_email_sent_at').order('order_id'))
   ]);
   if(token!==sequence)return;
   const [settings,orders,receipts]=results;rows=orders.filter(o=>date(o.created_at).startsWith('2026-')&&!o.is_test&&!['cancelled','refunded'].includes(o.status)&&!/^TEST(?:\b|[_-])/i.test(o.customer_name||''));receiptMap=new Map(receipts.map(r=>[r.order_id,r]));
   byId('receiptAutomationState').textContent=settings.settings.enabled?'Automatic receipts on':`Automatic receipts off · ${settings.configured?'setup review needed':'FinBot key not configured'}`;
   byId('receiptAutomationState').dataset.enabled=String(!!settings.settings.enabled);
   byId('receiptDisable').disabled=!settings.settings.enabled;
   const missing=rows.filter(o=>!['issued','external'].includes(receiptMap.get(o.id)?.status));report=missing;
   const total=missing.reduce((s,o)=>s+Math.round(Number(o.total||0)*100),0)/100;
   byId('receiptReportSummary').textContent=missing.length?`${missing.length} paid ${missing.length===1?'order needs':'orders need'} receipt review`:'All paid 2026 orders have linked receipts';
   byId('receiptReportNote').textContent=`2026 unlinked total: ${money(total)}. Based on order creation year; ${missing.filter(o=>!o.payment_confirmed_at).length} have an unknown payment date. Reconcile manual receipts and “Needs review” rows before using the accountant export. Cancelled, refunded and test orders excluded.`;
   byId('receiptExport').disabled=false;
   if(showReport||byId('receiptReportRows').dataset.open==='true'){
    byId('receiptReportRows').dataset.open='true';
    const visible=byId('receiptView').value==='all'?rows:missing;
    byId('receiptReportRows').innerHTML=`<table><thead><tr><th>Order</th><th>Customer</th><th>Total</th><th>Receipt</th><th>Action</th></tr></thead><tbody>${visible.map(o=>{const r=receiptMap.get(o.id);const button=(action,label)=>`<button class="btn btn-outline btn-sm" data-receipt-action="${action}" data-order-id="${esc(o.id)}">${label}</button>`;return `<tr><td>#${esc(o.order_number)}</td><td>${esc(o.customer_name)}</td><td>${esc(money(o.total))}</td><td>${esc(r?.status==='issued'?'Issued':r?.status==='external'?'Manually linked':r?.status==='needs_review'?'Needs review — do not reissue':r?.status==='issuing'?'Issuance pending — do not reissue':'No linked receipt')}${r?.document_reference?' · '+esc(r.document_reference):''}${r?.error_code?'<br>'+esc(r.error_code):''}</td><td>${r?.pdf_path?button('pdf','Open PDF'):r?.status==='issued'?button('retry_pdf','Retry PDF download'):!r||r.status==='needs_review'?button('manual','Link existing receipt'):''}${r?.is_test&&r.pdf_path&&!r.test_email_sent_at?button('test_email','Send test to owner'):''}</td></tr>`;}).join('')||'<tr><td colspan="5">No matching orders.</td></tr>'}</tbody></table>`;
   }
   badgeRows();
  }catch(e){if(token!==sequence)return;byId('receiptReportSummary').textContent='Receipt reporting unavailable. No totals are shown until the receipt tables and service are configured.';byId('receiptAutomationState').textContent='Receipt settings unavailable';}
 }
 function badgeRows(){
  for(const o of rows){const r=receiptMap.get(o.id);for(const tbody of ['ordersBody','closedOrdersBody']){const cell=byId(tbody)?.querySelector(`tr[onclick*="${o.id}"] td`);if(!cell||cell.querySelector('.receipt-badge'))continue;const badge=document.createElement('small');badge.className='receipt-badge';badge.style.cssText='display:block;font-size:.62rem;color:var(--text2);margin-top:4px';badge.textContent=r?.status==='issued'||r?.status==='external'?'קבלה ✓':r?'קבלה: review':'No linked קבלה';cell.append(badge);}}
 }
 function exportMissing(){if(!report)return;const safe=v=>/^[=+@\-\t\r]/.test(String(v??''))?"'"+v:v;const data=[['Order','Order date Jerusalem','Payment confirmed at','Payment date basis','Customer','Paid amount ILS','Receipt status','Source','Payment method']];for(const o of report)data.push([o.order_number,date(o.created_at),o.payment_confirmed_at||'',o.payment_confirmed_at?'Known':'Unknown — reconcile',o.customer_name,o.total,receiptMap.get(o.id)?.status||'No linked receipt',o.source,o.payment_method]);data.push(['TOTAL (order creation year; reconcile manual receipts)','','','','',report.reduce((s,o)=>s+Math.round(Number(o.total||0)*100),0)/100]);downloadCSV(data.map(r=>r.map(safe)),'gremier-2026-paid-orders-without-linked-receipts.csv');}
 const original=root.loadOrders;if(original)root.loadOrders=async function(...args){const result=await original.apply(this,args);await load();return result;};
 const render=root.renderOrdersTable;if(render)root.renderOrdersTable=function(...args){const result=render.apply(this,args);badgeRows();return result;};
 root.GremierReceipts={load};setup();
})(window);
