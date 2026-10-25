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
  const safeCell = v => {const text=String(v??'');return /^[=+@\-\t\r]/.test(text)?"'"+text:text;};
  function csvRows(model,payload,view,overrides={}) {
    const rows=[['Year','Snapshot date','Month / scope','View','Category','Source amount ILS','U.S. deduction','Notes']];
    const scope=model.months.length===1?model.months[0].month:'Year to snapshot date';
    const add=(period,label,n,note)=>rows.push([payload.report_year,payload.as_of_date,period,view,label,n/100,'',note]);
    if(view==='us') {
      usRows(model,overrides).forEach(r=>add(scope,r.us_category,r.amount_minor,title(r.label)+'; source ledger basis; deduction pending; no USD conversion'));
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
  const api={summarize,usRows,csvRows,buckets};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  if(!root.document)return;
  root.GremierFinancials=api;
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money=n=>new Intl.NumberFormat('en-IL',{style:'currency',currency:'ILS',minimumFractionDigits:2,maximumFractionDigits:2}).format(n/100);
  const monthName=m=>new Intl.DateTimeFormat('en',{month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(m+'-01T12:00:00Z'));
  const get=id=>document.getElementById(id);
  const metric=(label,value,note,cls='')=>`<div class="fin-metric ${cls}"><span>${esc(label)}</span><strong>${esc(value)}</strong>${note?`<small>${esc(note)}</small>`:''}</div>`;
  const row=(label,value)=>`<div class="fin-row"><span dir="auto">${esc(label)}</span><strong>${esc(value)}</strong></div>`;
  let snapshots=[],snapshot=null,preferences={},view='accounts',current=null,sequence=0,preferenceReady=false;
  const client=()=>typeof sb!=='undefined'?sb:root.MAIN_SB||root.ADMIN_SB;
  function setup() {
    const host=get('tab-reports');if(!host||get('financialResults'))return;
    host.innerHTML=`<header class="page-header"><div class="flex-between"><div><h1 class="page-title">Business stats</h1></div><span data-action-menu="Accounting tools"><button class="btn btn-outline btn-sm" id="financialExport" disabled>Export CSV</button><button class="btn btn-outline btn-sm" id="financialRefresh">Reload saved data</button></span></div></header>
      <section class="fin-panel" id="statsYearOverview"><div class="flex-between"><h2>Year overview</h2><label>Year<select class="form-input" id="financialYear" aria-label="Reporting year"></select></label></div><div id="statsYearTotals" role="status">Loading annual totals…</div></section>
      <div class="fin-toolbar"><label>FinBot period<select class="form-input" id="financialMonth" aria-label="Reporting period"></select></label></div>
      <p id="financialStatus" class="fin-note" role="status" aria-live="polite"></p>
      <div class="fin-views" role="group" aria-label="Expense reporting view"><button type="button" class="btn btn-outline" id="financialAccounts" aria-pressed="true">FinBot accounts</button><button type="button" class="btn btn-outline" id="financialUS" aria-pressed="false">U.S. expense view</button></div><div id="financialResults"></div>`;
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
    const live=root.GremierRevenue?.annualReport?.(year);
    const today=root.GremierDashboard?.businessDate(new Date())||new Date().toISOString().slice(0,10);
    host.innerHTML=`<div class="fin-metrics fin-year-metrics">${metric('Income',live?money(live.total_minor):'Unavailable',`Payments · ${year} through ${year===Number(today.slice(0,4))?today:year+'-12-31'}`)}${metric('Recorded expenses',money(annual.totals.expenses),`FinBot through ${snapshot.as_of_date}`)}</div><details class="sales-help"><summary>Why can the totals differ?</summary>${live?(()=>{const r=root.GremierRevenue.reconcile(live,annual.totals.income);return row('Saved FinBot income',money(r.snapshot))+row('Imported receipt adjustments / payment dates',money(r.importAdjustments))+row('Additional app receipts',money(r.newReceipts))+row('Paid online orders without receipts',money(r.unreceipted))+row('Current income · counted once',money(r.total));})():'<p>Live income could not be loaded. Refresh to retry.</p>'}<p class="fin-note">Income includes paid orders without receipts and links each order to its receipt once. FinBot figures below are a saved accounting report by document date. Expenses only include that report; newer expense documents are not included.</p></details>`;
  }
  root.addEventListener('gremier-revenue-ready',renderOverview);
  function chooseYear() {
    snapshot=snapshots.find(s=>String(s.report_year)===get('financialYear').value);current=null;
    preferences={};preferenceReady=false;
    get('financialMonth').innerHTML='<option value="all">Year to date · snapshot</option>'+snapshot.payload.monthly.map(m=>`<option value="${esc(m.month)}">${esc(monthName(m.month))}${m.is_partial_month?' · partial':''}</option>`).join('');
    render();
    const year=snapshot.report_year;
    client().from('finbot_us_expense_preferences').select('category_overrides,filing_context').eq('report_year',year).maybeSingle().then(({data,error})=>{
      if(snapshot?.report_year!==year)return;
      preferenceReady=!error;preferences=data||{};render();
    }).catch(()=>{});
  }
  function render() {
    if(!snapshot)return;
    renderOverview();
    try {
      current=summarize(snapshot.payload,get('financialMonth').value);
      const p=snapshot.payload,m=current,t=m.totals;
      get('financialExport').disabled=false;
      get('financialAccounts').setAttribute('aria-pressed',String(view==='accounts'));
      get('financialUS').setAttribute('aria-pressed',String(view==='us'));
      get('financialStatus').textContent=`Saved FinBot snapshot · ${new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(p.as_of_date+'T12:00:00Z'))}`;
      const coverage=`<aside class="fin-coverage"><details><summary>About these figures</summary><p>FinBot’s recorded accounts through ${esc(p.as_of_date)}. October is partial. Historical website receipts issued in October cover earlier payments, so the monthly view follows document dates, not when each sale happened. Website receipts are already included in revenue. Fixed assets are separate from profit-and-loss expenses.</p><p>${esc(p.coverage.unreported_expenses_2026)} dated ${p.report_year} expense documents were not yet reported; ${esc(p.coverage.undated_expenses_all_years)} documents across all years have no date. They are not estimated into these totals.</p></details></aside>`;
      if(view==='us'){renderUS(m,coverage);return;}
      const list=(items)=>items.map(c=>row(title(c.label),money(c.amount_minor))).join('')||'<p class="fin-note">No recorded costs in this period.</p>';
      const source=(label,n)=>`${row(label,money(n))}<div class="fin-track"><i style="width:${Math.max(0,Math.min(100,n/(t.income||1)*100))}%"></i></div>`;
      const max=Math.max(1,...m.months.flatMap(x=>[Math.abs(x.income_minor),Math.abs(x.expenses_minor)]));
      const trends=m.months.map(x=>`<tr><th scope="row">${esc(monthName(x.month))}${x.is_partial_month?'<small>Partial month</small>':''}</th><td>${esc(money(x.income_minor))}<div class="fin-track"><i style="width:${Math.max(0,x.income_minor)/max*100}%"></i></div></td><td>${esc(money(x.expenses_minor))}<div class="fin-track fin-expense"><i style="width:${Math.max(0,x.expenses_minor)/max*100}%"></i></div></td><td class="${x.net_minor<0?'fin-negative':'fin-positive'}">${esc(money(x.net_minor))}</td></tr>`).join('');
      get('financialResults').innerHTML=`<div class="fin-metrics">${metric('FinBot income',money(t.income),'Saved report')}${metric('Expenses',money(t.expenses),'')}${metric('Accounting result',money(t.net),'',t.net<0?'fin-negative':'fin-positive')}${metric('Result margin',m.margin===null?'—':m.margin.toFixed(1)+'%','')}</div>
        <div class="fin-grid"><section class="fin-panel"><h2>Revenue sources</h2>${source('Website receipts',m.sources.website)}${source('Other FinBot income',m.sources.other)}<p class="fin-note">Other income is unclassified.</p></section>
        <section class="fin-panel"><h2>Revenue to result</h2>${row('Revenue',money(t.income))}${row('Less cost of sales',money(t.cost_of_sales))}${row('Gross result',money(m.grossProfit))}${row('Less operating expenses',money(t.operating_expenses))}${row('Accounting result',money(t.net))}</section></div>
        <section class="fin-panel"><h2>Monthly revenue vs. expenses</h2><p class="fin-note">By document date · October includes receipts for earlier sales.</p><div class="table-wrap"><table class="fin-table"><thead><tr><th>Month</th><th>Revenue</th><th>Expenses</th><th>Result</th></tr></thead><tbody>${trends}</tbody></table></div></section>
        <div class="fin-grid"><section class="fin-panel"><h2>Cost of sales</h2>${list(m.categories.filter(c=>c.group==='cost_of_sales'))}</section><section class="fin-panel"><h2>Operating expenses</h2>${list(m.categories.filter(c=>c.group==='operating_expenses'))}</section></div>
        <div class="fin-grid"><section class="fin-panel"><h2>Supplier spending</h2><details><summary>View ${m.suppliers.length} suppliers</summary>${m.suppliers.map(([name,n])=>row(name,money(n))).join('')||'<p class="fin-note">No suppliers in this period.</p>'}</details></section><section class="fin-panel"><h2>Fixed assets</h2>${row('Recorded asset purchases',money(t.fixed_assets))}<p class="fin-note">Excluded from P&L expenses.</p></section></div><section class="fin-panel" id="financialReceiptActivity"><h2>Receipts since this snapshot</h2><p class="fin-note">Loading the live receipt register…</p></section>${coverage}`;
      loadReceiptActivity(snapshot,get('financialMonth').value);
    }catch{
      current=null;get('financialExport').disabled=true;get('financialResults').innerHTML='<p class="fin-note">This snapshot could not be validated. Reload saved data to retry.</p>';
    }
  }
  async function loadReceiptActivity(record,month) {
    try {
      const all=[];
      for(const table of ['business_receipts','order_receipts']){
        for(let offset=0;offset<100000;offset+=1000){
          const r=await client().from(table).select('amount_minor,issued_at').eq('status','issued').gt('issued_at',record.captured_at).order('issued_at').order(table==='order_receipts'?'order_id':'id').range(offset,offset+999);
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
  function renderUS(m,coverage) {
    const overrides=preferences.category_overrides||{},rows=usRows(m,overrides),groups=new Map();
    rows.forEach(r=>groups.set(r.bucket,(groups.get(r.bucket)||0)+r.amount_minor));
    const special=['home_electricity','home_water','home_property_tax','vehicle_lease','vehicle_running'];
    const specialRows=special.map(id=>row(buckets[id],groups.has(id)?money(groups.get(id)):'Not separately identified')).join('');
    const options=id=>Object.entries(buckets).map(([key,label])=>`<option value="${key}" ${key===id?'selected':''}>${esc(label)}</option>`).join('');
    const table=rows.map((r,i)=>`<tr><td><strong>${esc(title(r.label))}</strong><small dir="auto">${esc(r.label)}</small></td><td>${esc(money(r.amount_minor))}</td><td><select class="form-input fin-us-category" data-index="${i}" aria-label="U.S. category for ${esc(title(r.label))}">${options(r.bucket)}</select></td><td>Pending review</td></tr>`).join('');
    get('financialResults').innerHTML=`<section class="fin-coverage"><strong>Schedule C expense organizer</strong><p>Separate U.S. review categories, using the same source amounts in ILS. These are classification suggestions, not calculated deductions or a filed return. Israeli ledger amounts may already contain business-use adjustments; no 25% rule or reverse multiplication is applied. Full original bills, U.S. tax treatment and USD conversion still need review.</p></section>
      <div class="fin-grid"><section class="fin-panel"><h2>Home office</h2><p class="fin-note">There is no automatic business-use percentage. The simplified method uses $5 per qualifying square foot, up to 300 square feet, subject to the income limit and eligible regular, exclusive business use (exceptions can apply). It replaces actual home-office costs; do not add electricity and water deductions on top.</p><p class="fin-note">The actual-cost method needs the eligible business area and full bills. Foreign property tax / arnona needs separate treatment review. Missing bills are unknown, not zero.</p><a href="https://www.irs.gov/businesses/small-businesses-self-employed/simplified-option-for-home-office-deduction" target="_blank" rel="noopener">IRS home-office methods ↗</a></section>
      <section class="fin-panel"><h2>Leased car</h2><p class="fin-note">No fixed business-use percentage. Actual costs require business mileage ÷ total mileage and full lease/operating costs; a lease inclusion adjustment may apply. The standard-mileage option also requires records and cannot be combined with lease payments or fuel deductions for the same car. Prior method choices and the full lease period matter.</p><a href="https://www.irs.gov/taxtopics/tc510" target="_blank" rel="noopener">IRS business vehicle methods ↗</a> · <a href="https://www.irs.gov/publications/p463" target="_blank" rel="noopener">Lease rules ↗</a></section></div>
      <section class="fin-panel"><h2>Mixed-use costs to review</h2>${specialRows}<p class="fin-note">Amounts above are source accounting amounts, before U.S. review. Utilities or property taxes not listed separately may be missing or bundled; they are not inferred from another account.</p></section>
      <section class="fin-panel"><h2>U.S. category breakdown</h2>${[...groups].map(([id,n])=>row(buckets[id],money(n))).join('')}</section>
      <section class="fin-panel"><div class="flex-between"><h2>Review category assignments</h2><button class="btn btn-outline btn-sm" id="financialSaveUS" ${preferenceReady?'':'disabled'}>Save U.S. categories</button></div><p class="fin-note">Changes apply to the entire FinBot category for ${snapshot.report_year}. Split mixed bills separately with original records; this does not change the Israeli accounts.</p><div class="table-wrap"><table class="fin-table"><thead><tr><th>FinBot category</th><th>Source ILS</th><th>U.S. review category</th><th>U.S. deduction</th></tr></thead><tbody>${table}</tbody></table></div><p id="financialUSStatus" class="fin-note" role="status">${preferenceReady?'Categories are organized for Schedule C review.':'Saved category settings are unavailable. Reload before editing.'}</p><p class="fin-note">IRS guidance checked 20 October 2026; some annual publications currently cover 2025. Recheck 2026 filing instructions before filing. <a href="https://www.irs.gov/instructions/i1040sc" target="_blank" rel="noopener">Schedule C instructions ↗</a></p></section>${coverage}`;
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
      snapshots=data;get('financialYear').innerHTML=data.map(s=>`<option value="${s.report_year}">${s.report_year}</option>`).join('');chooseYear();
    }catch{if(token===sequence){get('financialStatus').textContent='Financial stats unavailable. Sign in as an admin and reload saved data.';renderOverview();}}
  };
  root.loadReportsByMonth=()=>root.loadReports();
})(typeof window!=='undefined'?window:globalThis);
