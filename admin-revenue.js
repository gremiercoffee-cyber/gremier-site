/* Operational revenue classification. Reporting only; never changes official documents. */
(function(root){
 'use strict';
 const categories=['coffee_bar','coffee','stores','other','unclassified'];
 const empty=()=>Object.fromEntries(categories.map(k=>[k,0]));
 const minor=v=>Math.round(Number(v)*100);
 const ref=v=>String(v??'').trim().replace(/^0+(?=\d)/,'');
 const normalize=v=>String(v??'').normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]/gu,'');
 const eligible=o=>o.payment_status==='paid'&&!o.is_test&&!o.delivery_info?.is_test&&!/^TEST(?:\b|[_-])/i.test(o.customer_name||'')&&!['cancelled','refunded'].includes(o.status);
 function splitOrder(order,products=[],purpose){
  const total=minor(order.total);if(!Number.isSafeInteger(total)||total<0)throw Error('Invalid order amount');
  const out=empty(),weights=empty();let invalid=false;
  if(['coffee_bar','coffee'].includes(purpose)){out[purpose]=total;return out;}
  const groupCustomer=/synagogue|\bshul\b|yeshiva|kollel|בית\s*כנסת|ישיב[הת]|כולל/.test(String(order.customer_name||'').toLowerCase());
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
  const overrides=new Map(data.overrides.map(o=>[o.source_key,o.category])),seen=new Set(),rows=[];
  function add(r){
   if(seen.has(r.key))return;seen.add(r.key);
   if(!Number.isSafeInteger(r.amount_minor))throw Error('Invalid receipt amount');
   let parts=empty(),basis='',estimated=false;
   if(overrides.has(r.key)){parts[overrides.get(r.key)]=r.amount_minor;basis='Reviewed';}
   else if(r.store_id||aliases.has(normalize(r.name))){parts.stores=r.amount_minor;basis='Store match';}
   else if(/מינימרקט|סופר\s*ציפר|פרי\s*וירק/.test(r.name)){parts.stores=r.amount_minor;basis='Retail customer · review';}
   else if(r.order){const purpose=overrides.get('order-purpose:'+r.order.id);parts=splitOrder({...r.order,total:Math.abs(r.amount_minor)/100},data.products,purpose);if(r.amount_minor<0)categories.forEach(k=>parts[k]*=-1);basis=purpose?'Reviewed order purpose':'Online order details';}
   else if(r.website_order_number!=null){parts.unclassified=r.amount_minor;basis='Online order unavailable';}
   else if(/synagogue|\bshul\b|yeshiva|kollel|בית\s*כנסת|ישיב[הת]|כולל/i.test(r.name)){parts.coffee_bar=r.amount_minor;basis='Group customer';}
   else if(r.amount_minor>30000){parts.coffee_bar=r.amount_minor;basis='Over ₪300 rule';estimated=true;}
   else {parts.other=r.amount_minor;basis='Other receipt';}
   rows.push({...r,parts,basis,estimated});
  }
  data.imported.forEach(r=>{
   const id=ref(r.document_reference),w=webByRef.get(id),b=manualByRef.get(id);
   add({key:'finbot:'+id,reference:r.document_reference,name:r.customer_name,date:w?.payment_date||b?.payment_date||r.document_date,amount_minor:w?.amount_minor??b?.amount_minor??Number(r.amount_minor),store_id:b?.store_id,order:w?byId.get(String(w.order_id)):byNumber.get(String(r.website_order_number)),website_order_number:r.website_order_number??(w?'missing':null),imported:true});
  });
  data.orderReceipts.filter(r=>['issued','external'].includes(r.status)&&!r.is_test).forEach(r=>add({key:r.document_reference?'finbot:'+ref(r.document_reference):'order:'+r.order_id,reference:r.document_reference||'',name:byId.get(String(r.order_id))?.customer_name||'Online order',date:r.payment_date,amount_minor:Number(r.amount_minor),order:byId.get(String(r.order_id)),website_order_number:byId.get(String(r.order_id))?.order_number??'missing'}));
  data.businessReceipts.filter(r=>r.status==='issued').forEach(r=>add({key:r.document_reference?'finbot:'+ref(r.document_reference):'business:'+r.id,reference:r.document_reference||'',name:r.customer_snapshot?.name||'',date:r.payment_date,amount_minor:Number(r.amount_minor),store_id:r.store_id}));
  return rows;
 }
 const api={splitOrder,online,receipts,normalize,ref};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
 if(!root.document)return;root.GremierRevenue=api;
 const get=id=>document.getElementById(id),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const money=n=>new Intl.NumberFormat('en-IL',{style:'currency',currency:'ILS',maximumFractionDigits:0}).format(n/100);
 const date=v=>root.GremierDashboard.businessDate(v);
 const labels={coffee_bar:'Events / groups',coffee:'Personal / retail',stores:'Stores',other:'Other',unclassified:'Needs review'};
 const client=()=>typeof sb!=='undefined'?sb:root.MAIN_SB||root.ADMIN_SB;
 let loaded=null,serial=0;
 const totalsHtml=totals=>[['Events / groups',totals.coffee_bar],['Personal / retail',totals.coffee+totals.stores],...['other','unclassified'].filter(k=>totals[k]).map(k=>[labels[k],totals[k]])].map(([name,n])=>`<div class="fin-row"><span>${name}</span><strong>${money(n)}</strong></div>`).join('');
 api.dashboardOnline=(orders,r,purposes=[],storeValue=null)=>{const host=get('dashOnlineRevenue');if(!host)return;try{const totals=online(orders,typeof allProducts!=='undefined'?allProducts:[],r.start,r.today,date,purposes);if(storeValue!==null)totals.stores=minor(storeValue);host.innerHTML='<h2>Sales by purpose</h2>'+totalsHtml(totals)+(storeValue===null?'<p class="sales-note">Store totals unavailable.</p>':'');}catch{host.innerHTML='<h2>Sales by purpose</h2><p>Activity breakdown unavailable.</p>';}};
 function setup(){
  const host=get('tab-reports');if(!host||get('revenueExplorer'))return;
  const section=document.createElement('section');section.id='revenueExplorer';section.className='sales-panel';
  const now=date(new Date()),year=now.slice(0,4);
  section.innerHTML=`<div class="sales-heading"><h2>Revenue by purpose</h2><span data-action-menu="Revenue tools"><button class="btn btn-outline" id="revenueRefresh">Refresh</button></span></div><div class="sales-controls"><label>Period<select class="form-input" id="revenueScope"><option value="year">Whole year</option><option value="month">Specific month</option></select></label><label id="revenueYearLabel">Year<input class="form-input" type="number" id="revenueYear" min="2020" max="2100" value="${year}"></label><label id="revenueMonthLabel" hidden>Month<input class="form-input" type="month" id="revenueMonth" value="${now.slice(0,7)}"></label></div><p id="revenueStatus" class="sales-note" role="status"></p><div id="revenueResults"></div><details class="sales-help"><summary>Classification details</summary><p>Stores and personal online orders count as retail. Coffee bars and known group orders count as events/groups. Online orders use their items and customer context, never the ₪300 rule. Bulk orders without clear context need review. Only non-online, non-store receipts over ₪300 use the estimate. Online totals allocate discounts and delivery proportionally. Receipt totals use payment dates when available, otherwise imported document dates. The two views overlap and must not be added together. FinBot imports remain dated snapshots.</p></details>`;
  host.querySelector('#salesExplorer')?.after(section);if(!section.parentNode)host.append(section);
  get('revenueScope').onchange=()=>{const month=get('revenueScope').value==='month';get('revenueMonthLabel').hidden=!month;get('revenueYearLabel').hidden=month;load();};
  get('revenueYear').onchange=load;get('revenueMonth').onchange=load;get('revenueRefresh').onclick=load;
 }
 function scope(){const y=get('revenueScope').value==='month'?get('revenueMonth').value.slice(0,4):get('revenueYear').value;if(!/^20\d{2}$/.test(y))throw Error('Choose a valid year.');const m=get('revenueScope').value==='month'?get('revenueMonth').value:null;return {year:y,...(m?root.GremierSales.monthRange(m):{from:y+'-01-01',to:y+'-12-31'})};}
 async function pages(table,columns){const out=[];for(let n=0;n<100000;n+=1000){const r=await client().from(table).select(columns).order(table==='order_receipts'?'order_id':table==='finbot_income_sources'?'document_reference':table==='revenue_classification_overrides'?'source_key':'id').range(n,n+999);if(r.error||!Array.isArray(r.data))throw Error('Could not load '+table);out.push(...r.data);if(r.data.length<1000)return out;}throw Error('Reporting limit reached');}
 async function load(){setup();const seq=++serial;get('revenueStatus').textContent='Loading revenue…';try{
  const tables=[['orders','id,order_number,created_at,total,customer_name,items,status,payment_status,delivery_info'],['products','id,name_en,name_he,category,is_coffee_bar'],['stores','id,name'],['receipt_customers','id,name,store_id'],['order_receipts','order_id,status,amount_minor,payment_date,document_reference,is_test'],['business_receipts','id,status,store_id,customer_snapshot,amount_minor,payment_date,document_reference'],['finbot_income_sources','document_reference,document_date,amount_minor,customer_name,website_order_number'],['revenue_classification_overrides','source_key,category']];
  const results=await Promise.all(tables.map(([t,c])=>pages(t,c)));if(seq!==serial)return;
  loaded=Object.fromEntries(['orders','products','stores','customers','orderReceipts','businessReceipts','imported','overrides'].map((k,i)=>[k,results[i]]));render();
 }catch(e){if(seq!==serial)return;get('revenueStatus').textContent=e.message;get('revenueResults').innerHTML='';}}
 function render(){
  const r=scope(),rows=receipts(loaded).filter(x=>x.date>=r.from&&x.date<=r.to),total=empty();rows.forEach(x=>categories.forEach(k=>total[k]+=x.parts[k]));
  const orders=loaded.orders.filter(o=>eligible(o)&&date(o.created_at)>=r.from&&date(o.created_at)<=r.to).sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)));const paid=online(loaded.orders,loaded.products,r.from,r.to,date,loaded.overrides),estimated=rows.filter(x=>x.estimated).reduce((s,x)=>s+x.amount_minor,0);
  get('revenueResults').innerHTML=`<div class="fin-grid"><section class="fin-panel"><h2>Online sales</h2>${totalsHtml(paid)}</section><section class="fin-panel"><h2>Receipt income</h2>${totalsHtml(total)}<p class="sales-note">${money(estimated)} in estimated events/groups</p></section></div><details class="sales-help"><summary>Review online order purpose · ${orders.length}</summary><div class="table-wrap sales-table"><table><thead><tr><th>Order / customer</th><th>Amount</th><th>Purpose</th></tr></thead><tbody>${orders.map(o=>{const key='order-purpose:'+o.id,choice=loaded.overrides.find(x=>x.source_key===key)?.category,parts=splitOrder(o,loaded.products,choice);return `<tr><td>#${esc(o.order_number)}<small>${esc(o.customer_name)}</small></td><td>${money(minor(o.total))}</td><td><select class="form-input" data-order-purpose="${esc(o.id)}"><option value="auto">Automatic</option>${['coffee','coffee_bar'].map(k=>`<option value="${k}" ${choice===k?'selected':''}>${labels[k]}</option>`).join('')}</select><small>${categories.filter(k=>parts[k]).map(k=>labels[k]).join(' + ')}</small></td></tr>`;}).join('')}</tbody></table></div></details><details class="sales-help"><summary>Review receipt categories · ${rows.length}</summary><div class="table-wrap sales-table"><table><thead><tr><th>Customer / receipt</th><th>Date</th><th>Amount</th><th>Category</th><th>Basis</th></tr></thead><tbody>${rows.sort((a,b)=>b.date.localeCompare(a.date)).map((x,i)=>`<tr><td>${esc(x.name)}<small>${esc(x.reference)}</small></td><td>${esc(x.date)}</td><td>${money(x.amount_minor)}</td><td><select class="form-input" data-revenue-row="${i}"><option value="auto">Automatic</option>${['coffee_bar','coffee','stores','other'].map(k=>`<option value="${k}" ${loaded.overrides.find(o=>o.source_key===x.key)?.category===k?'selected':''}>${labels[k]}</option>`).join('')}</select><small>${categories.filter(k=>x.parts[k]).map(k=>labels[k]).join(' + ')}</small></td><td>${esc(x.basis)}</td></tr>`).join('')}</tbody></table></div></details>`;
  const imported=loaded.imported.filter(x=>x.document_date.startsWith(r.year+'-'));get('revenueStatus').textContent=imported.length?'FinBot import through '+imported.map(x=>x.document_date).sort().at(-1)+' · app receipts live':'App receipts only · no FinBot import for '+r.year;
  get('revenueResults').querySelectorAll('[data-order-purpose]').forEach(select=>select.onchange=()=>savePurpose(select,'order-purpose:'+select.dataset.orderPurpose));
  get('revenueResults').querySelectorAll('[data-revenue-row]').forEach(select=>select.onchange=async()=>{select.disabled=true;try{const key=rows[Number(select.dataset.revenueRow)].key;const result=select.value==='auto'?await client().from('revenue_classification_overrides').delete().eq('source_key',key):await client().from('revenue_classification_overrides').upsert({source_key:key,category:select.value,updated_at:new Date().toISOString()});if(result.error)throw result.error;await load();}catch{get('revenueStatus').textContent='Category was not saved. Refresh and try again.';select.disabled=false;}});
 }
 async function savePurpose(select,key){select.disabled=true;try{const result=select.value==='auto'?await client().from('revenue_classification_overrides').delete().eq('source_key',key):await client().from('revenue_classification_overrides').upsert({source_key:key,category:select.value,updated_at:new Date().toISOString()});if(result.error)throw result.error;await load();}catch{get('revenueStatus').textContent='Purpose was not saved. Refresh and try again.';select.disabled=false;}}
 const original=root.loadReports;root.loadReports=function(...args){const result=original?.apply(this,args);setup();load();return result;};
})(typeof window==='undefined'?globalThis:window);
