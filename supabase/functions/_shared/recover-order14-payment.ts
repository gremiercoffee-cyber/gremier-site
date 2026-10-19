import {amountMinor,eligibleOrder,israelDate} from './finbot-receipt-model.ts';
import {getPayMeBase} from './payme-query.ts';

export const restoredOrder14Id='b4a22283-01cb-43c9-86eb-6a18ffeff640';
export function selectOrder14Payment(order:any,sales:any[],seller:string) {
  if(order.id!==restoredOrder14Id||order.order_number!==14||!order.delivery_info?.restored_from_payment_link||
    order.delivery_info?.payme_sale_id||order.source!=='payment_link'||order.payment_status!=='paid'||
    israelDate(order.created_at)!=='2026-06-09'||amountMinor(order.total)!==14700)throw Error('legacy_recovery_not_authorized');
  const words=(value:string)=>value.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const target=words(String(order.customer_name||''));
  const matches=sales.filter(s=>{
    const names=words(Object.entries(s.sale_buyer_details||{}).filter(([k,v])=>/name/i.test(k)&&typeof v==='string').map(([,v])=>v).join(' '));
    return s.seller_payme_id===seller&&s.sale_status==='completed'&&s.sale_currency==='ILS'&&Number(s.sale_price)===14700&&
      String(s.sale_paid_date||'').slice(0,10)==='2026-06-09'&&target.length&&target.every(w=>names.includes(w));
  });
  if(matches.length!==1)throw Error('legacy_payment_not_unique');
  const sale=matches[0];
  if(!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(String(sale.transaction_id||''))||sale.transaction_id===order.id||!sale.sale_payme_id)throw Error('legacy_reference_needs_review');
  const invoices=sale.sale_invoices;
  if(invoices&&(typeof invoices==='object'?Object.keys(invoices).length:String(invoices).trim().length))throw Error('existing_payme_invoice_needs_review');
  const card=String(sale.sale_buyer_details?.buyer_card_mask||'').replace(/\D/g,'').slice(-4);
  const installments=Number(sale.sale_installments);
  if(!/^\d{4}$/.test(card)||!Number.isInteger(installments)||installments<1||installments>999)throw Error('payment_card_details_required');
  const recovered={...order,delivery_info:{...order.delivery_info,payme_sale_id:sale.sale_payme_id,
    receipt_card_last4:card,receipt_installments:installments},receipt_payment_date:'2026-06-09'};
  eligibleOrder(recovered);
  return {order:recovered,sale};
}

export async function recoverOrder14Payment(db:any,order:any) {
  if(order.id!==restoredOrder14Id)throw Error('legacy_recovery_not_authorized');
  const seller=Deno.env.get('PAYME_SELLER_ID');
  if(!seller)throw Error('payment_history_unavailable');
  const response=await fetch(`${getPayMeBase()}api/get-sales`,{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({seller_payme_id:seller}),signal:AbortSignal.timeout(20000)});
  const result=await response.json();
  if(!response.ok||Number(result.status_code)===1||!Array.isArray(result.items)||
    Number(result.items_count)!==result.items.length)throw Error('complete_payment_history_required');
  const recovered=selectOrder14Payment(order,result.items,seller);
  const saleId=recovered.sale.sale_payme_id;
  const [original,linked,receipt]=await Promise.all([
    db.from('orders').select('id').eq('id',recovered.sale.transaction_id).maybeSingle(),
    db.from('orders').select('id').eq('delivery_info->>payme_sale_id',saleId),
    db.from('order_receipts').select('order_id').eq('payment_reference','payme:'+saleId),
  ]);
  if(original.error||linked.error||receipt.error)throw Error('legacy_linkage_check_failed');
  if(original.data||linked.data?.length||receipt.data?.length)throw Error('legacy_payment_already_linked');
  return recovered.order;
}
