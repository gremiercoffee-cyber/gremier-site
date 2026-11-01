/* Stats page in tabs — Overview · Sales & products · Stores · Website & customers · Accounting — with
   bar charts over time and year over year. The existing Stats sections are moved into their tab
   unchanged; the new sections here are read-only. */
(function(root){
 'use strict';
 // ── pure helpers (exported for tests) ──
 const months=year=>Array.from({length:12},(_,i)=>year+'-'+String(i+1).padStart(2,'0'));
 const median=list=>{const s=[...list].sort((a,b)=>a-b);return s.length?s.length%2?s[(s.length-1)/2]:(s[s.length/2-1]+s[s.length/2])/2:null;};
 const dayDiff=(a,b)=>Math.round((Date.parse(b)-Date.parse(a))/864e5);
 const paidOrder=o=>o.payment_status==='paid'&&!o.is_test&&!o.delivery_info?.is_test&&!/^TEST(?:\b|[_-])/i.test(o.customer_name||'')&&!['cancelled','refunded'].includes(o.status)&&o.payment_method!=='gift_card';
 const who=o=>String(o.customer_email||'').trim().toLowerCase()||String(o.customer_phone||'').replace(/\D/g,'').slice(-9)||null;
 // Per store: the usual gap between deliveries, how long statements take to be paid, the trend.
 function storeStats(store,bills,deliveries,today){
  const mine=bills.filter(b=>b.store_id===store.id&&!b.cancelled_at),dates=[...new Set(deliveries.filter(d=>d.store_id===store.id).map(d=>d.delivery_date))].sort();
  const gaps=dates.slice(1).map((d,i)=>dayDiff(dates[i],d)).filter(g=>g>0);
  const pays=mine.filter(b=>b.billed_at&&b.paid_at).map(b=>dayDiff(b.billed_at,b.paid_at)).filter(n=>n>=0);
  const byMonth=m=>Math.round(mine.filter(b=>b.year+'-'+String(b.month).padStart(2,'0')===m).reduce((s,b)=>s+Number(b.total||0),0)*100);
  const cur=today.slice(0,7),back=n=>{const d=new Date(cur+'-15T12:00:00Z');d.setUTCMonth(d.getUTCMonth()-n);return d.toISOString().slice(0,7);};
  const recent=[1,2,3].reduce((s,n)=>s+byMonth(back(n)),0),before=[4,5,6].reduce((s,n)=>s+byMonth(back(n)),0);
  const owed=mine.filter(b=>!b.paid_at).reduce((s,b)=>s+(b.invoiced_gross_minor??Math.round(Number(b.total||0)*100)),0);
  const oldest=mine.filter(b=>!b.paid_at&&b.billed_at).map(b=>b.billed_at).sort()[0]||null;
  return {gap:median(gaps),payDays:median(pays),trend:before?Math.round((recent-before)/before*100):null,owed,oldestBilled:oldest,lastDelivery:dates.at(-1)||null,last6:[6,5,4,3,2,1,0].map(n=>({month:back(n),value:byMonth(back(n))}))};
 }
 // Website customers by month: first-time vs returning, average order value.
 function customerMonths(orders,year){
  const first=new Map();
  for(const o of [...orders].filter(paidOrder).sort((a,b)=>String(a.created_at).localeCompare(String(b.created_at)))){const k=who(o);if(k&&!first.has(k))first.set(k,o.id);}
  return months(year).map(m=>{const list=orders.filter(o=>paidOrder(o)&&String(o.created_at).slice(0,7)===m),fresh=list.filter(o=>!who(o)||first.get(who(o))===o.id).length;
   const total=list.reduce((s,o)=>s+Math.round(Number(o.total||0)*100),0);return {month:m,orders:list.length,new:fresh,returning:list.length-fresh,revenue:total,aov:list.length?Math.round(total/list.length):0};});
 }
 const api={months,median,storeStats,customerMonths,paidOrder,who};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
 if(!root.document)return;
 root.GremierStatsTabs=api;

 // ── page ──
 const get=id=>document.getElementById(id),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const money=n=>'₪'+Math.round(n/100).toLocaleString('en-IL'),num=n=>Math.round(n).toLocaleString('en-IL');
 const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jerusalem'}).format(new Date());
 const monthShort=m=>new Date(m+'-15T12:00:00Z').toLocaleDateString('en-GB',{month:'short',timeZone:'UTC'});
 const monthLong=m=>new Date(m+'-15T12:00:00Z').toLocaleDateString('en-GB',{month:'long',year:'numeric',timeZone:'UTC'});
 const client=()=>typeof sb!=='undefined'?sb:root.MAIN_SB||root.ADMIN_SB;
 const TABS=[['overview','Overview'],['sales','Sales & products'],['stores','Stores'],['web','Website & customers'],['accounting','Accounting']];
 // Validated categorical order (blue, orange, aqua, yellow, magenta, green, violet); gray = not recorded.
 const C=['#2a78d6','#eb6834','#1baf7a','#eda100','#e87ba4','#008300','#6250d6'],GRAY='#a3a29c';
 let tab='overview';try{tab=localStorage.getItem('gremier_stats_tab')||'overview';}catch{}
 let year=+today().slice(0,4),data=null,serial=0;

 // A bar chart: one bar per label, stacked series or side-by-side groups, hover/focus for the values.
 function chart({title,labels,series,stacked=true,format=money,note=''}){
  const totals=labels.map((_,i)=>stacked?series.reduce((s,x)=>s+(x.values[i]||0),0):Math.max(0,...series.map(x=>x.values[i]||0)));
  const max=Math.max(1,...totals),nice=(()=>{const p=10**Math.floor(Math.log10(max)),f=max/p;return (f<=1?1:f<=2?2:f<=5?5:10)*p;})();
  const col=(i)=>{const parts=series.map(x=>({name:x.name,color:x.color,v:x.values[i]||0}));
   const tip=`${labels[i].tip||labels[i].label}: `+(series.length>1?parts.filter(p=>p.v).map(p=>`${p.name} ${format(p.v)}`).join(' · ')+(stacked?` · Total ${format(totals[i])}`:''):format(totals[i]));
   const bars=stacked?`<div class="st-stack" style="height:${(totals[i]/nice*100).toFixed(2)}%">${parts.filter(p=>p.v>0).reverse().map(p=>`<span style="flex:${p.v};background:${p.color}"></span>`).join('')}</div>`
    :`<div class="st-group">${parts.map(p=>`<span style="height:${(p.v/nice*100).toFixed(2)}%;background:${p.color}"></span>`).join('')}</div>`;
   return `<div class="st-col" tabindex="0" data-tip="${esc(tip)}" aria-label="${esc(tip)}">${bars}<small>${esc(labels[i].label)}</small></div>`;};
  return `<section class="st-card"><div class="st-card-head"><h3>${esc(title)}</h3>${series.length>1?`<div class="st-legend">${series.map(x=>`<span><i style="background:${x.color}"></i>${esc(x.name)}</span>`).join('')}</div>`:''}</div>
   <div class="st-chart" role="img" aria-label="${esc(title)}"><div class="st-axis"><span>${esc(format(nice))}</span><span>${esc(format(nice/2))}</span><span>0</span></div><div class="st-plot">${labels.map((_,i)=>col(i)).join('')}</div></div>
   ${note?`<p class="sales-note">${esc(note)}</p>`:''}
   <details class="st-table"><summary>Show as table</summary><div class="table-wrap"><table><thead><tr><th></th>${series.map(x=>`<th>${esc(x.name)}</th>`).join('')}${stacked&&series.length>1?'<th>Total</th>':''}</tr></thead><tbody>${labels.map((l,i)=>`<tr><th>${esc(l.tip||l.label)}</th>${series.map(x=>`<td>${esc(format(x.values[i]||0))}</td>`).join('')}${stacked&&series.length>1?`<td>${esc(format(totals[i]))}</td>`:''}</tr>`).join('')}</tbody></table></div></details></section>`;
 }
 // A line chart over time: one 2px line per series, dots on each point, hover/focus a month for its values.
 // Months still to come are left empty (null), so lines stop at today.
 function line({title,labels,series,format=money,note='',dots=true}){
  const W=640,H=220,L=56,Rm=12,T=12,B=26,pw=W-L-Rm,ph=H-T-B,n=labels.length;
  const vals=series.flatMap(x=>x.values.filter(v=>v!==null&&v!==undefined));
  const max=Math.max(1,...vals),nice=(()=>{const p=10**Math.floor(Math.log10(max)),f=max/p;return (f<=1?1:f<=2?2:f<=5?5:10)*p;})();
  const X=i=>L+(n===1?pw/2:i*pw/(n-1)),Y=v=>T+ph-(v/nice)*ph;
  const path=x=>{let d='',pen=false;x.values.forEach((v,i)=>{if(v===null||v===undefined){pen=false;return;}d+=(pen?'L':'M')+X(i).toFixed(1)+' '+Y(v).toFixed(1);pen=true;});return d;};
  const grid=[0,.5,1].map(f=>`<line x1="${L}" x2="${W-Rm}" y1="${Y(nice*f)}" y2="${Y(nice*f)}" class="st-grid"/><text x="${L-8}" y="${Y(nice*f)+4}" text-anchor="end" class="st-ax">${esc(format(nice*f))}</text>`).join('');
  const xl=labels.map((l,i)=>`<text x="${X(i)}" y="${H-8}" text-anchor="middle" class="st-ax">${esc(l.label)}</text>`).join('');
  const lines=series.map(x=>`<path d="${path(x)}" fill="none" stroke="${x.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"${x.dash?' stroke-dasharray="5 4"':''}/>`+x.values.map((v,i)=>v===null||v===undefined||!dots?'':`<circle cx="${X(i)}" cy="${Y(v)}" r="4" fill="${x.color}" stroke="var(--card)" stroke-width="2"/>`).join('')).join('');
  const step=n>1?pw/(n-1):pw;
  const hits=labels.map((l,i)=>{const parts=series.filter(x=>x.values[i]!==null&&x.values[i]!==undefined);if(!parts.length)return '';
   const tip=`${l.tip||l.label}: `+parts.map(x=>series.length>1?`${x.name} ${format(x.values[i])}`:format(x.values[i])).join(' · ');
   return `<g class="st-hit" tabindex="0" data-tip="${esc(tip)}" aria-label="${esc(tip)}"><rect x="${X(i)-step/2}" y="${T}" width="${step}" height="${ph}" fill="transparent"/><line class="st-cross" x1="${X(i)}" x2="${X(i)}" y1="${T}" y2="${T+ph}"/></g>`;}).join('');
  return `<section class="st-card"><div class="st-card-head"><h3>${esc(title)}</h3>${series.length>1?`<div class="st-legend">${series.map(x=>`<span><i style="background:${x.color}"></i>${esc(x.name)}</span>`).join('')}</div>`:''}</div>
   <svg class="st-line" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}">${grid}${xl}${lines}${hits}</svg>
   ${note?`<p class="sales-note">${esc(note)}</p>`:''}
   <details class="st-table"><summary>Show as table</summary><div class="table-wrap"><table><thead><tr><th></th>${series.map(x=>`<th>${esc(x.name)}</th>`).join('')}</tr></thead><tbody>${labels.map((l,i)=>series.some(x=>x.values[i]!==null&&x.values[i]!==undefined)?`<tr><th>${esc(l.tip||l.label)}</th>${series.map(x=>`<td>${x.values[i]===null||x.values[i]===undefined?'—':esc(format(x.values[i]))}</td>`).join('')}</tr>`:'').join('')}</tbody></table></div></details></section>`;
 }
 // Months after this one have no data yet.
 // Several charts in one card: chips on top switch between them, and the choice is remembered.
 // A chart can itself be a switcher (e.g. the running total's year filter); it nests without a second card.
 const inner=h=>String(h).replace(/^\s*<section class="st-card([^"]*)"/,'<div class="st-inner$1"').replace(/<\/section>\s*$/,'</div>');
 function multi(id,charts,sub=false){
  charts=charts.filter(c=>c&&c.html);if(!charts.length)return '';if(charts.length===1&&!sub)return charts[0].html;
  let pick=charts[0].key;try{const v=localStorage.getItem('gremier_stats_multi_'+id);if(charts.some(c=>c.key===v))pick=v;}catch{}
  return `<section class="st-card st-multi${sub?' st-sub':''}" data-multi="${esc(id)}"><div class="st-chips" role="tablist">${charts.map(c=>`<button type="button" role="tab" data-multi-key="${esc(c.key)}" aria-selected="${c.key===pick}">${esc(c.label)}</button>`).join('')}</div>${charts.map(c=>`<div class="st-multi-pane" data-multi-pane="${esc(c.key)}"${c.key===pick?'':' hidden'}>${inner(c.html)}</div>`).join('')}</section>`;
 }
 if(root.document)document.addEventListener('click',e=>{
  const b=e.target.closest?.('[data-multi-key]');if(!b)return;const box=b.closest('[data-multi]'),key=b.dataset.multiKey;
  box.querySelectorAll(':scope>.st-chips>[data-multi-key]').forEach(x=>x.setAttribute('aria-selected',String(x===b)));
  box.querySelectorAll(':scope>[data-multi-pane]').forEach(x=>x.hidden=x.dataset.multiPane!==key);
  try{localStorage.setItem('gremier_stats_multi_'+box.dataset.multi,key);}catch{}
 });
 const upToNow=(list,keys)=>list.map((v,i)=>keys[i]>today().slice(0,7)?null:v);
 const tile=(label,value,note='',cls='')=>`<div class="st-tile ${cls}"><span>${esc(label)}</span><strong>${esc(value)}</strong>${note?`<small>${esc(note)}</small>`:''}</div>`;

 // ── layout: tab bar + one pane per tab; existing sections are moved into their pane ──
 const placeOf=node=>{
  const has=id=>node.id===id||!!node.querySelector?.('#'+id);
  if(has('statsYearOverview'))return 'overview';
  if(has('salesByType')||has('salesExplorer')||has('revenueExplorer'))return 'sales';
  if(node.classList?.contains('fin-views')||node.classList?.contains('fin-toolbar')||has('financialResults')||has('financialStatus')||has('financialReceiptActivity'))return 'accounting';
  if(/analytic|visitor/i.test(node.id||''))return 'web';
  return 'accounting';
 };
 function layout(){
  const host=get('tab-reports');if(!host||!host.querySelector('.page-header'))return;
  let bar=get('statsTabs');
  if(!bar){
   bar=document.createElement('nav');bar.id='statsTabs';bar.className='st-tabs';bar.setAttribute('aria-label','Stats sections');
   bar.innerHTML=`<div class="st-tab-list" role="tablist">${TABS.map(([k,l])=>`<button type="button" role="tab" data-stats-tab="${k}" aria-selected="${k===tab}">${l}</button>`).join('')}</div><label class="st-year">Year<select class="form-input" id="statsTabYear"></select></label>`;
   host.querySelector('.page-header').after(bar);
   for(const [k] of TABS){const pane=document.createElement('div');pane.className='st-pane';pane.dataset.pane=k;pane.innerHTML=`<div class="st-new" id="statsNew-${k}"></div>`;host.append(pane);}
   bar.querySelectorAll('[data-stats-tab]').forEach(b=>b.onclick=()=>{tab=b.dataset.statsTab;try{localStorage.setItem('gremier_stats_tab',tab);}catch{}show();});
   const y=+today().slice(0,4);get('statsTabYear').innerHTML=[y,y-1,y-2].map(v=>`<option ${v===year?'selected':''}>${v}</option>`).join('');
   get('statsTabYear').onchange=()=>{year=+get('statsTabYear').value;draw();};
  }
  for(const node of [...host.children]){
   if(node===bar||node.classList.contains('page-header')||node.classList.contains('st-pane')||node.tagName==='STYLE'||node.tagName==='SCRIPT')continue;
   host.querySelector(`.st-pane[data-pane="${placeOf(node)}"]`)?.append(node);
  }
  // The new sections lead each pane; Accounting keeps its view switch first.
  for(const pane of host.querySelectorAll('.st-pane')){const fresh=pane.querySelector('.st-new');if(pane.dataset.pane==='accounting')pane.append(fresh);else if(pane.firstElementChild!==fresh)pane.prepend(fresh);}
  show();
 }
 function show(){
  document.querySelectorAll('#tab-reports .st-pane').forEach(p=>p.hidden=p.dataset.pane!==tab);
  document.querySelectorAll('#statsTabs [data-stats-tab]').forEach(b=>{b.setAttribute('aria-selected',String(b.dataset.statsTab===tab));if(b.dataset.statsTab===tab)b.parentElement.scrollLeft=Math.max(0,b.offsetLeft-16);});
 }

 // ── data ──
 async function pages(make){const out=[];for(let n=0;n<100000;n+=1000){const r=await make().range(n,n+999);if(r.error||!Array.isArray(r.data))throw Error('Could not load stats. Refresh to retry.');out.push(...r.data);if(r.data.length<1000)return out;}throw Error('Too much data to load.');}
 async function load(){
  layout();const seq=++serial;
  for(const [k] of TABS)if(get('statsNew-'+k)&&!data)get('statsNew-'+k).innerHTML='<p class="sales-note">Loading…</p>';
  try{
   const c=client(),since=new Date(Date.now()-90*864e5).toISOString();
   const [orders,products,stores,bills,deliveries,snaps,events,feedback,invoices,receipts]=await Promise.all([
    pages(()=>c.from('orders').select('id,order_number,created_at,total,items,customer_email,customer_phone,customer_name,status,payment_status,payment_method,delivery_info,payment_confirmed_at').eq('payment_status','paid').order('created_at').order('id')),
    pages(()=>c.from('products').select('id,name_en,name_he,category,is_coffee_bar').order('id')),
    pages(()=>c.from('stores').select('id,name,is_active,price_large,price_small,price_dairy_free,price_unfiltered,price_syrup').order('id')),
    pages(()=>c.from('store_billing').select('id,store_id,year,month,total,billed_at,paid_at,cancelled_at,invoiced_gross_minor').order('id')),
    pages(()=>c.from('store_deliveries').select('id,store_id,delivery_date,qty_large,qty_small,qty_dairy_free,qty_unfiltered,qty_syrup,quantities').order('delivery_date').order('id')),
    pages(()=>c.from('finbot_reporting_snapshots').select('report_year,as_of_date,payload').order('report_year')).catch(()=>[]),
    pages(()=>c.from('site_events').select('kind,sid,created_at').gte('created_at',since).order('created_at')).catch(()=>[]),
    pages(()=>c.from('feedback').select('rating,created_at').order('created_at')).catch(()=>[]),
    pages(()=>c.from('store_tax_invoices').select('vat_minor,issued_at,status').order('id')).catch(()=>[]),
    pages(()=>c.from('business_receipts').select('id,store_id,amount_minor,payment_date,status').order('id')).catch(()=>[])]);
   if(seq!==serial)return;
   data={orders,products,stores,bills,deliveries,snaps,events,feedback,invoices,receipts};draw();
  }catch(e){if(seq!==serial)return;for(const [k] of TABS)if(get('statsNew-'+k))get('statsNew-'+k).innerHTML=`<p class="sales-note">${esc(e.message)}</p>`;}
 }

 // Sales per month: store statements (delivered value), website and other income counted once.
 // Stores count what was delivered (the month's statement, paid or not). Months without statements
 // (before June 2026) count store payments instead; payments received in statement months beyond what
 // paid those statements were for earlier deliveries, so they're kept too, in the month received.
 function salesByMonth(y){
  const rev=root.GremierRevenue?.monthly?.(y),keys=months(y);
  const billed=keys.map(m=>data.bills.filter(b=>!b.cancelled_at&&b.year+'-'+String(b.month).padStart(2,'0')===m));
  const inStatementMonths=keys.reduce((s,m,i)=>s+(billed[i].length?(rev?.[i]?.stores||0):0),0);
  const paidStatements=data.bills.filter(b=>!b.cancelled_at&&b.paid_at&&b.year===y).reduce((s,b)=>s+Math.round(Number(b.total||0)*100),0);
  const late=inStatementMonths?Math.max(0,inStatementMonths-paidStatements)/inStatementMonths:0;
  return keys.map((m,i)=>{
   const pay=rev?.[i]?.stores||0;
   const stores=billed[i].length?Math.round(billed[i].reduce((s,b)=>s+Number(b.total||0),0)*100)+Math.round(pay*late):pay;
   return {month:m,stores,online:rev?.[i]?.online||0,other:rev?.[i]?.other||0};
  });
 }
 // Old-website sales exist only as one total for the year, so they're in year totals but not in any month.
 const oldWebsite=y=>(root.GremierRevenue?.annualReport?.(y)?.rows||[]).filter(r=>r.summary).reduce((s,r)=>s+r.amount_minor,0);
 const finbotYear=y=>data.snaps.find(s=>s.report_year===y);
 const finbotMonth=(y,m)=>finbotYear(y)?.payload?.monthly?.find(x=>x.month===m);
 // From 2026 the site knows every sale (receipts, paid orders without one yet, store deliveries, events);
 // earlier years only exist in FinBot. Months still to come are empty.
 const APP_FROM=2026;
 const yearByMonth=y=>y>=APP_FROM?upToNow(salesByMonth(y).map(r=>r.stores+r.online+r.other),months(y)):Array.from({length:12},(_,i)=>finbotMonth(y,y+'-'+String(i+1).padStart(2,'0'))?.income_minor??null);

 function drawOverview(){
  const t=today(),cur=t.slice(0,7),rows=salesByMonth(year),sum=r=>r.stores+r.online+r.other;
  const thisMonth=rows.find(r=>r.month===cur),prevKey=months(year)[Math.max(0,+cur.slice(5)-2)];
  const lastYearSame=finbotMonth(year-1,(year-1)+cur.slice(4));
  const ytd=rows.filter(r=>r.month<=cur).reduce((s,r)=>s+sum(r),0);
  const pct=(a,b)=>b?`${a>=b?'▲':'▼'} ${Math.abs(Math.round((a-b)/b*100))}%`:'';
  const owed=data.stores.map(s=>({s,x:storeStats(s,data.bills,data.deliveries,t)})).filter(({x})=>x.oldestBilled&&dayDiff(x.oldestBilled,t)>45).sort((a,b)=>b.x.owed-a.x.owed);
  const isNow=year===+t.slice(0,4);
  get('statsNew-overview').innerHTML=`<div class="st-tiles">
   ${isNow&&thisMonth?tile(monthLong(cur)+' so far',money(sum(thisMonth)),prevKey!==cur?`${monthShort(prevKey)}: ${money(sum(rows.find(r=>r.month===prevKey)))}`:''):''}
   ${isNow&&lastYearSame?tile('Same month last year',money(lastYearSame.income_minor),'FinBot income'):''}
   ${tile((isNow?'This year so far':'Year '+year),money(ytd+oldWebsite(year)),'Stores delivered (paid or not) + website + events'+(oldWebsite(year)?` · incl. ${money(oldWebsite(year))} old website`:''))}
   ${(()=>{const a=yearByMonth(year),b=yearByMonth(year-1),upTo=+cur.slice(5)-(isNow?1:0),through=isNow?upTo:12;if(!b.some(v=>v)||through<1)return '';
    const now=a.slice(0,through).reduce((s,v)=>s+(v||0),0)+oldWebsite(year),then=b.slice(0,through).reduce((s,v)=>s+(v||0),0);
    return tile('vs last year',pct(now,then)||'—',`${money(now)} vs ${money(then)}, Jan–${monthShort(year+'-'+String(through).padStart(2,'0'))}`);})()}
  </div>
  ${multi('overview',[{key:'month',label:'By month',html:line({title:`Sales by month · ${year}`,labels:rows.map(r=>({label:monthShort(r.month),tip:monthLong(r.month)})),series:[{name:'Total',color:'#52514e',dash:true,values:upToNow(rows.map(sum),rows.map(r=>r.month))},{name:'Stores',color:C[0],values:upToNow(rows.map(r=>r.stores),rows.map(r=>r.month))},{name:'Website',color:C[1],values:upToNow(rows.map(r=>r.online),rows.map(r=>r.month))},{name:'Events & other',color:C[2],values:upToNow(rows.map(r=>r.other),rows.map(r=>r.month))}],
   note:'Stores: what was delivered each month (paid or not); before June 2026, store payments. Website and events: payments, each counted once.'+(oldWebsite(year)?` Old-website sales (${money(oldWebsite(year))}) are one total for the year, so they're not in any month.`:'')})},
  {key:'total',label:'Running total',html:(()=>{
   // Running total of every sale, month by month: always going up. Filter: all time, one year, or the
   // last two years; each starts from zero. An old-website lump sum (no months) is added in the month its period ended.
   const first=Math.min(...data.snaps.map(s=>s.report_year),APP_FROM),now=+today().slice(0,4);
   const run=(from,to)=>{const keys=[],vals=[];let t=0;
    for(let y=from;y<=to;y++){const m=yearByMonth(y),lumps=(root.GremierRevenue?.annualReport?.(y)?.rows||[]).filter(r=>r.summary);
     m.forEach((v,i)=>{const k=y+'-'+String(i+1).padStart(2,'0');if(k>today().slice(0,7))return;t+=(v||0)+(y>=APP_FROM?lumps.filter(r=>String(r.date).slice(0,7)===k).reduce((n,r)=>n+r.amount_minor,0):0);keys.push(k);vals.push(t);});}
    if(!keys.length)return '';
    const many=to>from;
    return line({title:many?`Total sales over time · ${from}–${to}`:`Total sales · ${from}`,dots:keys.length<=18,labels:keys.map(k=>({label:many?(k.endsWith('-01')?k.slice(0,4):''):monthShort(k),tip:monthLong(k)})),series:[{name:'Running total',color:C[0],values:vals}],
     note:`Every sale added up from January ${from}: ${money(t)}${to>=now?' so far':''}. FinBot income for years before ${APP_FROM}; every sale we know of from ${APP_FROM}.`});};
   const years=[];for(let y=now;y>=first;y--)years.push(y);
   return multi('running',[{key:'all',label:'All time',html:run(first,now)},...(now-first>=2?[{key:'last2',label:`${now-1}–${now}`,html:run(now-1,now)}]:[]),...years.map(y=>({key:String(y),label:String(y),html:run(y,y)}))],true);})()},
  {key:'yoy',label:'Year over year',html:(()=>{const ys=[year-2,year-1,year].filter(y=>y>=APP_FROM||finbotYear(y));if(ys.length<2)return `<section class="st-card"><h3>Year over year</h3><p class="sales-note">Earlier years appear here once their FinBot reports are imported.</p></section>`;
   const total=y=>yearByMonth(y).reduce((s,v)=>s+(v||0),0)+(y>=APP_FROM?oldWebsite(y):0);
   return line({title:'Year over year · income by month',labels:Array.from({length:12},(_,i)=>({label:monthShort('2000-'+String(i+1).padStart(2,'0'))})),series:ys.map((y,j)=>({name:String(y),color:j===ys.length-1?C[0]:j===ys.length-2?C[1]:C[2],values:yearByMonth(y)})),
    note:`From ${APP_FROM}: every sale we know of, as in Sales by month above (old-website sales are in the year total only; they have no months). Earlier years: income as recorded in FinBot. `+ys.map(y=>`${y}: ${money(total(y))}`).join(' · ')});})()}])}
  ${owed.length?`<section class="st-card"><h3>Stores owing for over 45 days</h3>${owed.map(({s,x})=>`<div class="fin-row"><span>${esc(s.name)}<small> · oldest statement ${esc(x.oldestBilled.slice(0,10))}</small></span><strong>${money(x.owed)}</strong></div>`).join('')}</section>`:''}`;
 }

 function drawSales(){
  const S=root.GremierSalesByType;if(!S){get('statsNew-sales').innerHTML='';return;}
  const per=months(year).map(m=>{const o=data.orders.filter(x=>String(x.created_at).slice(0,7)===m),d=data.deliveries.filter(x=>String(x.delivery_date).slice(0,7)===m);return {m,on:S.onlineTotals(o,data.products),st:S.storeTotals(d,data.stores)};});
  const units=(r,k)=>r.on.totals[k].units+r.st.totals[k].units,prod=(r,k)=>(r.on.products[k]?.units||0)+(r.st.products[k]?.units||0);
  const labels=per.map(r=>({label:monthShort(r.m),tip:monthLong(r.m)}));
  const flavours=[['large:classic','Classic'],['large:house','House Blend'],['large:colombia','Colombia'],['large:sweetened','Sweetened'],['large:decaf','Decaf'],['large:unfiltered','Unfiltered']];
  const dow=[0,0,0,0,0,0,0];for(const o of data.orders.filter(o=>paidOrder(o)&&String(o.created_at).startsWith(String(year))))dow[new Date(o.created_at).getDay()]++;
  const keys=per.map(r=>r.m);
  get('statsNew-sales').innerHTML=multi('sales',[{key:'bottles',label:'Bottles',html:line({title:`Bottles per month · ${year}`,format:num,labels,series:[{name:'Liter bottles',color:C[0],values:upToNow(per.map(r=>units(r,'large')),keys)},{name:'Minis',color:C[1],values:upToNow(per.map(r=>units(r,'mini')),keys)},{name:'5L jerry cans',color:C[2],values:upToNow(per.map(r=>units(r,'jerry')),keys)}],note:'Website orders and store deliveries (stores from June 2026).'})
   },{key:'flavour',label:'By flavour',html:line({title:`Liter bottles by flavour · ${year}`,format:num,labels,series:[...flavours.map(([k,n],i)=>({name:n,color:C[i],values:upToNow(per.map(r=>prod(r,k)),keys)})),{name:'Not recorded',color:GRAY,dash:true,values:upToNow(per.map(r=>prod(r,'large:unknown')),keys)}],note:'Store deliveries count by the flavours logged on each delivery.'})
   },{key:'dow',label:'Day of week',html:chart({title:`Website orders by day of the week · ${year}`,format:num,labels:['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(l=>({label:l})),series:[{name:'Orders',color:C[0],values:dow}]})}]);
 }

 function drawStores(){
  const t=today(),active=data.stores.filter(s=>s.is_active!==false||data.bills.some(b=>b.store_id===s.id&&!b.paid_at&&!b.cancelled_at));
  const rows=active.map(s=>({s,x:storeStats(s,data.bills,data.deliveries,t),ytd:Math.round(data.bills.filter(b=>b.store_id===s.id&&!b.cancelled_at&&b.year===year).reduce((n,b)=>n+Number(b.total||0),0)*100)})).filter(r=>r.ytd||r.x.owed).sort((a,b)=>b.ytd-a.ytd);
  const monthly=months(year).map(m=>Math.round(data.bills.filter(b=>!b.cancelled_at&&b.year+'-'+String(b.month).padStart(2,'0')===m).reduce((n,b)=>n+Number(b.total||0),0)*100));
  const spark=list=>{const mx=Math.max(1,...list.map(x=>x.value)),pts=list.map((x,i)=>`${(i*80/(list.length-1)+2).toFixed(1)},${(24-x.value/mx*20).toFixed(1)}`);return `<svg class="st-spark" viewBox="0 0 84 28" aria-label="${esc(list.map(x=>monthShort(x.month)+' '+money(x.value)).join(', '))}"><polyline points="${pts.join(' ')}" fill="none" stroke="${C[0]}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/><circle cx="${pts.at(-1).split(',')[0]}" cy="${pts.at(-1).split(',')[1]}" r="3" fill="${C[0]}"/></svg>`;};
  const top=data.stores.length?line({title:`Store sales by month · ${year}`,labels:months(year).map(m=>({label:monthShort(m),tip:monthLong(m)})),series:[{name:'Stores',color:C[0],values:upToNow(monthly,months(year))}],note:'Monthly statements before VAT. Store statements start in June 2026.'}):'';
  get('statsNew-stores').innerHTML=top+`<section class="st-card"><h3>Stores · ${year}</h3><div class="table-wrap"><table class="st-store-table"><thead><tr><th>Store</th><th>Last 7 months</th><th>${year}</th><th>Trend</th><th>Delivers every</th><th>Pays within</th><th>Owes now</th></tr></thead><tbody>${rows.map(({s,x,ytd})=>`<tr><td class="st-name"><b>${esc(s.name)}</b>${x.lastDelivery?`<small>Last delivery ${esc(x.lastDelivery)}</small>`:''}</td><td>${spark(x.last6)}</td><td>${money(ytd)}</td><td>${x.trend===null?'—':`<span class="${x.trend>=0?'st-up':'st-down'}">${x.trend>=0?'▲':'▼'} ${Math.abs(x.trend)}%</span>`}</td><td>${x.gap?`${Math.round(x.gap)} days`:'—'}</td><td>${x.payDays!==null?`${Math.round(x.payDays)} days`:'—'}</td><td>${x.owed?money(x.owed):'—'}</td></tr>`).join('')||'<tr><td colspan="7">No store sales this year.</td></tr>'}</tbody></table></div><p class="sales-note">Trend: last 3 full months vs the 3 before. "Delivers every" is the usual gap between deliveries; "Pays within" the usual days from sending a statement to being paid.</p></section>`;
 }

 function drawWeb(){
  const cm=customerMonths(data.orders,year),labels=cm.map(r=>({label:monthShort(r.month),tip:monthLong(r.month)}));
  const yearOrders=data.orders.filter(o=>paidOrder(o)&&String(o.created_at).startsWith(String(year)));
  const buyers=new Map();for(const o of yearOrders){const k=who(o);if(k)buyers.set(k,(buyers.get(k)||0)+1);}
  const repeat=[...buyers.values()].filter(n=>n>1).length,revenue=yearOrders.reduce((s,o)=>s+Math.round(Number(o.total||0)*100),0);
  const sessions=k=>new Set(data.events.filter(e=>e.kind===k&&Date.parse(e.created_at)>Date.now()-30*864e5).map(e=>e.sid)).size;
  // Paid orders over the same days the steps were tracked (tracking began 24 Oct 2026).
  const tracked=Math.max(Date.now()-30*864e5,Math.min(...data.events.map(e=>Date.parse(e.created_at)),Date.now()));
  const paid30=data.orders.filter(o=>paidOrder(o)&&Date.parse(o.created_at)>=tracked).length;
  const steps=[['Added to cart',sessions('cart_add')],['Opened checkout',sessions('checkout_open')],['Pressed pay',sessions('pay_click')],['Paid orders',paid30]];
  const types={};for(const o of yearOrders){const k=({regular:'Regular delivery',expedited:'Expedited',pickup:'Pickup',event:'Event'})[String(o.delivery_info?.delivery_type||'').toLowerCase()]||'Other';types[k]=(types[k]||0)+1;}
  const spend=new Map();for(const o of yearOrders){const k=who(o)||o.id;const r=spend.get(k)||{name:o.customer_name||'Customer',orders:0,total:0};r.orders++;r.total+=Math.round(Number(o.total||0)*100);spend.set(k,r);}
  const rated=data.feedback.filter(f=>String(f.created_at).startsWith(String(year))),avg=rated.length?rated.reduce((s,f)=>s+f.rating,0)/rated.length:null;
  get('statsNew-web').innerHTML=`<div class="st-tiles">${tile('Paid orders · '+year,num(yearOrders.length))}${tile('Average order',yearOrders.length?money(revenue/yearOrders.length):'—')}${tile('Customers',num(buyers.size),buyers.size?`${Math.round(repeat/buyers.size*100)}% ordered more than once`:'')}${tile('Reviews',avg===null?'—':avg.toFixed(1)+' ★',rated.length?rated.length+' this year':'')}</div>
   ${multi('web',[{key:'orders',label:'Orders',html:line({title:`Website orders by month · ${year}`,format:num,labels,series:[{name:'All orders',color:'#52514e',dash:true,values:upToNow(cm.map(r=>r.orders),cm.map(r=>r.month))},{name:'New customers',color:C[0],values:upToNow(cm.map(r=>r.new),cm.map(r=>r.month))},{name:'Returning',color:C[1],values:upToNow(cm.map(r=>r.returning),cm.map(r=>r.month))}]})}
   ,{key:'aov',label:'Average order',html:line({title:`Average order value · ${year}`,labels,series:[{name:'Average order',color:C[0],values:upToNow(cm.map(r=>r.orders?r.aov:null),cm.map(r=>r.month))}]})}])}
   <section class="st-card"><h3>Checkout funnel · last 30 days</h3>${steps.map(([l,n],i)=>`<div class="st-funnel"><span>${esc(l)}</span><b style="width:${steps[0][1]?Math.min(100,Math.max(2,n/steps[0][1]*100)):0}%"></b><strong>${num(n)}${i&&steps[i-1][1]?` <small>${Math.round(n/steps[i-1][1]*100)}%</small>`:''}</strong></div>`).join('')}<p class="sales-note">Browsers that added to cart, opened checkout and pressed pay (counted from 24 Oct 2026), and paid orders.</p></section>
   <section class="st-card st-two"><div><h3>How orders arrive · ${year}</h3>${Object.entries(types).sort((a,b)=>b[1]-a[1]).map(([k,n])=>`<div class="fin-row"><span>${esc(k)}</span><strong>${num(n)} · ${Math.round(n/yearOrders.length*100)}%</strong></div>`).join('')||'<p class="sales-note">No orders yet.</p>'}</div>
   <div><h3>Top customers · ${year}</h3>${[...spend.values()].sort((a,b)=>b.total-a.total).slice(0,8).map(r=>`<div class="fin-row"><span>${esc(r.name)}<small> · ${r.orders} order${r.orders>1?'s':''}</small></span><strong>${money(r.total)}</strong></div>`).join('')||'<p class="sales-note">No orders yet.</p>'}</div></section>`;
 }

 // VAT collected since becoming Osek Morshe (22 Oct 2026): inside website prices and taxed receipts, on top for store invoices.
 function drawAccounting(){
  const from=Date.parse('2026-10-22T12:08:54Z');
  if(year<2026){get('statsNew-accounting').innerHTML='';return;}
  const web=data.orders.filter(o=>paidOrder(o)&&Date.parse(o.payment_confirmed_at||o.created_at)>=from&&String(o.created_at).startsWith(String(year)));
  const inside=n=>Math.round(n*18/118);
  const byMonth=months(year).map(m=>({m,web:web.filter(o=>String(o.payment_confirmed_at||o.created_at).slice(0,7)===m).reduce((s,o)=>s+inside(Math.round(Number(o.total)*100)),0),
   stores:data.invoices.filter(i=>i.status==='issued'&&String(i.issued_at).slice(0,7)===m).reduce((s,i)=>s+Number(i.vat_minor||0),0),
   other:data.receipts.filter(r=>r.status==='issued'&&!r.store_id&&r.payment_date>='2026-10-22'&&r.payment_date.slice(0,7)===m).reduce((s,r)=>s+inside(Number(r.amount_minor)),0)})).filter(r=>r.m>='2026-10'&&r.m<=today().slice(0,7));
  const total=byMonth.reduce((s,r)=>s+r.web+r.stores+r.other,0);
  get('statsNew-accounting').innerHTML=`<section class="st-card"><h3>VAT collected · since 22 Oct 2026</h3><div class="st-tiles">${tile('VAT on sales so far',money(total),'Estimate before expenses')}</div>${byMonth.map(r=>`<div class="fin-row"><span>${esc(monthLong(r.m))}<small> · website ${money(r.web)} · store invoices ${money(r.stores)} · other ${money(r.other)}</small></span><strong>${money(r.web+r.stores+r.other)}</strong></div>`).join('')}<p class="sales-note">18% inside website prices and taxed receipts; on top of store prices once their tax invoice is issued. VAT you can deduct on expenses isn't included, so this is more than you'll actually owe.</p></section>`;
 }

 function draw(){
  if(!data)return;
  for(const [k,f] of [['overview',drawOverview],['sales',drawSales],['stores',drawStores],['web',drawWeb],['accounting',drawAccounting]]){try{if(get('statsNew-'+k))f();}catch(e){console.warn('stats '+k,e);get('statsNew-'+k).innerHTML='<p class="sales-note">This section could not be shown. Refresh to retry.</p>';}}
  bindTips();
 }
 // One tooltip for every chart column (hover or keyboard focus).
 function bindTips(){
  let tipEl=get('statsTip');if(!tipEl){tipEl=document.createElement('div');tipEl.id='statsTip';tipEl.className='st-tip';tipEl.setAttribute('role','tooltip');document.body.append(tipEl);}
  const showTip=el=>{const r=el.getBoundingClientRect();tipEl.textContent=el.dataset.tip;tipEl.style.display='block';const w=tipEl.offsetWidth;tipEl.style.left=Math.max(8,Math.min(innerWidth-w-8,r.left+r.width/2-w/2))+'px';tipEl.style.top=(r.top+scrollY-tipEl.offsetHeight-8)+'px';};
  document.querySelectorAll('#tab-reports .st-col, #tab-reports .st-hit').forEach(el=>{el.onmouseenter=el.onfocus=()=>showTip(el);el.onmouseleave=el.onblur=()=>{tipEl.style.display='none';};});
 }

 const css=document.createElement('style');
 css.textContent=`
  .st-tabs{display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end;justify-content:space-between;margin:0 0 16px}
  .st-tab-list{display:flex;gap:4px;overflow-x:auto;scrollbar-width:none;border-bottom:1px solid var(--border);flex:1;min-width:0}
  .st-tab-list button{background:none;border:0;border-bottom:2px solid transparent;padding:10px 12px;font:inherit;font-size:.9rem;color:var(--silver-dim);cursor:pointer;white-space:nowrap}
  .st-tab-list button[aria-selected="true"]{color:var(--cream);border-bottom-color:var(--cream);font-weight:600}
  .st-year{display:flex;align-items:center;gap:8px;font-size:.85rem;color:var(--silver-dim)}.st-year select{width:auto}
  .st-pane[hidden]{display:none!important}
  .st-chips{display:flex;gap:6px;overflow-x:auto;scrollbar-width:none;margin:0 0 14px;padding:4px;background:var(--bg,#f1f2f4);border-radius:12px;width:fit-content;max-width:100%}
  .st-chips button{border:0;background:transparent;font:inherit;font-size:.85rem;font-weight:600;color:var(--silver-dim);padding:8px 14px;border-radius:9px;cursor:pointer;white-space:nowrap}
  .st-chips button[aria-selected="true"]{background:var(--card);color:var(--cream);box-shadow:0 1px 6px #0000001a}
  .st-sub{background:none;border:0;padding:0;border-radius:0}.st-sub>.st-chips{background:none;padding:0;gap:4px;margin:0 0 10px}
  .st-sub>.st-chips button{border:1px solid var(--border);padding:5px 11px;font-size:.78rem;border-radius:999px}
  .st-sub>.st-chips button[aria-selected="true"]{background:var(--cream);color:var(--card);border-color:var(--cream);box-shadow:none}
  .st-multi-pane[hidden]{display:none!important}
  .st-new{display:grid;gap:16px;margin-bottom:16px}
  .st-card{background:var(--card);border:1px solid var(--border);border-radius:14px;padding:16px;min-width:0}
  .st-card h3{margin:0 0 10px;font-size:1rem;color:var(--cream)}
  .st-card-head{display:flex;flex-wrap:wrap;justify-content:space-between;gap:8px;align-items:baseline}
  .st-legend{display:flex;flex-wrap:wrap;gap:10px;font-size:.78rem;color:var(--silver-dim)}.st-legend i{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:5px;vertical-align:-1px}
  .st-chart{display:flex;gap:8px;height:190px;margin-top:6px}
  .st-axis{display:flex;flex-direction:column;justify-content:space-between;font-size:.68rem;color:var(--silver-dim);text-align:right;padding-bottom:18px;min-width:44px}
  .st-plot{flex:1;display:flex;gap:4px;align-items:stretch;background:linear-gradient(var(--border) 1px,transparent 1px) 0 0/100% calc((100% - 18px)/2) no-repeat,linear-gradient(var(--border) 1px,transparent 1px) 0 calc((100% - 18px)/2)/100% 1px no-repeat;border-bottom:1px solid var(--border);min-width:0}
  .st-col{flex:1;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;min-width:0;outline:none;cursor:default}
  .st-col:focus-visible{box-shadow:0 0 0 2px var(--cream);border-radius:4px}
  .st-col>small{font-size:.66rem;color:var(--silver-dim);height:18px;line-height:18px;white-space:nowrap}
  .st-stack,.st-group{width:min(70%,34px);display:flex;flex-direction:column;border-radius:4px 4px 0 0;overflow:hidden;min-height:0;max-height:calc(100% - 18px)}
  .st-stack span{display:block;min-height:1px}.st-stack span+span{border-top:2px solid var(--card)}
  .st-group{flex-direction:row;align-items:flex-end;gap:2px;height:calc(100% - 18px);border-radius:0;width:min(86%,42px)}
  .st-group span{flex:1;border-radius:3px 3px 0 0;min-height:0}
  .st-col:hover .st-stack,.st-col:hover .st-group,.st-col:focus .st-stack{filter:brightness(1.08)}
  .st-table{margin-top:8px}.st-table summary{font-size:.8rem;color:var(--silver-dim);cursor:pointer}
  .st-tip{position:absolute;display:none;z-index:9999;background:#121212;color:#fff;font-size:.78rem;padding:6px 9px;border-radius:8px;max-width:280px;pointer-events:none;box-shadow:0 4px 14px rgba(0,0,0,.18)}
  .st-tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}
  .st-tile{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:12px 14px;display:flex;flex-direction:column;gap:2px}
  .st-tile span{font-size:.75rem;color:var(--silver-dim)}.st-tile strong{font-size:1.35rem;color:var(--cream)}.st-tile small{font-size:.72rem;color:var(--silver-dim)}
  .st-spark{width:84px;height:28px;vertical-align:middle}
  .st-line{width:100%;height:auto;display:block;margin-top:6px;overflow:visible}
  .st-line .st-grid{stroke:var(--border);stroke-width:1}.st-line .st-ax{font-size:11px;fill:var(--silver-dim)}
  .st-hit{outline:none}.st-hit .st-cross{stroke:var(--silver-dim);stroke-width:1;opacity:0}.st-hit:hover .st-cross,.st-hit:focus .st-cross{opacity:.6}
  .st-name b{display:block;font-weight:600}.st-name small{display:block;color:var(--silver-dim);font-size:.72rem;text-transform:none;letter-spacing:0}
  .st-store-table{min-width:680px}.st-store-table td,.st-store-table th{white-space:nowrap}
  .st-up{color:#1a7f37}.st-down{color:#c0392b}
  .st-funnel{display:grid;grid-template-columns:130px 1fr 80px;gap:10px;align-items:center;margin:8px 0;font-size:.85rem}
  .st-funnel b{display:block;height:12px;border-radius:0 6px 6px 0;background:${C[0]}}.st-funnel strong{text-align:right}.st-funnel small{color:var(--silver-dim);font-weight:400}
  .st-two{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:20px}
  @media(max-width:600px){.st-tabs{flex-direction:column;align-items:stretch}.st-tab-list{width:100%}.st-year{align-self:flex-end}.st-chart{height:160px}.st-axis{min-width:36px}.st-funnel{grid-template-columns:100px 1fr 64px}.st-col>small{font-size:.58rem}}
 `;
 document.head.appendChild(css);

 // Lay out as soon as the Stats sections exist, and keep newly added ones in their tab.
 const host=get('tab-reports');
 if(host)new MutationObserver(()=>{if(host.querySelector(':scope>.page-header')&&[...host.children].some(n=>!n.classList.contains('st-pane')&&n.id!=='statsTabs'&&!n.classList.contains('page-header')&&n.tagName!=='STYLE'))layout();}).observe(host,{childList:true});
 root.addEventListener('gremier-revenue-ready',()=>{if(data)draw();});
 const original=root.loadReports;
 root.loadReports=function(...args){const result=original?.apply(this,args);setTimeout(()=>{layout();load();},0);return result;};
})(typeof window==='undefined'?globalThis:window);
