const {test}=require('node:test'),assert=require('node:assert/strict');
const m=require('../admin-billing-documents.js');
const stores=[{id:'s',name:'Good Store'},{id:'old',name:'Inactive Store'}];
const bills=[{id:'b',store_id:'s',year:2025,month:12,total:100,image_url:'https://example.test/original.png'},{id:'no-image',store_id:'s',year:2026,month:1,total:200}];
const receipts=[{id:'receipt1',store_id:'s',status:'issued',amount_minor:9000,payment_date:'2026-02-03',document_reference:'20280',billing_snapshot:[{year:2025,month:12},{year:2026,month:1}]},{id:'draft',store_id:'s',status:'issuing'},{id:'personal',status:'issued',payment_date:'2026-01-01'},{id:'oldreceipt',store_id:'old',status:'issued',amount_minor:5000,payment_date:'2024-01-01',billing_snapshot:[]}];
test('all-time archive retains saved statements and issued store receipts including old stores',()=>{
 const rows=m.documents(bills,receipts,stores);assert.equal(rows.length,3);assert.equal(rows[0].kind,'receipt');assert.equal(rows[1].url,bills[0].image_url);
 const receipt=rows[0];assert.match(receipt.name,/Good Store/);assert.match(receipt.name,/2025-12, 2026-01/);assert.match(receipt.name,/קבלה 20280/);assert.equal(receipt.amount_minor,9000);
 assert.match(rows[1].name,/חשבון עסקה/);assert.equal(m.search(rows,{store:'old'}).length,1);
});
test('search finds store names, covered months, document types and receipt references together',()=>{
 const rows=m.documents(bills,receipts,stores);
 assert.equal(m.search(rows,{query:'good store 2026-01 receipt 20280'}).length,1);
 assert.equal(m.search(rows,{query:'חשבון עסקה 2025-12'}).length,1);
 assert.equal(m.search(rows,{query:'20280',store:'old'}).length,0);
 assert.equal(m.search(rows,{store:'s',type:'receipt'}).length,1);
});
test('download filenames retain findable Hebrew names while staying safe on Windows',()=>{
 const name=m.filename('Gremier - Store / Name: 2026-01 - קבלה 20280','pdf');
 assert.match(name,/קבלה 20280\.pdf$/);assert.doesNotMatch(name,/[<>:"/\\|?*]/);
});
