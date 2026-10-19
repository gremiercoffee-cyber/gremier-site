// Pure mappings: type 1 is a קבלה; Finbot requires an amount summary matching its payment.
export function israelDate(value: string | Date): string {
  const date=new Date(value);
  if (!Number.isFinite(date.getTime())) throw Error('invalid_date');
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jerusalem',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date);
  return ['year','month','day'].map(k=>parts.find(p=>p.type===k)!.value).join('-');
}
export function amountMinor(value: unknown): number {
  if(value===null||value===undefined||value==='')throw Error('invalid_amount');
  const amount=Number(value), minor=Math.round(amount*100);
  if(!Number.isFinite(amount)||!Number.isSafeInteger(minor)||minor<=0||Math.abs(amount*100-minor)>0.00001)throw Error('invalid_amount');
  return minor;
}
export function paymentReference(order: any): string {
  const info=order.delivery_info||{};
  // Sale ID remains stable when a return URL arrives before callback transaction metadata.
  const ref=String(info.payme_sale_id||'').trim();
  if(!ref||/^SUB/i.test(ref))throw Error('missing_payment_reference');
  return 'payme:'+ref;
}
export function receiptCardFields(payload:any): Record<string,unknown> {
  const digits=String(payload.buyer_card_mask??payload.payme_transaction_card_mask??payload.card_mask??'').replace(/\D/g,'').slice(-4);
  return /^\d{4}$/.test(digits)?{receipt_card_last4:digits}:{};
}
export function eligibleOrder(order: any): void {
  if(!order||order.payment_status!=='paid')throw Error('not_paid');
  if(['cancelled','refunded'].includes(order.status)||order.is_test||/^TEST(?:\b|[_-])/i.test(order.customer_name||''))throw Error('excluded_order');
  if(!['website','payment_link','subscription'].includes(order.source))throw Error('unsupported_order_source');
  if(order.payment_method!=='payme')throw Error('unsupported_payment_method');
  // Gift-card handling needs a separate accounting mapping; avoid guessing.
  if(Number(order.gift_card_discount)>0||order.delivery_info?.is_gift_card)throw Error('gift_card_review_required');
  if(!String(order.customer_name||'').trim())throw Error('missing_customer_name');
  amountMinor(order.total); paymentReference(order);
}
export function receiptPayload(order: any, paymentDate: string, now=new Date()): Record<string,unknown> {
  eligibleOrder(order);
  const parsed=new Date(paymentDate+'T12:00:00Z');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(paymentDate)||!Number.isFinite(parsed.getTime())||parsed.toISOString().slice(0,10)!==paymentDate||paymentDate>israelDate(now))throw Error('invalid_payment_date');
  const fmt=(iso:string)=>iso.split('-').reverse().join('/');
  const card=String(order.delivery_info?.receipt_card_last4||'');
  if(!/^\d{4}$/.test(card))throw Error('card_last_four_required');
  const installments=Number(order.delivery_info?.receipt_installments);
  if(!Number.isInteger(installments)||installments<1||installments>999)throw Error('installment_count_required');
  const phone=String(order.customer_phone||'').trim().replace(/[\s().-]/g,'');
  return {
    // This business is exempt: Finbot explicitly rejects vatType=true with validation code 115.
    type:'1',date:fmt(israelDate(now)),language:'HE',currency:'ILS',vatType:false,rounding:false,
    title:`Gremier order ${order.order_number||order.id}`,
    description:`תשלום עבור הזמנה ${order.order_number||order.id}`,
    remark:`הזמנה מספר ${order.order_number||order.id}`,
    customer:{name:String(order.customer_name).trim().slice(0,100),...(/^\+?\d{7,15}$/.test(phone)?{phone}:{}),save:false},
    items:[{name:`תשלום עבור הזמנה ${order.order_number||order.id}`,amount:1,price:amountMinor(order.total)/100,save:false}],
    payments:[{type:'2',date:fmt(paymentDate),sum:amountMinor(order.total)/100,cardNumber:Number(card),numberPayments:installments,transactionNumber:String(order.delivery_info?.payme_transaction_id||paymentReference(order).slice(6)).slice(0,40)}],
    // No customer email: our confirmation email carries the original PDF, avoiding a second provider email.
  };
}
export function resultDocument(body: any): {url:string;reference:string|null} {
  if(Number(body?.status)!==1)throw Error('provider_rejected_or_unknown');
  if(typeof body.data!=='string')throw Error('unexpected_provider_result');
  const url=new URL(body.data);
  if(url.protocol!=='https:'||url.username||url.password)throw Error('invalid_document_url');
  return {url:url.href,reference:null}; // A URL is not an invented document number.
}
export function missingReceiptReport(orders:any[],receipts:any[],year:number) {
  const map=new Map(receipts.map(r=>[r.order_id,r]));
  const eligible=orders.filter(o=>o.payment_status==='paid'&&!o.is_test&&!/^TEST(?:\b|[_-])/i.test(o.customer_name||'')&&!['cancelled','refunded'].includes(o.status)&&israelDate(o.created_at).startsWith(String(year)+'-'));
  const rows=eligible.filter(o=>!['issued','external'].includes(map.get(o.id)?.status)).map(o=>({
    ...o,receipt_status:map.get(o.id)?.status||'no_linked_receipt',
    payment_date_basis:o.payment_confirmed_at?'payment_confirmed_at':'unknown',
  }));
  const known=rows.filter(o=>o.payment_confirmed_at&&israelDate(o.payment_confirmed_at).startsWith(String(year)+'-'));
  return {rows,count:rows.length,total_minor:rows.reduce((s,o)=>s+Math.round(Number(o.total||0)*100),0),
    known_payment_year_total_minor:known.reduce((s,o)=>s+Math.round(Number(o.total||0)*100),0),
    unknown_payment_date_count:rows.filter(o=>!o.payment_confirmed_at).length,
    needs_review_count:rows.filter(o=>o.receipt_status==='needs_review'||o.receipt_status==='issuing').length,
    basis:'Order creation year in Jerusalem; unknown payment dates and ambiguous issuance require reconciliation. No linked receipt does not prove no manual receipt exists.'};
}
