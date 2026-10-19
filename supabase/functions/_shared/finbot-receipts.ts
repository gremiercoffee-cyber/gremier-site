import {eligibleOrder,israelDate,paymentReference,amountMinor,receiptPayload,resultDocument} from './finbot-receipt-model.ts';

const bucket='order-receipts';
async function eligibleReceiptOrder(order:any) {
  try {eligibleOrder(order);return order;} catch(e) {
    if(!(e instanceof Error)||e.message!=='missing_payment_reference')throw e;
  }
  // Some restored historical orders lost the sale ID. Recover only through PayMe's
  // verified order/link transaction lookup and exact amount, never names or dates.
  const {resolvePayMePaymentStatus}=await import('./payme-query.ts');
  const verified=await resolvePayMePaymentStatus('',[order.id,order.delivery_info?.payment_link_code?'pl_'+order.delivery_info.payment_link_code:'']);
  if(!verified?.isCompleted||verified.priceAgorot!==amountMinor(order.total))throw Error('missing_payment_reference');
  order.delivery_info={...order.delivery_info,payme_sale_id:verified.paymeSaleId};
  eligibleOrder(order);
  return order;
}
export async function receiptPaymentMetadata(db:any,orderId:string) {
  const order=await eligibleReceiptOrder(await receiptOrder(db,orderId));
  const {resolvePayMePaymentStatus,getPayMeBase}=await import('./payme-query.ts');
  const saleId=String(order.delivery_info?.payme_sale_id||''),seller=Deno.env.get('PAYME_SELLER_ID');
  const expected=[orderId,order.delivery_info?.payment_link_code?'pl_'+order.delivery_info.payment_link_code:''];
  const verified=await resolvePayMePaymentStatus(saleId,expected);
  if(!verified?.isCompleted||verified.priceAgorot!==amountMinor(order.total))throw Error('payment_verification_required');
  // A retried checkout may have paid a replacement sale rather than the stored original.
  const verifiedSaleId=verified.paymeSaleId;
  const response=await fetch(`${getPayMeBase()}api/get-sales`,{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({seller_payme_id:seller,sale_payme_id:verifiedSaleId}),signal:AbortSignal.timeout(15000)});
  const body=await response.json();
  const sale=(Array.isArray(body.items)?body.items:[]).find((s:any)=>String(s.sale_payme_id||s.payme_sale_id||'')===verifiedSaleId);
  if(!response.ok||!sale)throw Error('payment_details_unavailable');
  // Expose only structure and date fields for reconciliation, never buyer keys or card data.
  const fields:string[]=[],dates:Record<string,unknown>={};
  function walk(value:any,path='',depth=0){if(!value||typeof value!=='object'||depth>3)return;for(const [key,item] of Object.entries(value)){const p=path?path+'.'+key:key;fields.push(p);if(/date|time|created|paid_at|completed_at/i.test(key)&&typeof item==='string')dates[p]=item;if(item&&typeof item==='object')walk(item,p,depth+1);}}
  walk(sale);
  const last4=String(sale.sale_buyer_details?.buyer_card_mask||'').replace(/\D/g,'').slice(-4);
  const paidDate=String(sale.sale_paid_date||'').slice(0,10);
  return {verified:true,sale_id:verifiedSaleId,amount:verified.priceAgorot!/100,fields,dates,
    card_last4:/^\d{4}$/.test(last4)?last4:null,
    payment_date:/^\d{4}-\d{2}-\d{2}$/.test(paidDate)?paidDate:null,
    installments:Number(sale.sale_installments),currency:String(sale.sale_currency||'').toUpperCase(),
    existing_payme_invoices:Array.isArray(sale.sale_invoices)?sale.sale_invoices.length:
      sale.sale_invoices&&typeof sale.sale_invoices==='object'?Object.keys(sale.sale_invoices).length:
      typeof sale.sale_invoices==='string'&&sale.sale_invoices.trim()?1:0};
}
export async function receiptPreviewOrder(db:any,orderId:string) {
  const order=await eligibleReceiptOrder(await receiptOrder(db,orderId));
  const payment=await receiptPaymentMetadata(db,orderId);
  if(payment.currency!=='ILS')throw Error('payment_currency_needs_review');
  if(payment.existing_payme_invoices>0)throw Error('existing_payme_invoice_needs_review');
  if(!payment.card_last4||!Number.isInteger(payment.installments)||payment.installments<1)throw Error('payment_card_details_required');
  if(!payment.payment_date)throw Error('actual_payment_date_required');
  order.delivery_info={...order.delivery_info,payme_sale_id:payment.sale_id,receipt_card_last4:payment.card_last4,receipt_installments:payment.installments};
  order.receipt_payment_date=payment.payment_date;
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
export async function originalPdf(url:string,fetcher:typeof fetch=fetch,diagnostic?:(step:Record<string,unknown>)=>void):Promise<Uint8Array> {
  let target=allowedDocumentUrl(url);
  const cookies=new Map<string,Map<string,string>>();let referer:string|null=null;
  for(let redirect=0;redirect<4;redirect++) {
    const host=new URL(target).hostname,headers:Record<string,string>={};
    const jar=cookies.get(host);
    if(jar?.size)headers.Cookie=[...jar].map(([name,value])=>name+'='+value).join('; ');
    if(referer&&new URL(referer).origin===new URL(target).origin)headers.Referer=referer;
    const response=await fetcher(target,{headers,redirect:'manual',signal:AbortSignal.timeout(20000)});
    const setCookies=typeof response.headers.getSetCookie==='function'?response.headers.getSetCookie():
      (response.headers.get('set-cookie')||'').split(/,(?=\s*[^;,=\s]+=[^;,]*)/).filter(Boolean);
    for(const raw of setCookies){const pair=raw.split(';',1)[0],index=pair.indexOf('=');if(index<=0)continue;const name=pair.slice(0,index).trim(),value=pair.slice(index+1).trim();if(!/^[^\s;,=]+$/.test(name)||/[\r\n;]/.test(value))continue;if(!cookies.has(host))cookies.set(host,new Map());cookies.get(host)!.set(name,value);}
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
    diagnostic?.({path:new URL(target).pathname,status:response.status,content_type:response.headers.get('content-type'),bytes:length,cookie_names:[...(cookies.get(host)?.keys()||[])],pdf:new TextDecoder().decode(bytes.slice(0,5))==='%PDF-',viewer_source_found:/\bimage_url\s*=/.test(new TextDecoder().decode(bytes))});
    if(new TextDecoder().decode(bytes.slice(0,5))!=='%PDF-') {
      // Finbot's original-document response is its PDF viewer, with an explicit PDF source.
      // Follow only this observed same-host download path; never execute provider HTML/scripts.
      const current=new URL(target);
      if(['/show_doc_app.php','/show_image.php'].includes(current.pathname)) {
        const match=new TextDecoder().decode(bytes).match(/\bimage_url\s*=\s*['"]([^'"\r\n]+)['"]/);
        if(match) {
          const download=new URL(match[1].replace(/&amp;/g,'&'),current);
          if(download.hostname===current.hostname&&download.pathname==='/load_pdf_doc.php') {
            referer=target;target=allowedDocumentUrl(download.href);continue;
          }
        }
      }
      throw Error('original_is_not_downloadable_pdf');
    }
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
export async function issueFinbotReceipt(db:any,orderId:string,options:{test?:boolean;paymentDate?:string;retryValidatedRejection?:boolean;backfillYear?:number}={}) {
  let order=await receiptOrder(db,orderId);
  const settings=await receiptSettings(db);
  if(options.backfillYear!==undefined) {
    // Explicit admin-only catch-up; never weaken the cutoff for ordinary callbacks.
    if(options.test||options.backfillYear!==2026||!israelDate(order.created_at).startsWith('2026-'))throw Error('historical_year_mismatch');
  } else if(!options.test) {
    if(!settings.enabled||!settings.starts_at)return {skipped:'automation_disabled'};
    if(!order.payment_confirmed_at||new Date(order.payment_confirmed_at)<new Date(settings.starts_at))return {skipped:'historical_order'};
  }
  order=await eligibleReceiptOrder(order);
  const existing=await receiptRow(db,orderId);
  const knownRejection=existing?.error_code==='provider_vat_validation_confirmed'||/^provider_http_400(?:_codes_[n0-9_]+)?_needs_review$/.test(existing?.error_code||'');
  const retryRejected=!!(options.retryValidatedRejection&&existing?.status==='needs_review'&&knownRejection&&
    ((options.test&&existing.is_test)||(options.backfillYear===2026&&!existing.is_test)));
  if(existing&&!retryRejected) {
    if(existing.status==='issued')return {receipt:existing};
    return {skipped:'already_claimed_or_linked',receipt:existing};
  }
  const key=(Deno.env.get('FINBOT_API_KEY')||'').trim();
  if(!key)return {skipped:'finbot_not_configured'};
  const completeOrder=await receiptPreviewOrder(db,orderId);
  const paymentDate=completeOrder.receipt_payment_date;
  if(options.backfillYear!==undefined&&!paymentDate.startsWith('2026-'))throw Error('historical_payment_year_mismatch');
  if(options.paymentDate&&options.paymentDate!==paymentDate)throw Error('payment_date_does_not_match_payme');
  const payload=receiptPayload(completeOrder,paymentDate);
  // Committed unique claim BEFORE contacting Finbot. Never automatically retry an uncertain result.
  const claimQuery=retryRejected
    ?db.from('order_receipts').update({status:'issuing',error_code:null,attempted_at:new Date().toISOString()}).eq('order_id',orderId).eq('status','needs_review').eq('error_code',existing.error_code)
    :db.from('order_receipts').insert({order_id:orderId,status:'issuing',payment_reference:paymentReference(completeOrder),amount_minor:amountMinor(order.total),payment_date:paymentDate,is_test:!!options.test});
  const {data:claim,error:claimError}=await claimQuery.select('*').single();
  if(claimError) {
    if(claimError.code==='23505')return {skipped:'already_claimed_or_payment_linked'};
    throw Error('receipt_claim_failed');
  }
  let providerDetail:string|null=null;
  try {
    let response:Response|undefined;
    for(let attempt=0;attempt<2;attempt++) {
      response=await fetch('https://api.finbotai.co.il/income',{method:'POST',
        headers:{'Content-Type':'application/json',secret:key},body:JSON.stringify(payload),signal:AbortSignal.timeout(25000)});
      if(attempt===0&&response.status===400) {
        const rejection=await response.clone().json().catch(()=>null);
        if(Array.isArray(rejection)&&rejection.length===1&&Number(rejection[0]?.code)===-1&&
          String(rejection[0]?.message||'').includes('מסמך זהה הופק לאחרונה')) {
          // Finbot explicitly refused this request and asks us to wait. Keep our unique
          // claim issuing during the pause; no concurrent worker may issue or email it.
          await new Promise(resolve=>setTimeout(resolve,30000));
          continue;
        }
      }
      break;
    }
    if(!response)throw Error('provider_result_unknown');
    // Even a non-2xx response can be ambiguous: don't repeat document creation.
    if(!response.ok) {
      const raw=await response.text();
      providerDetail=raw.split(key).join('[redacted]').slice(0,1500);
      let codes:string[]=[];
      try {const errors=JSON.parse(raw);if(Array.isArray(errors))codes=errors.map(e=>String(e?.code??'')).filter(c=>/^-?\d{1,4}$/.test(c)).map(c=>c.replace('-','n'));}catch { /* no raw provider response in logs */ }
      throw Error(`provider_http_${response.status}${codes.length?'_codes_'+codes.join('_'):''}_needs_review`);
    }
    const document=resultDocument(await response.json());
    const {data:issued,error}=await db.from('order_receipts').update({status:'issued',document_url:document.url,
      document_reference:document.reference,issued_at:new Date().toISOString(),error_code:null}).eq('order_id',orderId).eq('status','issuing').select('*').single();
    if(error)throw Error('receipt_save_needs_review');
    return {receipt:await savePdf(db,issued)};
  } catch(e) {
    const code=e instanceof Error&&/^[a-z0-9_]+$/.test(e.message)?e.message:'provider_result_unknown';
    await db.from('order_receipts').update({status:'needs_review',error_code:code}).eq('order_id',claim.order_id).eq('status','issuing');
    return {skipped:'needs_review',error:code,...((options.test||options.backfillYear!==undefined)&&providerDetail?{provider_detail:providerDetail}:{})};
  }
}
export async function repairReceiptPdf(db:any,orderId:string) {
  const row=await receiptRow(db,orderId);
  if(row?.status!=='issued'||!row.document_url)throw Error('no_issued_document');
  return await savePdf(db,row);
}
export async function receiptAttachment(db:any,orderId:string,orderNumber?:number|null) {
  const row=await receiptRow(db,orderId);
  if(row?.status!=='issued'||!row.pdf_path)return null;
  const {data,error}=await db.storage.from(bucket).download(row.pdf_path);
  if(error||!data)return null;
  const bytes=new Uint8Array(await data.arrayBuffer());
  // Chunk conversion avoids large-argument stack overflows.
  let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.slice(i,i+8192));
  const label=String(row.document_reference||`order-${orderNumber||orderId}`).replace(/[^a-zA-Z0-9_-]/g,'');
  return {filename:`Gremier-receipt-${label}.pdf`,content:btoa(binary)};
}
export async function sendReceiptTest(db:any,orderId:string) {
  const row=await receiptRow(db,orderId);
  if(row?.status!=='issued'||!row.is_test)throw Error('test_receipt_required');
  if(row.test_email_sent_at)return {sent:true,already_sent:true};
  const order=await receiptOrder(db,orderId);
  const attachment=await receiptAttachment(db,orderId,order.order_number);
  if(!attachment)throw Error('original_pdf_not_ready');
  const {sendOrderEmails,buildCustomerReceiptText}=await import('./order-email.ts');
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
