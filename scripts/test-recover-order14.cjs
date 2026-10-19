const {test}=require('node:test');
const assert=require('node:assert/strict');
global.Deno={env:{get:k=>({PAYME_SELLER_ID:'seller',PAYME_API_URL:'https://payme.example.test/'})[k]}};
const {selectOrder14Payment,recoverOrder14Payment,restoredOrder14Id}=require('../supabase/functions/_shared/recover-order14-payment.ts');
const order=()=>({id:restoredOrder14Id,order_number:14,source:'payment_link',payment_method:'payme',payment_status:'paid',status:'fulfilled',
  created_at:'2026-06-09T22:35:32.580496+03:00',customer_name:'ernst',total:147,
  delivery_info:{restored_from_payment_link:true,payme_sale_id:null}});
const sale=()=>({seller_payme_id:'seller',sale_payme_id:'SALE-original',sale_status:'completed',sale_currency:'ILS',sale_price:14700,
  sale_paid_date:'2026-06-09 21:50:33',transaction_id:'11111111-1111-4111-8111-111111111111',sale_installments:1,
  sale_invoices:null,sale_buyer_details:{buyer_name:'Ofelia Ernst',buyer_card_mask:'****1234'}});
test('recovery identifies the unique same-day, same-buyer and same-amount payment without mutating order metadata',()=>{
 const o=order(),r=selectOrder14Payment(o,[sale()],'seller');
 assert.equal(r.order.delivery_info.payme_sale_id,'SALE-original');assert.equal(r.order.receipt_payment_date,'2026-06-09');
 assert.equal(r.order.total,147);assert.equal(o.delivery_info.payme_sale_id,null);
});
test('recovery cannot be used for another order or ambiguous/wrong payments',()=>{
 assert.throws(()=>selectOrder14Payment({...order(),id:'other'},[sale()],'seller'),/not_authorized/);
 assert.throws(()=>selectOrder14Payment(order(),[sale(),sale()],'seller'),/not_unique/);
 for(const patch of [{seller_payme_id:'other'},{sale_price:14699},{sale_status:'refunded'},{sale_currency:'USD'},
   {sale_paid_date:'2026-06-10 21:50:33'},{sale_buyer_details:{buyer_name:'Bernst'}}]) {
  assert.throws(()=>selectOrder14Payment(order(),[{...sale(),...patch}],'seller'),/not_unique/);
 }
 assert.throws(()=>selectOrder14Payment(order(),[{...sale(),sale_invoices:[{}]}],'seller'),/existing_payme_invoice/);
});
function db(block){return {from(table){const q={select(){return q},eq(){return q},maybeSingle:async()=>({data:block==='original'?{id:'original'}:null}),
 then(resolve){return Promise.resolve({data:block===table?[{id:'linked'}]:[]}).then(resolve)}};return q}}}
test('recovery requires complete history and refuses existing order or receipt linkages',async()=>{
 const response=(count=1)=>Response.json({status_code:0,items_count:count,items:[sale()]});
 global.fetch=async()=>response();
 assert.equal((await recoverOrder14Payment(db(),order())).receipt_payment_date,'2026-06-09');
 for(const blocked of ['original','orders','order_receipts'])await assert.rejects(recoverOrder14Payment(db(blocked),order()),/already_linked/);
 global.fetch=async()=>response(2);
 await assert.rejects(recoverOrder14Payment(db(),order()),/complete_payment_history/);
});
