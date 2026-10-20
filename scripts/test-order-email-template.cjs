const {test}=require('node:test'),assert=require('node:assert/strict');
const {buildCustomerReceiptText,buildFulfillmentEmailText}=require('../supabase/functions/_shared/order-email.ts');
test('confirmation and fulfillment templates use the current public domain',()=>{
 const confirmation=buildCustomerReceiptText({order_number:123,customer_name:'Example Customer',items_summary:'2× Classic — ₪48',subtotal:96,discount:0,total:96,delivery_address:'Example address'});
 assert.match(confirmation.subject,/order #123 confirmed/);assert.match(confirmation.text,/Thank you! We received your payment\./);assert.match(confirmation.text,/https:\/\/gremiercoffee\.co\.il/);assert.doesNotMatch(confirmation.text,/vercel\.app/);
 const fulfilled=buildFulfillmentEmailText({order_number:123});assert.match(fulfilled.text,/https:\/\/gremiercoffee\.co\.il/);assert.doesNotMatch(fulfilled.text,/vercel\.app/);
});
