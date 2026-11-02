/* FinBot accounting snapshot. Financial data is fetched only through admin RLS. */
(function (root) {
  'use strict';
  const amount = n => { if (!Number.isSafeInteger(n)) throw Error('Invalid accounting amount'); return n; };
  const keys = ['income','cost_of_sales','operating_expenses','expenses','net','fixed_assets'];
  const buckets = {
    purchases:'Inventory / cost of goods sold', contractors:'Contract labor',
    office:'Office expenses', software:'Software / subscriptions', professional:'Legal / professional services',
    fees:'Payment processing fees', delivery:'Delivery / freight — review COGS allocation',
    meals:'Meals / refreshments — purpose and limits review',
    vehicle_lease:'Vehicle lease — business use / method pending',
    vehicle_running:'Vehicle running costs — business use / method pending',
    home_electricity:'Home office — electricity', home_water:'Home office — water',
    home_property_tax:'Home office — property tax / arnona review',
    assets:'Equipment / fixed assets — capitalization review', review:'Needs classification / original bill'
  };
  const suggestions = {
    'קניות בארץ':'purchases','קניות חו"ל':'purchases','קניות בארץ ללא מעמ':'purchases',
    'קבלני משנה':'contractors','משרדיות':'office','אחזקת מחשב ותוכנות':'software',
    'הנהלת חשבונות':'professional','הכנת דוח אמריקאי':'professional','עמלות סליקה':'fees',
    'משלוחים':'delivery','כיבודים עם מעמ':'meals','שכירות רכב':'vehicle_lease',
    'דלק רכב 2/3':'vehicle_running','רכוש קבוע':'assets'
  };
  const labels = {
    'הכנסות פטורות':'Exempt income','הכנסה ממכירות':'Sales income','קניות בארץ':'Domestic purchases',
    'קניות חו"ל':'Overseas purchases','קניות בארץ ללא מעמ':'Domestic purchases without VAT',
    'קבלני משנה':'Subcontractors','יבוא':'Imports','משרדיות':'Office expenses',
    'הנהלת חשבונות':'Bookkeeping','אחזקת מחשב ותוכנות':'Computer & software',
    'כיבודים עם מעמ':'Refreshments','דלק רכב 2/3':'Vehicle fuel','עמלות סליקה':'Processing fees',
    'דמי שכירות תפעולית':'Operating lease — unspecified','שכירות רכב':'Vehicle lease',
    'משלוחים':'Deliveries','הכנת דוח אמריקאי':'U.S. return preparation','רכוש קבוע':'Fixed assets'
  };
  const title = label => labels[label] || label;
  function summarize(payload, selected='all') {
    if (payload?.schema_version!==1 || payload.currency!=='ILS' || !Array.isArray(payload.monthly) || !payload.monthly.length) throw Error('Unsupported snapshot');
    const seen = new Set();
    for (const month of payload.monthly) {
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month.month) || !month.month.startsWith(payload.report_year+'-') || month.month>payload.as_of_date.slice(0,7) || seen.has(month.month)) throw Error('Invalid snapshot period');
      seen.add(month.month);
      keys.forEach(k=>amount(month[k+'_minor']));
      if (month.expenses_minor!==month.cost_of_sales_minor+month.operating_expenses_minor || month.net_minor!==month.income_minor-month.expenses_minor) throw Error('Snapshot totals do not reconcile');
      if (amount(month.sources_minor.website)+amount(month.sources_minor.other)!==month.income_minor) throw Error('Revenue sources do not reconcile');
      for (const group of ['income','cost_of_sales','operating_expenses','fixed_assets']) {
        const total=month.categories.filter(c=>c.group===group).reduce((s,c)=>s+amount(c.amount_minor),0);
        if (total!==month[group+'_minor']) throw Error('Categories do not reconcile');
      }
      if (month.suppliers.reduce((s,r)=>s+amount(r.amount_minor),0)!==month.expenses_minor) throw Error('Suppliers do not reconcile');
    }
    if (selected!=='all' && !seen.has(selected)) throw Error('Month not in snapshot');
    const months=payload.monthly.filter(m=>selected==='all'||m.month===selected).sort((a,b)=>a.month.localeCompare(b.month));
    const totals=Object.fromEntries(keys.map(k=>[k,months.reduce((s,m)=>s+m[k+'_minor'],0)]));
    const categoryMap=new Map(),supplierMap=new Map();
    for (const m of months) {
      for (const c of m.categories) { const key=JSON.stringify([c.label,c.group]); const item=categoryMap.get(key)||{...c,amount_minor:0};item.amount_minor+=c.amount_minor;categoryMap.set(key,item); }
      for (const s of m.suppliers) supplierMap.set(s.label,(supplierMap.get(s.label)||0)+s.amount_minor);
    }
    return {months,totals,categories:[...categoryMap.values()].sort((a,b)=>b.amount_minor-a.amount_minor),
      suppliers:[...supplierMap].sort((a,b)=>b[1]-a[1]),
      sources:{website:months.reduce((s,m)=>s+m.sources_minor.website,0),other:months.reduce((s,m)=>s+m.sources_minor.other,0)},
      websiteCount:months.reduce((s,m)=>s+m.website_receipt_count,0),
      grossProfit:totals.income-totals.cost_of_sales,
      margin:totals.income ? totals.net/totals.income*100 : null};
  }
  function usRows(model, overrides={}) {
    return model.categories.filter(c=>c.group!=='income').map(c=>{
      const id=Object.hasOwn(buckets,overrides[c.label])?overrides[c.label]:(suggestions[c.label]||'review');
      return {...c,bucket:id,us_category:buckets[id],deduction_minor:null,status:'Review required'};
    });
  }
  function usEstimate(model,overrides={}){
    let deductible=0,pending=0,cogs=0;
    const automatic=new Set(['purchases','contractors','office','software','professional','fees','delivery']);
    const rows=usRows(model,overrides).map(r=>{
      const included=automatic.has(r.bucket)&&r.label!=='הכנת דוח אמריקאי';
      if(included){deductible+=r.amount_minor;if(r.bucket==='purchases')cogs+=r.amount_minor;}else pending+=r.amount_minor;
      return {...r,deduction_minor:included?r.amount_minor:null,status:included?'Included in estimate':r.bucket.startsWith('vehicle_')?'Excluded · no mileage log':'Needs review'};
    });
    return {deductible,pending,cogs,rows};
  }
  const safeCell = v => {const text=String(v??'');return /^[=+@\-\t\r]/.test(text)?"'"+text:text;};
  function csvRows(model,payload,view,overrides={}) {
    const rows=[['Year','Snapshot date','Month / scope','View','Category','Source amount ILS','U.S. deduction','Notes']];
    const scope=model.months.length===1?model.months[0].month:'Year to snapshot date';
    const add=(period,label,n,note)=>rows.push([payload.report_year,payload.as_of_date,period,view,label,n/100,'',note]);
    if(view==='us') {
      usEstimate(model,overrides).rows.forEach(r=>rows.push([payload.report_year,payload.as_of_date,scope,view,r.us_category,r.amount_minor/100,r.deduction_minor===null?'':r.deduction_minor/100,title(r.label)+'; '+r.status+'; ILS estimate, not USD filing amount']));
      for(const id of ['home_electricity','home_water','home_property_tax']) if(!usRows(model,overrides).some(r=>r.bucket===id)) rows.push([payload.report_year,payload.as_of_date,scope,view,buckets[id],'','','Not separately identified; original full bills required']);
    } else {
      keys.forEach(k=>add(scope,k,model.totals[k],'FinBot accounting basis; fixed assets separate from P&L expenses'));
      add(scope,'Website receipts included in revenue',model.sources.website,'Subset of revenue, not additional sales');
      add(scope,'Other FinBot income',model.sources.other,'Not yet classified by business channel');
      model.months.forEach(m=>['income','expenses','net'].forEach(k=>add(m.month,k,m[k+'_minor'],'Document dates; catch-up receipts affect October')));
      model.categories.forEach(c=>add(scope,title(c.label),c.amount_minor,c.group));
      model.suppliers.forEach(([name,n])=>add(scope,name,n,'Supplier spending included in P&L expenses'));
    }
    return rows.map(row=>row.map(safeCell));
  }
  const api={summarize,usRows,usEstimate,csvRows,buckets};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  if(!root.document)return;
  root.GremierFinancials=api;
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money=n=>new Intl.NumberFormat('en-IL',{style:'currency',currency:'ILS',minimumFractionDigits:2,maximumFractionDigits:2}).format(n/100);
  const monthName=m=>new Intl.DateTimeFormat('en',{month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(m+'-01T12:00:00Z'));
  const get=id=>document.getElementById(id);
  const metric=(label,value,note,cls='')=>`<div class="fin-metric ${cls}"><span>${esc(label)}</span><strong>${esc(value)}</strong>${note?`<small>${esc(note)}</small>`:''}</div>`;
  const row=(label,value)=>`<div class="fin-row"><span dir="auto">${esc(label)}</span><strong>${esc(value)}</strong></div>`;
  let snapshots=[],snapshot=null,preferences={},view='accounts',current=null,sequence=0,preferenceReady=false,preferenceState='loading';
  const client=()=>typeof sb!=='undefined'?sb:root.MAIN_SB||root.ADMIN_SB;
  // Expenses filed in the app's expense inbox after the saved FinBot report was taken (amounts read off
  // each document). From the Osek Morshe start (2026-10-22) their VAT is reclaimable (input VAT).
  let inboxExpenses=null,workerPay=null,profitMode=(()=>{try{return localStorage.getItem('gremier_stats_profit')==='home'?'home':'il';}catch{return 'il';}})(),vatMode=(()=>{try{return localStorage.getItem('gremier_stats_vat')==='net'?'net':'raw';}catch{return 'raw';}})();
  async function loadInboxExpenses(){
    const [{data,error},work]=await Promise.all([client().from('expense_inbox_files').select('supplier,doc_date,total_minor,vat_minor,currency,read_status,status,created_at').neq('status','archived'),
      client().from('worker_entries').select('entry_date,amount').eq('kind','work')]);
    inboxExpenses=error?null:data||[];workerPay=work.error?null:work.data||[];render();
  }
  function inboxSince(s){
    if(!inboxExpenses||!s)return null;
    const after=inboxExpenses.filter(f=>f.created_at>s.captured_at&&(f.doc_date||f.created_at).startsWith(String(s.report_year)));
    const counted=after.filter(f=>['read','manual'].includes(f.read_status)&&(f.currency||'ILS')==='ILS'&&Number.isFinite(f.total_minor));
    const reclaim=counted.filter(f=>(f.doc_date||f.created_at.slice(0,10))>='2026-10-22'&&f.vat_minor>0),byPeriod={};
    reclaim.forEach(f=>{const k=root.GremierRevenue?.vatPeriod?.(f.doc_date||f.created_at.slice(0,10));if(k)byPeriod[k]=(byPeriod[k]||0)+f.vat_minor;});
    return {total:counted.reduce((t,f)=>t+f.total_minor,0),vat:reclaim.reduce((t,f)=>t+f.vat_minor,0),byPeriod,count:counted.length,
      waiting:after.filter(f=>['unread','failed'].includes(f.read_status)).length};
  }
  // Counted documents filed in the app since the saved report (ILS, amount read).
  const appFiles=s=>(inboxExpenses||[]).filter(f=>f.created_at>s.captured_at&&(f.doc_date||f.created_at).startsWith(String(s.report_year))&&['read','manual'].includes(f.read_status)&&(f.currency||'ILS')==='ILS'&&Number.isFinite(f.total_minor));
  const fileNet=f=>f.total_minor-((f.doc_date||f.created_at.slice(0,10))>='2026-10-22'&&f.vat_minor>0?f.vat_minor:0);
  // Costs the business may claim that are really the household's: the car, home property tax, and
  // electricity / water beyond the 5% the business really uses. FinBot labels say what share was claimed ("חשמל 25%").
  const TAKE_HOME_UTILITY=5;
  function personal(label,supplier=false){
    const l=String(label||'');
    if(supplier){
      if(/ארנונה|עיריית|municipal/i.test(l))return {kind:'home',keep:0};
      if(/חברת החשמל|\bIEC\b|electric/i.test(l)||/(^|\s)חשמל/.test(l))return {kind:'utility',keep:TAKE_HOME_UTILITY/100};
      if(/גיחון|תאגיד המים|water corp/i.test(l))return {kind:'utility',keep:TAKE_HOME_UTILITY/100};
      if(/ליסינג|השכרת רכב|leasing|car rental|סונול|דור אלון|(^|\s)פז(\s|$)|(^|\s)דלק(\s|$)/i.test(l))return {kind:'car',keep:0};
      return null;
    }
    if(/רכב|דלק/.test(l))return {kind:'car',keep:0};
    if(/ארנונה/.test(l))return {kind:'home',keep:0};
    if(/חשמל|מים/.test(l)){const pct=Number((l.match(/(\d+)\s*%/)||[])[1])||100;return {kind:'utility',keep:Math.min(1,TAKE_HOME_UTILITY/pct)};}
    return null;
  }
  // Net profit two ways. Israeli accounts: income before VAT less every claimed expense before VAT.
  // Take-home: the same, with the household's share of the car, property tax and utilities added back, less what workers earned.
  function profitCard(annual,year,live){
    if(!live)return '';
    const R=root.GremierRevenue,out=R.salesVat(live),x=inboxSince(snapshot),files=appFiles(snapshot);
    const income=live.total_minor-out.vat_minor,expenses=annual.totals.expenses+(x?.total||0)-(x?.vat||0),il=income-expenses;
    const back={car:0,home:0,utility:0};
    annual.categories.filter(c=>c.group!=='income'&&c.group!=='fixed_assets').forEach(c=>{const k=personal(c.label);if(k)back[k.kind]+=Math.round(c.amount_minor*(1-k.keep));});
    files.forEach(f=>{const k=personal(f.supplier,true);if(k)back[k.kind]+=Math.round(fileNet(f)*(1-k.keep));});
    const workers=workerPay?Math.round(workerPay.filter(w=>String(w.entry_date).startsWith(String(year))).reduce((t,w)=>t+Number(w.amount||0),0)*100):null;
    const home=il+back.car+back.home+back.utility-(workers||0),value=profitMode==='home'?home:il;
    // Once stores pay: store sales counted in the month delivered (their statements), not when paid. A store
    // paying next year for this year's months still counts here only, and this year's payments for last
    // year's months don't. Only the store part changes; statements are before VAT, so VAT comes off the payments.
    const months=R.salesByMonth?.(year),share=r=>r.amount_minor?(r.parts?.stores||0)/r.amount_minor:0;
    const paidStores=live.rows.reduce((n,r)=>n+(r.parts?.stores||0)-Math.round(R.rowVat(r)*share(r)),0);
    const gap=months?months.reduce((n,m)=>n+m.stores,0)-paidStores:0,earned=income+gap;
    const tabs=`<div class="fin-views fin-profit-toggle" role="group" aria-label="Net profit"><button type="button" class="btn btn-outline" data-profit-mode="il" aria-pressed="${profitMode==='il'}">Israeli accounts</button><button type="button" class="btn btn-outline" data-profit-mode="home" aria-pressed="${profitMode==='home'}">Take-home</button></div>`;
    const detail=profitMode==='il'
      ?row('Income before VAT',money(income))+row('Less expenses claimed, before VAT',money(-expenses))+row('Net profit · Israeli accounts',money(il))+(gap?row('Once stores pay for '+year,money(il+gap)):'')+`<p class="fin-note">What the books show: every expense the business claims, including the car, the home's property tax and its share of electricity and water. Payments received in ${year}; expenses from FinBot through ${snapshot.as_of_date} plus documents filed in the app since. Your accountant's report is the official figure.</p>`
      :row('Net profit · Israeli accounts',money(il))+(back.car?row('Add back: car (lease, fuel)',money(back.car)):'')+(back.home?row('Add back: home property tax',money(back.home)):'')+(back.utility?row(`Add back: electricity & water above ${TAKE_HOME_UTILITY}%`,money(back.utility)):'')+row('Less workers\' pay',workers===null?'Unavailable':money(-workers))+row('Take-home profit',money(home))+(gap?row('Once stores pay for '+year,money(home+gap)):'')+`<p class="fin-note">What the business really earns you: costs you'd pay anyway at home are added back (only ${TAKE_HOME_UTILITY}% of electricity and water counts as business), and what workers earned (from the Workers page) comes off.</p>`;
    return `<section class="fin-panel fin-profit"><div class="flex-between"><h2>Net profit · ${year}</h2>${tabs}</div><div class="fin-metrics fin-year-metrics">${metric(profitMode==='home'?'Take-home profit':'Net profit · Israeli accounts',money(value),profitMode==='home'?'What you actually keep':'As the business reports it',value<0?'fin-negative':'fin-positive')}${gap?metric('Once stores pay for '+year,money(value+gap),`Store sales by the month delivered (${money(earned)} income before VAT): a payment that comes next year still counts in ${year}, never twice`,value+gap<0?'fin-negative':'fin-positive'):''}</div><details class="sales-help"><summary>How it's worked out</summary>${detail}</details></section>`;
  }
  function setup() {
    const host=get('tab-reports');if(!host||get('financialResults'))return;
    host.innerHTML=`<header class="page-header"><div class="flex-between"><div><h1 class="page-title">Business stats</h1></div><span data-action-menu="Accounting tools"><button class="btn btn-outline btn-sm" id="financialExport" disabled>Export CSV</button><button class="btn btn-outline btn-sm" id="financialRefresh">Reload saved data</button></span></div></header>
      <section class="fin-panel" id="statsYearOverview"><div class="flex-between"><h2>Year overview</h2><label>Year<select class="form-input" id="financialYear" aria-label="Reporting year"></select></label></div><div id="statsYearTotals" role="status">Loading annual totals…</div></section>
      <div class="fin-toolbar"><label>Accounting period<select class="form-input" id="financialMonth" aria-label="Reporting period"></select></label></div>
      <p id="financialStatus" class="fin-note" role="status" aria-live="polite"></p>
      <div class="fin-views" role="group" aria-label="Expense reporting view"><button type="button" class="btn btn-outline" id="financialAccounts" aria-pressed="true">Israeli accounts</button><button type="button" class="btn btn-outline" id="financialUS" aria-pressed="false">U.S. estimate</button></div><div id="financialResults"></div>`;
    const views=get('financialAccounts').closest('.fin-views');host.querySelector('.page-header').after(views);
    get('financialYear').onchange=()=>chooseYear();
    get('financialMonth').onchange=render;
    get('financialRefresh').onclick=()=>root.loadReports();
    get('financialAccounts').onclick=()=>{view='accounts';render();};
    get('financialUS').onclick=()=>{view='us';render();};
    get('financialExport').onclick=()=>{
      if(!current)return;
      const rows=csvRows(current,snapshot.payload,view,preferences.category_overrides||{});
      const text='\uFEFF'+rows.map(r=>r.map(v=>'"'+v.replace(/"/g,'""')+'"').join(',')).join('\r\n');
      const url=URL.createObjectURL(new Blob([text],{type:'text/csv;charset=utf-8'}));
      const a=document.createElement('a');a.href=url;a.download=`gremier-${view}-${snapshot.report_year}-${get('financialMonth').value}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    };
  }
  function renderOverview(){
    const host=get('statsYearTotals');if(!host)return;
    if(!snapshot){host.textContent='Annual totals unavailable.';return;}
    const annual=summarize(snapshot.payload,'all'),year=snapshot.report_year;
    const live=root.GremierRevenue?.annualReport?.(year),due=root.GremierRevenue?.annualOwed?.(year);
    if(view==='us'){const estimate=usEstimate(annual,preferences.category_overrides||{});get('statsYearOverview').querySelector('h2').textContent='U.S. estimate';host.innerHTML=`<div class="fin-metrics fin-year-metrics">${metric('Estimated deductions',preferenceReady?money(estimate.deductible):preferenceState==='error'?'Unavailable':'Loading…','Includes product ingredients')}${metric('Estimated business profit',live&&preferenceReady?money(live.total_minor-estimate.deductible):preferenceState==='error'?'Unavailable':'Loading…','Before personal taxes · ILS')}</div><details class="sales-help"><summary>Estimate details${preferenceReady?' · '+money(estimate.pending)+' not included':''}</summary>${row('Income',live?money(live.total_minor):'Unavailable')}${row('Included costs',money(estimate.deductible))}${row('Unresolved / excluded costs',money(estimate.pending))}<p class="fin-note">Expenses through ${snapshot.as_of_date}. Recorded purchases and product ingredients are treated as cost of goods sold for this estimate; unsold inventory may require adjustment. Vehicle costs are excluded without a mileage log. Unconfirmed items and equipment are not deducted. Amounts are shown in ILS; a U.S. return requires USD conversion. This is a business-profit estimate, not your final U.S. tax bill.</p><a href="https://www.irs.gov/instructions/i1040sc" target="_blank" rel="noopener">IRS Schedule C</a> · <a href="https://www.irs.gov/individuals/international-taxpayers/foreign-currency-and-currency-exchange-rates" target="_blank" rel="noopener">Currency conversion</a></details>`;return;}
    get('statsYearOverview').querySelector('h2').textContent='Year overview';
    const today=root.GremierDashboard?.businessDate(new Date())||new Date().toISOString().slice(0,10);
    const toggle=`<div class="fin-views fin-vat-toggle" role="group" aria-label="VAT"><button type="button" class="btn btn-outline" data-vat-mode="raw" aria-pressed="${vatMode==='raw'}">As recorded</button><button type="button" class="btn btn-outline" data-vat-mode="net" aria-pressed="${vatMode==='net'}">After VAT</button></div>`;
    const bindToggle=()=>host.querySelectorAll('[data-vat-mode]').forEach(b=>b.onclick=()=>{vatMode=b.dataset.vatMode;try{localStorage.setItem('gremier_stats_vat',vatMode);}catch{}renderOverview();});
    const bindProfit=()=>host.querySelectorAll('[data-profit-mode]').forEach(b=>b.onclick=()=>{profitMode=b.dataset.profitMode;try{localStorage.setItem('gremier_stats_profit',profitMode);}catch{}renderOverview();});
    if(vatMode==='net'){host.innerHTML=toggle+afterVat(annual,year,live,due,today)+profitCard(annual,year,live);bindToggle();bindProfit();return;}
    host.innerHTML=toggle+`<div class="fin-metrics fin-year-metrics">${metric('Income',live?money(live.total_minor):root.GremierRevenue?.loading?'Loading…':'Unavailable',`Payments · ${year} through ${year===Number(today.slice(0,4))?today:year+'-12-31'}`)}${metric('Earned so far',live&&due?money(live.total_minor+due.total_minor):root.GremierRevenue?.loading?'Loading…':'Unavailable',live&&due?`Incl. ${money(due.total_minor)} stores haven't paid yet`:'Income plus what stores owe')}${(()=>{const x=inboxSince(snapshot);return metric('Recorded expenses',money(annual.totals.expenses+(x?.total||0)),`FinBot through ${snapshot.as_of_date}`+(x?.count?` + ${money(x.total)} from ${x.count} filed in the app since`:'')+(x?.waiting?` · ${x.waiting} still being read`:''));})()}</div>${live&&due?`<details class="sales-help"><summary>What's in "Earned so far"</summary>${row('Receipts issued',money(live.total_minor-root.GremierRevenue.reconcile(live,0).unreceipted))}${row('Paid website orders · receipt not issued yet',money(root.GremierRevenue.reconcile(live,0).unreceipted))}${row('Store statements sent · not paid yet',money(due.billed))}${row('Store deliveries · statement not sent yet',money(due.running))}${row('Earned so far',money(live.total_minor+due.total_minor))}${due.rows.length?`<details><summary>Stores that owe · ${new Set(due.rows.map(r=>r.store_id)).size}</summary>${Object.values(due.rows.reduce((m,r)=>{const k=r.store_id;(m[k]||(m[k]={name:r.stores?.name||'Store',months:[],amount:0})).months.push(r.month);m[k].amount+=r.amount_minor;return m;},{})).sort((a,b)=>b.amount-a.amount).map(x=>row(x.name+' · '+x.months.map(m=>monthName(m)).join(', '),money(x.amount))).join('')}</details>`:''}<p class="fin-note">Each store month counts once. Until it's paid, it counts at its statement amount. Once you issue the store's receipt, that month counts at what was actually paid instead, so if a store owed ₪1,000 and paid ₪800, it counts as ₪800 and nothing is counted twice.</p></details>`:''}<details class="sales-help"><summary>Why can the totals differ?</summary>${live?(()=>{const r=root.GremierRevenue.reconcile(live,annual.totals.income);return row('Saved FinBot income',money(r.snapshot))+row('Imported receipt adjustments / payment dates',money(r.importAdjustments))+(r.legacyWebsite?row('Old website · net sales after refund',money(r.legacyWebsite)):'')+row('Additional app receipts',money(r.newReceipts))+row('Paid online orders without receipts',money(r.unreceipted))+row('Current income · counted once',money(r.total));})():'<p>Live income could not be loaded. Refresh to retry.</p>'}<p class="fin-note">Income includes paid orders without receipts and links each order to its receipt once. FinBot figures below are a saved accounting report by document date. Expenses: that report, plus documents filed in the app's expense inbox since it was taken (amounts read off each document, VAT included). Switch to After VAT to take out the VAT that goes to the government.</p></details>`+profitCard(annual,year,live);bindToggle();bindProfit();
  }
  // The same year with VAT taken out: sales VAT (collected for the government) leaves income, expense VAT
  // (reclaimed) leaves expenses, and the difference is what's paid, by two-month VAT period.
  function afterVat(annual,year,live,due,today){
    const R=root.GremierRevenue,x=inboxSince(snapshot);
    if(!live||!due||!R?.salesVat)return `<p class="fin-note">${R?.loading?'Loading…':'Live income could not be loaded. Refresh to retry.'}</p>`;
    const out=R.salesVat(live),pending=R.owedVat(due),input=x?.vat||0,expenses=annual.totals.expenses+(x?.total||0);
    const net=out.vat_minor-input,periods=[...new Set([...Object.keys(out.byPeriod),...Object.keys(x?.byPeriod||{})])].sort();
    const names=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'],pname=k=>{const m=Number(k.slice(5,7));return `${names[m-1]}–${names[m]} ${k.slice(0,4)}`;};
    const dueBy=k=>{const m=Number(k.slice(5,7))+2,y=Number(k.slice(0,4))+(m>12?1:0);return `${y}-${String(m>12?m-12:m).padStart(2,'0')}-15`;};
    return `<div class="fin-metrics fin-year-metrics">${metric('Income before VAT',money(live.total_minor-out.vat_minor),`${money(out.vat_minor)} VAT collected for the government`)}${metric('Earned so far before VAT',money(live.total_minor-out.vat_minor+due.total_minor),`Incl. ${money(due.total_minor)} stores haven't paid yet${pending?` (+${money(pending)} VAT on top when invoiced)`:''}`)}${metric('Expenses before VAT',money(expenses-input),input?`${money(input)} VAT you get back`:'No reclaimable VAT yet')}${metric(net>=0?'VAT to pay':'VAT refund due',money(Math.abs(net)),`Collected ${money(out.vat_minor)} − get back ${money(input)}`,'fin-vat-due')}</div>
      <details class="sales-help" open><summary>VAT by period</summary>${periods.length?periods.map(k=>{const o=out.byPeriod[k]||0,i=x?.byPeriod?.[k]||0;return row(`${pname(k)} · due ${dueBy(k)}`,`${money(o-i)}`)+`<p class="fin-note">Sales VAT ${money(o)} − expense VAT ${money(i)}</p>`;}).join(''):'<p class="fin-note">No VAT yet this year.</p>'}
      ${pending?`<p class="fin-note">Store months from October aren't invoiced yet. When you issue their tax invoices, ${money(pending)} VAT is added on top: the stores pay it and it goes to the government, so it doesn't change what you earn.</p>`:''}
      <p class="fin-note">From 22 Oct 2026 (Osek Morshe): website prices include VAT, so 18/118 of each order is VAT; store payments carry VAT when they pay a tax invoice; expense VAT counts from documents filed in the app dated 22 Oct or later. Before that you were Osek Patur, so nothing earlier changes. Estimates for planning; your accountant's VAT report is the official figure.</p></details>`;
  }
  root.addEventListener('gremier-revenue-ready',()=>render());
  function chooseYear() {
    snapshot=snapshots.find(s=>String(s.report_year)===get('financialYear').value);current=null;
    preferences={};preferenceReady=false;preferenceState='loading';
    get('financialMonth').innerHTML='<option value="all">Year to date</option>'+liveMonths(snapshot.report_year).map(m=>`<option value="${esc(m)}">${esc(monthName(m))}</option>`).join('');
    render();
    const year=snapshot.report_year;
    client().from('finbot_us_expense_preferences').select('category_overrides,filing_context').eq('report_year',year).maybeSingle().then(({data,error})=>{
      if(snapshot?.report_year!==year)return;
      preferenceReady=!error;preferenceState=error?'error':'ready';preferences=data||{};render();
    }).catch(()=>{if(snapshot?.report_year!==year)return;preferenceState='error';preferenceReady=false;render();});
  }
  const thisMonth=()=>(root.GremierDashboard?.businessDate(new Date())||new Date().toISOString()).slice(0,7);
  const liveMonths=year=>Array.from({length:12},(_,i)=>year+'-'+String(i+1).padStart(2,'0')).filter(m=>m<=thisMonth());
  // Income from the site's records (payments received); expenses from the saved FinBot report through its
  // date plus documents filed in the app since. FinBot can't be read automatically, so this keeps it current.
  function liveReport(selected){
    const p=snapshot.payload,base=summarize(p,'all'),live=root.GremierRevenue?.annualReport?.(p.report_year),files=appFiles(snapshot);
    const months=liveMonths(p.report_year).filter(m=>selected==='all'||m===selected).map(m=>{
      const f=base.months.find(x=>x.month===m),rows=live?live.rows.filter(r=>String(r.date).slice(0,7)===m):[];
      const app=files.filter(x=>(x.doc_date||x.created_at).slice(0,7)===m).reduce((t,x)=>t+x.total_minor,0);
      const income_minor=live?rows.reduce((t,r)=>t+r.amount_minor,0):f?.income_minor||0,expenses_minor=(f?.expenses_minor||0)+app;
      return {month:m,is_partial_month:m===thisMonth(),income_minor,expenses_minor,net_minor:income_minor-expenses_minor,app,finbot:f||null,
        website:live?rows.filter(r=>r.origin==='online').reduce((t,r)=>t+r.amount_minor,0):f?.sources_minor.website||0};
    });
    const keep=new Set(months.map(m=>m.month)),fb=base.months.filter(m=>keep.has(m.month)),sum=(list,k)=>list.reduce((t,m)=>t+m[k],0);
    const totals={income:sum(months,'income_minor'),cost_of_sales:sum(fb,'cost_of_sales_minor'),operating_expenses:sum(fb,'operating_expenses_minor'),app:sum(months,'app'),expenses:sum(months,'expenses_minor'),fixed_assets:sum(fb,'fixed_assets_minor')};
    totals.net=totals.income-totals.expenses;
    const cats=new Map(),sup=new Map();
    fb.forEach(m=>{m.categories.forEach(c=>{const k=c.label+'|'+c.group,i=cats.get(k)||{...c,amount_minor:0};i.amount_minor+=c.amount_minor;cats.set(k,i);});m.suppliers.forEach(x=>sup.set(x.label,(sup.get(x.label)||0)+x.amount_minor));});
    files.filter(x=>keep.has((x.doc_date||x.created_at).slice(0,7))).forEach(x=>{const k=x.supplier||'Unnamed document';sup.set(k,(sup.get(k)||0)+x.total_minor);});
    return {months,totals,live:!!live,files:files.filter(x=>keep.has((x.doc_date||x.created_at).slice(0,7))).length,
      categories:[...cats.values()].sort((a,b)=>b.amount_minor-a.amount_minor),suppliers:[...sup].sort((a,b)=>b[1]-a[1]),
      sources:{website:sum(months,'website'),other:totals.income-sum(months,'website')},grossProfit:totals.income-totals.cost_of_sales,
      margin:totals.income?totals.net/totals.income*100:null};
  }
  function render() {
    if(!snapshot)return;
    get('tab-reports').dataset.financialView=view;
    renderOverview();
    try {
      const picked=get('financialMonth').value,inSnapshot=picked==='all'||snapshot.payload.monthly.some(x=>x.month===picked);
      current=summarize(snapshot.payload,inSnapshot?picked:'all');
      const p=snapshot.payload,m=view==='us'?current:liveReport(picked),t=m.totals;
      get('financialExport').disabled=false;
      get('financialAccounts').setAttribute('aria-pressed',String(view==='accounts'));
      get('financialUS').setAttribute('aria-pressed',String(view==='us'));
      const asOf=new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(p.as_of_date+'T12:00:00Z'));
      get('financialStatus').textContent=view==='us'?`Saved FinBot report · ${asOf}`:`Up to date · income from the site's records${m.live?'':' (loading…)'}; expenses from FinBot through ${asOf} plus ${m.files} document${m.files===1?'':'s'} filed in the app since`;
      const coverage=`<aside class="fin-coverage"><details><summary>About these figures</summary><p>FinBot’s recorded accounts through ${esc(p.as_of_date)}. October is partial. Historical website receipts issued in October cover earlier payments, so the monthly view follows document dates, not when each sale happened. Website receipts are already included in revenue. Fixed assets are separate from profit-and-loss expenses.</p><p>${esc(p.coverage.unreported_expenses_2026)} dated ${p.report_year} expense documents were not yet reported; ${esc(p.coverage.undated_expenses_all_years)} documents across all years have no date. They are not estimated into these totals.</p></details></aside>`;
      if(view==='us'){renderUS(m,coverage);return;}
      const list=(items)=>items.map(c=>row(title(c.label),money(c.amount_minor))).join('')||'<p class="fin-note">No recorded costs in this period.</p>';
      const source=(label,n)=>`${row(label,money(n))}<div class="fin-track"><i style="width:${Math.max(0,Math.min(100,n/(t.income||1)*100))}%"></i></div>`;
      const max=Math.max(1,...m.months.flatMap(x=>[Math.abs(x.income_minor),Math.abs(x.expenses_minor)]));
      const trends=m.months.map(x=>`<tr><th scope="row">${esc(monthName(x.month))}${x.is_partial_month?'<small>Partial month</small>':''}</th><td>${esc(money(x.income_minor))}<div class="fin-track"><i style="width:${Math.max(0,x.income_minor)/max*100}%"></i></div></td><td>${esc(money(x.expenses_minor))}<div class="fin-track fin-expense"><i style="width:${Math.max(0,x.expenses_minor)/max*100}%"></i></div></td><td class="${x.net_minor<0?'fin-negative':'fin-positive'}">${esc(money(x.net_minor))}</td></tr>`).join('');
      get('financialResults').innerHTML=`<details class="stats-accounting-details"><summary>Accounting report · ${p.report_year}</summary><div class="fin-metrics">${metric('Income',money(t.income),'Payments received · VAT included')}${metric('Expenses',money(t.expenses),t.app?`Incl. ${money(t.app)} filed in the app since ${asOf}`:'')}${metric('Accounting result',money(t.net),'',t.net<0?'fin-negative':'fin-positive')}${metric('Result margin',m.margin===null?'—':m.margin.toFixed(1)+'%','')}</div>
        <div class="fin-grid"><section class="fin-panel"><h2>Revenue sources</h2>${source('Website',m.sources.website)}${source('Stores, events & other',m.sources.other)}</section>
        <section class="fin-panel"><h2>Revenue to result</h2>${row('Revenue',money(t.income))}${row('Less cost of sales',money(t.cost_of_sales))}${row('Gross result',money(m.grossProfit))}${row('Less operating expenses',money(t.operating_expenses))}${t.app?row('Less documents filed in the app (not yet sorted)',money(t.app)):''}${row('Accounting result',money(t.net))}</section></div>
        <section class="fin-panel"><h2>Monthly revenue vs. expenses</h2><p class="fin-note">Income by payment date; expenses by document date.</p><div class="table-wrap"><table class="fin-table"><thead><tr><th>Month</th><th>Revenue</th><th>Expenses</th><th>Result</th></tr></thead><tbody>${trends}</tbody></table></div></section>
        <div class="fin-grid"><section class="fin-panel"><h2>Cost of sales</h2>${list(m.categories.filter(c=>c.group==='cost_of_sales'))}</section><section class="fin-panel"><h2>Operating expenses</h2>${list(m.categories.filter(c=>c.group==='operating_expenses'))}</section></div>
        <div class="fin-grid"><section class="fin-panel"><h2>Supplier spending</h2><details><summary>View ${m.suppliers.length} suppliers</summary>${m.suppliers.map(([name,n])=>row(name,money(n))).join('')||'<p class="fin-note">No suppliers in this period.</p>'}</details></section><section class="fin-panel"><h2>Fixed assets</h2>${row('Recorded asset purchases',money(t.fixed_assets))}<p class="fin-note">Excluded from P&L expenses.</p></section></div><section class="fin-panel" id="financialReceiptActivity"><h2>Receipts since this snapshot</h2><p class="fin-note">Loading the live receipt register…</p></section>${coverage}</details>`;
      loadReceiptActivity(snapshot,inSnapshot?picked:'all');
    }catch{
      current=null;get('financialExport').disabled=true;get('financialResults').innerHTML='<p class="fin-note">This snapshot could not be validated. Reload saved data to retry.</p>';
    }
  }
  async function loadReceiptActivity(record,month) {
    try {
      const all=[];
      for(const table of ['business_receipts','order_receipts']){
        for(let offset=0;offset<100000;offset+=1000){
          let q=client().from(table).select('amount_minor,issued_at').eq('status','issued');if(table==='business_receipts')q=q.neq('document_type','tax_invoice');const r=await q.gt('issued_at',record.captured_at).order('issued_at').order(table==='order_receipts'?'order_id':'id').range(offset,offset+999);
          if(r.error)throw r.error;all.push(...r.data);if(r.data.length<1000)break;if(offset===99000)throw Error('Receipt register too large');
        }
      }
      if(snapshot!==record||get('financialMonth').value!==month||!get('financialReceiptActivity'))return;
      const date=value=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jerusalem',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));
      const rows=all.filter(r=>date(r.issued_at).startsWith(month==='all'?String(record.report_year):month));
      const total=rows.reduce((s,r)=>s+amount(Number(r.amount_minor)),0);
      get('financialReceiptActivity').innerHTML=`<h2>Receipts since this snapshot</h2>${row('New official receipts',String(rows.length))}${row('Received amounts on those receipts',money(total))}<p class="fin-note">Not included in the snapshot totals.</p><button class="btn btn-outline btn-sm" id="financialOpenReceipts">Open all receipts</button>`;
      get('financialOpenReceipts').onclick=()=>root.showTab('finance');
    }catch{
      if(snapshot===record&&get('financialReceiptActivity'))get('financialReceiptActivity').innerHTML='<h2>Receipts since this snapshot</h2><p class="fin-note">Live receipt activity is unavailable. The accounting snapshot above is unchanged.</p>';
    }
  }
  function renderUS(m,coverage){
    if(!preferenceReady){get('financialResults').innerHTML='<p class="fin-note">'+(preferenceState==='error'?'U.S. settings unavailable. Reload saved data to retry.':'Loading U.S. settings…')+'</p>';return;}
    const overrides=preferences.category_overrides||{},estimate=usEstimate(m,overrides),rows=estimate.rows;
    const usTitle=r=>r.label==='כיבודים עם מעמ'&&r.bucket==='purchases'?'Milk & sugar · ingredients':title(r.label);
    const options=id=>Object.entries(buckets).map(([key,label])=>`<option value="${key}" ${key===id?'selected':''}>${esc(label)}</option>`).join('');
    const table=rows.map((r,i)=>`<tr><td><strong>${esc(usTitle(r))}</strong></td><td>${money(r.amount_minor)}</td><td><select class="form-input fin-us-category" data-index="${i}" aria-label="U.S. category for ${esc(title(r.label))}">${options(r.bucket)}</select></td><td>${r.deduction_minor===null?esc(r.status):money(r.deduction_minor)}</td></tr>`).join('');
    get('financialResults').innerHTML=`<section class="fin-panel"><h2>Included costs</h2><details><summary>View ${rows.filter(r=>r.deduction_minor!==null).length} categories</summary>${rows.filter(r=>r.deduction_minor!==null).map(r=>row(usTitle(r),money(r.deduction_minor))).join('')}</details></section><section class="fin-panel"><h2>Not included yet</h2>${rows.filter(r=>r.deduction_minor===null).map(r=>row(title(r.label)+(r.bucket.startsWith('vehicle_')?' · no mileage log':''),money(r.amount_minor))).join('')}</section><section class="fin-panel"><details><summary>Adjust categories</summary><p class="fin-note">These settings affect the U.S. estimate only.</p><div class="table-wrap"><table class="fin-table"><thead><tr><th>Expense</th><th>Recorded</th><th>U.S. category</th><th>Estimate</th></tr></thead><tbody>${table}</tbody></table></div><button class="btn btn-outline" id="financialSaveUS" ${preferenceReady?'':'disabled'}>Save categories</button><p id="financialUSStatus" role="status"></p></details></section>`;
    get('financialSaveUS').onclick=async()=>{
      const year=snapshot.report_year,button=get('financialSaveUS');button.disabled=true;
      const revised={...overrides};get('financialResults').querySelectorAll('.fin-us-category').forEach(select=>revised[rows[Number(select.dataset.index)].label]=select.value);
      try {
        const {error}=await client().from('finbot_us_expense_preferences').upsert({report_year:year,filing_context:'schedule_c',category_overrides:revised,updated_at:new Date().toISOString()});
        if(error)throw error;
        if(snapshot.report_year!==year)return;
        preferences={category_overrides:revised,filing_context:'schedule_c'};render();
        get('financialUSStatus').textContent='U.S. categories saved. Israeli accounts are unchanged.';
      }catch{if(get('financialUSStatus'))get('financialUSStatus').textContent='Could not save categories. Your changes have not been stored.';}
      finally{if(button.isConnected)button.disabled=false;}
    };
  }
  root.loadReports=async function(){
    setup();const token=++sequence;current=null;snapshot=null;
    get('financialExport').disabled=true;get('financialStatus').textContent='Loading saved FinBot accounts…';get('financialResults').innerHTML='';get('statsYearTotals').textContent='Loading annual totals…';
    try{
      const {data,error}=await client().from('finbot_reporting_snapshots').select('report_year,as_of_date,captured_at,payload').order('report_year',{ascending:false});
      if(token!==sequence)return;
      if(error)throw error;
      if(!data?.length){get('financialStatus').textContent='No FinBot snapshot has been imported yet.';return;}
      data.forEach(s=>{if(s.report_year!==s.payload.report_year||s.as_of_date!==s.payload.as_of_date)throw Error('Invalid snapshot');summarize(s.payload);});
      snapshots=data;loadInboxExpenses();get('financialYear').innerHTML=data.map(s=>`<option value="${s.report_year}">${s.report_year}</option>`).join('');chooseYear();
    }catch{if(token===sequence){get('financialStatus').textContent='Financial stats unavailable. Sign in as an admin and reload saved data.';renderOverview();}}
  };
  root.loadReportsByMonth=()=>root.loadReports();
})(typeof window!=='undefined'?window:globalThis);
