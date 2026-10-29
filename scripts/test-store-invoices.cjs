const {test}=require('node:test'),assert=require('node:assert/strict');
const m=require('../supabase/functions/_shared/store-invoice-model.ts');
const {documentNumber,showsAmount}=require('../supabase/functions/_shared/finbot-pdf-text.ts');
const bill=(id,month,total,patch={})=>({id,store_id:'s',year:2026,month,total,...patch});
test('one invoice for all unpaid months: a line per month, VAT on top, shares add up',()=>{
 const plan=m.invoiceBills([bill('b',9,4020),bill('a',7,1430),bill('c',10,2541.5)],'s');
 assert.deepEqual(plan.lines.map(l=>l.month),[7,9,10]);assert.equal(plan.net_minor,799150);assert.equal(plan.vat_minor,143847);assert.equal(plan.gross_minor,942997);
 assert.equal(plan.shares.reduce((n,s)=>n+s.gross_minor,0),plan.gross_minor);
 const p=m.invoicePayload({name:'Good Store Ltd',tax_id:'123456789'},plan.lines,new Date('2026-11-01T10:00:00Z'));
 assert.equal(p.type,'0');assert.equal(p.vatType,true);assert.equal(p.customer.tax,'123456789');assert.deepEqual(p.items.map(i=>i.price),[1430,4020,2541.5]);
});
test('paid, cancelled or already invoiced months are refused; a ח.פ. is required',()=>{
 for(const patch of [{paid_at:'x'},{cancelled_at:'x'},{tax_invoice_id:'i'},{store_id:'other'}])assert.throws(()=>m.invoiceBills([bill('a',7,100,patch)],'s'),/month_not_invoiceable/);
 assert.throws(()=>m.invoiceBills([],'s'),/no_unpaid_months/);
 assert.throws(()=>m.invoiceCustomer({name:'Store'}),/store_tax_id_required/);
});
test('the document number is read next to its title, in either text direction',()=>{
 assert.equal(documentNumber(['גרמיר','20278',' / הלבק','212'],'קבלה'),'20278');
 assert.equal(documentNumber(['חשבונית מס / 30011','סה"כ'],'חשבונית מס'),'30011');
 assert.equal(documentNumber(['30011','סמ תינובשח','30012'],'חשבונית מס'),'30011');assert.equal(documentNumber(['חשבונית מס 30011','x','חשבונית מס 30012'],'חשבונית מס'),null,'two different numbers: not sure');
 assert.equal(showsAmount(['סה"כ','9,429.97'],942997),true);assert.equal(showsAmount(['9429.96'],942997),false);
});
