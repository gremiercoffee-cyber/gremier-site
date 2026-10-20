(function(root){
 'use strict';
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const sbc=()=>typeof sb!=='undefined'?sb:root.MAIN_SB||root.ADMIN_SB,get=id=>document.getElementById(id);
 const money=n=>new Intl.NumberFormat('en-IL',{style:'currency',currency:'ILS'}).format(n/100);
 const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jerusalem',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const receiptErrors={check_bank_code_required:'Enter the bank number printed on the check.',check_branch_required:'Enter the branch number printed on the check.',check_account_required:'Enter the account number printed on the check (up to 15 digits).',check_check_number_required:'Enter the check number (up to 15 digits).',check_date_required:'Enter a valid date printed on the check.',payment_reference_max_40:'The payment reference can contain up to 40 characters.',amount_exceeds_finbot_limit:'The amount exceeds FinBot’s supported receipt limit.',customer_changed_refresh_preview:'Customer details changed. Refresh and review the receipt again.'};
 async function call(name,body){const r=await sbc().functions.invoke(name,{body});if(r.error||r.data?.error){const detail=r.data||await r.error?.context?.json?.().catch(()=>null);throw Error(receiptErrors[detail?.error]||detail?.error||'Request failed; refresh before retrying.');}return r.data;}
 async function pages(table,columns,order){const out=[],primary=table==='order_receipts'?'order_id':'id';for(let n=0;n<100000;n+=1000){let query=sbc().from(table).select(columns).order(order);if(order!==primary)query=query.order(primary);const r=await query.range(n,n+999);if(r.error)throw Error('Could not load '+table);out.push(...r.data);if(r.data.length<1000)return out;}throw Error('Report is too large');}
 const status=(id,message)=>{if(get(id))get(id).textContent=message;};
 let customers=[],allCustomers=[],stores=[],bills=[],preview=null,requestId=crypto.randomUUID(),preparedReceipt=null,expenseFiles=[],expenseSettings=null,batch=null,allReceipts=[];
 let financeSeq=0,expenseSeq=0;
 const field=(label,id,type='text',extra='')=>`<label>${label}<input class="form-input" id="${id}" type="${type}" ${extra}></label>`;
 function setup(){
  const original=get('tab-reports');if(!original||get('tab-finance'))return;
  for(const [id,label,icon] of [['finance','Receipts','🧾'],['expenses','Expenses','📥']]){
   const tab=document.createElement('div');tab.id='tab-'+id;tab.className='tab-content';tab.style.display='none';original.insertAdjacentElement('afterend',tab);
   const nav=document.createElement('div');nav.id='nav-'+id;nav.className='nav-item';nav.innerHTML=`<span class="icon">${icon}</span><span>${label}</span>`;nav.onclick=()=>root.showTab(id);get('nav-reports')?.insertAdjacentElement('afterend',nav);
   const drawer=document.querySelector('.nav-drawer-item[onclick*="reports"]');if(drawer){const b=document.createElement('button');b.className='nav-drawer-item';b.textContent=icon+' '+label;b.onclick=()=>{root.showTab(id);root.closeNavDrawer?.();};drawer.insertAdjacentElement('afterend',b);}
  }
  get('tab-finance').innerHTML=`<header class="page-header"><div class="flex-between"><div><h1 class="page-title">Receipts · קבלות</h1><p class="page-sub">Receipts and customer payments</p></div><span data-action-menu="Receipt tools"><button class="btn btn-outline" id="financeReload">Refresh</button></span></div></header><p class="fw-note" id="financeStatus" role="status"></p>
   <section class="fw-panel"><h2>New receipt</h2>
   <div id="manualReceiptForm"><div class="fw-form"><label>Search<input class="form-input" id="receiptCustomerSearch" placeholder="Name, store or ח.פ."></label><label>Customer<select class="form-input" id="manualCustomer"></select></label></div><div class="fw-actions fw-customer-actions"><button class="btn btn-outline" id="receiptAddCustomer">+ Add new customer</button><button class="btn btn-outline" id="receiptEditCustomer" hidden disabled>Edit details</button></div><div id="manualCustomerDetails" class="fw-note"></div><div id="manualPaymentFields" hidden><div id="manualBills"></div><div id="manualSettlement" class="fw-settlement" hidden></div>
   <div class="fw-form fw-primary">${field('Amount received · ₪','manualAmount','number','min="0.01" max="9999999" step="0.01"')}${field('Date received','manualDate','date')}<label>Payment method<select class="form-input" id="manualMethod"><option value="bank_transfer">Bank transfer</option><option value="cash">Cash</option><option value="check">Check · צ׳ק</option><option value="bit">Bit · ביט</option></select></label></div>
   <div id="manualAdjustmentGroup" hidden>${field('Reason for the different amount','manualAdjustment','text','maxlength="500" placeholder="e.g. spoiled stock or agreed adjustment"')}</div>
   <details class="fw-help" id="manualReceiptExtras"><summary>Reference & description</summary><div class="fw-form">${field('Payment reference · optional','manualReference','text','maxlength="40"')}${field('Description','manualDescription','text','maxlength="200"')}</div></details>
   <div id="manualCheckFields" hidden><h3>Check details</h3><div class="fw-form">${field('Bank number · מספר בנק','manualCheckBank','text','inputmode="numeric" maxlength="3"')}${field('Branch · סניף','manualCheckBranch','text','inputmode="numeric" maxlength="4"')}${field('Account number · מספר חשבון','manualCheckAccount','text','inputmode="numeric" maxlength="15"')}${field('Check number · מספר צ׳ק','manualCheckNumber','text','inputmode="numeric" maxlength="15"')}${field('Date printed on check · תאריך פירעון','manualCheckDate','date')}</div></div>
   <label class="fw-check"><input type="checkbox" id="manualEmail"> Email receipt PDF</label><button class="btn btn-amber" id="manualPreview">Review receipt</button></div></div><div id="manualReceiptReview"></div><p class="fw-note" id="manualReceiptStatus" role="status"></p></section>
   <section class="fw-panel"><details id="financeCustomerEditor"><summary>Saved customers & store details</summary><div class="fw-form"><label>Edit customer<select class="form-input" id="customerEdit"></select></label><label>Linked store<select class="form-input" id="customerStore"></select></label>${field('Official name','customerName','text','maxlength="100"')}${field('ח.פ. / עוסק · 9 digits','customerTax','text','inputmode="numeric" maxlength="9"')}${field('Email for receipts','customerEmail','email','maxlength="50"')}${field('Phone · optional','customerPhone','tel')}${field('Address · optional','customerAddress','text','maxlength="100"')}</div><div class="fw-actions"><button class="btn btn-outline" id="customerSave">Save customer</button><button class="btn btn-outline" id="customerNew">New customer</button><span data-action-menu="Customer actions"><button class="btn btn-red" id="customerArchive">Archive customer</button></span></div><p id="customerStatus" class="fw-note" role="status"></p></details></section>
   <section class="fw-panel"><details id="financeReceiptHistory"><summary>Receipt history</summary><div class="fw-form">${field('Filter customer / order','financeReceiptSearch')}${field('Payment year','financeReceiptYear','number','min="2020" max="2100"')}</div><p class="fw-note" id="financeReceiptTotal"></p><div class="table-wrap" id="financeReceiptList"></div><details class="fw-help"><summary>About this history</summary><p class="fw-note">Online and manually issued receipts, by payment date. Invoices and delivery estimates are excluded. Older FinBot-only receipts remain in the Stats snapshot; their PDFs are not synced here.</p></details></details></section>`;
  get('financeReload').onclick=loadFinance;
  get('manualDate').value=today();get('financeReceiptYear').value=today().slice(0,4);
  get('receiptCustomerSearch').oninput=customerOptions;
  get('manualCustomer').onchange=loadCustomerBills;
  get('receiptAddCustomer').onclick=()=>startCustomer();
  get('receiptEditCustomer').onclick=()=>startCustomer(get('manualCustomer').value);
  get('manualMethod').onchange=()=>{get('manualCheckFields').hidden=get('manualMethod').value!=='check';if(!get('manualCheckDate').value)get('manualCheckDate').value=get('manualDate').value||today();};
  get('manualPreview').onclick=review;
  get('manualAmount').oninput=updateSettlement;
  get('customerEdit').onchange=editCustomer;
  get('customerNew').onclick=()=>startCustomer();
  get('customerStore').onchange=()=>{const s=stores.find(s=>s.id===get('customerStore').value);if(s&&!get('customerEdit').value){get('customerName').value=s.name;get('customerPhone').value=s.phone||'';}};
  get('customerSave').onclick=saveCustomer;get('customerArchive').onclick=archiveCustomer;
  get('financeReceiptSearch').oninput=renderReceipts;get('financeReceiptYear').oninput=renderReceipts;
  const delivery=get('tab-storedeliveries')?.querySelector('.page-header');if(delivery){const b=document.createElement('button');b.className='btn btn-outline';b.textContent='Issue store receipt';b.onclick=()=>{root.showTab('finance');status('manualReceiptStatus','Choose a saved store, then select the months this payment settles. Store details can be added under Saved customers & store details.');};const actions=delivery.querySelector('.header-actions');if(actions)actions.append(b);else delivery.append(b);}
  setupExpenses();
 }
 function customerOptions(){
  const selected=get('manualCustomer').value,q=get('receiptCustomerSearch').value.toLowerCase();
  get('manualCustomer').innerHTML='<option value="">Choose customer / store</option>'+customers.filter(c=>(c.name+' '+c.tax_id).toLowerCase().includes(q)).map(c=>`<option value="${esc(c.id)}">${esc(c.name)}${c.store_id?' · store':''}</option>`).join('');get('manualCustomer').value=selected;
  showCustomerDetails();
 }
 function showCustomerDetails(){
  const c=customers.find(c=>c.id===get('manualCustomer').value);
  get('receiptEditCustomer').disabled=!c;get('receiptEditCustomer').hidden=!c;
  get('manualPaymentFields').hidden=!c;
  get('manualCustomerDetails').innerHTML=c?`<details class="fw-help"><summary>Customer details${c.tax_id?' · '+esc(c.tax_id):''}</summary>${[c.name,c.tax_id,c.address,c.phone,c.email].filter(Boolean).map(v=>esc(v)).join('<br>')}</details>`:'';
 }
 function startCustomer(id=''){
  get('customerEdit').value=id;editCustomer();
  get('financeCustomerEditor').open=true;
  get('financeCustomerEditor').querySelector('summary').textContent=id?'Edit customer details':'Add new customer';
  get('financeCustomerEditor').scrollIntoView({behavior:'smooth',block:'start'});
  get('customerName').focus({preventScroll:true});
 }
 async function loadFinance(){
  setup();const token=++financeSeq;status('financeStatus','Loading customers and receipt history…');
  try{
   const results=await Promise.all([pages('receipt_customers','*','name'),pages('stores','id,name,phone','name'),
    pages('business_receipts','id,customer_snapshot,amount_minor,payment_date,payment_method,status,pdf_path,email_requested,email_sent_at,email_error,error_code,issued_at,created_at','created_at'),
    pages('order_receipts','order_id,status,amount_minor,payment_date,pdf_path,document_reference,issued_at,orders(customer_name,order_number)','order_id')]);
   if(token!==financeSeq)return;
   allCustomers=results[0];customers=allCustomers.filter(c=>!c.archived_at);stores=results[1];
   get('customerEdit').innerHTML='<option value="">New customer</option>'+allCustomers.map(c=>`<option value="${esc(c.id)}">${esc(c.name)}${c.archived_at?' · archived':''}</option>`).join('');
   get('customerStore').innerHTML='<option value="">Independent customer</option>'+stores.map(s=>`<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('');customerOptions();
   allReceipts=[...results[2].map(r=>({...r,kind:'business',name:r.customer_snapshot.name,reference:r.id.slice(0,8)})),...results[3].map(r=>({...r,id:r.order_id,kind:'order',name:r.orders?.customer_name||'Online customer',reference:r.orders?.order_number?'Order #'+r.orders.order_number:r.order_id.slice(0,8)}))];renderReceipts();status('financeStatus','');
  }catch(e){status('financeStatus',e.message);}
 }
 function editCustomer(){const c=allCustomers.find(c=>c.id===get('customerEdit').value)||{};for(const [id,key] of [['customerName','name'],['customerTax','tax_id'],['customerEmail','email'],['customerPhone','phone'],['customerAddress','address'],['customerStore','store_id']])get(id).value=c[key]||'';get('customerArchive').textContent=c.archived_at?'Restore customer':'Archive customer';status('customerStatus','');}
 async function saveCustomer(){
  if(get('customerSave').disabled)return;
  get('customerSave').disabled=true;
  try{
   const value={name:get('customerName').value.trim(),tax_id:get('customerTax').value.trim(),email:get('customerEmail').value.trim(),phone:get('customerPhone').value.trim(),address:get('customerAddress').value.trim(),store_id:get('customerStore').value||null,updated_at:new Date().toISOString()};
   if(!value.name||value.name.length>100)throw Error('Enter the official customer name (up to 100 characters).');if(value.tax_id&&!/^\d{9}$/.test(value.tax_id))throw Error('ח.פ./עוסק must contain 9 digits.');
   if(value.email&&(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email)||value.email.length>50))throw Error('Enter a valid receipt email (up to 50 characters).');
   if(value.phone&&!/^\+?\d{7,15}$/.test(value.phone.replace(/[\s().-]/g,'')))throw Error('Enter a valid phone number, or leave it blank.');
   const id=get('customerEdit').value,r=id?await sbc().from('receipt_customers').update(value).eq('id',id).select('id').single():await sbc().from('receipt_customers').insert(value).select('id').single();
   if(r.error)throw Error(r.error.code==='23505'?'This store already has saved receipt details. Edit that customer instead.':'Could not save customer.');
   get('receiptCustomerSearch').value='';await loadFinance();get('customerEdit').value=r.data.id;editCustomer();get('manualCustomer').value=r.data.id;await loadCustomerBills();status('customerStatus','Customer saved and selected for the receipt.');
   get('financeCustomerEditor').open=false;get('manualCustomer').scrollIntoView({behavior:'smooth',block:'center'});get('manualCustomer').focus({preventScroll:true});
  }catch(e){status('customerStatus',e.message);}finally{get('customerSave').disabled=false;}
 }
 async function archiveCustomer(){const id=get('customerEdit').value;if(!id)return;const restore=!!allCustomers.find(c=>c.id===id)?.archived_at;try{const r=await sbc().from('receipt_customers').update({archived_at:restore?null:new Date().toISOString()}).eq('id',id);if(r.error)throw Error('Could not update customer');await loadFinance();editCustomer();status('customerStatus',restore?'Customer restored.':'Customer archived; issued receipt records are preserved.');}catch(e){status('customerStatus',e.message);}}
 async function loadCustomerBills(){
  const c=customers.find(c=>c.id===get('manualCustomer').value);bills=[];preview=null;get('manualReceiptReview').innerHTML='';get('manualReceiptForm').hidden=false;get('manualBills').innerHTML='';get('manualEmail').checked=!!c?.email;get('manualEmail').disabled=!c?.email;get('manualAmount').value='';get('manualDescription').value=c?'Payment from '+c.name:'';
  showCustomerDetails();get('manualReference').value='';get('manualAdjustment').value='';
  for(const id of ['manualCheckBank','manualCheckBranch','manualCheckAccount','manualCheckNumber'])get(id).value='';get('manualCheckDate').value=get('manualDate').value||today();
  status('manualReceiptStatus','');updateSettlement();
  if(!c?.store_id)return;
  status('manualReceiptStatus','Loading outstanding months…');
  try{
   const [r,claimed]=await Promise.all([sbc().from('store_billing').select('id,year,month,total').eq('store_id',c.store_id).is('paid_at',null).is('cancelled_at',null).order('year').order('month'),sbc().from('business_receipt_bills').select('billing_id')]);
   if(c.id!==get('manualCustomer').value)return;if(r.error||claimed.error)throw Error('Could not load outstanding bills.');
   const ids=new Set(claimed.data.map(x=>x.billing_id));bills=r.data.filter(b=>!ids.has(b.id));
   get('manualBills').innerHTML=bills.length?'<h3>Months paid for</h3><p class="fw-note">Selected months are marked paid when the receipt is issued.</p><div class="fw-months">'+bills.map(b=>`<label class="fw-month"><input type="checkbox" value="${esc(b.id)}" class="manual-bill"><span>${b.year}-${String(b.month).padStart(2,'0')}</span><strong>${money(Math.round(Number(b.total)*100))}</strong></label>`).join('')+'</div>':'';
   get('manualBills').querySelectorAll('input').forEach(i=>i.onchange=()=>{const selected=selectedBills();get('manualAmount').value=(selected.reduce((s,b)=>s+Math.round(Number(b.total)*100),0)/100).toFixed(2);get('manualDescription').value=('Payment '+c.name+' · '+selected.map(b=>b.year+'-'+String(b.month).padStart(2,'0')).join(', ')).slice(0,200);updateSettlement();});
   status('manualReceiptStatus',bills.length?'':'No outstanding months available.');
  }catch(e){status('manualReceiptStatus',e.message);}
 }
 const selectedBills=()=>bills.filter(b=>[...document.querySelectorAll('.manual-bill:checked')].some(i=>i.value===b.id));
 function updateSettlement(){
  const selected=selectedBills(),billed=selected.reduce((sum,b)=>sum+Math.round(Number(b.total)*100),0),actual=Math.round(Number(get('manualAmount').value)*100);
  const differs=selected.length>0&&Number.isFinite(actual)&&actual>0&&actual!==billed;
  get('manualAdjustmentGroup').hidden=!differs;
  get('manualAdjustment').required=differs;
  get('manualSettlement').hidden=!selected.length;
  get('manualSettlement').textContent=selected.length?`${selected.length} month${selected.length===1?'':'s'} · Billed ${money(billed)}${differs?' · Difference '+money(actual-billed):''}`:'';
 }
 function receiptReviewDetails(p){
  const c=p.customer,check=p.payment_details||{},method=({cash:'Cash',bank_transfer:'Bank transfer',check:'Check · צ׳ק',bit:'Bit · ביט'})[p.payment_method];
  const rows=[['Document','קבלה · ILS'],['Issue date',p.payload?.date||today()],['Date received',p.payment_date],['Method',method],
   ['ח.פ./עוסק',c.tax_id],['Address',c.address],['Phone',c.phone],['Reference',p.payment_reference],['Description',p.description],
   ...(p.payment_method==='check'?[['Bank',check.bank_code],['Branch',check.branch],['Account',check.account],['Check number',check.check_number],['Check date',check.check_date]]:[]),
   ...(p.bills.length?[['Months paid for',p.bills.map(b=>b.year+'-'+String(b.month).padStart(2,'0')).join(', ')],['Original bills',money(p.billed_total_minor)],['Settlement','Selected months will be marked paid in full']]:[]),
   ['Adjustment',p.adjustment_reason],['Email PDF',p.email_requested?c.email:'No']];
  return `<div class="fw-review-amount">${esc(money(p.amount_minor))}</div><p class="fw-review-customer">${esc(c.name)}</p><dl class="fw-review-grid">${rows.filter(([,value])=>value).map(([label,value])=>`<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl>`;
 }
 async function review(){
  get('manualPreview').disabled=true;status('manualReceiptStatus','Preparing review…');
  try{
   const selected=selectedBills(),input={id:requestId,customer_id:get('manualCustomer').value,customer_version:customers.find(c=>c.id===get('manualCustomer').value)?.updated_at||'',amount:get('manualAmount').value,payment_date:get('manualDate').value,payment_method:get('manualMethod').value,payment_reference:get('manualReference').value,description:get('manualDescription').value,adjustment_reason:get('manualAdjustmentGroup').hidden?'':get('manualAdjustment').value,billing_ids:selected.map(b=>b.id),billed_total_minor:selected.length?selected.reduce((s,b)=>s+Math.round(Number(b.total)*100),0):null,email_requested:get('manualEmail').checked};
   input.payment_details=get('manualMethod').value==='check'?{bank_code:get('manualCheckBank').value,branch:get('manualCheckBranch').value,account:get('manualCheckAccount').value,check_number:get('manualCheckNumber').value,check_date:get('manualCheckDate').value}:{};
   const r=await call('business-receipts',{action:'preview',...input});if(r.already_claimed)throw Error('This request already has a receipt or needs review. Check the receipt history.');
   preview=input;get('manualReceiptForm').hidden=true;const p=r.preview;
   get('manualReceiptReview').innerHTML=`<h3>Review receipt · קבלה</h3>${receiptReviewDetails(p)}<label class="fw-check"><input type="checkbox" id="receiptReceived"> I confirm this ${p.payment_method==='check'?'check':'payment'} has already been received${p.bills.length?' and fully settles the selected months':''}.</label><label class="fw-check"><input type="checkbox" id="receiptNoPrior"> No official receipt has already been issued for this payment.</label><div class="fw-actions"><button class="btn btn-outline" id="receiptEditPreview">Edit</button><button class="btn btn-green" id="receiptIssueOfficial">Issue official receipt</button></div>`;
   get('receiptEditPreview').onclick=()=>{get('manualReceiptReview').innerHTML='';get('manualReceiptForm').hidden=false;preview=null;};get('receiptIssueOfficial').onclick=issue;
   status('manualReceiptStatus','');
  }catch(e){status('manualReceiptStatus',e.message);}finally{get('manualPreview').disabled=false;}
 }
 async function issue(){
  if(!get('receiptReceived').checked||!get('receiptNoPrior').checked){status('manualReceiptStatus','Confirm payment received and no existing receipt first.');return;}
  get('receiptIssueOfficial').disabled=true;get('receiptEditPreview').disabled=true;status('manualReceiptStatus','Issuing official receipt… Do not submit another request.');
  try{
   const r=await call('business-receipts',{action:'issue',...preview,payment_received:true,not_already_receipted:true});
   if(r.receipt?.status!=='issued')throw Error('Issuance is pending or needs review. Do not issue again; check receipt history.');
   const receipt=r.receipt,c=receipt.customer_snapshot,settledMonths=preview?.billing_ids?.length||0;requestId=crypto.randomUUID();preview=null;
   get('manualReceiptReview').innerHTML=`<h3>Receipt issued · ${esc(money(receipt.amount_minor))}</h3><p class="fw-note">${settledMonths?settledMonths+' month'+(settledMonths===1?'':'s')+' marked paid. ':'Saved in FinBot. '}${receipt.email_sent_at?'PDF email accepted for delivery to '+esc(c.email):receipt.email_requested?'Email pending; use Retry email in the receipt history.':'No email requested.'}</p><div class="fw-actions"><button class="btn btn-outline" id="issuedReceiptOpen">Open official PDF</button><button class="btn btn-outline" id="issuedReceiptShare">Prepare WhatsApp PDF</button><button class="btn btn-outline" id="issuedReceiptNew">New receipt</button></div>`;
   get('issuedReceiptOpen').onclick=()=>openReceipt('business',receipt.id);get('issuedReceiptShare').onclick=()=>prepareReceiptShare(receipt,'issuedReceiptShare');get('issuedReceiptNew').onclick=()=>{get('manualReceiptReview').innerHTML='';get('manualReceiptForm').hidden=false;get('manualAmount').value='';get('manualAdjustment').value='';get('manualReference').value='';loadCustomerBills();};
   status('manualReceiptStatus','');await loadFinance();
  }catch(e){status('manualReceiptStatus',e.message+' Check the receipt history before starting another request.');}
 }
 async function openReceipt(kind,id){try{const r=await call(kind==='order'?'finbot-receipts':'business-receipts',{action:'pdf',...(kind==='order'?{order_id:id}:{id})});root.open(r.url,'_blank','noopener');}catch(e){status('financeStatus',e.message);}}
 async function prepareReceiptShare(receipt,buttonId){
  const button=get(buttonId);button.disabled=true;
  try{const r=await call('business-receipts',{action:'pdf',id:receipt.id}),response=await fetch(r.url);if(!response.ok)throw Error('PDF unavailable');const file=new File([await response.blob()],`Gremier-receipt-${receipt.id.slice(0,8)}.pdf`,{type:'application/pdf'});preparedReceipt={file,receipt};button.disabled=false;button.textContent='Share official PDF';button.onclick=async()=>{try{if(navigator.canShare?.({files:[file]}))await navigator.share({files:[file],title:'Gremier receipt'});else{download(file,file.name);root.open('https://wa.me/'+phone(receipt.customer_snapshot.phone)+'?text='+encodeURIComponent('Gremier Coffee · קבלה · '+money(receipt.amount_minor)),'_blank','noopener');status('financeStatus','PDF downloaded. Attach it in the opened WhatsApp chat.');}}catch(e){if(e.name!=='AbortError')status('financeStatus','Could not share. Use Open PDF to download it.');}};}catch(e){button.disabled=false;status('financeStatus',e.message);}
 }
 function phone(raw){let n=String(raw||'').replace(/\D/g,'');if(n.startsWith('0'))n='972'+n.slice(1);return n;}
 function renderReceipts(){
  const q=get('financeReceiptSearch').value.toLowerCase(),year=get('financeReceiptYear').value;
  const filtered=allReceipts.filter(r=>(r.payment_date||'').startsWith(year)&&(r.name+' '+r.reference).toLowerCase().includes(q)).sort((a,b)=>(b.payment_date||'').localeCompare(a.payment_date||''));
  const issued=filtered.filter(r=>['issued','external'].includes(r.status));status('financeReceiptTotal',`${issued.length} issued / linked receipts · ${money(issued.reduce((s,r)=>s+Number(r.amount_minor),0))} received by payment date. Pending/review items are excluded.`);
  get('financeReceiptList').innerHTML=`<table><thead><tr><th>Customer / reference</th><th>Payment date</th><th>Received</th><th>Method / status</th><th>Documents</th></tr></thead><tbody>${filtered.map(r=>`<tr><td>${esc(r.name)}<small>${esc(r.reference)}</small></td><td>${esc(r.payment_date)}</td><td>${esc(money(Number(r.amount_minor)))}</td><td>${esc(r.payment_method||'Online card')} · ${esc(r.status)}${r.error_code?'<small>'+esc(r.error_code)+'</small>':''}${r.email_error?'<small>Email pending</small>':''}</td><td>${r.status==='issued'?`<button class="btn btn-outline btn-sm" data-open-receipt="${esc(r.id)}" data-kind="${r.kind}">Open PDF</button>${r.kind==='business'?`<button class="btn btn-outline btn-sm" data-share-receipt="${esc(r.id)}" id="share-${esc(r.id)}">Prepare WhatsApp PDF</button>${r.email_requested&&!r.email_sent_at?`<button class="btn btn-outline btn-sm" data-email-receipt="${esc(r.id)}">Retry email</button>`:''}`:''}`:''}</td></tr>`).join('')||'<tr><td colspan="5">No receipts in this view.</td></tr>'}</tbody></table>`;
  get('financeReceiptList').querySelectorAll('[data-open-receipt]').forEach(b=>b.onclick=()=>openReceipt(b.dataset.kind,b.dataset.openReceipt));
  get('financeReceiptList').querySelectorAll('[data-share-receipt]').forEach(b=>b.onclick=()=>prepareReceiptShare(allReceipts.find(r=>r.id===b.dataset.shareReceipt),b.id));
  get('financeReceiptList').querySelectorAll('[data-email-receipt]').forEach(b=>b.onclick=async()=>{b.disabled=true;try{await call('business-receipts',{action:'retry_email',id:b.dataset.emailReceipt});await loadFinance();}catch(e){status('financeStatus',e.message);b.disabled=false;}});
 }
 function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);}
 function setupExpenses(){
  get('tab-expenses').innerHTML=`<header class="page-header"><div class="flex-between"><div><h1 class="page-title">Expense inbox</h1><p class="page-sub">Collect receipts and file batches</p></div><span data-action-menu="Expense tools"><button class="btn btn-outline" id="expenseReload">Refresh</button></span></div></header><p class="fw-note" role="status" id="expenseStatus"></p>
   <section class="fw-panel"><h2>Add expenses</h2><p>Forward attachments to <strong>gremiercoffee+expenses@gmail.com</strong></p><p class="fw-note" id="expenseEmailState">Checking email intake…</p><div class="fw-form"><label>Upload photos or PDFs<input type="file" id="expenseUpload" class="form-input" accept="application/pdf,image/jpeg,image/png,image/webp" multiple></label><label>Take a receipt photo<input type="file" id="expenseCamera" class="form-input" accept="image/*" capture="environment"></label><label>Notify / batch size<select class="form-input" id="expenseBatchSize"><option>5</option><option>10</option><option>15</option><option>20</option></select></label></div><details class="fw-help"><summary>Formats & email intake</summary><p class="fw-note">PDF, JPG, PNG or WebP · up to 20 MB. Originals stay private. Email is checked about every five minutes.</p></details></section>
   <section class="fw-panel"><div class="flex-between"><h2 id="expenseQueueTitle">Waiting to file</h2><button class="btn btn-outline" id="expensePrepare">Prepare selected batch</button></div><details class="fw-help"><summary>How batches work</summary><p class="fw-note">Each document counts once toward the batch size. Every PDF page becomes an image. Smaller batches work best for long PDFs.</p></details><div id="expenseQueue"></div><div id="expensePrepared"></div></section><section class="fw-panel"><details><summary>Filed / archived history</summary><div id="expenseHistory"></div></details></section>`;
  get('expenseReload').onclick=loadExpenses;get('expensePrepare').onclick=prepareBatch;
  for(const id of ['expenseUpload','expenseCamera'])get(id).onchange=async()=>{const files=[...get(id).files];get(id).disabled=true;try{for(let i=0;i<files.length;i++){status('expenseStatus',`Uploading ${i+1} of ${files.length}…`);let file=files[i];if(id==='expenseCamera'&&!['image/jpeg','image/png','image/webp'].includes(file.type)){try{const bitmap=await createImageBitmap(file),canvas=document.createElement('canvas'),scale=Math.min(1,2400/bitmap.width,5000/bitmap.height);canvas.width=Math.ceil(bitmap.width*scale);canvas.height=Math.ceil(bitmap.height*scale);const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();file=new File([await jpeg(canvas)],'receipt-photo.jpg',{type:'image/jpeg'});canvas.width=canvas.height=1;}catch{throw Error('This camera format could not be converted. Upload a JPG, PNG or PDF instead.');}}const form=new FormData();form.append('file',file);await call('expense-inbox',form);}get(id).value='';await loadExpenses();status('expenseStatus','Documents saved to the private inbox.');}catch(e){status('expenseStatus',e.message);}finally{get(id).disabled=false;}};
  get('expenseBatchSize').onchange=async()=>{try{await call('expense-inbox',{action:'settings',batch_size:Number(get('expenseBatchSize').value)});await loadExpenses();}catch(e){status('expenseStatus',e.message);}};
 }
 async function loadExpenses(){
  setup();const token=++expenseSeq;status('expenseStatus','Loading expense inbox…');
  try{
   const [files,settings]=await Promise.all([pages('expense_inbox_files','id,original_name,mime_type,size_bytes,source,status,created_at,filed_at,batch_id','created_at'),sbc().from('expense_inbox_settings').select('*').eq('id',1).single()]);
   if(token!==expenseSeq)return;if(settings.error)throw Error('Expense settings unavailable');expenseFiles=files;expenseSettings=settings.data;get('expenseBatchSize').value=expenseSettings.batch_size;
   const pending=files.filter(f=>f.status==='pending');get('expenseQueueTitle').textContent=`Waiting to file · ${pending.length} documents`;
   get('expenseQueue').innerHTML=pending.map((f,i)=>`<div class="fw-expense-row"><label class="fw-check"><input type="checkbox" class="expense-select" value="${esc(f.id)}" ${i<expenseSettings.batch_size?'checked':''}> ${esc(f.original_name)}<small>${esc(f.source)} · ${esc(f.created_at.slice(0,10))} · ${(f.size_bytes/1024).toFixed(0)} KB</small></label><div><button class="btn btn-outline btn-sm" data-expense-open="${esc(f.id)}">Original</button><button class="btn btn-outline btn-sm" data-expense-archive="${esc(f.id)}">Archive</button></div></div>`).join('')||'<p class="fw-note">No documents waiting to file.</p>';
   get('expenseHistory').innerHTML=files.filter(f=>f.status!=='pending').reverse().map(f=>`<p class="fw-note">${esc(f.original_name)} · ${esc(f.status)} · ${esc((f.filed_at||f.created_at).slice(0,10))}</p>`).join('')||'<p class="fw-note">Nothing filed yet.</p>';
   get('expenseQueue').querySelectorAll('[data-expense-open]').forEach(b=>b.onclick=async()=>{try{const r=await call('expense-inbox',{action:'original',id:b.dataset.expenseOpen});root.open(r.url,'_blank','noopener');}catch(e){status('expenseStatus',e.message);}});
   get('expenseQueue').querySelectorAll('[data-expense-archive]').forEach(b=>b.onclick=async()=>{try{await call('expense-inbox',{action:'archive',ids:[b.dataset.expenseArchive]});await loadExpenses();}catch(e){status('expenseStatus',e.message);}});
   status('expenseEmailState',expenseSettings.email_last_checked_at?'Email last checked: '+new Date(expenseSettings.email_last_checked_at).toLocaleString()+(expenseSettings.email_error_count?' · '+expenseSettings.email_error_count+' messages need review in Gmail / script execution logs.':' · Connected')+(Date.now()-new Date(expenseSettings.email_last_checked_at).getTime()>20*60*1000?' · Check is overdue; review the Google trigger.':''):expenseSettings.email_last_received_at?'Last email attachment received: '+new Date(expenseSettings.email_last_received_at).toLocaleString():'Email connection is awaiting verification. Complete the one-time Google authorization if you have not done so.');
   status('expenseStatus',pending.length>=expenseSettings.batch_size?`You have ${pending.length} expenses to file. Prepare a batch when ready.`:`${pending.length} waiting · notification threshold ${expenseSettings.batch_size}`);
  }catch(e){status('expenseStatus',e.message);}
 }
 let pdfLibrary=null,zipPromise=null;
 async function pdfjs(){if(!pdfLibrary){pdfLibrary=await import('/vendor/pdfjs-6.4.299/build/pdf.mjs');pdfLibrary.GlobalWorkerOptions.workerSrc='/vendor/pdfjs-6.4.299/build/pdf.worker.mjs';}return pdfLibrary;}
 function zipjs(){if(root.JSZip)return Promise.resolve(root.JSZip);if(!zipPromise)zipPromise=new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='/vendor/jszip-3.10.2/dist/jszip.min.js';s.onload=()=>resolve(root.JSZip);s.onerror=()=>{zipPromise=null;reject(Error('ZIP export unavailable'));};document.head.append(s);});return zipPromise;}
 const jpeg=canvas=>new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('Image conversion failed')),'image/jpeg',0.9));
 async function prepareBatch(){
  const ids=[...document.querySelectorAll('.expense-select:checked')].map(i=>i.value),selected=expenseFiles.filter(f=>ids.includes(f.id));
  if(!selected.length||selected.length>20){status('expenseStatus','Select 1–20 documents.');return;}
  batch=null;get('expensePrepared').innerHTML='';get('expensePrepare').disabled=true;
  try{
   const files=[];
   for(let i=0;i<selected.length;i++){
    status('expenseStatus',`Preparing document ${i+1} of ${selected.length}…`);
    const item=selected[i],r=await call('expense-inbox',{action:'original',id:item.id}),response=await fetch(r.url);if(!response.ok)throw Error('Original unavailable');const blob=await response.blob();
    if(item.mime_type==='application/pdf'){
     const lib=await pdfjs(),task=lib.getDocument({data:new Uint8Array(await blob.arrayBuffer()),isEvalSupported:false,cMapUrl:'/vendor/pdfjs-6.4.299/cmaps/',cMapPacked:true,standardFontDataUrl:'/vendor/pdfjs-6.4.299/standard_fonts/',wasmUrl:'/vendor/pdfjs-6.4.299/wasm/'}),doc=await task.promise;
     try{if(doc.numPages+files.length>60)throw Error('This batch exceeds 60 pages. Select fewer documents.');for(let page=1;page<=doc.numPages;page++){
      const p=await doc.getPage(page),base=p.getViewport({scale:1}),viewport=p.getViewport({scale:Math.min(2,1800/base.width,5000/base.height)}),canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
      await p.render({canvasContext:canvas.getContext('2d'),canvas,viewport,background:'white'}).promise;files.push(new File([await jpeg(canvas)],`expense-${String(i+1).padStart(2,'0')}-page-${String(page).padStart(2,'0')}.jpg`,{type:'image/jpeg'}));canvas.width=canvas.height=1;p.cleanup();
     }}finally{await task.destroy();}
    }else{
     const image=await createImageBitmap(blob),scale=Math.min(1,2000/image.width,5000/image.height),canvas=document.createElement('canvas');canvas.width=Math.ceil(image.width*scale);canvas.height=Math.ceil(image.height*scale);const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,0,canvas.width,canvas.height);image.close();files.push(new File([await jpeg(canvas)],`expense-${String(i+1).padStart(2,'0')}.jpg`,{type:'image/jpeg'}));canvas.width=canvas.height=1;
    }
   }
   batch={ids,files};get('expensePrepared').innerHTML=`<h3>Ready · ${selected.length} documents / ${files.length} images</h3><p class="fw-note">Review the images before filing. Sharing opens your device’s share panel; WhatsApp chat opens ${esc(expenseSettings.whatsapp_number)}. Desktop browsers may require attaching the downloaded images manually.</p><div class="fw-actions"><button class="btn btn-green" id="expenseShare">Send now · share images</button><span data-action-menu="Batch download and WhatsApp"><button class="btn btn-outline" id="expenseZip">Download batch ZIP</button><button class="btn btn-outline" id="expenseWhatsApp">Open filing WhatsApp</button></span><button class="btn btn-outline" id="expenseFiled">I filed this batch</button></div><div id="expenseImageReview" class="fw-image-review"></div>`;
   files.forEach(f=>{const button=document.createElement('button'),img=document.createElement('img'),url=URL.createObjectURL(f);button.type='button';button.className='fw-preview-image';button.title='Open full-size page';img.src=url;img.alt=f.name;img.loading='lazy';img.decoding='async';img.onload=()=>URL.revokeObjectURL(url);button.append(img);button.onclick=()=>{const full=URL.createObjectURL(f);root.open(full,'_blank','noopener');setTimeout(()=>URL.revokeObjectURL(full),60000);};get('expenseImageReview').append(button);});
   get('expenseShare').onclick=async()=>{try{if(navigator.canShare?.({files}))await navigator.share({files,title:'Gremier expense documents'});else{status('expenseStatus','File sharing is unavailable here. Download the ZIP, extract the images and attach them in WhatsApp.');get('expenseZip').click();}}catch(e){if(e.name!=='AbortError')status('expenseStatus','Sharing failed. Download the ZIP and attach its images manually.');}};
   get('expenseZip').onclick=async()=>{try{const Zip=await zipjs(),z=new Zip();files.forEach(f=>z.file(f.name,f));download(await z.generateAsync({type:'blob',compression:'STORE'}),'Gremier-expenses-'+today()+'.zip');}catch(e){status('expenseStatus',e.message);}};
   get('expenseWhatsApp').onclick=()=>root.open('https://wa.me/'+phone(expenseSettings.whatsapp_number),'_blank','noopener');
   get('expenseFiled').onclick=async()=>{get('expenseFiled').disabled=true;try{await call('expense-inbox',{action:'filed',ids});get('expensePrepared').innerHTML='';batch=null;await loadExpenses();status('expenseStatus','Batch marked filed. Original documents are retained.');}catch(e){get('expenseFiled').disabled=false;status('expenseStatus',e.message);}};
   status('expenseStatus','Batch ready. Sending or downloading does not mark it filed.');
  }catch(e){status('expenseStatus',e.message+' No documents were marked filed.');}finally{get('expensePrepare').disabled=false;}
 }
 const originalShow=root.showTab;
 if(originalShow)root.showTab=function(tab,...args){const result=originalShow.call(this,tab,...args);if(tab==='finance')loadFinance();if(tab==='expenses')loadExpenses();return result;};
 setup();
 const initialTab=({expenses:'expenses',receipts:'finance'})[new URLSearchParams(location.search).get('finance')];
 if(['finance','expenses'].includes(initialTab)){
  let restored=false;
  const restore=session=>{if(session&&!restored){restored=true;setTimeout(()=>root.showTab(initialTab),0);}};
  sbc()?.auth.getSession().then(({data})=>restore(data.session));
  sbc()?.auth.onAuthStateChange((event,session)=>{if(event==='SIGNED_IN')restore(session);});
 }
 root.GremierFinance={load:loadFinance,loadExpenses};
})(window);
