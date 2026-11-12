/* Standalone Website traffic screen. */
(function(root){
 'use strict';
 const $=id=>document.getElementById(id),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const num=n=>Number(n||0).toLocaleString('en-IL'),pct=(n,d)=>d?Math.round(n/d*100)+'%':'—';
 const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jerusalem'}).format(new Date());
 const before=n=>new Date(Date.parse(today()+'T12:00:00Z')-n*86400000).toISOString().slice(0,10);
 const time=d=>new Date(d).toLocaleString('en-GB',{timeZone:'Asia/Jerusalem',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
 const duration=n=>n>=60?Math.round(n/60)+' min':Math.round(n)+' sec';
 let serial=0,detailSerial=0,loaded=false,last=null,visitorOffset=0,trendMetric='checkout',trendGrain='day';
 async function call(body){const client=typeof sb!=='undefined'?sb:root.MAIN_SB||root.ADMIN_SB;const r=await client.functions.invoke('site-journeys',{body});if(r.error||r.data?.error)throw Error(r.data?.error||'Website analytics unavailable');return r.data;}
 function mount(){
  const host=$('tab-traffic');if(!host||$('websiteJourneyAnalytics'))return !!host;
  const el=document.createElement('section');el.id='websiteJourneyAnalytics';el.className='wj-root';
  el.innerHTML=`<header class="wj-heading"><div><h1>Website traffic</h1><p>Visits, shopping and the paths people take.</p></div><button class="btn btn-outline btn-sm" id="wjRefresh">Refresh</button></header>
   <div class="wj-filters"><label>From<input type="date" id="wjFrom" value="${before(6)}"></label><label>To<input type="date" id="wjTo" value="${today()}"></label><div>${[['today','Today'],['week','1 week'],['fortnight','2 weeks'],['threeweeks','3 weeks'],['month','1 month'],['year','1 year'],['calendar','This year']].map(([id,label])=>`<button type="button" class="btn btn-outline btn-sm" data-wj-period="${id}">${label}</button>`).join('')}</div></div>
   <p class="wj-note" id="wjStatus" role="status">Loading…</p><div id="wjResults"></div><div id="wjLinks"></div><div id="wjVisitors"></div><div id="wjDetail"></div>`;
  host.prepend(el);
  $('wjRefresh').onclick=load;$('wjFrom').onchange=$('wjTo').onchange=()=>{visitorOffset=0;load();};
  el.querySelectorAll('[data-wj-period]').forEach(b=>b.onclick=()=>{visitorOffset=0;$('wjTo').value=today();$('wjFrom').value=b.dataset.wjPeriod==='calendar'?today().slice(0,4)+'-01-01':before({today:0,week:6,fortnight:13,threeweeks:20,month:29,year:364}[b.dataset.wjPeriod]);load();});
  el.addEventListener('click',e=>{
   const button=e.target.closest('[data-wj-visitor]');if(button)detail(button.dataset.wjVisitor);
   // Tabs inside a card: show one pane, remember the choice.
   const tab=e.target.closest('[data-wj-tab]');if(!tab)return;const card=tab.closest('[data-wj-tabs]');
   card.querySelectorAll(':scope>.wj-tabbar>[data-wj-tab]').forEach(b=>b.setAttribute('aria-selected',String(b===tab)));
   card.querySelectorAll(':scope>[data-wj-pane]').forEach(p=>p.hidden=p.dataset.wjPane!==tab.dataset.wjTab);
   try{localStorage.setItem('gremier_wj_tab_'+card.dataset.wjTabs,tab.dataset.wjTab);}catch{}
  });return true;
 }
 // One card, several views: a row of tabs on top, one pane showing at a time.
 function tabs(id,title,items,extra=''){
  items=items.filter(i=>i&&i.html);let pick=items[0]?.key;try{const v=localStorage.getItem('gremier_wj_tab_'+id);if(items.some(i=>i.key===v))pick=v;}catch{}
  return `<section class="wj-card wj-tabs-card" data-wj-tabs="${id}"><div class="wj-heading"><h3>${title}</h3>${extra}</div><div class="wj-tabbar" role="tablist">${items.map(i=>`<button type="button" role="tab" data-wj-tab="${i.key}" aria-selected="${i.key===pick}">${esc(i.label)}</button>`).join('')}</div>${items.map(i=>`<div class="wj-tabpane" data-wj-pane="${i.key}"${i.key===pick?'':' hidden'}>${i.html}</div>`).join('')}</section>`;
 }
 const tile=(label,value,note='')=>`<div class="wj-tile"><span>${esc(label)}</span><strong>${esc(value)}</strong>${note?`<small>${esc(note)}</small>`:''}</div>`;
 function table(title,rows,metric,label=x=>x.label){return `<section class="wj-card"><h3>${title}</h3>${rows.length?`<div class="table-wrap"><table><thead><tr><th>${title}</th><th>${metric}</th><th>Active time</th></tr></thead><tbody>${rows.sort((a,b)=>(b.visits||b.events)-(a.visits||a.events)).slice(0,20).map(r=>`<tr><td>${esc(label(r))}</td><td>${num(r.visits||r.events)}</td><td>${duration(r.seconds)}</td></tr>`).join('')}</tbody></table></div>`:'<p class="wj-note">No recorded activity in this period.</p>'}</section>`;}
 async function load(){
  if(!mount())return;const seq=++serial;$('wjStatus').textContent='Loading…';
  root.GremierLinkReport?.load($('wjFrom').value,$('wjTo').value);
  try{
   const data=await call({action:'report',from:$('wjFrom').value,to:$('wjTo').value,visitor_offset:visitorOffset});if(seq!==serial)return;
   last=data;loaded=true;const t=data.totals||{},visits=Number(t.visits||0),parts=data.breakdowns||[],products=new Map(data.products.map(p=>[p.id,p.name_en]));
   const fullDetail=data.from>=String(data.detail_from);
   $('wjStatus').innerHTML=`<b class="wj-live${data.online?' on':''}">● ${num(data.online)} on site now</b> · Tracking started 2 Nov 2026 · only visitors who accepted analytics · Jerusalem time`;
   const grain=`<label>Group by <select id="wjGrain" aria-label="Group by"><option value="day">Day</option><option value="week">Week</option><option value="month">Month</option></select></label>`;
   $('wjResults').innerHTML=`<div class="wj-tiles">${tile('Visits',num(visits),`${num(t.page_views)} page views · ${pct(t.one_page,visits)} saw one page`)}${tile('Visitors',fullDetail?num(data.unique_recent):'Recent: '+num(data.unique_recent),`${pct(data.one_visit_recent,data.unique_recent)} came only once${fullDetail?'':' · last 30 days'}`)}${tile('Returning visits',pct(t.repeat_visits,visits),num(t.repeat_visits)+' visits')}${tile('Average time on site',duration(visits?t.seconds/visits:0),'Active time per visit')}</div>
    ${tabs('trend','Over time',[{key:'visits',label:'Visits',html:'<div id="wjTrafficTrend"></div>'},{key:'conversion',label:'Conversion',html:`<div class="wj-chart-tabs">${Object.entries(root.GremierJourneyCharts.metrics).map(([id,m])=>`<button type="button" data-wj-metric="${id}">${m.label}</button>`).join('')}</div><div id="wjTrend"></div>`}],grain)}
    <section class="wj-card"><h3>Visit → purchase</h3><div class="wj-funnel">${[['Visited',visits],['Added to cart',t.cart],['Opened checkout',t.checkout],['Pressed pay',t.pay],['Paid',t.paid]].map(([label,n])=>`<div><span>${label}</span><strong>${num(n)}</strong><small>${pct(n,visits)} of visits</small></div>`).join('')}</div><p class="wj-note">Each step counts visits that reached it. “Paid” is checked against real orders, not button clicks.</p></section>
    ${tabs('where','Where people go & come from',[{key:'popular',label:'Most viewed',html:root.GremierJourneyCharts.bars(parts.filter(x=>['page','product'].includes(x.dimension)).map(x=>({...x,label:x.dimension==='product'?(products.get(x.label)||'Product'):x.label})))},
     {key:'source',label:'Came from',html:table('Came from',parts.filter(x=>x.dimension==='source'),'Visits')},{key:'pages',label:'Pages',html:table('Pages',parts.filter(x=>x.dimension==='page'),'Views')},{key:'products',label:'Products',html:table('Products',parts.filter(x=>x.dimension==='product'),'Views',x=>products.get(x.label)||'Product no longer listed')},
     {key:'entry',label:'First page',html:table('First page',parts.filter(x=>x.dimension==='entry'),'Visits')},{key:'exit',label:'Last page',html:table('Last page',parts.filter(x=>x.dimension==='exit'),'Visits')},{key:'device',label:'Devices',html:table('Devices',parts.filter(x=>x.dimension==='device'),'Visits')}])}`;
   $('wjVisitors').innerHTML=`<section class="wj-card"><h3>Visitors & their journeys</h3><p class="wj-note">${data.visitors.length?`Visitors ${visitorOffset+1}–${visitorOffset+data.visitors.length} in the selected period`:`No visitors in the selected period`} · recent 30 days. A guest label represents a browser, not a known person.</p>${data.visitors.length?`<div class="table-wrap wj-scroll"><table><thead><tr><th>Visitor</th><th>Visits</th><th>Views</th><th>Active</th><th>Last seen</th><th></th></tr></thead><tbody>${data.visitors.map(v=>`<tr><td><strong>${esc(v.user_id?(v.name||'Member'):'Guest '+v.visitor_id.slice(0,8))}</strong><small>${v.user_id?'Member':'Guest browser'} · ${esc(v.current_page||'')}${v.paid?' · paid':v.checkout?' · reached checkout':''}</small></td><td>${num(v.visits)}</td><td>${num(v.views)}</td><td>${duration(v.seconds)}</td><td>${time(v.last_seen)}</td><td><button type="button" class="btn btn-outline btn-sm" data-wj-visitor="${esc(v.visitor_id)}">View journey</button></td></tr>`).join('')}</tbody></table></div>`:'<p class="wj-note">No detailed journeys yet for this period.</p>'}<div class="wj-pagination"><button type="button" class="btn btn-outline btn-sm" id="wjPrev" ${visitorOffset?'':'disabled'}>Previous visitors</button> <button type="button" class="btn btn-outline btn-sm" id="wjNext" ${data.has_more?'':'disabled'}>Next visitors</button></div></section>
    <details class="wj-card"><summary>Tracking & retention</summary><p>Detailed journeys expire after 30 days. Anonymous daily summaries remain for two years. A random browser ID and visit count are kept for up to six months to recognize return visits. Members are identified only while detailed visits are retained. No IP addresses, typed text, addresses, payment details or full URLs are collected. Guests who decline analytics are not tracked here. Clearing browser storage or using another device creates another visitor.</p></details>`;
   const drawTraffic=()=>{ $('wjTrafficTrend').innerHTML=root.GremierJourneyCharts.trafficChart(data.days||[],data.from,data.to,trendGrain);};
   const drawTrend=()=>{ $('wjTrend').innerHTML=root.GremierJourneyCharts.chart(data.conversion_days||[],data.from,data.to,trendMetric,trendGrain);document.querySelectorAll('[data-wj-metric]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.wjMetric===trendMetric)));};
   document.querySelectorAll('[data-wj-metric]').forEach(b=>b.onclick=()=>{trendMetric=b.dataset.wjMetric;drawTrend();});$('wjGrain').value=trendGrain;$('wjGrain').onchange=e=>{trendGrain=e.target.value;drawTraffic();drawTrend();};drawTraffic();drawTrend();
   $('wjPrev').onclick=()=>{visitorOffset=Math.max(0,visitorOffset-100);load();};$('wjNext').onclick=()=>{visitorOffset+=100;load();};
  }catch(e){if(seq===serial)$('wjStatus').textContent=e.message;}
 }
 async function detail(id){
  const seq=++detailSerial,box=$('wjDetail');box.innerHTML='<section class="wj-card">Loading journey…</section>';
  try{const d=await call({action:'visitor',visitor_id:id,from:$('wjFrom').value,to:$('wjTo').value,visitor_offset:visitorOffset});if(seq!==detailSerial)return;const products=new Map(d.products.map(p=>[p.id,p.name_en]));
   const labels={page_view:'Viewed',product_view:'Viewed product',category_view:'Browsed category',bar_builder:'Built coffee bar',pack_builder:'Opened 6-pack builder',cart_add:'Added to cart',cart_open:'Opened cart',checkout_open:'Opened checkout',pay_click:'Pressed pay',payment_error:'Payment failed',member_signin:'Signed in',reorder_seen:'Saw Order again',reorder_open:'Opened Order again',reorder_used:'Used Order again'};
   box.innerHTML=`<section class="wj-card"><div class="wj-heading"><h3>Journey · ${esc(last.visitors.find(v=>v.visitor_id===id)?.name||id.slice(0,8))}</h3><button type="button" class="btn btn-outline btn-sm" id="wjCloseDetail">Close</button></div>${d.sessions.map(s=>`<details class="wj-visit" open><summary>${time(s.started_at)} · ${esc(s.device)} · ${duration(s.active_seconds)} · ${s.repeat_visits?'Returning':'First visit'}</summary><ol>${d.events.filter(e=>e.session_id===s.id).map(e=>`<li><time>${time(e.created_at)}</time><strong>${esc(labels[e.kind]||e.kind)}</strong><span>${esc(e.product_id?products.get(e.product_id)||'Product':e.category||e.page)}</span></li>`).join('')}</ol></details>`).join('')}${d.truncated?'<p>Showing the first 3,000 recorded actions.</p>':''}</section>`;
   $('wjCloseDetail').onclick=()=>{detailSerial++;box.innerHTML='';};box.scrollIntoView({block:'start',behavior:'smooth'});
  }catch(e){if(seq===detailSerial)box.innerHTML=`<p>${esc(e.message)}</p>`;}
 }
 const show=root.showTab;if(typeof show==='function')root.showTab=function(tab,...args){const r=show.call(this,tab,...args);if(tab==='traffic'){mount();load();}return r;};
 let attempts=0;const timer=setInterval(()=>{if(mount()){clearInterval(timer);if(getComputedStyle($('tab-traffic')).display!=='none'&&!loaded)load();}else if(++attempts>30)clearInterval(timer);},500);
})(window);
