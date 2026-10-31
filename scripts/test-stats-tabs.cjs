const {test}=require('node:test'),assert=require('node:assert/strict');
const m=require('../admin-stats-tabs.js');
test('store stats: usual delivery gap, days to pay, trend and what is owed',()=>{
 const bills=[{store_id:'s',year:2026,month:4,total:100,billed_at:'2026-05-01',paid_at:'2026-05-11'},{store_id:'s',year:2026,month:5,total:100,billed_at:'2026-06-01',paid_at:'2026-06-21'},
  {store_id:'s',year:2026,month:7,total:300,billed_at:'2026-08-01'},{store_id:'s',year:2026,month:8,total:300,billed_at:'2026-09-01',invoiced_gross_minor:35400},{store_id:'s',year:2026,month:9,total:300,cancelled_at:'x'}];
 const del=['2026-08-01','2026-08-08','2026-08-15','2026-08-29'].map(d=>({store_id:'s',delivery_date:d}));
 const x=m.storeStats({id:'s'},bills,del,'2026-10-15');
 assert.equal(x.gap,7);assert.equal(x.payDays,15);assert.equal(x.owed,30000+35400);assert.equal(x.oldestBilled,'2026-08-01');
 assert.equal(x.trend,200);// Jul-Sep 600 vs Apr-Jun 200
 assert.equal(x.last6.length,7);
});
test('customers by month: first order counts as new, later ones as returning; average order',()=>{
 const o=(id,at,email,total)=>({id,created_at:at,customer_email:email,total,payment_status:'paid',status:'fulfilled'});
 const r=m.customerMonths([o('a','2026-01-05','x@y.z',100),o('b','2026-02-01','X@y.z',50),o('c','2026-02-03','q@y.z',150),{...o('d','2026-02-04','r@y.z',99),status:'cancelled'}],2026);
 assert.deepEqual([r[0].new,r[0].returning,r[1].new,r[1].returning,r[1].aov],[1,0,1,1,10000]);
});
