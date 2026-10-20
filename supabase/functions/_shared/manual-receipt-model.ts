import {amountMinor,israelDate} from './finbot-receipt-model.ts';
export function customerFields(raw:any) {
 const name=String(raw.name||'').trim(),tax=String(raw.tax_id||'').trim(),email=String(raw.email||'').trim(),phone=String(raw.phone||'').replace(/[\s().-]/g,'');
 if(!name||name.length>100)throw Error('customer_name_required');
 if(tax&&!/^\d{9}$/.test(tax))throw Error('tax_id_must_have_9_digits');
 if(email&&(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>50))throw Error('invalid_customer_email');
 if(phone&&!/^\+?\d{7,15}$/.test(phone))throw Error('invalid_customer_phone');
 return {name,tax_id:tax,email,phone,address:String(raw.address||'').trim().slice(0,100)};
}
export function normalizeManualInput(raw:any,now=new Date()) {
 if(!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(raw.id||''))throw Error('invalid_request_id');
 if(!['cash','bank_transfer'].includes(raw.payment_method))throw Error('choose_cash_or_bank_transfer');
 const payment_date=String(raw.payment_date||''),d=new Date(payment_date+'T12:00:00Z');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(payment_date)||!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==payment_date||payment_date>israelDate(now))throw Error('invalid_payment_date');
 const ids=Array.isArray(raw.billing_ids)?raw.billing_ids.map(String).sort():[];
 if(ids.length>60||new Set(ids).size!==ids.length||ids.some((x:string)=>!/^[0-9a-f-]{36}$/i.test(x)))throw Error('invalid_billing_selection');
 const customer_id=String(raw.customer_id||'');if(!/^[0-9a-f-]{36}$/i.test(customer_id))throw Error('choose_saved_customer');
 const description=String(raw.description||'').trim();if(!description||description.length>200)throw Error('description_required_max_200');
 const billed=raw.billed_total_minor===null?null:Number(raw.billed_total_minor);
 if(ids.length&&(!Number.isSafeInteger(billed)||billed!<=0))throw Error('billing_preview_required');
 return {id:String(raw.id).toLowerCase(),customer_id,payment_method:raw.payment_method,payment_date,amount_minor:amountMinor(raw.amount),
  payment_reference:String(raw.payment_reference||'').trim().slice(0,40),description,billing_ids:ids,
  adjustment_reason:String(raw.adjustment_reason||'').trim().slice(0,500),billed_total_minor:ids.length?billed:null,email_requested:raw.email_requested===true};
}
export function manualPayload(input:any,customer:any,now=new Date()) {
 const c=customerFields(customer),fmt=(s:string)=>s.split('-').reverse().join('/');
 if(input.email_requested&&!c.email)throw Error('customer_email_required');
 return {type:'1',date:fmt(israelDate(now)),language:'HE',currency:'ILS',vatType:false,rounding:false,
  title:`Gremier payment ${input.id.slice(0,8)}`,description:input.description,remark:input.adjustment_reason||'',
  customer:{name:c.name,...(c.tax_id?{tax:c.tax_id}:{}),...(c.phone?{phone:c.phone}:{}),...(c.address?{address:c.address}:{}),save:false},
  items:[{name:input.description.slice(0,100),amount:1,price:input.amount_minor/100,save:false}],
  payments:[{type:input.payment_method==='cash'?'0':'1',date:fmt(input.payment_date),sum:input.amount_minor/100,
   ...(input.payment_reference?{transactionNumber:input.payment_reference}:{})}]};
}
