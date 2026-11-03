const {test}=require('node:test'),assert=require('node:assert/strict');
const {normalizeManualInput,manualPayload}=require('../supabase/functions/_shared/manual-receipt-model.ts');
test('one combined paid document retains selected months and the actual VAT-inclusive payment',()=>{
 const ids=['10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002'];
 const input=normalizeManualInput({id:'20000000-0000-4000-8000-000000000001',customer_id:'30000000-0000-4000-8000-000000000001',document_type:'invoice_receipt',amount:'2080',payment_date:'2026-11-03',payment_method:'bank_transfer',description:'July and August',billing_ids:ids,billed_total_minor:206000,adjustment_reason:'Customer paid ₪20 extra'},new Date('2026-11-03T12:00:00Z'));
 assert.deepEqual(input.billing_ids,ids);assert.equal(input.amount_minor,208000);assert.equal(input.billed_total_minor,206000);
 const payload=manualPayload(input,{name:'Test store'},new Date('2026-11-03T12:00:00Z'));
 assert.equal(payload.type,'2');assert.equal(payload.payments[0].sum,2080);
 const net=Math.round(payload.items[0].price*100);assert.equal(net+Math.round(net*.18),208000);
 assert.equal(payload.description,'July and August');
});
