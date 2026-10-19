const {test}=require('node:test');
const assert=require('node:assert/strict');
const {eligibleOrder,receiptPayload,resultDocument,missingReceiptReport}=require('../supabase/functions/_shared/finbot-receipt-model.ts');
const env={FINBOT_API_KEY:'fixture-only',RESEND_API_KEY:'fixture-only',NOTIFY_EMAIL:'owner@example.test',PAYME_SELLER_ID:'seller-fixture',PAYME_API_URL:'https://payme.example.test/'};
global.Deno={env:{get:key=>env[key]}};
const {issueFinbotReceipt,repairReceiptPdf,originalPdf,sendReceiptTest}=require('../supabase/functions/_shared/finbot-receipts.ts');
const order=(patch={})=>({id:'a',order_number:123,customer_name:'Example buyer',customer_email:'buyer@example.test',source:'website',payment_status:'paid',status:'confirmed',payment_method:'payme',total:125.25,created_at:'2026-10-10T10:00:00Z',payment_confirmed_at:'2026-10-19T08:00:00Z',delivery_info:{payme_sale_id:'SALE-fixture',receipt_card_last4:'1234',receipt_installments:1},...patch});
function database(orders=[order()]){
 const receipts=new Map(),files=new Map();
 const settings={id:1,enabled:true,starts_at:'2026-10-19T07:00:00Z'};
 return {receipts,files,settings,from(table){
  let operation='read',patch,filters=[];
  const execute=()=>{
   let items=table==='orders'?orders:table==='order_receipts'?[...receipts.values()]:[settings];
   const matched=items.filter(r=>filters.every(([key,value])=>r[key]===value));
   if(operation==='insert'){
    if(receipts.has(patch.order_id)||[...receipts.values()].some(r=>r.payment_reference===patch.payment_reference))return {data:null,error:{code:'23505'}};
    const row={...patch};receipts.set(row.order_id,row);return {data:row,error:null};
   }
   if(operation==='update'){for(const row of matched)Object.assign(row,patch);return {data:matched[0]||null,error:matched.length?null:{message:'not found'}};}
   return {data:matched[0]||null,error:null};
  };
  const q={select(){return q},eq(k,v){filters.push([k,v]);return q},insert(p){operation='insert';patch=p;return q},update(p){operation='update';patch=p;return q},single:async()=>execute(),maybeSingle:async()=>execute(),then(resolve,reject){return Promise.resolve(execute()).then(resolve,reject)}};return q;
 },storage:{from(){return {upload:async(path,bytes)=>{files.set(path,bytes);return {error:null}},download:async path=>({data:files.has(path)?new Blob([files.get(path)]):null,error:!files.has(path)})}}}};
}
function provider(mode='ok'){
 const calls=[];
 global.fetch=async(url,init={})=>{
  calls.push({url,init});
  if(url==='https://payme.example.test/api/get-sales')return Response.json({items:[{sale_payme_id:'SALE-fixture',sale_status:'completed',sale_price:12525,transaction_id:'a',sale_paid_date:'2026-10-19 11:00:00',sale_currency:'ILS',sale_installments:1,sale_buyer_details:{buyer_card_mask:'****1234'},sale_invoices:[]}]});
  if(url==='https://api.resend.com/emails')return new Response('{}',{status:200});
  if(url==='https://api.finbotai.co.il/income'){
   if(mode==='timeout')throw Error('network timeout');
   return Response.json(mode==='reject'?{status:0}:{status:1,data:'https://api.finbotai.co.il/receipt-fixture.pdf'});
  }
  return new Response(mode==='html'?'<html>Viewer</html>':'%PDF-1.7\nfixture',{headers:{'content-type':mode==='html'?'text/html':'application/pdf'}});
 };
 return calls;
}
test('קבלה payload uses exact collected amount, card reference, Hebrew and matching summary without provider-email side effect',()=>{
 const p=receiptPayload(order(),'2026-10-19',new Date('2026-10-20T10:00:00Z'));
 assert.equal(p.type,'1');assert.equal(p.language,'HE');assert.equal(p.date,'20/10/2026');
 assert.equal(p.vatType,false,'This exempt business cannot issue VAT-inclusive receipts');
 assert.equal(p.payments[0].date,'19/10/2026');assert.equal(p.payments[0].sum,125.25);assert.equal(p.payments[0].type,'2');
 assert.equal(p.items.length,1);assert.equal(p.items[0].price*p.items[0].amount,p.payments[0].sum);assert.equal(p.customer.email,undefined);assert.equal(p.email,undefined);
 assert.throws(()=>receiptPayload(order(),'2026-02-30'));assert.throws(()=>receiptPayload(order(),'2099-01-01'));
});
test('reject unpaid, test, refunded, unsupported payment, gift-card and invalid-amount cases',()=>{
 for(const patch of [{payment_status:'unpaid'},{status:'refunded'},{is_test:true},{customer_name:'TEST-order'},{source:'gift_card'},{payment_method:'gift_card'},{gift_card_discount:20},{total:0},{total:-10},{total:null},{total:1.001},{delivery_info:{payme_sale_id:'SUB-1'}}])assert.throws(()=>eligibleOrder(order(patch)));
});
test('successful result must include an HTTPS original-document URL',()=>{
 assert.equal(resultDocument({status:1,data:'https://api.finbotai.co.il/r.pdf'}).url,'https://api.finbotai.co.il/r.pdf');
 for(const b of [{status:0},{status:1,data:'http://localhost/private'},{status:1,data:{url:'x'}}])assert.throws(()=>resultDocument(b));
});
test('disabled automation and historical order do not contact Finbot',async()=>{
 const calls=provider(),db=database();db.settings.enabled=false;await issueFinbotReceipt(db,'a');
 db.settings.enabled=true;db.settings.starts_at='2026-10-20T00:00:00Z';await issueFinbotReceipt(db,'a');assert.equal(calls.length,0);assert.equal(db.receipts.size,0);
});

test('explicit historical issuance bypasses the cutoff, stores a real receipt and sends no email',async()=>{
 const calls=provider(),db=database([order({payment_confirmed_at:null})]);
 db.settings.starts_at='2026-10-20T00:00:00Z';
 await issueFinbotReceipt(db,'a',{backfillYear:2026});
 await issueFinbotReceipt(db,'a',{backfillYear:2026});
 assert.equal(calls.filter(c=>c.url.endsWith('/income')).length,1);
 assert.equal(calls.filter(c=>c.url==='https://api.resend.com/emails').length,0);
 assert.equal(db.receipts.get('a').status,'issued');
 assert.equal(db.receipts.get('a').is_test,false);
 assert.equal(db.receipts.get('a').payment_date,'2026-10-19');
 assert.equal(db.files.size,1);
});

test('historical issuance rejects other years, unpaid orders and payments outside 2026',async()=>{
 const calls=provider();
 for(const [patch,options,error] of [
  [{created_at:'2025-12-01T00:00:00Z'},{backfillYear:2026},/historical_year_mismatch/],
  [{},{backfillYear:2025},/historical_year_mismatch/],
  [{},{backfillYear:2026,test:true},/historical_year_mismatch/],
  [{payment_status:'unpaid'},{backfillYear:2026},/not_paid/],
 ])await assert.rejects(issueFinbotReceipt(database([order(patch)]),'a',options),error);
 const fetcher=global.fetch;
 global.fetch=async(url,init)=>{
  const response=await fetcher(url,init);
  if(url==='https://payme.example.test/api/get-sales'){
   const body=await response.json();body.items[0].sale_paid_date='2025-12-31 12:00:00';return Response.json(body);
  }
  return response;
 };
 await assert.rejects(issueFinbotReceipt(database(),'a',{backfillYear:2026}),/historical_payment_year_mismatch/);
 assert.equal(calls.filter(c=>c.url.endsWith('/income')).length,0);
});
test('concurrent callbacks issue exactly one receipt and persist original PDF',async()=>{
 const calls=provider(),db=database();await Promise.all(Array.from({length:5},()=>issueFinbotReceipt(db,'a')));
 assert.equal(calls.filter(c=>c.url.endsWith('/income')).length,1);
 assert.equal(db.receipts.get('a').status,'issued');assert.equal(db.files.size,1);
 await issueFinbotReceipt(db,'a');assert.equal(calls.filter(c=>c.url.endsWith('/income')).length,1);
});
test('same payment cannot create receipts against two orders',async()=>{
 const calls=provider(),db=database([order(),order({id:'b',delivery_info:{payme_sale_id:'SALE-fixture',payme_transaction_id:'TX-added-later',receipt_card_last4:'1234'}})]);await issueFinbotReceipt(db,'a');await assert.rejects(issueFinbotReceipt(db,'b'),/payment_verification_required/);
 assert.equal(calls.filter(c=>c.url.endsWith('/income')).length,1);
});

test('checkout retries use the verified replacement sale for details and the unique receipt claim',async()=>{
 const calls=provider(),fetcher=global.fetch;
 global.fetch=async(url,init)=>{
  if(url==='https://payme.example.test/api/get-sales'&&JSON.parse(init.body).sale_payme_id==='OLD-SALE')return Response.json({items:[]});
  return fetcher(url,init);
 };
 const db=database([order({delivery_info:{payme_sale_id:'OLD-SALE'}})]);
 await issueFinbotReceipt(db,'a',{backfillYear:2026});
 assert.equal(db.receipts.get('a').status,'issued');
 assert.equal(db.receipts.get('a').payment_reference,'payme:SALE-fixture');
 assert.equal(calls.filter(c=>c.url.endsWith('/income')).length,1);
});

test('missing sale references are recovered only from a verified completed payment for this order',async()=>{
 const calls=provider(),db=database([order({delivery_info:{}})]);
 await issueFinbotReceipt(db,'a',{backfillYear:2026});
 assert.equal(db.receipts.get('a').payment_reference,'payme:SALE-fixture');
 assert.equal(calls.filter(c=>c.url.endsWith('/income')).length,1);
 const noMatch=database([order({delivery_info:{}})]);
 global.fetch=async()=>Response.json({items:[]});
 await assert.rejects(issueFinbotReceipt(noMatch,'a',{backfillYear:2026}),/missing_payment_reference/);
 assert.equal(noMatch.receipts.size,0);
});
test('timeout and HTTP-200 business failure stop for review without automatic reissuance',async()=>{
 for(const mode of ['timeout','reject']){const calls=provider(mode),db=database();await issueFinbotReceipt(db,'a');await issueFinbotReceipt(db,'a');assert.equal(db.receipts.get('a').status,'needs_review');assert.equal(calls.filter(c=>c.url.endsWith('/income')).length,1);}
});
test('HTML viewer cannot be disguised as PDF; repairing download never reissues receipt',async()=>{
 const calls=provider('html'),db=database();await issueFinbotReceipt(db,'a');assert.equal(db.receipts.get('a').status,'issued');assert.equal(db.receipts.get('a').pdf_path,undefined);
 const retryCalls=provider();await repairReceiptPdf(db,'a');assert.ok(db.receipts.get('a').pdf_path);assert.equal(retryCalls.filter(c=>c.url.endsWith('/income')).length,0);assert.equal(calls.filter(c=>c.url.endsWith('/income')).length,1);
});
test('PDF requests reject unknown hosts and redirects to private hosts',async()=>{
 await assert.rejects(originalPdf('https://example.test/r.pdf'));
 await assert.rejects(originalPdf('https://api.finbotai.co.il/r.pdf',async()=>new Response(null,{status:302,headers:{location:'http://127.0.0.1/private'}})));
});
test('Finbot original viewer resolves only the observed same-host PDF source',async()=>{
 const seen=[];
 const bytes=await originalPdf('https://arusi.finbot.co.il/show_doc_app.php?doc=fixture',async(url,options)=>{
  seen.push(url);if(seen.length===1)return new Response(`<script>image_url='/load_pdf_doc.php?auth=fixture'</script>`,{headers:{'set-cookie':'PHPSESSID=fixture-session; Path=/; HttpOnly'}});
  assert.equal(options.headers.Cookie,'PHPSESSID=fixture-session');assert.ok(options.headers.Referer.includes('/show_doc_app.php'));
  return new Response('%PDF-1.7\nfixture');
 });
 assert.ok(new TextDecoder().decode(bytes).startsWith('%PDF-'));assert.equal(seen.length,2);assert.equal(new URL(seen[1]).pathname,'/load_pdf_doc.php');
 await assert.rejects(originalPdf('https://arusi.finbot.co.il/show_doc_app.php',async()=>new Response(`<script>image_url='https://untrusted.example.test/load_pdf_doc.php'</script>`)));
 const redirected=await originalPdf('https://arusi.finbot.co.il/show_doc_app.php',async url=>new Response(new URL(url).pathname==='/show_doc_app.php'?null:new URL(url).pathname==='/show_image.php'?`<script>image_url='/load_pdf_doc.php?auth=fixture'</script>`:'%PDF-1.7\nfixture',new URL(url).pathname==='/show_doc_app.php'?{status:302,headers:{location:'/show_image.php'}}:{}));
 assert.ok(new TextDecoder().decode(redirected).startsWith('%PDF-'));
});
test('real test email goes only to owner, includes PDF and sends once',async()=>{
 const calls=provider(),db=database();db.settings.enabled=false;
 await issueFinbotReceipt(db,'a',{test:true});await sendReceiptTest(db,'a');await sendReceiptTest(db,'a');
 const sent=calls.filter(c=>c.url==='https://api.resend.com/emails');assert.equal(sent.length,1);
 const mail=JSON.parse(sent[0].init.body);assert.deepEqual(mail.to,['owner@example.test']);assert.equal(mail.attachments.length,1);assert.ok(atob(mail.attachments[0].content).startsWith('%PDF-'));
});
test('2026 reconciliation separates linked, unknown payment dates, reviews and Jerusalem year boundary',()=>{
 const orders=[order({id:'a'}),order({id:'b',payment_confirmed_at:null}),order({id:'c'}),order({id:'d'}),order({id:'e',created_at:'2026-12-31T23:00:00Z'}),order({id:'f',payment_status:'unpaid'}),order({id:'g',status:'cancelled'})];
 const report=missingReceiptReport(orders,[{order_id:'a',status:'issued'},{order_id:'c',status:'external'},{order_id:'d',status:'needs_review'}],2026);
 assert.equal(report.count,2);assert.equal(report.total_minor,25050);assert.equal(report.unknown_payment_date_count,1);assert.equal(report.needs_review_count,1);
});
