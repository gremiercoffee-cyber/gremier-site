import {amountMinor,israelDate} from './finbot-receipt-model.ts';
export function customerFields(raw:any) {
 const name=String(raw.name||'').trim(),tax=String(raw.tax_id||'').trim(),email=String(raw.email||'').trim(),phone=String(raw.phone||'').replace(/[\s().-]/g,'');
 if(!name||name.length>100)throw Error('customer_name_required');
 if(tax&&!/^\d{9}$/.test(tax))throw Error('tax_id_must_have_9_digits');
 if(email&&(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>50))throw Error('invalid_customer_email');
 if(phone&&!/^\+?\d{7,15}$/.test(phone))throw Error('invalid_customer_phone');
 const address=String(raw.address||'').trim();if(address.length>100)throw Error('customer_address_max_100');
 return {name,tax_id:tax,email,phone,address};
}
export function normalizeManualInput(raw:any,now=new Date()) {
 if(!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(raw.id||''))throw Error('invalid_request_id');
 if(!['cash','bank_transfer','check','bit'].includes(raw.payment_method))throw Error('choose_supported_payment_method');
 const payment_date=String(raw.payment_date||''),d=new Date(payment_date+'T12:00:00Z');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(payment_date)||!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==payment_date||payment_date>israelDate(now))throw Error('invalid_payment_date');
 const ids=Array.isArray(raw.billing_ids)?raw.billing_ids.map(String).sort():[];
 if(ids.length>60||new Set(ids).size!==ids.length||ids.some((x:string)=>!/^[0-9a-f-]{36}$/i.test(x)))throw Error('invalid_billing_selection');
 const customer_id=String(raw.customer_id||'');if(!/^[0-9a-f-]{36}$/i.test(customer_id))throw Error('choose_saved_customer');
 const description=String(raw.description||'').trim();if(!description||description.length>200)throw Error('description_required_max_200');
 const payment_reference=String(raw.payment_reference||'').trim(),adjustment_reason=String(raw.adjustment_reason||'').trim();
 if(payment_reference.length>40)throw Error('payment_reference_max_40');
 if(adjustment_reason.length>500)throw Error('adjustment_reason_max_500');
 const payment_details:Record<string,string>={};
 if(raw.payment_method==='check'){
  const details=raw.payment_details||{};
  for(const [key,max] of [['bank_code',3],['branch',4],['account',15],['check_number',15]] as const){
   const value=String(details[key]||'').trim();
   if(!new RegExp('^\\d{1,'+max+'}$').test(value)||!Number.isSafeInteger(Number(value))||Number(value)<=0)throw Error('check_'+key+'_required');
   payment_details[key]=value;
  }
  const date=String(details.check_date||''),parsed=new Date(date+'T12:00:00Z');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(parsed.getTime())||parsed.toISOString().slice(0,10)!==date)throw Error('check_date_required');
  payment_details.check_date=date;
 }
 const amount_minor=amountMinor(raw.amount);if(amount_minor>999999900)throw Error('amount_exceeds_finbot_limit');
 const billed=raw.billed_total_minor===null?null:Number(raw.billed_total_minor);
 if(ids.length&&(!Number.isSafeInteger(billed)||billed!<=0))throw Error('billing_preview_required');
 return {id:String(raw.id).toLowerCase(),customer_id,customer_version:String(raw.customer_version||'').slice(0,80),payment_method:raw.payment_method,payment_date,amount_minor,payment_details,
  payment_reference,description,billing_ids:ids,
  adjustment_reason,billed_total_minor:ids.length?billed:null,email_requested:raw.email_requested===true};
}
export function manualPayload(input:any,customer:any,now=new Date()) {
 const c=customerFields(customer),fmt=(s:string)=>s.split('-').reverse().join('/');
 if(input.email_requested&&!c.email)throw Error('customer_email_required');
 return {type:'1',date:fmt(israelDate(now)),language:'HE',currency:'ILS',vatType:false,rounding:false,
  title:`Gremier payment ${input.id.slice(0,8)}`,description:input.description,remark:input.adjustment_reason||'',
  customer:{name:c.name,...(c.tax_id?{tax:c.tax_id}:{}),...(c.phone?{phone:c.phone}:{}),...(c.address?{address:c.address}:{}),save:false},
  items:[{name:input.description.slice(0,100),amount:1,price:input.amount_minor/100,save:false}],
  payments:[{type:({cash:'0',bank_transfer:'1',check:'3',bit:'8'} as Record<string,string>)[input.payment_method],date:fmt(input.payment_method==='check'?input.payment_details.check_date:input.payment_date),sum:input.amount_minor/100,
   ...(input.payment_method==='check'?{bankName:Number(input.payment_details.bank_code),bankBranch:Number(input.payment_details.branch),bankAccount:Number(input.payment_details.account),checkNumber:Number(input.payment_details.check_number)}:{}),
   ...(input.payment_reference?{transactionNumber:input.payment_reference}:{})}]};
}
