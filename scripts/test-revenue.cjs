const {test}=require('node:test'),assert=require('node:assert/strict');
const m=require('../admin-revenue.js');
const products=[{id:'bar',is_coffee_bar:true},{id:'coffee',category:'bottles'},{id:'gift',category:'giftcards'}];
const order={id:'o',order_number:42,total:450,created_at:'2026-10-02',payment_status:'paid',items:[{product_id:'bar',price:400,qty:1},{product_id:'coffee',price:100,qty:1}]};
const base=()=>({orders:[order],products,stores:[{id:'s',name:'Good Store'}],customers:[{name:'Store legal name',store_id:'s'}],imported:[],orderReceipts:[],businessReceipts:[],overrides:[]});
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
 const rows=m.receipts(d);assert.equal(rows[0].parts.stores,100000);assert.equal(rows[1].parts.stores,40000);assert.equal(rows[2].parts.other,30000);assert.equal(rows[3].parts.coffee_bar,30001);assert.equal(rows[3].estimated,true);
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
