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
  function range(period, now = new Date()) {
    const today = businessDate(now);
    return {period, today, start:period === 'year' ? today.slice(0,4)+'-01-01' : period === 'week' ? addDays(today,-6) : today.slice(0,7)+'-01', end:addDays(today,1)};
  }
  const eligible = o => !o.is_test && !/^TEST(?:\b|[_-])/i.test(String(o.customer_name || '')) && !['cancelled','refunded'].includes(o.status) && !['refunded','failed'].includes(o.payment_status);
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
  function model(data, r) {
    const orders = data.orders === null ? null : data.orders.filter(o => paid(o) && within(businessDate(o.created_at),r));
    const deliveries = data.deliveries === null ? null : data.deliveries.filter(d => within(businessDate(d.delivery_date),r));
    const online = orders === null ? null : orders.reduce((s,o) => s+num(o.total),0);
    const values = deliveries === null || data.stores === null ? null : deliveries.map(d => deliveryValue(d,data.stores));
    const store = values === null || values.includes(null) ? null : values.reduce((s,v) => s+v,0);
    const bills = data.bills === null ? null : data.bills.filter(b => !b.cancelled_at && !b.paid_at);
    const owed = bills === null ? null : bills.filter(b => b.billed_at).reduce((s,b) => s+num(b.total),0);
    const unbilled = bills === null ? null : bills.filter(b => !b.billed_at).reduce((s,b) => s+num(b.total),0);
    const waiting = data.backlog === null ? null : data.backlog.filter(o => paid(o) && !['fulfilled','completed'].includes(o.status));
    const jobs = data.jobs === null ? null : data.jobs.filter(j => !j.done && j.date && j.date <= r.today);
    const buckets = [];
    for (let date=r.start; date<r.end; date=addDays(date,1)) {
      const key = r.period === 'year' ? date.slice(0,7) : date;
      if (!buckets.some(b => b.key === key)) buckets.push({key, online:0, store:0});
    }
    function bucket(date) { return buckets.find(b => b.key === (r.period === 'year' ? date.slice(0,7) : date)); }
    (orders || []).forEach(o => { const b=bucket(businessDate(o.created_at)); if (b) b.online+=num(o.total); });
    (deliveries || []).forEach((d,i) => { const b=bucket(businessDate(d.delivery_date)); if (b) b.store+=num(values?.[i]); });
    return {orders, deliveries, online, store, owed, unbilled, waiting, jobs, bills, buckets, range:r};
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
  function render(m, data, errors=[]) {
    const periodLabel = m.range.period === 'week' ? 'Last 7 days' : m.range.period === 'year' ? 'This year to date' : 'This month to date';
    set('dashKPIs', metric('Paid online sales',money(m.online),'')+metric('Store delivery value',money(m.store),'')+metric('Unpaid store bills',money(m.owed),'All dates')+metric('Paid orders to fulfil',m.waiting === null ? 'Unavailable' : m.waiting.length,'All dates'));
    const action = (count,title,sub,target,urgent=false) => `<button type="button" class="dash-action" data-dash-target="${target}" data-urgent="${urgent}"><span class="dash-action-count">${esc(count)}</span><span><span class="dash-action-title">${esc(title)}</span>${sub?`<span class="dash-action-sub">${esc(sub)}</span>`:""}</span><span class="dash-action-arrow" aria-hidden="true">↗</span></button>`;
    let actions='';
    if (m.jobs?.length) actions+=action(m.jobs.length,'Due & overdue tasks',`${m.jobs.filter(j=>j.date<m.range.today).length} overdue`,'schedule',true);
    if (m.waiting?.length) actions+=action(m.waiting.length,'Orders to fulfil','','orders',true);
    if (m.owed > 0) actions+=action(m.bills.filter(b=>b.billed_at).length,'Store payments due',money(m.owed),'billing-owed');
    if (m.unbilled > 0) actions+=action(m.bills.filter(b=>!b.billed_at).length,'Bills to send',money(m.unbilled),'billing-unbilled');
    set('dashAttention', actions || empty(errors.some(e=>['jobs','backlog','bills'].includes(e)) ? 'Some action sources could not load. Refresh to check what needs attention.' : 'Nothing pending.'));
    set('dashMoney',row('Paid online orders',money(m.online))+row('Store deliveries',money(m.store))+row('Unpaid store bills · all dates',money(m.owed))+row('Unsent bills · all dates',money(m.unbilled))+'<details class="dash-footnote"><summary>Calculation details</summary><p>Online totals include paid orders only. Store deliveries use current prices. Bills and fulfilment counts cover all dates. Sales are grouped by order or delivery date in Jerusalem time; these totals are not bank cash flow or profit.</p></details>');
    el('dashTrendTitle').textContent=periodLabel;
    if (m.online === null || m.store === null) set('dashTrend',empty('Sales chart unavailable until both sales sources and store prices load.'));
    else if (!m.buckets.some(b=>b.online || b.store)) set('dashTrend',empty('No paid online orders or store deliveries recorded in this period.'));
    else {
      const max = Math.max(...m.buckets.map(b=>b.online+b.store),1);
      const label = b => m.range.period === 'year' ? new Date(b.key+'-01T12:00:00Z').toLocaleDateString('en',{month:'short',timeZone:'UTC'}) : b.key.slice(8);
      set('dashTrend',`<p class="dash-chart-scale">Largest ${m.range.period==='year'?'month':'day'}: ${esc(money(max))}</p><div class="dash-chart-scroll"><div class="dash-bars">${m.buckets.map(b=>`<div class="dash-bar-column" title="${esc(b.key+': online '+money(b.online)+', stores '+money(b.store))}"><div class="dash-bar" style="height:${(b.online+b.store)/max*160}px"><div class="dash-bar-online" style="height:${b.online/(b.online+b.store||1)*100}%"></div><div class="dash-bar-store" style="height:${b.store/(b.online+b.store||1)*100}%"></div></div><span class="dash-bar-label">${esc(label(b))}</span></div>`).join('')}</div></div><details class="dash-footnote"><summary>View exact amounts by ${m.range.period==='year'?'month':'day'}</summary><table><thead><tr><th>Date</th><th>Paid online</th><th>Store value</th></tr></thead><tbody>${m.buckets.map(b=>`<tr><td>${esc(b.key)}</td><td>${esc(money(b.online))}</td><td>${esc(money(b.store))}</td></tr>`).join('')}</tbody></table></details>`);
    }
    set('dashChart', row('Paid online sales',money(m.online))+row('Store delivery value',money(m.store))+'');
    const rawOrders=data.orders === null ? null : data.orders.filter(o=>eligible(o) && within(businessDate(o.created_at),m.range));
    set('dashRecentOrders', rawOrders === null ? '<tr><td colspan="4">Orders unavailable. Try Refresh.</td></tr>' : rawOrders.slice(0,8).map(o=>`<tr><td>${esc(o.order_number)}</td><td>${esc(o.customer_name)}</td><td>${esc(money(num(o.total)))}</td><td>${esc(o.payment_status)} · ${esc(o.status)}</td></tr>`).join('') || '<tr><td colspan="4">No orders in this period.</td></tr>');
    set('dashRecentDeliveries',m.deliveries === null ? '<tr><td colspan="4">Deliveries unavailable. Try Refresh.</td></tr>' : m.deliveries.slice(0,8).map(d=>`<tr><td>${esc(d.store_name || data.stores?.find(s=>s.id===d.store_id)?.name || 'Store')}</td><td>${esc(num(d.qty_large))}</td><td>${esc(num(d.qty_small))}</td><td>${esc(money(data.stores === null ? null : deliveryValue(d,data.stores)))}</td></tr>`).join('') || '<tr><td colspan="4">No deliveries in this period.</td></tr>');
    const groups=new Map();
    (m.deliveries || []).forEach(d=> { if (!groups.has(d.store_id)) groups.set(d.store_id,{...d, total:0, missing:false, qty_large:0,qty_small:0,qty_dairy_free:0,qty_unfiltered:0,qty_syrup:0}); const g=groups.get(d.store_id); quantityFields.forEach(f=>g['qty_'+f]+=num(d['qty_'+f])); const value=data.stores === null ? null : deliveryValue(d,data.stores); g.missing ||= value === null; g.total+=num(value); });
    set('dashStoreBreakdown',m.deliveries === null ? '<tr><td colspan="7">Deliveries unavailable.</td></tr>' : [...groups.values()].map(g=>`<tr><td>${esc(g.store_name || data.stores?.find(s=>s.id===g.store_id)?.name || 'Store')}</td>${quantityFields.map(f=>`<td>${esc(g['qty_'+f])}</td>`).join('')}<td>${esc(money(g.missing ? null : g.total))}</td></tr>`).join('') || '<tr><td colspan="7">No deliveries in this period.</td></tr>');
    if (m.orders !== null && m.deliveries !== null && typeof renderDashboardBottlesSold === 'function') renderDashboardBottlesSold(m.orders,m.deliveries);
    else set('dashBottlesSold',empty('Product totals unavailable until both sales sources load.'));
    el('dashUpdated').textContent=errors.length ? `Some data couldn’t load (${errors.join(', ')}). Affected values show Unavailable. Try Refresh.` : `Updated ${new Date().toLocaleTimeString('en-IL',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Jerusalem'})}`;
    el('dashUpdated').classList.toggle('dash-error',errors.length>0);
    api.refreshPurpose=data.orders!==null?()=>root.GremierRevenue?.dashboardOnline(data.orders,m.range,data.purposes||[],m.store):null;
    api.refreshPurpose?.();
  }
  api.render=render;
  let request=0;
  const cachePrefix='gremier_dash_v2:', flights=new Map();let requestedKey='';
  const owner=()=>root.__gremierAdminUserId||'';
  const cacheKey=r=>owner()?cachePrefix+owner()+':'+r.period:null;
  function readCache(r){try{const key=cacheKey(r),c=key&&JSON.parse(root.localStorage.getItem(key));return c&&c.version===2&&c.range.start===r.start&&c.range.end<=r.end&&Date.now()-c.savedAt<7*86400000&&['orders','deliveries','stores','bills','backlog','jobs'].every(k=>Array.isArray(c.data[k]))?c:null;}catch{return null;}}
  function saveCache(r,data){try{const key=cacheKey(r);if(key)root.localStorage.setItem(key,JSON.stringify({version:2,range:r,savedAt:Date.now(),data}));}catch{}}
  api.clearCache=()=>{try{Object.keys(root.localStorage).filter(k=>k.startsWith(cachePrefix)).forEach(k=>root.localStorage.removeItem(k));}catch{}};
  function loadingState(){
    api.refreshPurpose=null;
    set('dashKPIs',['Paid online sales','Store delivery value','Unpaid store bills','Paid orders to fulfil'].map(label=>`<div class="dash-metric"><div class="dash-metric-label">${label}</div><div class="dash-metric-value dash-skeleton" aria-label="Loading">&nbsp;</div></div>`).join(''));
    set('dashAttention',empty('Loading…'));
    ['dashMoney','dashTrend','dashChart','dashStoreBreakdown','dashBottlesSold','dashOnlineRevenue'].forEach(id=>set(id,''));
    ['dashRecentOrders','dashRecentDeliveries'].forEach(id=>set(id,'<tr><td colspan="4">Loading…</td></tr>'));
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
    if (typeof ensureDailyBriefing === 'function') ensureDailyBriefing();
    if(cached){render(model(cached.data,r),cached.data);el('dashUpdated').textContent='Saved '+new Date(cached.savedAt).toLocaleString('en-IL',{timeZone:'Asia/Jerusalem'})+' · refreshing…';}
    else loadingState();
    try {
      const client=typeof sb !== 'undefined' ? sb : root.MAIN_SB || root.ADMIN_SB;
      if (!client) throw new Error('Admin session unavailable');
      const sources={
        orders:()=>client.from('orders').select('id,order_number,created_at,total,customer_name,status,payment_status,items,delivery_info').gte('created_at',addDays(r.start,-1)+'T00:00:00Z').lt('created_at',r.end+'T00:00:00Z').order('created_at',{ascending:false}).order('id'),
        backlog:()=>client.from('orders').select('id,customer_name,status,payment_status,total').eq('payment_status','paid').not('status','in','(fulfilled,completed,cancelled,refunded)').order('id'),
        deliveries:()=>client.from('store_deliveries').select('*').gte('delivery_date',r.start).lt('delivery_date',r.end).order('delivery_date',{ascending:false}).order('id'),
        stores:()=>client.from('stores').select('id,name,price_large,price_small,price_dairy_free,price_unfiltered,price_syrup').order('id'),
        bills:()=>client.from('store_billing').select('id,total,billed_at,paid_at,cancelled_at').is('paid_at',null).is('cancelled_at',null).order('id'),
        jobs:()=>client.from('jobs').select('id,date,done').eq('done',false).lte('date',r.today).order('id'),
        purposes:()=>client.from('revenue_classification_overrides').select('source_key,category').order('source_key')
      };
      const keys=Object.keys(sources), results=await Promise.allSettled(keys.map(key=>pages(sources[key])));
      if (token!==request) return;
      const data={}, errors=[];
      results.forEach((result,i)=> { data[keys[i]]=result.status==='fulfilled' ? result.value : cached?.data[keys[i]]??null; if(result.status==='rejected') errors.push(keys[i]); });
      render(model(data,r),data,errors);
      if(!errors.length)saveCache(r,data);
      else if(cached)el('dashUpdated').textContent='Refresh incomplete · saved figures for '+errors.join(', ');
    } catch (error) {
      if (token===request) el('dashUpdated').textContent='Could not load the dashboard. Check your connection and try Refresh.';
    } finally { if (token===request) el('dashRefresh').disabled=false; }
  };
  root.loadDashboard=function(){const r=range(el('dashPeriod')?.value||'month'),key=owner()+'/'+r.start+'/'+r.end+'/'+r.period;if(requestedKey===key&&flights.has(key))return flights.get(key);requestedKey=key;const task=refreshDashboard(r).finally(()=>{if(flights.get(key)===task)flights.delete(key);});flights.set(key,task);return task;};
  api.load=root.loadDashboard;
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
