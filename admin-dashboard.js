/* Dashboard reporting is read-only. No AI calls, billing changes, or financial writes. */
(function (root) {
  'use strict';
  const num = value => Number.isFinite(Number(value)) ? Number(value) : 0;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money = value => value === null ? 'Unavailable' : new Intl.NumberFormat('en-IL', {style:'currency', currency:'ILS', maximumFractionDigits:0}).format(value);
  function businessDate(value) {
    if (!value) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return '';
    const parts = new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Jerusalem', year:'numeric', month:'2-digit', day:'2-digit'}).formatToParts(date);
    return ['year','month','day'].map(key => parts.find(p => p.type === key).value).join('-');
  }
  function addDays(date, days) { const d = new Date(date + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0,10); }
  function range(period, now = new Date(), choice={}) {
    const today = businessDate(now);
    let start=period==='year'?today.slice(0,4)+'-01-01':period==='week'?addDays(today,-6):today.slice(0,7)+'-01',end=addDays(today,1);
    if(period==='lastmonth'){end=today.slice(0,7)+'-01';start=addDays(end,-1).slice(0,7)+'-01';}
    if(period==='pickmonth'){
      if(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(choice.month||''))throw Error('Choose a month.');
      start=choice.month+'-01';const d=new Date(start+'T12:00:00Z');d.setUTCMonth(d.getUTCMonth()+1);end=d.toISOString().slice(0,10);
    }
    if(period==='pickyear'){
      if(!/^20\d{2}$/.test(String(choice.year||'')))throw Error('Choose a year.');
      start=choice.year+'-01-01';end=(Number(choice.year)+1)+'-01-01';
    }
    if(start>today)throw Error('Choose a month or year that has started.');
    end=end<addDays(today,1)?end:addDays(today,1);
    const to=addDays(end,-1),yearly=period==='year'||period==='pickyear';
    const label=period==='week'?'Last 7 days':period==='month'?'This month to date':period==='year'?'This year to date':yearly?start.slice(0,4):new Date(start+'T12:00:00Z').toLocaleDateString('en-GB',{month:'long',year:'numeric',timeZone:'UTC'});
    return {period,today,start,end,to,label,yearly};
  }
  const eligible = o => !o.is_test && !o.delivery_info?.is_test && !/^TEST(?:\b|[_-])/i.test(String(o.customer_name || '')) && !['cancelled','refunded'].includes(o.status) && !['refunded','failed'].includes(o.payment_status);
  const paid = o => eligible(o) && o.payment_status === 'paid';
  const within = (date, r) => date >= r.start && date < r.end;
  const quantityFields = ['large','small','dairy_free','unfiltered','syrup'];
  function deliveryValue(d, stores) {
    const store = stores.find(s => s.id === d.store_id) || d.stores;
    let total = 0;
    for (const field of quantityFields) {
      const qty = num(d['qty_'+field]);
      if (!qty) continue;
      if (!store || store['price_'+field] === null || store['price_'+field] === undefined || !Number.isFinite(Number(store['price_'+field]))) return null;
      total += qty * Number(store['price_'+field]);
    }
    return total;
  }
  function model(data, r, revenue=root.GremierRevenue) {
    const orders = data.orders === null ? null : data.orders.filter(o => paid(o) && within(businessDate(o.created_at),r));
    const deliveries = data.deliveries === null ? null : data.deliveries.filter(d => within(businessDate(d.delivery_date),r));
    let online = orders === null ? null : orders.reduce((s,o) => s+num(o.total),0);
    const values = deliveries === null || data.stores === null ? null : deliveries.map(d => deliveryValue(d,data.stores));
    let store = values === null || values.includes(null) ? null : values.reduce((s,v) => s+v,0);
    const bills = data.bills === null ? null : data.bills.filter(b => !b.cancelled_at && !b.paid_at);
    const owed = bills === null ? null : bills.filter(b => b.billed_at).reduce((s,b) => s+num(b.total),0);
    const unbilled = bills === null ? null : bills.filter(b => !b.billed_at).reduce((s,b) => s+num(b.total),0);
    const waiting = data.backlog === null ? null : data.backlog.filter(o => paid(o) && !['fulfilled','completed'].includes(o.status));
    const jobs = data.jobs === null ? null : data.jobs.filter(j => !j.done && j.date && j.date <= r.today);
    let buckets = [];
    for (let date=r.start; date<r.end; date=addDays(date,1)) {
      const key = r.yearly ? date.slice(0,7) : date;
      if (!buckets.some(b => b.key === key)) buckets.push({key, online:0, store:0});
    }
    function bucket(date) { return buckets.find(b => b.key === (r.yearly ? date.slice(0,7) : date)); }
    (orders || []).forEach(o => { const b=bucket(businessDate(o.created_at)); if (b) b.online+=num(o.total); });
    (deliveries || []).forEach((d,i) => { const b=bucket(businessDate(d.delivery_date)); if (b) b.store+=num(values?.[i]); });
    const sales=data.revenueData&&revenue?.operationalSales?revenue.operationalSales(data.revenueData,r,businessDate,store===null?null:Math.round(store*100)):data.salesSnapshot||null;
    let other=0,monthlyBuckets=r.yearly;
    if(sales){
      online=sales.online===null?null:sales.online/100;store=sales.stores===null?null:sales.stores/100;other=sales.other===null?null:sales.other/100;
      if(r.period!=='week'){
        buckets=sales.monthly;monthlyBuckets=true;
        if(sales.legacy)buckets=[...buckets,{key:'summary',label:'Old website',online:sales.legacy/100,store:0,other:0}];
      }else if(sales.rows){
        buckets.forEach(b=>{b.online=0;b.other=0;});
        sales.rows.forEach(row=>{const b=bucket(row.date);if(b)b[row.origin==='online'?'online':'other']+=(row.amount_minor-row.parts.stores)/100;});
      }
    }else if(data.revenueData===null){online=null;other=null;store=null;}
    const totalSales=sales?.historical?(sales.total===null?null:sales.total/100):online===null||store===null||other===null?null:Math.round((online+store+other)*100)/100;
    return {orders,deliveries,online,store,other,totalSales,sales,monthlyBuckets,owed,unbilled,waiting,jobs,bills,buckets,range:r};
  }
  const api = {businessDate, range, deliveryValue, model};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (!root.document) return;
  root.GremierDashboard = api;
  const el = id => document.getElementById(id);
  const set = (id, html) => { if (el(id)) el(id).innerHTML = html; };
  const empty = text => `<div class="dash-empty">${esc(text)}</div>`;
  const metric = (label,value,sub) => `<div class="dash-metric"><div class="dash-metric-label">${esc(label)}</div><div class="dash-metric-value">${esc(value)}</div>${sub?`<div class="dash-metric-sub">${esc(sub)}</div>`:""}</div>`;
  const row = (label,value) => `<div class="dash-money-row"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`;
  // Split bar under the total: online / stores / events, each with its amount.
  function heroSplit(m) {
    const parts=[['online','Online',m.online],['store','Stores',m.store],['other','Events & other',m.other]];
    const total=parts.reduce((s,p)=>s+(p[2]||0),0);
    const bar=total>0&&parts.every(p=>p[2]!==null)?`<div class="dash-split" aria-hidden="true">${parts.filter(p=>p[2]>0).map(p=>`<i class="ds-${p[0]}" style="width:${(p[2]/total*100).toFixed(2)}%"></i>`).join('')}</div>`:'';
    return bar+`<div class="dash-total-breakdown">${parts.map(p=>`<span class="ds-chip"><i class="ds-${p[0]}"></i>${p[1]} <b>${esc(money(p[2]))}</b></span>`).join('')}</div>`;
  }
  const tile=(icon,label,value,sub,target)=>`<button type="button" class="dash-metric dash-tile" data-dash-target="${target}"><span class="dash-tile-ico" aria-hidden="true">${icon}</span><div class="dash-metric-label">${esc(label)}</div><div class="dash-metric-value">${esc(value)}</div>${sub?`<div class="dash-metric-sub">${esc(sub)}</div>`:''}</button>`;
  const initials=name=>esc((String(name||'?').trim()[0]||'?').toUpperCase());
  const shortDate=v=>{const d=businessDate(v);return d?new Date(d+'T12:00:00Z').toLocaleDateString('en-GB',{day:'numeric',month:'short',timeZone:'UTC'}):'';};
  const listRow=(avatar,title,sub,amount,target,extra='')=>`<button type="button" class="dash-row"${target?` data-dash-target="${target}"`:''}><span class="dash-av">${avatar}</span><span class="dash-row-main"><b>${title}</b><small>${sub}</small>${extra}</span><strong>${amount}</strong></button>`;
  function render(m, data, errors=[]) {
    const periodLabel = m.range.label;
    const legend=el('tab-dashboard')?.querySelector?.('.dash-legend');
    if(legend)legend.innerHTML=m.sales?.historical?'<span><i class="dash-other-dot"></i>Historical FinBot income</span>':'<span><i class="dash-online-dot"></i>Online payments</span><span><i class="dash-store-dot"></i>Stores</span><span><i class="dash-other-dot"></i>Direct events & other</span>';
    set('dashSalesTotal',`<div class="dash-total-label">Total sales <span>${esc(periodLabel)}</span></div><div class="dash-total-value">${esc(money(m.totalSales))}</div>${m.sales?.historical?'<div class="dash-total-breakdown"><span>Historical FinBot income · channel split unavailable</span></div>':heroSplit(m)}`);
    set('dashKPIs', tile('🧾','Unpaid store bills',money(m.owed),'Tap to see who owes','billing-owed')+tile('📦','Paid orders to fulfil',m.waiting === null ? 'Unavailable' : m.waiting.length,'Tap to open Orders','orders'));
    const icons={schedule:'🚚',orders:'📦','billing-owed':'💰','billing-unbilled':'🧾'};
    const action = (count,title,sub,target,urgent=false) => `<button type="button" class="dash-action" data-dash-target="${target}" data-urgent="${urgent}"><span class="dash-action-ico" aria-hidden="true">${icons[target]||'•'}</span><span class="dash-action-count">${esc(count)}</span><span><span class="dash-action-title">${esc(title)}</span>${sub?`<span class="dash-action-sub">${esc(sub)}</span>`:""}</span><span class="dash-action-arrow" aria-hidden="true">↗</span></button>`;
    let actions='';
    if (m.jobs?.length) actions+=action(m.jobs.length,'Due & overdue tasks',`${m.jobs.filter(j=>j.date<m.range.today).length} overdue`,'schedule',true);
    if (m.waiting?.length) actions+=action(m.waiting.length,'Orders to fulfil','','orders',true);
    if (m.owed > 0) actions+=action(m.bills.filter(b=>b.billed_at).length,'Store payments due',money(m.owed),'billing-owed');
    if (m.unbilled > 0) actions+=action(m.bills.filter(b=>!b.billed_at).length,'Bills to send',money(m.unbilled),'billing-unbilled');
    set('dashAttention', actions || empty(errors.some(e=>['jobs','backlog','bills'].includes(e)) ? 'Some action sources could not load. Refresh to check what needs attention.' : 'Nothing pending.').replace('class="dash-empty"', errors.some(e=>['jobs','backlog','bills'].includes(e))?'class="dash-empty"':'class="dash-empty dash-allclear"'));
    set('dashMoney',(m.sales?.historical?row('Historical FinBot income',money(m.totalSales)):row('Online payments',money(m.online))+row('Stores',money(m.store))+row('Direct events & other',money(m.other)))+row('Unpaid store bills · all dates',money(m.owed))+row('Unsent bills · all dates',money(m.unbilled))+'<details class="dash-footnote"><summary>Calculation details</summary><p>Same sales basis as Stats: linked orders and receipts count once; direct event and other payments are included. Stores use statement value, paid or not, with earlier-delivery payments retained as in Stats; a 7-day view uses delivered value. Bills and fulfilment counts cover all dates. These totals are sales, not bank cash flow or profit.</p></details>');
    el('dashTrendTitle').textContent=periodLabel;
    if(m.sales?.historical&&m.totalSales===null)set('dashTrend',empty('No saved accounting report for this period.'));
    else if (!m.sales?.historical&&(m.online === null || m.store === null || m.other===null)) set('dashTrend',empty('Sales chart unavailable until all sales sources load.'));
    else if (!m.buckets.some(b=>b.online || b.store || b.other)) set('dashTrend',empty('No sales recorded in this period.'));
    else {
      const max = Math.max(...m.buckets.map(b=>b.online+b.store+(b.other||0)),1);
      const label = b => b.label||(m.monthlyBuckets ? new Date(b.key+'-01T12:00:00Z').toLocaleDateString('en',{month:'short',year:'2-digit',timeZone:'UTC'}) : b.key.slice(8));
      set('dashTrend',`<p class="dash-chart-scale">Largest ${m.monthlyBuckets?'month':'day'}: ${esc(money(max))}</p><div class="dash-chart-scroll"><div class="dash-bars">${m.buckets.map(b=>`<div class="dash-bar-column" title="${esc(b.key+': online '+money(b.online)+', stores '+money(b.store)+', direct events and other '+money(b.other||0))}"><div class="dash-bar" style="height:${(b.online+b.store+(b.other||0))/max*160}px"><div class="dash-bar-online" style="height:${b.online/(b.online+b.store+(b.other||0)||1)*100}%"></div><div class="dash-bar-store" style="height:${b.store/(b.online+b.store+(b.other||0)||1)*100}%"></div><div class="dash-bar-other" style="height:${(b.other||0)/(b.online+b.store+(b.other||0)||1)*100}%"></div></div><span class="dash-bar-label">${esc(label(b))}</span></div>`).join('')}</div></div><details class="dash-footnote"><summary>View exact amounts by ${m.monthlyBuckets?'month':'day'}</summary><table><thead><tr><th>Date</th>${m.sales?.historical?'<th>Historical income</th>':'<th>Paid online</th><th>Stores</th><th>Direct events & other</th>'}</tr></thead><tbody>${m.buckets.map(b=>`<tr><td>${esc(b.label||b.key)}</td>${m.sales?.historical?`<td>${esc(money(b.other||0))}</td>`:`<td>${esc(money(b.online))}</td><td>${esc(money(b.store))}</td><td>${esc(money(b.other||0))}</td>`}</tr>`).join('')}</tbody></table></details>`);
    }
    set('dashChart',m.sales?.historical?row('Historical FinBot income',money(m.totalSales)):row('Online sales',money(m.online))+row('Stores',money(m.store))+row('Direct events & other',money(m.other)));
    const rawOrders=data.orders === null ? null : data.orders.filter(o=>eligible(o) && within(businessDate(o.created_at),m.range));
    const statusWord=o=>o.payment_status!=='paid'?'Not paid':['fulfilled','completed'].includes(o.status)?'Done':'To fulfil';
    set('dashRecentOrders', rawOrders === null ? empty('Orders unavailable. Try Refresh.') : rawOrders.slice(0,6).map(o=>listRow(initials(o.customer_name),esc(o.customer_name||'Customer'),`#${esc(o.order_number)} · ${esc(shortDate(o.created_at))}`,esc(money(num(o.total))),'orders',`<span class="dash-pill dp-${o.payment_status!=='paid'?'unpaid':['fulfilled','completed'].includes(o.status)?'done':'open'}">${statusWord(o)}</span>`)).join('') || empty('No orders in this period.'));
    const qtyLine=d=>[['large','large'],['small','small'],['dairy_free','dairy free'],['unfiltered','unfiltered'],['syrup','syrup']].filter(([f])=>num(d['qty_'+f])).map(([f,w])=>num(d['qty_'+f])+' '+w).join(' · ')||'No bottles';
    const storeName=d=>d.store_name || data.stores?.find(s=>s.id===d.store_id)?.name || 'Store';
    set('dashRecentDeliveries',m.deliveries === null ? empty('Deliveries unavailable. Try Refresh.') : m.deliveries.slice(0,6).map(d=>listRow(initials(storeName(d)),esc(storeName(d)),`${esc(shortDate(d.delivery_date))} · ${esc(qtyLine(d))}`,esc(money(data.stores === null ? null : deliveryValue(d,data.stores))),'storedeliveries')).join('') || empty('No deliveries in this period.'));
    const groups=new Map();
    (m.deliveries || []).forEach(d=> { if (!groups.has(d.store_id)) groups.set(d.store_id,{...d, total:0, missing:false, qty_large:0,qty_small:0,qty_dairy_free:0,qty_unfiltered:0,qty_syrup:0}); const g=groups.get(d.store_id); quantityFields.forEach(f=>g['qty_'+f]+=num(d['qty_'+f])); const value=data.stores === null ? null : deliveryValue(d,data.stores); g.missing ||= value === null; g.total+=num(value); });
    const ranked=[...groups.values()].sort((a,b)=>b.total-a.total),top=Math.max(...ranked.map(g=>g.total),1);
    set('dashStoreBreakdown',m.deliveries === null ? empty('Deliveries unavailable.') : ranked.map(g=>`<button type="button" class="dash-storebar" data-dash-target="storedeliveries"><span class="dash-storebar-top"><b>${esc(storeName(g))}</b><strong>${esc(money(g.missing ? null : g.total))}</strong></span><span class="dash-storebar-track"><i style="width:${Math.max(4,g.total/top*100).toFixed(1)}%"></i></span><small>${esc(qtyLine(g))}</small></button>`).join('') || empty('No store deliveries in this period.'));
    if (m.orders !== null && m.deliveries !== null && typeof renderDashboardBottlesSold === 'function') renderDashboardBottlesSold(m.orders,m.deliveries);
    else set('dashBottlesSold',empty('Product totals unavailable until both sales sources load.'));
    el('dashUpdated').textContent=errors.length ? `Some data couldn’t load (${errors.join(', ')}). Affected values show Unavailable. Try Refresh.` : `Updated ${new Date().toLocaleTimeString('en-IL',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Jerusalem'})}`;
    el('dashUpdated').classList.toggle('dash-error',errors.length>0);
    api.refreshPurpose=m.sales?.historical?()=>set('dashOnlineRevenue','<h2>Historical income</h2><p class="dash-empty">The saved FinBot report has no online/store/event split for this year.</p>'):data.orders!==null?()=>root.GremierRevenue?.dashboardOnline?.(data.orders,m.range,data.purposes||[],m.store,m.sales?.totals):null;
    api.refreshPurpose?.();
  }
  api.render=render;
  let request=0;
  const cachePrefix='gremier_dash_v3:', flights=new Map();let requestedKey='';
  const owner=()=>root.__gremierAdminUserId||'';
  const cacheKey=r=>owner()?cachePrefix+owner()+':'+r.period+':'+r.start+':'+r.end:null;
  function readCache(r){try{const key=cacheKey(r),c=key&&JSON.parse(root.localStorage.getItem(key));return c&&c.version===3&&c.range.start===r.start&&c.range.end<=r.end&&Date.now()-c.savedAt<7*86400000&&['orders','deliveries','stores','bills','backlog','jobs'].every(k=>Array.isArray(c.data[k]))?c:null;}catch{return null;}}
  function saveCache(r,data){try{const key=cacheKey(r),sales=model(data,r).sales,safe={...data};delete safe.revenueData;if(sales){const {rows,...summary}=sales;safe.salesSnapshot=summary;}if(key)root.localStorage.setItem(key,JSON.stringify({version:3,range:r,savedAt:Date.now(),data:safe}));}catch{}}
  api.clearCache=()=>{try{Object.keys(root.localStorage).filter(k=>k.startsWith(cachePrefix)).forEach(k=>root.localStorage.removeItem(k));}catch{}};
  function loadingState(){
    api.refreshPurpose=null;
    set('dashSalesTotal','<div class="dash-total-label">Total sales</div><div class="dash-total-value dash-skeleton" aria-label="Loading">&nbsp;</div>');
    set('dashKPIs',['Unpaid store bills','Paid orders to fulfil'].map(label=>`<div class="dash-metric dash-tile"><div class="dash-metric-label">${label}</div><div class="dash-metric-value dash-skeleton" aria-label="Loading">&nbsp;</div></div>`).join(''));
    set('dashAttention',empty('Loading…'));
    ['dashMoney','dashTrend','dashChart','dashStoreBreakdown','dashBottlesSold','dashOnlineRevenue'].forEach(id=>set(id,''));
    ['dashRecentOrders','dashRecentDeliveries','dashStoreBreakdown'].forEach(id=>set(id,'<div class="dash-row dash-row-skel"><span class="dash-av dash-skeleton"></span><span class="dash-row-main"><b class="dash-skeleton">&nbsp;</b></span></div>'.repeat(2)));
    set('dashOnlineRevenue','<h2>Sales by purpose</h2>'+['Events / groups','Personal / retail','Needs review'].map(label=>`<div class="fin-row"><span>${label}</span><span class="dash-skeleton">&nbsp;</span></div>`).join(''));
  }
  // Fetch every page: PostgREST's default 1,000-row limit must never silently lower totals.
  async function pages(makeQuery) {
    const rows=[];
    for (let offset=0; offset<100000; offset+=1000) {
      const {data,error}=await makeQuery().range(offset,offset+999);
      if (error) throw error;
      if (!Array.isArray(data)) throw new Error('Missing reporting data');
      rows.push(...data);
      if (data.length<1000) return rows;
    }
    throw new Error('Reporting row limit reached');
  }
  async function refreshDashboard(r) {
    const token=++request, cached=readCache(r);
    el('dashUpdated').textContent='Refreshing business data…';
    el('dashRefresh').disabled=true;
    if(cached){render(model(cached.data,r),cached.data);el('dashUpdated').textContent='Saved '+new Date(cached.savedAt).toLocaleString('en-IL',{timeZone:'Asia/Jerusalem'})+' · refreshing…';}
    else loadingState();
    try {
      const client=typeof sb !== 'undefined' ? sb : root.MAIN_SB || root.ADMIN_SB;
      if (!client) throw new Error('Admin session unavailable');
      const sources={
        revenueData:async()=>{for(let i=0;!root.GremierRevenue?.fetchData&&i<100;i++)await new Promise(resolve=>setTimeout(resolve,50));if(!root.GremierRevenue?.fetchData)throw Error('Revenue sources unavailable');return root.GremierRevenue.fetchData();},
        orders:()=>client.from('orders').select('id,order_number,created_at,total,customer_name,status,payment_status,items,delivery_info').gte('created_at',addDays(r.start,-1)+'T00:00:00Z').lt('created_at',r.end+'T00:00:00Z').order('created_at',{ascending:false}).order('id'),
        backlog:()=>client.from('orders').select('id,customer_name,status,payment_status,total').eq('payment_status','paid').not('status','in','(fulfilled,completed,cancelled,refunded)').order('id'),
        deliveries:()=>client.from('store_deliveries').select('*').gte('delivery_date',r.start).lt('delivery_date',r.end).order('delivery_date',{ascending:false}).order('id'),
        stores:()=>client.from('stores').select('id,name,price_large,price_small,price_dairy_free,price_unfiltered,price_syrup').order('id'),
        bills:()=>client.from('store_billing').select('id,total,billed_at,paid_at,cancelled_at').is('paid_at',null).is('cancelled_at',null).order('id'),
        jobs:()=>client.from('jobs').select('id,date,done').eq('done',false).lte('date',r.today).order('id'),
        purposes:()=>client.from('revenue_classification_overrides').select('source_key,category').order('source_key')
      };
      const keys=Object.keys(sources), results=await Promise.allSettled(keys.map(key=>key==='revenueData'?sources[key]():pages(sources[key])));
      if (token!==request) return;
      const data={}, errors=[];
      results.forEach((result,i)=> { data[keys[i]]=result.status==='fulfilled' ? result.value : cached?.data[keys[i]]??null; if(result.status==='rejected') errors.push(keys[i]); });
      if(cached?.data.salesSnapshot)data.salesSnapshot=cached.data.salesSnapshot;
      render(model(data,r),data,errors);
      if(!errors.length)saveCache(r,data);
      else if(cached)el('dashUpdated').textContent='Refresh incomplete · saved figures for '+errors.join(', ');
    } catch (error) {
      if (token===request) el('dashUpdated').textContent='Could not load the dashboard. Check your connection and try Refresh.';
    } finally { if (token===request) el('dashRefresh').disabled=false; }
  };
  root.loadDashboard=function(){const selected=el('dashPeriod')?.value||'month';root.dashSyncPeriodUI?.();if(el('dashMonthLabel'))el('dashMonthLabel').hidden=selected!=='pickmonth';if(el('dashYearLabel'))el('dashYearLabel').hidden=selected!=='pickyear';let r;try{r=range(selected,new Date(),{month:el('dashMonth')?.value,year:el('dashYear')?.value});}catch(e){el('dashUpdated').textContent=e.message;return Promise.resolve();}const key=owner()+'/'+r.start+'/'+r.end+'/'+r.period;if(requestedKey===key&&flights.has(key))return flights.get(key);requestedKey=key;const task=refreshDashboard(r).finally(()=>{if(flights.get(key)===task)flights.delete(key);});flights.set(key,task);return task;};
  api.load=root.loadDashboard;
  if(el('dashMonth')){el('dashMonth').value=businessDate(new Date()).slice(0,7);el('dashMonth').max=businessDate(new Date()).slice(0,7);}
  if(el('dashYear')?.tagName==='SELECT'&&!el('dashYear').options.length){const y=Number(businessDate(new Date()).slice(0,4));for(let n=y;n>=2023;n--)el('dashYear').add(new Option(String(n),String(n)));}
  if(el('dashYear')){el('dashYear').value=businessDate(new Date()).slice(0,4);el('dashYear').max=businessDate(new Date()).slice(0,4);}
  el('tab-dashboard')?.addEventListener('click',event=> {
    const button=event.target.closest('[data-dash-target]');
    if (!button) return;
    const target=button.dataset.dashTarget;
    const billing=target.startsWith('billing-');
    showTab(billing ? 'storedeliveries' : target);
    if (billing) {
      if (el('sdBillingView')?.style.display==='none') toggleBillingBoard();
      if (el('billStatus')) el('billStatus').value=target==='billing-owed' ? 'owed' : 'unbilled';
      ['billStore','billMonth'].forEach(id=> { if (el(id)) el(id).value=''; });
      if (typeof billFocusStore !== 'undefined') billFocusStore='';
      if (typeof setBillingMode === 'function') setBillingMode('all');
    }
  });
})(typeof window !== 'undefined' ? window : globalThis);
