/* Recorded physical sales, independent of accounting receipts and income snapshots. */
(function(root){
 'use strict';
 const number=v=>Number.isFinite(Number(v))&&Number(v)>=0?Number(v):0;
 const fields=['large','mini','unfiltered','dairyFree'];
 const blank=()=>({large:0,mini:0,unfiltered:0,dairyFree:0,unknown:0});
 const day=value=>{if(/^\d{4}-\d{2}-\d{2}$/.test(value||''))return value;const d=new Date(value);if(!Number.isFinite(d.getTime()))return '';const p=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jerusalem',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(d);return ['year','month','day'].map(k=>p.find(x=>x.type===k).value).join('-');};
 const shift=(value,n)=>{const d=new Date(value+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);};
 const validDate=value=>/^\d{4}-\d{2}-\d{2}$/.test(value||'')&&Number.isFinite(new Date(value+'T12:00:00Z').getTime())&&new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value;
 const days=p=>Math.round((new Date(p.to+'T12:00Z')-new Date(p.from+'T12:00Z'))/86400000)+1;
 const csvCell=value=>{let text=String(value);if(typeof value==='string'&&/^[=+\-@\t\r]/.test(text))text="'"+text;return '"'+text.replace(/"/g,'""')+'"';};
 function units(v){if(v===undefined||v===null)return 1;const n=Number(v);return Number.isSafeInteger(n)&&n>=0?n:null;}
 function itemUnits(item,products,depth=0){
  const out=blank(),qty=units(item.qty);if(qty===0)return out;if(qty===null||depth>5){out.unknown=1;return out;}
  if(Array.isArray(item.subscription_items)&&item.subscription_items.length){
   item.subscription_items.forEach(child=>{const v=itemUnits(child,products,depth+1);Object.keys(out).forEach(k=>out[k]+=v[k]*qty);});return out;
  }
  const p=products.find(p=>String(p.id)===String(item.product_id))||{};
  const name=String(item.name_en||item.name_he||p.name_en||p.name_he||item.product_id||'');
  const text=(name+' '+(item.category||p.category||'')+' '+(item.stock_key||p.stock_key||'')).toLowerCase();
  if(item.is_coffee_bar||p.is_coffee_bar||item.meta?.service_type==='coffee_bar'||/coffeebars?|coffee.?bar|gift.?card|סירופ|syrup|dispenser|bulk|jerry|5\s*l\b/.test(text))return out;
  let key=/unfilter|אנפילטר/.test(text)?'unfiltered':/dairy.?free|ללא חלב/.test(text)?'dairyFree':/mini|cremier|קרמייר|מיני/.test(text)?'mini':/bottles?|liter|litre|ליטר|classic|colombia|decaf|house.?blend|קלאסי|קולומב|נטול/.test(text)?'large':null;
  if(!key){out.unknown=qty;return out;}
  const ops=Array.isArray(p.variations)?p.variations.find(v=>v.type==='ops_settings'):null;
  const namedPack=name.match(/(\d+)\s*[- ]?pack|pack\s*(?:of\s*)?(\d+)|(\d+)\s*יחידות/i);
  const pack=Number(item.pack_size||item.ops_pack_size||(namedPack&&(namedPack[1]||namedPack[2]||namedPack[3]))||p.ops_pack_size||ops?.pack_size||1);
  if(!Number.isSafeInteger(pack)||pack<1||pack>1000||(/pack|bundle|case/i.test(name)&&!namedPack&&!item.pack_size&&!item.ops_pack_size&&!p.ops_pack_size&&!ops?.pack_size)){out.unknown=qty;return out;}
  out[key]=qty*pack;return out;
 }
 function records(data){
  const out=[];
  (data.orders||[]).filter(o=>o.payment_status==='paid'&&!o.is_test&&!o.delivery_info?.is_test&&!/^TEST(?:\b|[_-])/i.test(o.customer_name||'')&&!['cancelled','refunded'].includes(o.status)).forEach(o=>{
   const v=blank();(o.items||[]).forEach(i=>{const q=itemUnits(i,data.products||[]);Object.keys(v).forEach(k=>v[k]+=q[k]);});
   out.push({...v,date:day(o.created_at),channel:'online',store_id:null,name:'Online orders'});
  });
  (data.deliveries||[]).forEach(d=>out.push({large:number(d.qty_large),mini:number(d.qty_small),unfiltered:number(d.qty_unfiltered),dairyFree:number(d.qty_dairy_free),unknown:0,date:day(d.delivery_date),channel:'store',store_id:d.store_id,name:data.stores?.find(s=>s.id===d.store_id)?.name||d.store_name||'Unknown store'}));
  return out;
 }
 function selected(v,type){return type==='large'?v.large+v.unfiltered:type==='mini'?v.mini:type==='unfiltered'?v.unfiltered:type==='dairyFree'?v.dairyFree:fields.reduce((s,k)=>s+v[k],0);}
 function summarize(rows,period,filters={}){
  if(!validDate(period.from)||!validDate(period.to)||period.from>period.to)throw Error('Choose valid From and Through dates.');
  const list=rows.filter(r=>r.date>=period.from&&r.date<=period.to&&(!filters.channel||filters.channel==='all'||r.channel===(filters.channel==='stores'?'store':filters.channel))&&(r.channel!=='store'||!filters.stores?.length||filters.stores.includes(r.store_id)));
  const total=blank(),channels={online:blank(),store:blank()},groups=new Map();
  list.forEach(r=>{for(const k of Object.keys(total)){total[k]+=number(r[k]);channels[r.channel][k]+=number(r[k]);}const key=r.channel==='online'?'online':r.store_id;if(!groups.has(key))groups.set(key,{name:r.name,...blank()});const g=groups.get(key);Object.keys(total).forEach(k=>g[k]+=number(r[k]));});
  return {...total,channels,groups,period,days:days(period)};
 }
 function preset(name,now=new Date()){
  const to=day(now),year=Number(to.slice(0,4)),month=Number(to.slice(5,7));
  if(name==='week')return {from:shift(to,-6),to};
  if(name==='year')return {from:year+'-01-01',to};
  if(name==='lastyear')return {from:(year-1)+'-01-01',to:(year-1)+'-12-31'};
  if(name==='lastmonth'){const end=shift(to.slice(0,7)+'-01',-1);return {from:end.slice(0,7)+'-01',to:end};}
  return {from:year+'-'+String(month).padStart(2,'0')+'-01',to};
 }
 function monthRange(value){
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(value||''))throw Error('Choose a month and year.');
  const from=value+'-01',end=new Date(from+'T12:00:00Z');end.setUTCMonth(end.getUTCMonth()+1,0);
  return {from,to:end.toISOString().slice(0,10)};
 }
 const hebrewFormatter=new Intl.DateTimeFormat('en-u-ca-hebrew',{year:'numeric',month:'long',timeZone:'UTC'}),hebrewCache=new Map();
 function hebrewMonths(year){
  if(!Number.isInteger(year)||year<5700||year>5900)throw Error('Enter a Jewish year from 5700 to 5900.');
  if(hebrewCache.has(year))return hebrewCache.get(year).map(m=>({...m}));
  const months=[];
  for(let date=(year-3761)+'-08-01',end=(year-3760)+'-11-01';date<end;date=shift(date,1)){
   const parts=hebrewFormatter.formatToParts(new Date(date+'T12:00:00Z'));
   if(Number(parts.find(p=>p.type==='year').value)!==year)continue;
   const name=parts.find(p=>p.type==='month').value,last=months.at(-1);
   if(last?.name===name)last.to=date;else months.push({name,from:date,to:date});
  }
  hebrewCache.set(year,months);return months.map(m=>({...m}));
 }
 const api={day,shift,validDate,days,itemUnits,records,selected,summarize,preset,csvCell,monthRange,hebrewMonths};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
 if(!root.document)return;
 root.GremierSales=api;
 const get=id=>document.getElementById(id),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),fmt=n=>new Intl.NumberFormat('en-IL',{maximumFractionDigits:1}).format(n);
 let data=null,serial=0,loading=false,loadPromise=null,counter=0,rendered=[];
 function setup(){
  const host=get('tab-reports');if(!host||get('salesExplorer'))return;
  const panel=document.createElement('section');panel.id='salesExplorer';panel.className='sales-panel';
  panel.innerHTML=`<div class="sales-heading"><div><h2>Bottle sales</h2></div><span data-action-menu="Sales tools"><button class="btn btn-outline btn-sm" id="salesRefresh">Refresh sales</button><button class="btn btn-outline" id="salesExport" disabled>Export comparison CSV</button></span></div><div class="sales-controls"><label>Show<select class="form-input" id="salesType"><option value="all">All bottles</option><option value="large">Large bottles · includes unfiltered</option><option value="mini">Mini bottles</option><option value="unfiltered">Unfiltered liters only</option><option value="dairyFree">Dairy free · size unspecified</option></select></label><label>Channel<select class="form-input" id="salesChannel"><option value="all">Online + stores</option><option value="online">Online orders</option><option value="stores">Store deliveries</option></select></label></div><details class="sales-stores"><summary>Filter stores · all stores selected</summary><div id="salesStoreChoices"></div><button class="btn btn-outline btn-sm" id="salesAllStores">Clear store filter</button></details><div id="salesPeriods"></div><div class="fw-actions"><button class="btn btn-outline" id="salesAddPeriod">+ Compare another period</button></div><p id="salesStatus" class="sales-note" role="status"></p><div id="salesResults"></div><details class="sales-help"><summary>How these figures work</summary><p class="sales-note">Packs are counted as individual bottles. Dates use online order dates and store delivery dates in Jerusalem time. Coffee bars, syrups and 5L containers are excluded. Dairy-free bottles without a known size stay separate. Periods can differ in length; compare bottles per day for a fair rate. These are sales quantities, separate from the FinBot accounting totals. Jewish months follow the displayed civil date range, using Jerusalem midnights.</p></details>`;
  const toolbar=host.querySelector('.fin-toolbar');if(toolbar)toolbar.before(panel);else host.append(panel);
  get('salesType').onchange=render;get('salesChannel').onchange=render;get('salesRefresh').onclick=()=>load(true);get('salesAddPeriod').onclick=()=>{addPeriod('selectedmonth');load();};get('salesExport').onclick=exportCsv;
  get('salesAllStores').onclick=()=>{get('salesStoreChoices').querySelectorAll('input').forEach(i=>i.checked=false);render();};
  addPeriod('lastmonth');addPeriod('month');
 }
 function addPeriod(kind){
  if(get('salesPeriods').children.length>=6)return;
  const n=++counter,p=preset(kind==='custom'||kind==='selectedmonth'?'month':kind),row=document.createElement('div');row.className='sales-period';
  const jewishYear=Number(hebrewFormatter.formatToParts(new Date()).find(p=>p.type==='year').value);
  row.innerHTML=`<label><span class="sales-period-role">Period</span><select class="form-input sales-preset"><option value="month">This month to date</option><option value="lastmonth">Last full month</option><option value="selectedmonth">Specific month</option><option value="hebrew">Jewish month</option><option value="week">Last 7 days</option><option value="year">This year to date</option><option value="lastyear">Last full year</option><option value="custom">Custom dates</option></select></label><span class="sales-period-range">${p.from} → ${p.to}</span><button class="btn btn-outline btn-sm sales-remove" title="Remove comparison period" aria-label="Remove comparison period">×</button><div class="sales-calendar sales-month-picker" hidden><label>Month & year<input type="month" class="form-input sales-month" value="${p.from.slice(0,7)}"></label></div><div class="sales-calendar sales-hebrew-picker" hidden><label>Jewish year<input type="number" class="form-input sales-hebrew-year" min="5700" max="5900" step="1" value="${jewishYear}"></label><label>Jewish month<select class="form-input sales-hebrew-month"></select></label></div><div class="sales-custom" ${kind==='custom'?'':'hidden'}><label>Label<input class="form-input sales-label" value="${kind==='month'?'This month':kind==='lastmonth'?'Last month':'Period '+n}" maxlength="50"></label><label>From<input class="form-input sales-from" type="date" value="${p.from}"></label><label>Through<input class="form-input sales-to" type="date" value="${p.to}"></label></div>`;
  const q=selector=>row.querySelector(selector),mode=q('.sales-preset');mode.value=kind;
  function jewishOptions(){
   const choice=q('.sales-hebrew-month'),previous=choice.value,months=hebrewMonths(Number(q('.sales-hebrew-year').value));
   choice.innerHTML=months.map(m=>`<option value="${esc(m.name)}">${esc(m.name)}</option>`).join('');
   if(months.some(m=>m.name===previous))choice.value=previous;
  }
  function sync(){
   const type=mode.value;q('.sales-custom').hidden=type!=='custom';q('.sales-month-picker').hidden=type!=='selectedmonth';q('.sales-hebrew-picker').hidden=type!=='hebrew';
   if(type==='custom')return;
   let range,label;
   if(type==='selectedmonth'){range=monthRange(q('.sales-month').value);label=new Intl.DateTimeFormat('en',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(range.from+'T12:00:00Z'));}
   else if(type==='hebrew'){range=hebrewMonths(Number(q('.sales-hebrew-year').value)).find(m=>m.name===q('.sales-hebrew-month').value);if(!range)throw Error('Choose a Jewish month.');label=range.name+' '+q('.sales-hebrew-year').value;}
   else{range=preset(type);label=mode.selectedOptions[0].textContent;}
   q('.sales-from').value=range.from;q('.sales-to').value=range.to;q('.sales-label').value=label;q('.sales-period-range').textContent=range.from+' → '+range.to;
  }
  function change(){try{sync();load();}catch(e){get('salesStatus').textContent=e.message;get('salesResults').innerHTML='';get('salesExport').disabled=true;}}
  jewishOptions();mode.onchange=change;q('.sales-month').onchange=change;q('.sales-hebrew-month').onchange=change;
  q('.sales-hebrew-year').onchange=()=>{try{jewishOptions();change();}catch(e){get('salesStatus').textContent=e.message;get('salesResults').innerHTML='';get('salesExport').disabled=true;}};
  row.querySelectorAll('.sales-label,.sales-from,.sales-to').forEach(i=>i.onchange=()=>{if(i.type==='date'){mode.value='custom';sync();q('.sales-period-range').textContent=q('.sales-from').value+' → '+q('.sales-to').value;}load();});
  q('.sales-remove').onclick=()=>{if(get('salesPeriods').children.length<=1)return;row.remove();render();};
  if(kind==='selectedmonth')sync();
  get('salesPeriods').append(row);updateButtons();
 }
 function updateButtons(){const rows=[...get('salesPeriods').children],n=rows.length;get('salesAddPeriod').disabled=n>=6;rows.forEach((r,i)=>{r.querySelector('.sales-remove').disabled=n<=1;r.querySelector('.sales-period-role').textContent=i===0?'Baseline':'Compare';});}
 function periods(){return [...get('salesPeriods').children].map((r,i)=>{const kind=r.querySelector('.sales-preset').value;if(kind==='selectedmonth')monthRange(r.querySelector('.sales-month').value);if(kind==='hebrew'){const months=hebrewMonths(Number(r.querySelector('.sales-hebrew-year').value));if(!months.some(m=>m.name===r.querySelector('.sales-hebrew-month').value))throw Error('Choose a Jewish month.');}return {label:r.querySelector('.sales-label').value.trim()||'Period '+(i+1),from:r.querySelector('.sales-from').value,to:r.querySelector('.sales-to').value};});}
 function filters(){return {type:get('salesType').value,channel:get('salesChannel').value,stores:[...get('salesStoreChoices').querySelectorAll('input:checked')].map(i=>i.value)};}
 async function pages(make){const rows=[];for(let offset=0;offset<100000;offset+=1000){const r=await make().range(offset,offset+999);if(r.error||!Array.isArray(r.data))throw Error('Could not load complete sales data. Try Refresh.');rows.push(...r.data);if(r.data.length<1000)return rows;}throw Error('Select shorter periods.');}
 async function load(force=false){
  setup();if(!get('salesExplorer'))return;
  let ps;try{ps=periods();ps.forEach(p=>summarize([],p));}catch(e){get('salesStatus').textContent=e.message;get('salesResults').innerHTML='';get('salesExport').disabled=true;return;}
  const from=ps.map(p=>p.from).sort()[0],to=ps.map(p=>p.to).sort().at(-1),key=from+'/'+to;
  if(!force&&data?.key===key){render();return;}
  if(!force&&loading&&loadPromise?.key===key)return;
  const request=++serial;loading=true;loadPromise={key};get('salesRefresh').disabled=true;get('salesStatus').textContent='Loading recorded sales…';get('salesResults').innerHTML='';get('salesExport').disabled=true;
  try{
   const client=typeof sb!=='undefined'?sb:root.MAIN_SB||root.ADMIN_SB;
   const results=await Promise.all([pages(()=>client.from('orders').select('id,created_at,items,payment_status,status,delivery_info,customer_name').eq('payment_status','paid').gte('created_at',shift(from,-1)+'T00:00:00Z').lt('created_at',shift(to,1)+'T23:59:59Z').order('created_at').order('id')),pages(()=>client.from('store_deliveries').select('id,store_id,store_name,delivery_date,qty_large,qty_small,qty_dairy_free,qty_unfiltered').gte('delivery_date',from).lte('delivery_date',to).order('delivery_date').order('id')),pages(()=>client.from('products').select('id,name_en,name_he,category,variations,is_coffee_bar').order('id')),pages(()=>client.from('stores').select('id,name').order('name').order('id'))]);
   if(request!==serial)return;
   const previous=filters().stores;data={orders:results[0],deliveries:results[1],products:results[2],stores:results[3],key};data.rows=records(data);
   const storeMap=new Map(data.stores.map(s=>[s.id,s.name]));data.deliveries.forEach(d=>{if(!storeMap.has(d.store_id))storeMap.set(d.store_id,d.store_name||'Unknown store');});
   get('salesStoreChoices').innerHTML=[...storeMap].map(([id,name])=>`<label><input type="checkbox" value="${esc(id)}" ${previous.includes(id)?'checked':''}>${esc(name)}</label>`).join('');
   get('salesStoreChoices').querySelectorAll('input').forEach(i=>i.onchange=()=>{if(i.checked)get('salesChannel').value='stores';render();});
   render();
  }catch(e){if(request===serial){data=null;get('salesStatus').textContent=e.message;get('salesResults').innerHTML='Sales are unavailable; incomplete totals are not shown.';}}
  finally{if(request===serial){loading=false;get('salesRefresh').disabled=false;}}
 }
 function render(){
  updateButtons();if(!data)return;
  const ps=periods(),f=filters();let ms;try{ms=ps.map(p=>summarize(data.rows,p,f));}catch(e){get('salesStatus').textContent=e.message;get('salesResults').innerHTML='';get('salesExport').disabled=true;return;}
  const from=ps.map(p=>p.from).sort()[0],to=ps.map(p=>p.to).sort().at(-1);if(from<data.key.split('/')[0]||to>data.key.split('/')[1]){load();return;}
  rendered=ms;
  const value=m=>selected(m,f.type),base=value(ms[0]),max=Math.max(1,...ms.map(value));
  const metrics=[['Selected bottle count',value],['Bottles per day',m=>value(m)/m.days],['Large · includes unfiltered',m=>m.large+m.unfiltered],['Mini bottles',m=>m.mini],['Unfiltered liters',m=>m.unfiltered],['Dairy free · size unspecified',m=>m.dairyFree],['Online · selected bottle type',m=>selected(m.channels.online,f.type)],['Stores · selected bottle type',m=>selected(m.channels.store,f.type)]];
  const head='<th scope="col">Measure</th>'+ms.map(m=>`<th scope="col">${esc(m.period.label)}<small>${esc(m.period.from)} → ${esc(m.period.to)}<br>${m.days} days</small></th>`).join('');
  const delta=ms.map((m,i)=>`<td>${i===0?'Baseline':fmt(value(m)-base)+(base?' ('+fmt((value(m)-base)/base*100)+'%)':value(m)?' · new activity':' · no change')}</td>`).join('');
  const groups=new Map();ms.forEach(m=>m.groups.forEach((v,k)=>groups.set(k,v.name)));const ordered=[...groups].sort((a,b)=>ms.reduce((s,m)=>s+selected(m.groups.get(b[0])||blank(),f.type)-selected(m.groups.get(a[0])||blank(),f.type),0));
  get('salesResults').innerHTML=`<div class="sales-bars" aria-label="Selected bottles by channel and period">${ms.map(m=>`<div class="sales-bar-row"><strong>${esc(m.period.label)}</strong><div class="sales-bar-track"><span style="width:${selected(m.channels.online,f.type)/max*100}%" title="Online: ${fmt(selected(m.channels.online,f.type))}"></span><i style="width:${selected(m.channels.store,f.type)/max*100}%" title="Stores: ${fmt(selected(m.channels.store,f.type))}"></i></div><b>${fmt(value(m))}</b></div>`).join('')}<p class="sales-note">● Online <span style="color:#89909a">● Stores</span></p></div><div class="table-wrap sales-table"><table><thead><tr>${head}</tr></thead><tbody>${metrics.map(([label,fn])=>`<tr><th scope="row">${esc(label)}</th>${ms.map(m=>`<td>${fmt(fn(m))}</td>`).join('')}</tr>`).join('')}<tr><th scope="row">Change vs baseline</th>${delta}</tr></tbody></table></div><h3>By channel & store</h3><div class="table-wrap sales-table"><table><thead><tr>${head.replace('Measure','Channel / store')}</tr></thead><tbody>${ordered.map(([id,name])=>`<tr><th scope="row">${esc(name)}</th>${ms.map(m=>`<td>${fmt(selected(m.groups.get(id)||blank(),f.type))}</td>`).join('')}</tr>`).join('')||`<tr><td colspan="${ms.length+1}">No recorded bottles for these filters.</td></tr>`}</tbody></table></div>`;
  const unknown=ms.reduce((s,m)=>s+m.unknown,0);get('salesStatus').textContent=unknown?'Some online items have unknown contents ('+unknown+' across selected periods) and are excluded.':'';
  get('salesExplorer').querySelector('.sales-stores summary').textContent=f.stores.length?'Filter stores · '+f.stores.length+' selected':'Filter stores · all stores selected';get('salesExport').disabled=false;
 }
 function exportCsv(){if(!rendered.length)return;const f=filters(),rows=[['Period','From','Through','Days','Channel / store','Bottle filter','Bottles']];rendered.forEach(m=>{rows.push([m.period.label,m.period.from,m.period.to,m.days,'TOTAL',f.type,selected(m,f.type)]);m.groups.forEach(g=>rows.push([m.period.label,m.period.from,m.period.to,m.days,g.name,f.type,selected(g,f.type)]));});const text='\uFEFF'+rows.map(r=>r.map(csvCell).join(',')).join('\r\n'),url=URL.createObjectURL(new Blob([text],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='gremier-bottle-comparison.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 api.renderQuick=(orders,deliveries,products)=>{const rows=records({orders,deliveries,products}),v=blank();rows.forEach(r=>Object.keys(v).forEach(k=>v[k]+=number(r[k])));const node=get('dashBottlesSold');if(!node)return;node.innerHTML=`<div class="sales-quick">${[['All bottles',selected(v,'all')],['Large · incl. unfiltered',selected(v,'large')],['Mini bottles',v.mini]].map(([label,n])=>`<div><span>${esc(label)}</span><strong>${fmt(n)}</strong></div>`).join('')}</div><p class="sales-note">${v.unknown?'Unknown items excluded.':''}</p><button class="btn btn-outline btn-sm" id="salesOpenStats">Compare sales in Stats</button>`;get('salesOpenStats').onclick=()=>{root.showTab('reports');get('salesExplorer')?.scrollIntoView({behavior:'smooth',block:'start'});};};
 const original=root.loadReports;root.loadReports=function(...args){const result=original?.apply(this,args);setup();load();return result;};
 root.loadReportsByMonth=()=>root.loadReports();
})(typeof window==='undefined'?globalThis:window);
