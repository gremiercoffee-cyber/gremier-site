/* Operational revenue classification. Reporting only; never changes official documents. */
(function(root){
 'use strict';
 const categories=['coffee_bar','coffee','stores','other','unclassified'];
 const empty=()=>Object.fromEntries(categories.map(k=>[k,0]));
 const minor=v=>Math.round(Number(v)*100);
 const ref=v=>String(v??'').trim().replace(/^0+(?=\d)/,'');
 const normalize=v=>String(v??'').normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]/gu,'');
 const eligible=o=>o.payment_status==='paid'&&!o.is_test&&!o.delivery_info?.is_test&&!/^TEST(?:\b|[_-])/i.test(o.customer_name||'')&&!['cancelled','refunded'].includes(o.status);
 const groupName=v=>/\b(?:synagogue|shul|yeshiva|kollel|organization|organisation|foundation|association|school|community|cent(?:er|re)|merk[ae]z|daf\s*(?:ha\s*)?yomi|ltd|inc)\b|בית\s*כנסת|ישיב[הת]|כולל|מרכז|דף\s*יומי|תורה\s*לכל\s*יהודי|עמות[הת]|מוסדות|קהיל[הת]|בית\s*ספר|תלמוד\s*תורה|בע["'׳״]{0,2}מ/i.test(String(v||''));
 const coffeeBarText=v=>/coffee[\s-]*bar|בר\s*קפה/i.test(String(v||''));
 function splitOrder(order,products=[],purpose){
  const total=minor(order.total);if(!Number.isSafeInteger(total)||total<0)throw Error('Invalid order amount');
  const out=empty(),weights=empty();let invalid=false;
  if(['coffee_bar','coffee','stores','other'].includes(purpose)){out[purpose]=total;return out;}
  const groupCustomer=groupName(order.customer_name);
  const event=order.delivery_info?.delivery_type==='event'||order.delivery_info?.is_coffee_bar;
  for(const item of order.items||[]){
   const p=products.find(p=>String(p.id)===String(item.product_id||item.id))||{};
   const text=[item.name_en,item.name_he,p.name_en,p.name_he].filter(Boolean).join(' ');
   const bulk=p.category==='bulk'||/jerry|\b5\s*(?:l\b|lit[er]+|ליטר)|ג.?ריקן/i.test(text);
   const coffee=['bottles','minis','bulk','subscriptions'].includes(p.category)||/coffee|bottle|mini|cremier|liter|litre|קפה|בקבוק|קרמייר|ליטר/i.test(text);
   const key=item.is_coffee_bar||p.is_coffee_bar||p.category==='coffeebars'||item.meta?.service_type==='coffee_bar'||/coffee\s*bar|בר\s*קפה/i.test(text)?'coffee_bar':/gift.?card|כרטיס.*מתנה/i.test(text)?'other':coffee&&(groupCustomer||event)?'coffee_bar':bulk?'unclassified':coffee?'coffee':p.id?'other':'unclassified';
   const price=Number(item.price),qty=Number(item.qty??1);
   if(item.price==null||!Number.isFinite(price)||price<0||!Number.isFinite(qty)||qty<0){invalid=true;continue;}
   weights[key]+=price*qty;
  }
  const sum=Object.values(weights).reduce((s,n)=>s+n,0);
  if(invalid||!sum){out.unclassified=total;return out;}
  const parts=categories.filter(k=>weights[k]>0).map(k=>({k,raw:total*weights[k]/sum}));
  parts.forEach(p=>out[p.k]=Math.floor(p.raw));let remainder=total-Object.values(out).reduce((s,n)=>s+n,0);
  parts.sort((a,b)=>(b.raw-Math.floor(b.raw))-(a.raw-Math.floor(a.raw)));
  for(let i=0;i<remainder;i++)out[parts[i%parts.length].k]++;
  return out;
 }
 function online(orders,products,from,to,date,overrides=[]){const purposes=new Map(overrides.map(o=>[o.source_key,o.category])),totals=empty();(orders||[]).filter(o=>eligible(o)&&date(o.created_at)>=from&&date(o.created_at)<=to).forEach(o=>{const parts=splitOrder(o,products,purposes.get('order-purpose:'+o.id));categories.forEach(k=>totals[k]+=parts[k]);});return totals;}
 function receipts(data){
  const byNumber=new Map(data.orders.map(o=>[String(o.order_number),o])),byId=new Map(data.orders.map(o=>[String(o.id),o]));
  const webByRef=new Map(data.orderReceipts.filter(r=>r.document_reference).map(r=>[ref(r.document_reference),r]));
  const manualByRef=new Map(data.businessReceipts.filter(r=>r.document_reference).map(r=>[ref(r.document_reference),r]));
  const aliases=new Map();data.stores.forEach(s=>aliases.set(normalize(s.name),s.id));data.customers.filter(c=>c.store_id).forEach(c=>aliases.set(normalize(c.name),c.store_id));
  // These transliterations appear in the imported ledger; retain the store exclusion.
  const translated={'goodstore':['גוד סטור'],'birkatsanhedriya':['ברכת סנהדרייה','חסן מאיר ברכת סנהדרייה'],'minimachaneyehudarbs':['מיני מחניודה']};
  data.stores.forEach(s=>(translated[normalize(s.name)]||[]).forEach(name=>aliases.set(normalize(name),s.id)));
  const overrides=new Map(data.overrides.map(o=>[o.source_key,o.category])),seen=new Set(),seenOrders=new Set(),rows=[];
  function add(r){
   if(seen.has(r.key)||(r.order?.id&&seenOrders.has(String(r.order.id))))return;seen.add(r.key);if(r.order?.id)seenOrders.add(String(r.order.id));
   if(!Number.isSafeInteger(r.amount_minor))throw Error('Invalid receipt amount');
   let parts=empty(),basis='',estimated=false;
   if(overrides.has(r.key)){parts[overrides.get(r.key)]=r.amount_minor;basis='Reviewed';}
   else if(r.store_id||aliases.has(normalize(r.name))){parts.stores=r.amount_minor;basis='Store match';}
   else if(/מינימרקט|סופר\s*ציפר|פרי\s*וירק/.test(r.name)){parts.stores=r.amount_minor;basis='Retail customer';}
   else if(r.order){const purpose=overrides.get('order-purpose:'+r.order.id);parts=splitOrder({...r.order,total:Math.abs(r.amount_minor)/100},data.products,purpose);if(r.amount_minor<0)categories.forEach(k=>parts[k]*=-1);basis=purpose?'Reviewed order purpose':'Online order details';}
   else if(r.website_order_number!=null){parts.unclassified=r.amount_minor;basis='Online order unavailable';}
   else if(coffeeBarText(r.name)||coffeeBarText(r.description)){parts.coffee_bar=r.amount_minor;basis='Coffee bar';}
   else if(groupName(r.name)){parts.coffee_bar=r.amount_minor;basis='Organization / group';}
   else if(r.amount_minor>30000){parts.coffee_bar=r.amount_minor;basis='Over ₪300 rule';estimated=true;}
   else {parts.coffee=r.amount_minor;basis='Up to ₪300 rule · review';}
   rows.push({...r,parts,basis,estimated});
  }
  data.imported.forEach(r=>{
   const id=ref(r.document_reference),w=webByRef.get(id),b=manualByRef.get(id);
   add({key:'finbot:'+id,reference:r.document_reference,name:r.customer_name,description:b?.description||r.description||'',date:w?.payment_date||b?.payment_date||r.document_date,amount_minor:w?.amount_minor??b?.amount_minor??Number(r.amount_minor),store_id:b?.store_id,order:w?byId.get(String(w.order_id)):byNumber.get(String(r.website_order_number)),website_order_number:r.website_order_number??(w?'missing':null),imported:true});
  });
  data.orderReceipts.filter(r=>['issued','external'].includes(r.status)&&!r.is_test).forEach(r=>add({key:r.document_reference?'finbot:'+ref(r.document_reference):'order:'+r.order_id,reference:r.document_reference||'',name:byId.get(String(r.order_id))?.customer_name||'Online order',date:r.payment_date,amount_minor:Number(r.amount_minor),order:byId.get(String(r.order_id)),website_order_number:byId.get(String(r.order_id))?.order_number??'missing'}));
  data.businessReceipts.filter(r=>r.status==='issued').forEach(r=>add({key:r.document_reference?'finbot:'+ref(r.document_reference):'business:'+r.id,reference:r.document_reference||'',name:r.customer_snapshot?.name||'',description:r.description||'',date:r.payment_date,amount_minor:Number(r.amount_minor),store_id:r.store_id}));
  return rows;
 }
 function income(data,from,to,businessDate){
  const documents=receipts(data),coveredIds=new Set(),coveredNumbers=new Set();
  // Match across all dates before filtering: an order and its receipt are one payment.
  documents.forEach(r=>{if(r.order?.id)coveredIds.add(String(r.order.id));if(r.website_order_number!=null)coveredNumbers.add(String(r.website_order_number));});
  const rows=documents.map(r=>({...r,origin:r.order||r.website_order_number!=null?'online':'direct'}));
  const overrides=new Map(data.overrides.map(o=>[o.source_key,o.category]));
  data.orders.filter(o=>eligible(o)&&o.payment_method!=='gift_card').forEach(o=>{
   if(coveredIds.has(String(o.id))||(o.order_number!=null&&coveredNumbers.has(String(o.order_number))))return;
   rows.push({key:'order-purpose:'+o.id,order:o,name:o.customer_name,date:businessDate(o.created_at),amount_minor:minor(o.total),parts:splitOrder(o,data.products,overrides.get('order-purpose:'+o.id)),origin:'online',basis:'Paid online order'});
  });
  const selected=rows.filter(r=>r.date>=from&&r.date<=to),totals=empty(),origins={online:empty(),direct:empty()};
  selected.forEach(r=>categories.forEach(k=>{totals[k]+=r.parts[k];origins[r.origin][k]+=r.parts[k];}));
  return {rows:selected,totals,origins,total_minor:Object.values(totals).reduce((sum,n)=>sum+n,0)};
 }
 function channels(report){
  const stores=report.totals.stores,rest=report.total_minor-stores;
  const online=Object.entries(report.origins.online).reduce((sum,[key,n])=>sum+(key==='stores'?0:n),0);
  return {stores,rest,online,other:rest-online};
 }
 const needsReview=row=>Boolean(row.parts?.unclassified||row.estimated||/review/i.test(row.basis||'')&&!/^Reviewed/.test(row.basis));
 function reconcile(report,snapshotIncome){
  const sum=rows=>rows.reduce((n,r)=>n+r.amount_minor,0);
  const imported=sum(report.rows.filter(r=>r.imported));
  const newReceipts=sum(report.rows.filter(r=>!r.imported&&!r.key.startsWith('order-purpose:')));
  const unreceipted=sum(report.rows.filter(r=>r.key.startsWith('order-purpose:')));
  return {snapshot:snapshotIncome,importAdjustments:imported-snapshotIncome,newReceipts,unreceipted,total:report.total_minor};
 }
 const api={reconcile,splitOrder,online,receipts,income,channels,normalize,ref,needsReview};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
 if(!root.document)return;root.GremierRevenue=api;
 const get=id=>document.getElementById(id),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const money=n=>new Intl.NumberFormat('en-IL',{style:'currency',currency:'ILS',maximumFractionDigits:0}).format(n/100);
 const date=v=>root.GremierDashboard.businessDate(v);
 const labels={coffee_bar:'Events',coffee:'Personal orders',stores:'Store sales',other:'Other',unclassified:'Needs review'};
 const client=()=>typeof sb!=='undefined'?sb:root.MAIN_SB||root.ADMIN_SB;
 let loaded=null,serial=0,reviewMode='pending';
 api.annualReport=year=>loaded?income(loaded,year+'-01-01',[year+'-12-31',date(new Date())].sort()[0],date):null;
 const totalsHtml=totals=>['stores','coffee','coffee_bar',...['other','unclassified'].filter(k=>totals[k])].map(k=>`<div class="fin-row"><span>${labels[k]}</span><strong>${money(totals[k])}</strong></div>`).join('');
 api.dashboardOnline=(orders,r,purposes=[],storeValue=null)=>{
  const host=get('dashOnlineRevenue');if(!host)return;
  try {
   const products=typeof allProducts!=='undefined'?allProducts:[],totals=online(orders,products,r.start,r.today,date,purposes);
   if(storeValue!==null)totals.stores+=minor(storeValue);
   const pending=orders.filter(o=>eligible(o)&&date(o.created_at)>=r.start&&date(o.created_at)<=r.today&&needsReview({parts:splitOrder(o,products,purposes.find(p=>p.source_key==='order-purpose:'+o.id)?.category)}));
   const open=get('dashPurposeReview')?.open;
   host.innerHTML='<h2>Sales by purpose</h2>'+totalsHtml({...totals,unclassified:0})+(pending.length?`<details id="dashPurposeReview" class="dash-review" ${open?'open':''}><summary><span>Needs review · ${pending.length}</span><strong>${money(totals.unclassified)}</strong></summary><p class="sales-note">Orders awaiting a sales category.</p><div role="status" id="dashPurposeStatus" class="dash-review-error"></div>${pending.map(o=>`<div class="dash-review-order"><div><strong>#${esc(o.order_number)} · ${esc(o.customer_name)}</strong><small>${esc((o.items||[]).map(i=>`${i.qty??1} × ${i.name_en||i.name_he||'Item'}`).join(', '))}</small></div><strong>${money(minor(o.total))}</strong><label>Category<select class="form-input" aria-label="Category for order ${esc(o.order_number)}" data-dashboard-purpose="${esc(o.id)}"><option value="" selected disabled>Choose category</option>${['coffee','coffee_bar','stores','other'].map(k=>`<option value="${k}">${labels[k]}</option>`).join('')}</select></label></div>`).join('')}</details>`:'')+(storeValue===null?'<p class="sales-note">Store totals unavailable.</p>':'');
   host.querySelectorAll('[data-dashboard-purpose]').forEach(select=>select.onchange=async()=>{
    select.disabled=true;
    try {
     const source_key='order-purpose:'+select.dataset.dashboardPurpose;
     const result=await client().from('revenue_classification_overrides').upsert({source_key,category:select.value,updated_at:new Date().toISOString()});
     if(result.error)throw result.error;
     const previous=purposes.findIndex(p=>p.source_key===source_key);if(previous>=0)purposes.splice(previous,1);
     purposes.push({source_key,category:select.value});
     root.GremierDashboard?.clearCache?.();
     api.dashboardOnline(orders,r,purposes,storeValue);
    } catch {get('dashPurposeStatus').textContent='Category was not saved. Try again.';select.disabled=false;}
   });
  } catch {host.innerHTML='<h2>Sales by purpose</h2><p>Activity breakdown unavailable.</p>';}
 };
 function setup(){
  const host=get('tab-reports');if(!host||get('revenueExplorer'))return;
  const section=document.createElement('section');section.id='revenueExplorer';section.className='sales-panel';
  const now=date(new Date()),year=now.slice(0,4);
  section.innerHTML=`<div class="sales-heading"><h2>Revenue by purpose</h2><span data-action-menu="Revenue tools"><button class="btn btn-outline" id="revenueRefresh">Refresh</button></span></div><div class="sales-controls"><label>Period<select class="form-input" id="revenueScope"><option value="year">Whole year</option><option value="month">Specific month</option></select></label><label id="revenueYearLabel">Year<input class="form-input" type="number" id="revenueYear" min="2020" max="2100" value="${year}"></label><label id="revenueMonthLabel" hidden>Month<input class="form-input" type="month" id="revenueMonth" value="${now.slice(0,7)}"></label></div><p id="revenueStatus" class="sales-note" role="status"></p><div id="revenueResults"></div><details class="sales-help"><summary>Classification details</summary><p>Store sales, personal orders and events are separate categories. Paid online orders and official receipts are combined once: a linked receipt replaces its order in this total and keeps its online origin. Receipts use payment dates when available, otherwise document dates; paid orders without receipts use order dates. Store income here is payments received, not unpaid delivery value. Everything else includes online and other non-store payments. Activity counts use order and delivery dates; a store receipt may cover multiple deliveries. Online orders use their items and customer context, never the ₪300 rule. Organizations and coffee bars count as events; personal or unclear non-online receipts use the provisional amount rule and stay reviewable. Your corrections take priority. FinBot imports remain dated snapshots.</p></details>`;
  host.querySelector('#salesExplorer')?.after(section);if(!section.parentNode)host.append(section);
  get('revenueScope').onchange=()=>{const month=get('revenueScope').value==='month';get('revenueMonthLabel').hidden=!month;get('revenueYearLabel').hidden=month;load();};
  get('revenueYear').onchange=load;get('revenueMonth').onchange=load;get('revenueRefresh').onclick=load;
 }
 function scope(){const y=get('revenueScope').value==='month'?get('revenueMonth').value.slice(0,4):get('revenueYear').value;if(!/^20\d{2}$/.test(y))throw Error('Choose a valid year.');const m=get('revenueScope').value==='month'?get('revenueMonth').value:null;return {year:y,...(m?root.GremierSales.monthRange(m):{from:y+'-01-01',to:y+'-12-31'})};}
 async function pages(table,columns){const out=[];for(let n=0;n<100000;n+=1000){const r=await client().from(table).select(columns).order(table==='order_receipts'?'order_id':table==='finbot_income_sources'?'document_reference':table==='revenue_classification_overrides'?'source_key':'id').range(n,n+999);if(r.error||!Array.isArray(r.data))throw Error('Could not load '+table);out.push(...r.data);if(r.data.length<1000)return out;}throw Error('Reporting limit reached');}
 async function load(){setup();const seq=++serial;get('revenueStatus').textContent='Loading revenue…';try{
  const tables=[['orders','id,order_number,created_at,total,customer_name,items,status,payment_status,payment_method,delivery_info'],['products','id,name_en,name_he,category,is_coffee_bar'],['stores','id,name'],['receipt_customers','id,name,store_id'],['order_receipts','order_id,status,amount_minor,payment_date,document_reference,is_test'],['business_receipts','id,status,store_id,customer_snapshot,description,amount_minor,payment_date,document_reference'],['finbot_income_sources','document_reference,document_date,amount_minor,customer_name,website_order_number'],['revenue_classification_overrides','source_key,category']];
  const results=await Promise.all([...tables.map(([t,c])=>pages(t,c)),pages('store_deliveries','id,delivery_date').catch(()=>null)]);if(seq!==serial)return;
  loaded=Object.fromEntries(['orders','products','stores','customers','orderReceipts','businessReceipts','imported','overrides','deliveries'].map((k,i)=>[k,results[i]]));render();root.dispatchEvent(new Event('gremier-revenue-ready'));
 }catch(e){if(seq!==serial)return;get('revenueStatus').textContent=e.message;get('revenueResults').innerHTML='';loaded=null;root.dispatchEvent(new Event('gremier-revenue-ready'));}}
 function render(){
  const r=scope(),combined=income(loaded,r.from,r.to,date),channel=channels(combined),rows=receipts(loaded).filter(x=>x.date>=r.from&&x.date<=r.to);
  const orders=loaded.orders.filter(o=>eligible(o)&&date(o.created_at)>=r.from&&date(o.created_at)<=r.to).sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)));
  const reviewOrders=orders.filter(o=>reviewMode==='all'||needsReview({parts:splitOrder(o,loaded.products,loaded.overrides.find(x=>x.source_key==='order-purpose:'+o.id)?.category)}));
  const reviewRows=rows.filter(x=>reviewMode==='all'||needsReview(x)).sort((a,b)=>b.date.localeCompare(a.date));
  const orderOpen=get('revenueOrderReview')?.open,receiptOpen=get('revenueReceiptReview')?.open;
  get('revenueResults').innerHTML=`<section class="fin-panel" id="incomeBreakdown"><h2>Sales channels</h2><div class="fin-row"><span>Stores</span><strong>${money(channel.stores)}</strong></div><div class="fin-row"><span>Everything else<small class="sales-note" style="display:block;margin:6px 0 0">Online ${money(channel.online)} · Other ${money(channel.other)}</small></span><strong>${money(channel.rest)}</strong></div><div class="fin-row"><strong>Total income</strong><strong>${money(combined.total_minor)}</strong></div><div class="fin-row"><span>Paid online orders</span><strong>${orders.length}</strong></div><div class="fin-row"><span>Store deliveries</span><strong>${loaded.deliveries===null?'Unavailable':loaded.deliveries.filter(d=>date(d.delivery_date)>=r.from&&date(d.delivery_date)<=r.to).length}</strong></div><details class="sales-help"><summary>Personal orders &amp; events</summary>${totalsHtml(combined.totals)}</details></section><div class="sales-controls"><label>Show<select class="form-input" id="revenueReviewMode"><option value="pending" ${reviewMode==='pending'?'selected':''}>Needs review</option><option value="all" ${reviewMode==='all'?'selected':''}>All entries</option></select></label></div><details id="revenueOrderReview" class="sales-help" ${orderOpen?'open':''}><summary>Online orders · ${reviewOrders.length}</summary>${reviewOrders.length?'':'<p>Nothing to review.</p>'}<div class="table-wrap sales-table revenue-review"><table><thead><tr><th>Order / customer</th><th>Amount</th><th>Purpose</th></tr></thead><tbody>${reviewOrders.map(o=>{const key='order-purpose:'+o.id,choice=loaded.overrides.find(x=>x.source_key===key)?.category,parts=splitOrder(o,loaded.products,choice);return `<tr><td class="review-customer">#${esc(o.order_number)}<small>${esc(o.customer_name)}</small><small>${esc((o.items||[]).map(item=>`${item.qty??1} × ${item.name_en||item.name_he||'Item'}`).join(', '))}</small></td><td class="review-amount">${money(minor(o.total))}</td><td class="review-purpose"><label class="review-mobile-label">Purpose</label><select aria-label="Purpose for order ${esc(o.order_number)}" class="form-input" data-order-purpose="${esc(o.id)}"><option value="auto">Automatic</option>${['coffee','coffee_bar','stores','other'].map(k=>`<option value="${k}" ${choice===k?'selected':''}>${labels[k]}</option>`).join('')}</select><small>${categories.filter(k=>parts[k]).map(k=>labels[k]).join(' + ')}</small></td></tr>`;}).join('')}</tbody></table></div></details><details id="revenueReceiptReview" class="sales-help" ${receiptOpen?'open':''}><summary>Receipts · ${reviewRows.length}</summary>${reviewRows.length?'':'<p>Nothing to review.</p>'}<div class="table-wrap sales-table revenue-review"><table><thead><tr><th>Customer / receipt</th><th>Date</th><th>Amount</th><th>Category</th><th>Basis</th></tr></thead><tbody>${reviewRows.map((x,i)=>`<tr><td class="review-customer">${esc(x.name)}<small>${esc(x.reference)}</small></td><td class="review-date">${esc(x.date)}</td><td class="review-amount">${money(x.amount_minor)}</td><td class="review-purpose"><label class="review-mobile-label">Category</label><select aria-label="Category for receipt ${esc(x.reference)}" class="form-input" data-revenue-row="${i}"><option value="auto">Automatic</option>${['coffee_bar','coffee','stores','other'].map(k=>`<option value="${k}" ${loaded.overrides.find(o=>o.source_key===x.key)?.category===k?'selected':''}>${labels[k]}</option>`).join('')}</select><small>${categories.filter(k=>x.parts[k]).map(k=>labels[k]).join(' + ')}</small></td><td class="review-basis">${esc(x.basis)}</td></tr>`).join('')}</tbody></table></div></details>`;
  get('revenueReviewMode').onchange=()=>{reviewMode=get('revenueReviewMode').value;render();};
  const imported=loaded.imported.filter(x=>x.document_date.startsWith(r.year+'-'));get('revenueStatus').textContent=imported.length?'FinBot import through '+imported.map(x=>x.document_date).sort().at(-1)+' · app receipts live':'App receipts only · no FinBot import for '+r.year;
  get('revenueResults').querySelectorAll('[data-order-purpose]').forEach(select=>select.onchange=()=>savePurpose(select,'order-purpose:'+select.dataset.orderPurpose));
  get('revenueResults').querySelectorAll('[data-revenue-row]').forEach(select=>select.onchange=async()=>{select.disabled=true;try{const key=reviewRows[Number(select.dataset.revenueRow)].key;const result=select.value==='auto'?await client().from('revenue_classification_overrides').delete().eq('source_key',key):await client().from('revenue_classification_overrides').upsert({source_key:key,category:select.value,updated_at:new Date().toISOString()});if(result.error)throw result.error;await load();}catch{get('revenueStatus').textContent='Category was not saved. Refresh and try again.';select.disabled=false;}});
 }
 async function savePurpose(select,key){select.disabled=true;try{const result=select.value==='auto'?await client().from('revenue_classification_overrides').delete().eq('source_key',key):await client().from('revenue_classification_overrides').upsert({source_key:key,category:select.value,updated_at:new Date().toISOString()});if(result.error)throw result.error;await load();}catch{get('revenueStatus').textContent='Purpose was not saved. Refresh and try again.';select.disabled=false;}}
 root.GremierDashboard?.refreshPurpose?.();
 const original=root.loadReports;root.loadReports=function(...args){const result=original?.apply(this,args);setup();load();return result;};
})(typeof window==='undefined'?globalThis:window);
