import {eligibleOrder,israelDate,paymentReference,amountMinor,receiptPayload,resultDocument} from './finbot-receipt-model.ts';

const bucket='order-receipts';
export async function receiptPreviewOrder(db:any,orderId:string) {
  const order=await receiptOrder(db,orderId);
  eligibleOrder(order);
  if(!/^\d{4}$/.test(String(order.delivery_info?.receipt_card_last4||''))) {
    const seller=Deno.env.get('PAYME_SELLER_ID'),sale=String(order.delivery_info?.payme_sale_id||'');
    if(seller&&sale&&!/^SUB/i.test(sale)) {
      const {resolvePayMePaymentStatus,getPayMeBase}=await import('./payme-query.ts');
      const expected=[orderId,order.delivery_info?.payment_link_code?'pl_'+order.delivery_info.payment_link_code:''];
      const verified=await resolvePayMePaymentStatus(sale,expected);
      if(!verified?.isCompleted||verified.priceAgorot!==amountMinor(order.total))throw Error('payment_verification_required');
      const response=await fetch(`${getPayMeBase()}api/get-buyer-key`,{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({seller_payme_id:seller,payme_sale_id:sale}),signal:AbortSignal.timeout(15000)});
      const body=await response.json();
      // Only the last four card digits are used. Never store or return a reusable buyer token.
      const digits=String(body.buyer_card_mask||'').replace(/\D/g,'').slice(-4);
      if(response.ok&&/^\d{4}$/.test(digits))order.delivery_info={...order.delivery_info,receipt_card_last4:digits};
    }
  }
  return order;
}
export async function receiptSettings(db:any) {
  const {data,error}=await db.from('finbot_receipt_settings').select('*').eq('id',1).single();
  if(error)throw Error('receipt_settings_unavailable');
  return data;
}
export async function receiptRow(db:any,orderId:string) {
  const {data,error}=await db.from('order_receipts').select('*').eq('order_id',orderId).maybeSingle();
  if(error)throw Error('receipt_status_unavailable');
  return data;
}
export async function receiptOrder(db:any,orderId:string) {
  const {data,error}=await db.from('orders').select('*').eq('id',orderId).single();
  if(error)throw Error('order_unavailable');
  return data;
}
function allowedDocumentUrl(value:string) {
  const url=new URL(value);
  const hosts=['api.finbotai.co.il','arusi.finbot.co.il','finbot.co.il','www.finbot.co.il',
    ...(Deno.env.get('FINBOT_DOCUMENT_HOSTS')||'').split(',').map(s=>s.trim()).filter(Boolean)];
  if(url.protocol!=='https:'||url.username||url.password||url.port||!hosts.includes(url.hostname))throw Error('document_host_needs_review');
  return url.href;
}
export async function originalPdf(url:string,fetcher:typeof fetch=fetch):Promise<Uint8Array> {
  let target=allowedDocumentUrl(url);
  for(let redirect=0;redirect<4;redirect++) {
    const response=await fetcher(target,{redirect:'manual',signal:AbortSignal.timeout(20000)});
    if([301,302,303,307,308].includes(response.status)) {
      const location=response.headers.get('location');
      await response.body?.cancel();
      if(!location)throw Error('document_redirect_invalid');
      target=allowedDocumentUrl(new URL(location,target).href); continue;
    }
    if(!response.ok||!response.body)throw Error('document_download_failed');
    const max=8*1024*1024;
    if(Number(response.headers.get('content-length'))>max){await response.body.cancel();throw Error('document_too_large');}
    const reader=response.body.getReader(),chunks:Uint8Array[]=[];let length=0;
    while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>max){await reader.cancel();throw Error('document_too_large');}chunks.push(value);}
    const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
    if(new TextDecoder().decode(bytes.slice(0,5))!=='%PDF-')throw Error('original_is_not_downloadable_pdf');
    return bytes;
  }
  throw Error('too_many_document_redirects');
}
async function savePdf(db:any,row:any) {
  if(row.pdf_path)return row;
  try {
    const bytes=await originalPdf(row.document_url);
    const pdfPath=`${row.order_id}/receipt.pdf`;
    const {error}=await db.storage.from(bucket).upload(pdfPath,bytes,{contentType:'application/pdf',upsert:true});
    if(error)throw Error('pdf_storage_failed');
    const {data,error:updateError}=await db.from('order_receipts').update({pdf_path:pdfPath,error_code:null}).eq('order_id',row.order_id).eq('status','issued').select('*').single();
    if(updateError)throw Error('pdf_status_save_failed');
    return data;
  } catch(e) {
    const code=e instanceof Error&&/^[a-z_]+$/.test(e.message)?e.message:'pdf_unavailable';
    await db.from('order_receipts').update({error_code:code}).eq('order_id',row.order_id).eq('status','issued');
    return {...row,error_code:code};
  }
}
export async function issueFinbotReceipt(db:any,orderId:string,options:{test?:boolean;paymentDate?:string}={}) {
  const order=await receiptOrder(db,orderId);
  const settings=await receiptSettings(db);
  if(!options.test) {
    if(!settings.enabled||!settings.starts_at)return {skipped:'automation_disabled'};
    if(!order.payment_confirmed_at||new Date(order.payment_confirmed_at)<new Date(settings.starts_at))return {skipped:'historical_order'};
  }
  eligibleOrder(order);
  const existing=await receiptRow(db,orderId);
  if(existing) {
    if(existing.status==='issued')return {receipt:existing};
    return {skipped:'already_claimed_or_linked',receipt:existing};
  }
  const key=(Deno.env.get('FINBOT_API_KEY')||'').trim();
  if(!key)return {skipped:'finbot_not_configured'};
  const paymentDate=order.payment_confirmed_at?israelDate(order.payment_confirmed_at):options.paymentDate;
  if(!paymentDate)throw Error('actual_payment_date_required');
  const completeOrder=await receiptPreviewOrder(db,orderId);
  const payload=receiptPayload(completeOrder,paymentDate);
  // Committed unique claim BEFORE contacting Finbot. Never automatically retry an uncertain result.
  const {data:claim,error:claimError}=await db.from('order_receipts').insert({order_id:orderId,status:'issuing',
    payment_reference:paymentReference(order),amount_minor:amountMinor(order.total),payment_date:paymentDate,is_test:!!options.test}).select('*').single();
  if(claimError) {
    if(claimError.code==='23505')return {skipped:'already_claimed_or_payment_linked'};
    throw Error('receipt_claim_failed');
  }
  try {
    const response=await fetch('https://api.finbotai.co.il/income',{method:'POST',
      headers:{'Content-Type':'application/json',secret:key},body:JSON.stringify(payload),signal:AbortSignal.timeout(25000)});
    // Even a non-2xx response can be ambiguous: don't repeat document creation.
    if(!response.ok)throw Error('provider_response_needs_review');
    const document=resultDocument(await response.json());
    const {data:issued,error}=await db.from('order_receipts').update({status:'issued',document_url:document.url,
      document_reference:document.reference,issued_at:new Date().toISOString(),error_code:null}).eq('order_id',orderId).eq('status','issuing').select('*').single();
    if(error)throw Error('receipt_save_needs_review');
    return {receipt:await savePdf(db,issued)};
  } catch(e) {
    const code=e instanceof Error&&/^[a-z_]+$/.test(e.message)?e.message:'provider_result_unknown';
    await db.from('order_receipts').update({status:'needs_review',error_code:code}).eq('order_id',claim.order_id).eq('status','issuing');
    return {skipped:'needs_review',error:code};
  }
}
export async function repairReceiptPdf(db:any,orderId:string) {
  const row=await receiptRow(db,orderId);
  if(row?.status!=='issued'||!row.document_url)throw Error('no_issued_document');
  return await savePdf(db,row);
}
export async function receiptAttachment(db:any,orderId:string) {
  const row=await receiptRow(db,orderId);
  if(row?.status!=='issued'||!row.pdf_path)return null;
  const {data,error}=await db.storage.from(bucket).download(row.pdf_path);
  if(error||!data)return null;
  const bytes=new Uint8Array(await data.arrayBuffer());
  // Chunk conversion avoids large-argument stack overflows.
  let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.slice(i,i+8192));
  return {filename:`Gremier-receipt-${orderId}.pdf`,content:btoa(binary)};
}
export async function sendReceiptTest(db:any,orderId:string) {
  const row=await receiptRow(db,orderId);
  if(row?.status!=='issued'||!row.is_test)throw Error('test_receipt_required');
  if(row.test_email_sent_at)return {sent:true,already_sent:true};
  const attachment=await receiptAttachment(db,orderId);
  if(!attachment)throw Error('original_pdf_not_ready');
  const {sendOrderEmails,buildCustomerReceiptText}=await import('./order-email.ts');
  const order=await receiptOrder(db,orderId);
  const confirmation=buildCustomerReceiptText({order_number:order.order_number,customer_name:order.customer_name,
    items_summary:(order.items||[]).map((i:any)=>`${i.qty}× ${i.name_he||i.name_en}`).join('\n'),
    subtotal:Number(order.subtotal)||0,discount:Number(order.discount)||0,total:Number(order.total),delivery_address:order.delivery_address});
  const result=await sendOrderEmails({ownerSubject:`[Finbot receipt test] ${confirmation.subject}`,
    ownerText:`REVIEW ONLY: official receipt issued for real order ${order.order_number||orderId}. Automatic receipts remain disabled.\n\n${confirmation.text}`,
    ownerAttachments:[attachment]});
  if(!result.ok)throw Error('test_email_failed');
  const {error}=await db.from('order_receipts').update({test_email_sent_at:new Date().toISOString()}).eq('order_id',orderId);
  if(error)throw Error('test_email_status_save_failed');
  return {sent:true};
}
