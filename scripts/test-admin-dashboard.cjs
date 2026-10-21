const {test}=require('node:test');
const assert=require('node:assert/strict');
const {range,model,deliveryValue,businessDate}=require('../admin-dashboard.js');
const r=range('month',new Date('2026-10-15T12:00:00Z'));
const order=(patch={})=>({created_at:'2026-10-05T12:00:00Z',payment_status:'paid',status:'confirmed',total:100,...patch});
const data=(patch={})=>({orders:[],deliveries:[],stores:[],bills:[],backlog:[],jobs:[],...patch});
test('online sales exclude abandoned, cancelled, refunded, test, and future orders',()=>{
  const m=model(data({orders:[order(),order({payment_status:'unpaid',total:999}),order({status:'cancelled'}),order({payment_status:'refunded'}),order({is_test:true}),order({customer_name:'TEST customer'}),order({created_at:'2026-11-02T00:00:00Z'})]}),r);
  assert.equal(m.online,100);
  assert.equal(m.orders.length,1);
});
test('store valuation includes every supported category and preserves a valid zero price',()=>{
  assert.equal(deliveryValue({store_id:'a',qty_large:2,qty_small:3,qty_dairy_free:1,qty_unfiltered:1,qty_syrup:2},[{id:'a',price_large:25,price_small:10,price_dairy_free:30,price_unfiltered:0,price_syrup:15}]),140);
});
test('missing store prices make the total unavailable instead of silently zero',()=>{
  const m=model(data({deliveries:[{delivery_date:'2026-10-05',store_id:'missing',qty_large:2}]}),r);
  assert.equal(m.store,null);
});
test('an unavailable source is distinct from an empty source',()=>{
  assert.equal(model(data({orders:null,bills:null,backlog:null,jobs:null}),r).online,null);
  assert.equal(model(data(),r).online,0);
  assert.equal(model(data({bills:null}),r).owed,null);
  assert.equal(model(data({deliveries:null}),r).store,null);
});
test('store bills separate issued receivables and unbilled records without paid or cancelled bills',()=>{
  const m=model(data({bills:[{total:100,billed_at:'2026-01-01'},{total:50},{total:300,paid_at:'2026-10-01',billed_at:'2026-09-01'},{total:400,cancelled_at:'2026-09-01'}]}),r);
  assert.equal(m.owed,100); assert.equal(m.unbilled,50);
});
test('last seven days include today and cross month and year boundaries',()=>{
  const week=range('week',new Date('2026-01-03T12:00:00Z'));
  assert.equal(week.start,'2025-12-28'); assert.equal(week.end,'2026-01-04');
  assert.equal(model(data(),week).buckets.length,7);
});
test('year chart keeps months separate instead of grouping by day-of-month',()=>{
  const year=range('year',new Date('2026-10-15T12:00:00Z'));
  const m=model(data({orders:[order({created_at:'2026-01-05T12:00:00Z',total:10}),order({total:20})]}),year);
  assert.equal(m.buckets.length,10); assert.equal(m.buckets[0].online,10); assert.equal(m.buckets[9].online,20);
  assert.equal(m.buckets.reduce((sum,b)=>sum+b.online,0),m.online);
});
test('Jerusalem reporting includes orders after local midnight on the correct day',()=>{
  assert.equal(businessDate('2026-10-14T22:30:00Z'),'2026-10-15');
  const m=model(data({orders:[order({created_at:'2026-09-30T22:30:00Z'})]}),r);
  assert.equal(m.online,100); assert.equal(m.buckets[0].online,100);
});
test('open paid orders and due jobs remain actionable outside the selected sales period',()=>{
  const m=model(data({backlog:[order({created_at:'2025-01-01T00:00:00Z'}),order({status:'fulfilled'}),order({payment_status:'unpaid'})],jobs:[{date:'2025-12-01',done:false},{date:r.today,done:false},{date:'2026-10-16',done:false},{date:r.today,done:true}]}),r);
  assert.equal(m.waiting.length,1); assert.equal(m.jobs.length,2);
});

// Exercise the actual loader: accounting totals must not silently stop at a page,
// and an inaccessible source must not turn into a plausible zero.
function loaderHarness(tables,failTable) {
  const fs=require('node:fs'), vm=require('node:vm');
  const nodes=new Map(), calls=[];
  const document={getElementById(id){if(!nodes.has(id)) nodes.set(id,{value:id==='dashPeriod'?'month':'',innerHTML:'',textContent:'',classList:{toggle(){}},addEventListener(){}});return nodes.get(id)}};
  const root={document,MAIN_SB:{from(table){const q={select(){return q},gte(){return q},lt(){return q},lte(){return q},eq(){return q},is(){return q},not(){return q},order(){return q},range(a,b){calls.push({table,a,b});return Promise.resolve(table===failTable?{error:new Error('Unavailable')}:{data:(tables[table]||[]).slice(a,b+1)})}};return q}}};
  class ReportingDate extends Date { constructor(...args) { super(...(args.length ? args : ['2026-10-15T12:00:00Z'])); } }
  vm.runInNewContext(fs.readFileSync(require.resolve('../admin-dashboard.js'),'utf8'),{window:root,document,Intl,Date:ReportingDate,console});
  return {root,nodes,calls};
}
test('loader paginates beyond 1,000 orders before displaying totals',async()=>{
  const h=loaderHarness({orders:Array.from({length:1001},(_,i)=>order({id:String(i),total:1}))});
  await h.root.loadDashboard();
  assert.match(h.nodes.get('dashKPIs').innerHTML,/1,001/);
  assert.ok(h.calls.some(c=>c.table==='orders' && c.a===1000));
  assert.equal(h.nodes.get('dashRefresh').disabled,false);
});
test('loader renders unavailable for a failed source while preserving successful sources',async()=>{
  const h=loaderHarness({orders:[order()]},'store_billing');
  await h.root.loadDashboard();
  assert.match(h.nodes.get('dashKPIs').innerHTML,/Unavailable/);
  assert.match(h.nodes.get('dashKPIs').innerHTML,/100/);
  assert.match(h.nodes.get('dashUpdated').textContent,/bills/);
  assert.equal(h.nodes.get('dashRefresh').disabled,false);
});
function storage(){return {getItem(k){return this[k]??null},setItem(k,v){this[k]=v},removeItem(k){delete this[k]}};}
test('a new dashboard instance paints its scoped cache synchronously and retains it on source failure',async()=>{
 const cache=storage(),first=loaderHarness({orders:[order()]});first.root.localStorage=cache;first.root.__gremierAdminUserId='admin-a';await first.root.loadDashboard();
 const next=loaderHarness({},'orders');next.root.localStorage=cache;next.root.__gremierAdminUserId='admin-a';const pending=next.root.loadDashboard();
 assert.match(next.nodes.get('dashKPIs').innerHTML,/100/);assert.doesNotMatch(next.nodes.get('dashKPIs').innerHTML,/Unavailable/);assert.match(next.nodes.get('dashUpdated').textContent,/Saved/);
 await pending;assert.match(next.nodes.get('dashKPIs').innerHTML,/100/);assert.match(next.nodes.get('dashUpdated').textContent,/saved figures for orders/);
});
test('cache never crosses a period or signed-in user, and overlapping refreshes share one fetch',async()=>{
 const cache=storage(),first=loaderHarness({orders:[order()]});first.root.localStorage=cache;first.root.__gremierAdminUserId='admin-a';await first.root.loadDashboard();
 const next=loaderHarness({});next.root.localStorage=cache;next.root.__gremierAdminUserId='admin-b';const pending=next.root.loadDashboard();assert.doesNotMatch(next.nodes.get('dashKPIs').innerHTML,/100|Unavailable/);assert.strictEqual(next.root.loadDashboard(),pending);await pending;assert.equal(next.calls.length,7);
 next.nodes.get('dashPeriod').value='year';const changed=next.root.loadDashboard();assert.match(next.nodes.get('dashKPIs').innerHTML,/dash-skeleton/);await changed;
 next.root.GremierDashboard.clearCache();assert.equal(Object.keys(cache).filter(k=>k.startsWith('gremier_dash_v2:')).length,0);
});
