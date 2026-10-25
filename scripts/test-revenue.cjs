const {test}=require('node:test'),assert=require('node:assert/strict');
const m=require('../admin-revenue.js');
const products=[{id:'bar',is_coffee_bar:true},{id:'coffee',category:'bottles'},{id:'gift',category:'giftcards'}];
const order={id:'o',order_number:42,total:450,created_at:'2026-10-02',payment_status:'paid',items:[{product_id:'bar',price:400,qty:1},{product_id:'coffee',price:100,qty:1}]};
const base=()=>({orders:[order],products,stores:[{id:'s',name:'Good Store'}],customers:[{name:'Store legal name',store_id:'s'}],imported:[],orderReceipts:[],businessReceipts:[],overrides:[]});
test('store versus everything else is exhaustive and online store purchases stay in stores',()=>{
 const d=base();d.imported=[{document_reference:'store',customer_name:'Good Store',amount_minor:50000,document_date:'2026-10-01'},{document_reference:'event',customer_name:'Merkez Dafayomi',amount_minor:70000,document_date:'2026-10-01'}];
 let report=m.income(d,'2026-01-01','2026-12-31',s=>s.slice(0,10)),c=m.channels(report);
 assert.deepEqual(c,{stores:50000,rest:115000,online:45000,other:70000});assert.equal(c.stores+c.rest,report.total_minor);assert.equal(c.online+c.other,c.rest);
 d.overrides=[{source_key:'order-purpose:o',category:'stores'}];report=m.income(d,'2026-01-01','2026-12-31',s=>s.slice(0,10));c=m.channels(report);
 assert.deepEqual(c,{stores:95000,rest:70000,online:0,other:70000});assert.equal(c.stores+c.rest,report.total_minor);
});
test('one income breakdown separates stores, personal orders and events, keeping online origin',()=>{
 const d=base();d.orders=[{...order,total:100,items:[{product_id:'coffee',price:100,qty:1}]}];
 d.orderReceipts=[{order_id:'o',status:'issued',document_reference:'1',amount_minor:10000,payment_date:'2026-10-02'}];
 d.imported=[{document_reference:'001',website_order_number:42,customer_name:'Online customer',amount_minor:10000,document_date:'2026-10-20'},
 {document_reference:'2',customer_name:'Good Store',amount_minor:50000,document_date:'2026-10-01'},
 {document_reference:'3',customer_name:'Merkez Dafayomi',amount_minor:700000,document_date:'2026-10-01'}];
 const result=m.income(d,'2026-01-01','2026-12-31',s=>s.slice(0,10));
 assert.equal(result.rows.length,3);assert.equal(result.total_minor,760000);
 assert.equal(result.totals.stores,50000);assert.equal(result.totals.coffee,10000);assert.equal(result.totals.coffee_bar,700000);
 assert.equal(result.origins.online.coffee,10000);assert.equal(result.origins.direct.coffee,0);
 assert.equal(Object.values(result.origins.online).reduce((a,b)=>a+b,0)+Object.values(result.origins.direct).reduce((a,b)=>a+b,0),result.total_minor);
});
test('paid orders without receipts are included once, excluding unpaid/refunded orders',()=>{
 const d=base();d.orders=[order,{...order,id:'unpaid',order_number:43,payment_status:'pending'},{...order,id:'refunded',order_number:44,status:'refunded'},{...order,id:'redeemed',order_number:45,payment_method:'gift_card'}];
 const result=m.income(d,'2026-10-01','2026-10-31',s=>s.slice(0,10));
 assert.equal(result.rows.length,1);assert.equal(result.total_minor,45000);assert.equal(result.origins.online.coffee_bar,36000);
 d.overrides=[{source_key:'order-purpose:o',category:'stores'}];assert.equal(m.income(d,'2026-10-01','2026-10-31',s=>s.slice(0,10)).totals.stores,45000);
});
test('receipt date and amount prevail without re-adding a linked order in another period',()=>{
 const d=base();d.orderReceipts=[{order_id:'o',status:'issued',amount_minor:40000,document_reference:'1',payment_date:'2026-11-01'}];
 assert.equal(m.income(d,'2026-10-01','2026-10-31',s=>s.slice(0,10)).total_minor,0);
 const november=m.income(d,'2026-11-01','2026-11-30',s=>s.slice(0,10));assert.equal(november.total_minor,40000);assert.equal(november.rows.length,1);
 d.overrides=[{source_key:'finbot:1',category:'coffee'}];assert.equal(m.income(d,'2026-01-01','2026-12-31',s=>s.slice(0,10)).totals.coffee,40000);
});
test('clear organizations and explicit coffee bars skip review; personal names stay pending',()=>{
 const d=base();
 const names=['מרכז דף יומי','Merkez Dafayomi','תורה לכל יהודי בית שמש','Example Foundation','Daniel Cohen','Daniel Cohen - Coffee Bar','מינימרקט הגבעה','סופר ציפר 2020 בע"מ'];
 d.imported=names.map((customer_name,i)=>({document_reference:String(i),document_date:'2026-10-01',amount_minor:700000,customer_name}));
 const rows=m.receipts(d);
 for(const i of [0,1,2,3,5]){assert.equal(rows[i].parts.coffee_bar,700000);assert.equal(m.needsReview(rows[i]),false,names[i]);}
 assert.equal(m.needsReview(rows[4]),true);
 for(const i of [6,7]){assert.equal(rows[i].parts.stores,700000);assert.equal(m.needsReview(rows[i]),false);}
 d.overrides=[{source_key:'finbot:0',category:'coffee'}];assert.equal(m.receipts(d)[0].parts.coffee,700000);
 d.imported=[{...d.imported[0],customer_name:'Merkez Dafayomi',website_order_number:42}];
 d.overrides=[];d.orders=[{...order,total:7000,items:[{product_id:'coffee',qty:1,price:7000}]}];
 assert.equal(m.receipts(d)[0].parts.coffee,700000,'Actual private online items beat receipt name guesses');
});
test('manual receipt descriptions identify coffee bars, including matching imported receipts',()=>{
 const d=base();d.businessReceipts=[{id:'b',status:'issued',customer_snapshot:{name:'Daniel Cohen'},description:'בר קפה לאירוע',document_reference:'42',amount_minor:90000,payment_date:'2026-10-01'}];
 assert.equal(m.receipts(d)[0].basis,'Coffee bar');assert.equal(m.needsReview(m.receipts(d)[0]),false);
 d.imported=[{document_reference:'42',customer_name:'Daniel Cohen',amount_minor:90000,document_date:'2026-10-01'}];
 assert.equal(m.receipts(d).length,1);assert.equal(m.receipts(d)[0].basis,'Coffee bar');
 d.businessReceipts[0].store_id='s';assert.equal(m.receipts(d)[0].parts.stores,90000);
});
test('review queue excludes confident matches and clears linked receipts after reviewing an order',()=>{
 const data=base();data.orders=[{...order,items:[{name_en:'Jerry can',price:450,qty:1}]}];
 data.imported=[{document_reference:'pending',document_date:'2026-10-02',amount_minor:45000,customer_name:'Private customer',website_order_number:42}];
 assert.equal(m.needsReview(m.receipts(data)[0]),true);
 data.overrides=[{source_key:'order-purpose:o',category:'coffee_bar'}];
 assert.equal(m.needsReview(m.receipts(data)[0]),false);
 for(const basis of ['Online order details','Store match','Group customer','Reviewed','Reviewed order purpose'])assert.equal(m.needsReview({parts:{coffee:100},basis}),false,basis);
 assert.equal(m.needsReview({parts:{coffee_bar:45000},estimated:true}),true);
 assert.equal(m.needsReview({parts:{coffee:100},basis:'Up to ₪300 rule · review'}),true);
 assert.equal(m.needsReview({parts:{stores:100},basis:'Retail customer · review'}),true);
});
test('mixed online paid totals allocate discounts and delivery exactly without losing cents',()=>{
 const p=m.splitOrder(order,products);assert.equal(p.coffee_bar,36000);assert.equal(p.coffee,9000);
 const cents=m.splitOrder({...order,total:0.01,items:[{price:1,qty:1,name_en:'Coffee bar'},{price:1,qty:1,name_en:'Mini bottle'}]},products);
 assert.equal(Object.values(cents).reduce((s,n)=>s+n,0),1);
 assert.equal(m.splitOrder({...order,items:[{product_id:'gift',price:450,qty:1}]},products).other,45000);
 assert.equal(m.splitOrder({...order,items:[{name_en:'Coffee bar',qty:1}]},products).unclassified,45000);
});
test('online channel excludes unpaid, cancelled, refunded, test, and outside-period orders',()=>{
 const rows=[order,{...order,payment_status:'pending'},{...order,status:'refunded'},{...order,delivery_info:{is_test:true}},{...order,created_at:'2026-09-30'}];
 const totals=m.online(rows,products,'2026-10-01','2026-10-31',x=>x);
 assert.equal(totals.coffee_bar,36000);assert.equal(totals.coffee,9000);
});
test('store matches always beat the threshold; only strictly over 300 is estimated',()=>{
 const d=base();d.imported=[{document_reference:'1',document_date:'2026-10-01',amount_minor:100000,customer_name:'Good Store'},{document_reference:'2',document_date:'2026-10-01',amount_minor:40000,customer_name:'Store legal name'},{document_reference:'3',document_date:'2026-10-01',amount_minor:30000,customer_name:'Other'},{document_reference:'4',document_date:'2026-10-01',amount_minor:30001,customer_name:'Other'}];
 const rows=m.receipts(d);assert.equal(rows[0].parts.stores,100000);assert.equal(rows[1].parts.stores,40000);assert.equal(rows[2].parts.coffee,30000);assert.equal(rows[3].parts.coffee_bar,30001);assert.equal(rows[3].estimated,true);
});
test('imported and live references count once, with actual online items and known payment dates',()=>{
 const d=base();d.imported=[{document_reference:'001',document_date:'2026-10-20',amount_minor:45000,customer_name:'Online customer',website_order_number:42}];d.orderReceipts=[{order_id:'o',document_reference:'1',payment_date:'2026-10-02',amount_minor:45000,status:'issued'}];
 const rows=m.receipts(d);assert.equal(rows.length,1);assert.equal(rows[0].date,'2026-10-02');assert.equal(rows[0].parts.coffee_bar,36000);assert.equal(rows[0].estimated,false);
 d.orderReceipts[0].document_reference='different-provider-format';assert.equal(m.receipts(d).length,1);
});
test('unknown online orders are not guessed as coffee bars, and receipt corrections override estimates',()=>{
 const d=base();d.imported=[{document_reference:'1',document_date:'2026-10-20',amount_minor:40000,customer_name:'Online',website_order_number:999},{document_reference:'2',document_date:'2026-10-20',amount_minor:40000,customer_name:'Unknown'}];d.overrides=[{source_key:'finbot:2',category:'stores'}];
 const rows=m.receipts(d);assert.equal(rows[0].parts.unclassified,40000);assert.equal(rows[1].parts.stores,40000);assert.equal(rows[1].basis,'Reviewed');assert.equal(rows[1].estimated,false);
});
test('draft and failed manual receipts are excluded; a linked store stays a store at every amount',()=>{
 const d=base();d.businessReceipts=['issued','issuing','needs_review'].map((status,i)=>({id:String(i),status,store_id:'s',amount_minor:90000,payment_date:'2026-10-01',customer_snapshot:{name:'Unrelated name'}}));
 const rows=m.receipts(d);assert.equal(rows.length,1);assert.equal(rows[0].parts.stores,90000);
});
test('online personal orders never use the amount rule; group bulk orders and ambiguous bulk differ',()=>{
 const bulk=[{id:'jerry',category:'bulk'}],items=[{product_id:'jerry',price:400,qty:2}];
 assert.equal(m.splitOrder({...order,total:800,items:[{product_id:'coffee',price:400,qty:2}]},products).coffee,80000);
 assert.equal(m.splitOrder({...order,total:800,customer_name:'Example Shul',items},bulk).coffee_bar,80000);
 assert.equal(m.splitOrder({...order,total:800,customer_name:'Individual customer',items},bulk).unclassified,80000);
 assert.equal(m.splitOrder({...order,total:800,items},bulk,'coffee').coffee,80000);
 assert.equal(m.splitOrder({...order,total:800,items},bulk,'coffee_bar').coffee_bar,80000);
});
test('reviewed order purpose carries into linked receipts without using their price',()=>{
 const d=base();d.overrides=[{source_key:'order-purpose:o',category:'coffee'}];d.orderReceipts=[{order_id:'o',document_reference:'3',status:'issued',payment_date:'2026-10-02',amount_minor:45000}];
 const row=m.receipts(d)[0];assert.equal(row.parts.coffee,45000);assert.equal(row.parts.coffee_bar,0);assert.equal(row.basis,'Reviewed order purpose');assert.equal(row.estimated,false);
});

function dashboardReviewHarness(fail=false){
 const vm=require('node:vm'),fs=require('node:fs'),saved=[],nodes=new Map();
 const host={innerHTML:'',querySelectorAll(){return [...this.innerHTML.matchAll(/data-dashboard-purpose="([^"]+)"/g)].map(match=>({dataset:{dashboardPurpose:match[1]},value:'coffee_bar',disabled:false}));}};
 nodes.set('dashOnlineRevenue',host);nodes.set('dashPurposeStatus',{textContent:''});
 const document={getElementById:id=>nodes.get(id)||null};
 const root={document,GremierDashboard:{businessDate:v=>String(v).slice(0,10),clearCache(){}},MAIN_SB:{from(table){assert.equal(table,'revenue_classification_overrides');return {upsert:async row=>{saved.push(row);return {error:fail?Error('offline'):null};}};}}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../admin-revenue.js'),'utf8'),{window:root,document,Intl,Date,console});
 return {root,host,saved,nodes};
}
test('dashboard review opens only unresolved orders and saving immediately updates the breakdown',async()=>{
 const h=dashboardReviewHarness(),pending={...order,id:'pending',order_number:209,customer_name:'Sample customer',items:[{name_en:'Jerry can',price:450,qty:1}]};
 const known={...order,id:'known',order_number:210,items:[{name_en:'Coffee bottle',price:450,qty:1}]};
 h.root.GremierRevenue.dashboardOnline([pending,known],{start:'2026-10-01',today:'2026-10-31'},[],75);
 assert.match(h.host.innerHTML,/Needs review · 1/);assert.match(h.host.innerHTML,/Orders awaiting a sales category/);
 assert.match(h.host.innerHTML,/data-dashboard-purpose="pending"/);assert.doesNotMatch(h.host.innerHTML,/data-dashboard-purpose="known"/);
 // Capture the real handler attached by the production renderer.
 const selects=[];const original=h.host.querySelectorAll.bind(h.host);h.host.querySelectorAll=()=>{const rows=original();selects.push(...rows);return rows;};
 h.root.GremierRevenue.dashboardOnline([pending,known],{start:'2026-10-01',today:'2026-10-31'},[],75);
 await selects[0].onchange();assert.equal(h.saved[0].source_key,'order-purpose:pending');assert.equal(h.saved[0].category,'coffee_bar');
 assert.doesNotMatch(h.host.innerHTML,/Needs review/);assert.match(h.host.innerHTML,/Events/);
});
test('failed dashboard classification preserves the unresolved order and reports that it was not saved',async()=>{
 const h=dashboardReviewHarness(true),selects=[],original=h.host.querySelectorAll.bind(h.host);
 h.host.querySelectorAll=()=>{const rows=original();selects.push(...rows);return rows;};
 h.root.GremierRevenue.dashboardOnline([{...order,items:[{name_en:'Jerry can',qty:1,price:450}]}],{start:'2026-10-01',today:'2026-10-31'},[],0);
 await selects[0].onchange();assert.equal(selects[0].disabled,false);assert.match(h.host.innerHTML,/Needs review/);assert.match(h.nodes.get('dashPurposeStatus').textContent,/not saved/);
});

{
 const {reconcile}=require('../admin-revenue.js');
 const report={total_minor:11240585,rows:[{imported:true,key:'finbot:1',amount_minor:11035665},{key:'order:2',amount_minor:46420},{key:'order-purpose:3',amount_minor:158500}]};
 const bridge=reconcile(report,11035665);
 assert.equal(bridge.newReceipts,46420);assert.equal(bridge.unreceipted,158500);
 assert.equal(bridge.snapshot+bridge.importAdjustments+bridge.newReceipts+bridge.unreceipted,bridge.total);
}
