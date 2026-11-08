// Refunds from the admin order card. Admin only.
//   { action:'preview', order_id }  → what can be refunded, the card, the document that goes with it; changes nothing
//   { action:'refund', id, order_id, amount_minor, reason?, invoice_number?, email_customer?, confirm:true }
//        → refund through PayMe; if PayMe confirms, the חשבונית זיכוי from FinBot (once per id)
//   { action:'retry_credit', id }   → only after FinBot refused the credit invoice (nothing was created)
//   { action:'email', id }          → email the customer the credit invoice
//   { action:'pdf', id }            → short-lived link to the credit invoice PDF
//   { action:'check_credit_format', order_id, amount_minor } → FinBot validates the payload without a name (creates nothing)
//   { action:'backfill_numbers' }   → read missing invoice numbers from saved receipt PDFs
// Never retries a PayMe refund on its own: a repeated partial refund is a second refund.
import {createClient} from 'https://esm.sh/@supabase/supabase-js@2';
import {forbidden,isServiceOrAdmin} from '../_shared/security.ts';
import {resultDocument} from '../_shared/finbot-receipt-model.ts';
import {originalPdf,receiptPaymentMetadata,receiptOrder,receiptRow,ensureReceiptNumber} from '../_shared/finbot-receipts.ts';
import {pdfLines,documentNumber,showsAmount} from '../_shared/finbot-pdf-text.ts';
import {getPayMeBase} from '../_shared/payme-query.ts';
import {sendOrderEmails} from '../_shared/order-email.ts';
import {checkRefundAmount,creditPayload,refundDocument,refundPlan,shekels} from '../_shared/order-refund-model.ts';

const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,apikey,x-client-info,content-type','Access-Control-Allow-Methods':'POST,OPTIONS'};
const json=(b:unknown,status=200)=>new Response(JSON.stringify(b),{status,headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'}});
function serviceKey(){const k=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');if(k)return k;try{const keys=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}');return keys.default||keys.service_role||''}catch{return ''}}
const uuid=(v:unknown)=>/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(String(v||''));
const safe=(r:any)=>{if(!r)return r;const {credit_document_url,...rest}=r;return rest;};
const BUCKET='order-receipts';

async function adminEmail(req:Request):Promise<string|null>{
  try{const t=(req.headers.get('authorization')||'').replace(/^Bearer\s+/i,'');const p=JSON.parse(atob(t.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));return p.email||p.role||null;}catch{return null;}
}

/** The PayMe sale as it is now (paid, possibly partly refunded). */
async function paymeSale(saleId:string){
  const seller=Deno.env.get('PAYME_SELLER_ID');if(!seller)throw Error('payme_not_configured');
  const r=await fetch(`${getPayMeBase()}api/get-sales`,{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({seller_payme_id:seller,sale_payme_id:saleId}),signal:AbortSignal.timeout(15000)});
  const body=await r.json().catch(()=>({}));
  const sale=(Array.isArray(body.items)?body.items:[]).find((s:any)=>String(s.sale_payme_id||s.payme_sale_id||'')===saleId);
  if(!r.ok||!sale)throw Error('payme_sale_not_found');
  const status=String(sale.sale_status||'').toLowerCase();
  const last4=String(sale.sale_buyer_details?.buyer_card_mask||'').replace(/\D/g,'').slice(-4);
  return {sale_id:saleId,status,price_minor:Number(sale.sale_price),currency:String(sale.sale_currency||'ILS').toUpperCase(),card_last4:/^\d{4}$/.test(last4)?last4:null};
}

async function loadAll(db:any,orderId:string){
  const order=await receiptOrder(db,orderId);
  const {data:refunds,error}=await db.from('order_refunds').select('*').eq('order_id',orderId).order('created_at');
  if(error)throw Error('refunds_unavailable');
  let receipt=await receiptRow(db,orderId);
  if(receipt&&!receipt.document_reference){const n=await ensureReceiptNumber(db,receipt).catch(()=>null);if(n)receipt={...receipt,document_reference:n};}
  return {order,refunds:refunds||[],receipt};
}

async function saleFor(db:any,order:any,refunds:any[]){
  if(order.payment_status!=='paid')throw Error('order_not_paid');
  // After a first refund the sale is no longer "completed"; reuse the sale that was refunded.
  const known=refunds.find((r:any)=>r.status==='refunded')?.payme_sale_id;
  const saleId=known||(await receiptPaymentMetadata(db,order.id)).sale_id;
  const sale=await paymeSale(saleId);
  if(sale.currency!=='ILS')throw Error('payment_currency_needs_review');
  if(!['completed','partial-refund','refunded'].includes(sale.status))throw Error('payme_sale_not_refundable');
  if(!Number.isSafeInteger(sale.price_minor)||sale.price_minor<=0)throw Error('payme_sale_amount_unknown');
  return sale;
}

async function preview(db:any,orderId:string){
  const {order,refunds,receipt}=await loadAll(db,orderId);
  const sale=await saleFor(db,order,refunds);
  const plan=refundPlan(sale.price_minor,refunds);
  const document=refundDocument(order,receipt);
  const credit_check=document.kind==='credit'&&document.invoice_number?await validateCredit(order,Math.max(500,plan.left_minor||500),document.invoice_number):null;
  return {credit_check,order:{id:order.id,order_number:order.order_number,customer_name:order.customer_name,has_email:!!order.customer_email,total:order.total},
    sale:{card_last4:sale.card_last4,status:sale.status},plan,document,refunds:refunds.map(safe),creates_nothing:true};
}

/** FinBot checks the credit invoice without making it: the customer name is left out, so it can't be
 *  issued. Ready when the missing name is the only complaint. Never throws. */
async function validateCredit(order:any,amountMinor:number,invoiceNumber:string){
  const key=(Deno.env.get('FINBOT_API_KEY')||'').trim();if(!key)return {ready:false,codes:['finbot_not_configured']};
  try{
    const payload:any=creditPayload(order,amountMinor,invoiceNumber,null);payload.customer={...payload.customer,name:''};
    const r=await fetch('https://api.finbotai.co.il/income',{method:'POST',headers:{'Content-Type':'application/json',secret:key},body:JSON.stringify(payload),signal:AbortSignal.timeout(15000)});
    const raw=(await r.text()).split(key).join('[redacted]');
    let list:any[]=[];try{const j=JSON.parse(raw);if(Array.isArray(j))list=j;}catch{/* not JSON */}
    const codes=list.map((e:any)=>String(e?.code??'')).filter((c)=>c&&c!=='203');
    const ready=r.status===400&&list.length>0&&codes.length===0;
    return {ready,codes,...(ready?{}:{detail:raw.slice(0,400)})};
  }catch(e){return {ready:false,codes:[e instanceof Error?e.message:'check_failed']};}
}

async function finishCreditPdf(db:any,row:any){
  const bytes=await originalPdf(row.credit_document_url);
  const path=`${row.order_id}/credit-${row.id}.pdf`;
  const up=await db.storage.from(BUCKET).upload(path,bytes,{contentType:'application/pdf',upsert:true});if(up.error)throw Error('pdf_storage_failed');
  const lines=await pdfLines(bytes).catch(()=>[] as string[]);
  const number=documentNumber(lines,'חשבונית זיכוי'),amountOk=showsAmount(lines,row.amount_minor);
  const credit_error=!number?'number_unreadable':!amountOk?'total_check_failed':null;
  const {data}=await db.from('order_refunds').update({credit_pdf_path:path,credit_document_number:number,credit_error}).eq('id',row.id).select('*').single();
  return data||row;
}

async function issueCredit(db:any,row:any,order:any){
  const key=(Deno.env.get('FINBOT_API_KEY')||'').trim();
  if(!key){await db.from('order_refunds').update({credit_status:'rejected',credit_error:'finbot_not_configured'}).eq('id',row.id);return {...row,credit_status:'rejected',credit_error:'finbot_not_configured'};}
  const payload=creditPayload(order,row.amount_minor,row.linked_document_number,row.reason);
  // Claim before contacting FinBot; an unclear result is never resent automatically.
  const claim=await db.from('order_refunds').update({credit_status:'issuing',credit_error:null}).eq('id',row.id).in('credit_status',['pending','rejected']).select('*').single();
  if(claim.error)return row;
  try{
    const r=await fetch('https://api.finbotai.co.il/income',{method:'POST',headers:{'Content-Type':'application/json',secret:key},body:JSON.stringify(payload),signal:AbortSignal.timeout(25000)});
    if(!r.ok){
      const raw=(await r.text()).split(key).join('[redacted]');
      let codes:string[]=[];try{const e=JSON.parse(raw);if(Array.isArray(e))codes=e.map((x:any)=>String(x?.code??'')).filter(Boolean);}catch{/* not JSON */}
      // A 400 with FinBot's error list is a refusal: no document was made, so it can be retried after fixing.
      const refused=r.status===400&&codes.length>0;
      const detail=`http_${r.status}${codes.length?' codes '+codes.join(','):''}: ${raw.slice(0,400)}`;
      const {data}=await db.from('order_refunds').update({credit_status:refused?'rejected':'needs_review',credit_error:detail}).eq('id',row.id).select('*').single();
      return data;
    }
    const doc=resultDocument(await r.json());
    const {data:issued,error}=await db.from('order_refunds').update({credit_status:'issued',credit_document_url:doc.url,credit_error:null}).eq('id',row.id).eq('credit_status','issuing').select('*').single();
    if(error)throw Error('credit_save_needs_review');
    try{return await finishCreditPdf(db,issued);}catch(e){
      const code=e instanceof Error?e.message:'pdf_unavailable';
      await db.from('order_refunds').update({credit_error:code}).eq('id',row.id);return {...issued,credit_error:code};
    }
  }catch(e){
    const code=e instanceof Error&&/^[a-z_]+$/.test(e.message)?e.message:'finbot_result_unknown';
    const {data}=await db.from('order_refunds').update({credit_status:'needs_review',credit_error:code}).eq('id',row.id).eq('credit_status','issuing').select('*').single();
    return data||{...row,credit_status:'needs_review',credit_error:code};
  }
}

async function emailCustomer(db:any,row:any,order:any,cardLast4:string|null){
  if(!order.customer_email)return row;
  const n=order.order_number||order.id,amount=shekels(row.amount_minor);
  let attachments:Array<{filename:string;content:string}>|undefined;
  if(row.credit_pdf_path){
    const f=await db.storage.from(BUCKET).download(row.credit_pdf_path);
    if(!f.error&&f.data){const b=new Uint8Array(await f.data.arrayBuffer());let bin='';for(let i=0;i<b.length;i+=8192)bin+=String.fromCharCode(...b.slice(i,i+8192));
      attachments=[{filename:`Gremier-credit-${row.credit_document_number||String(row.id).slice(0,8)}.pdf`,content:btoa(bin)}];}
  }
  const card=cardLast4?` (כרטיס המסתיים ב-${cardLast4})`:'',cardEn=cardLast4?` ending ${cardLast4}`:'';
  const subject=`Gremier · Refund ${amount} · החזר כספי · #${n}`;
  const text=`שלום ${order.customer_name||''},
החזרנו ${amount} לכרטיס האשראי${card} עבור הזמנה #${n}. ייתכן שיעברו כמה ימי עסקים עד שההחזר יופיע בחשבון.${attachments?'\nמצורפת חשבונית זיכוי.':''}

Hi ${order.customer_name||''},
We refunded ${amount} to your card${cardEn} for order #${n}. It can take a few business days to appear.${attachments?'\nThe credit invoice is attached.':''}

גרמיר קפה · Gremier Coffee`;
  const sent=await sendOrderEmails({idempotencyKey:`refund-${row.id}`,ownerSubject:subject,ownerText:text,skipOwner:true,
    customerEmail:order.customer_email,customerSubject:subject,customerText:text,...(attachments?{customerAttachments:attachments}:{})});
  const patch=sent.ok?{email_sent_at:new Date().toISOString(),email_error:null}:{email_error:String(sent.detail||'email_failed').replace(/[^\s:@]+@[^\s:]+/g,'[customer]').slice(0,200)};
  const {data}=await db.from('order_refunds').update(patch).eq('id',row.id).select('*').single();
  return data||{...row,...patch};
}

/** The order remembers how much was refunded; a sale refunded in full marks the order refunded. */
async function noteOnOrder(db:any,orderId:string,saleMinor:number){
  const {data:rows}=await db.from('order_refunds').select('amount_minor,status,refunded_at').eq('order_id',orderId).eq('status','refunded');
  const total=(rows||[]).reduce((s:number,r:any)=>s+Number(r.amount_minor),0);
  const {data:o}=await db.from('orders').select('delivery_info,status').eq('id',orderId).single();
  const info={...(o?.delivery_info||{}),refunded_minor:total,refunded_at:new Date().toISOString(),refund_type:'payme'};
  await db.from('orders').update({delivery_info:info,...(total>=saleMinor?{status:'refunded'}:{})}).eq('id',orderId);
}

async function refund(db:any,req:Request,raw:any){
  if(raw.confirm!==true)throw Error('confirm_required');
  if(!uuid(raw.id)||!uuid(raw.order_id))throw Error('invalid_request');
  const prior=await db.from('order_refunds').select('*').eq('id',raw.id).maybeSingle();
  if(prior.data)return {refund:safe(prior.data),already_done:true};
  const amount=Number(raw.amount_minor);
  const {order,refunds,receipt}=await loadAll(db,raw.order_id);
  const sale=await saleFor(db,order,refunds);
  const plan=refundPlan(sale.price_minor,refunds);
  const {full}=checkRefundAmount(plan,amount);
  const doc=refundDocument(order,receipt);
  let invoiceNumber:string|null=null;
  if(doc.kind==='credit'){
    invoiceNumber=doc.invoice_number;
    const typed=String(raw.invoice_number||'').trim();
    if(!invoiceNumber&&/^\d{1,12}$/.test(typed)){
      invoiceNumber=typed;
      await db.from('order_receipts').update({document_reference:typed}).eq('order_id',order.id).is('document_reference',null);
    }
    if(!invoiceNumber)throw Error('invoice_number_required');
    creditPayload(order,amount,invoiceNumber,null); // fail before any money moves if the credit can't be built
  }
  const reason=String(raw.reason||'').trim().slice(0,200)||null;
  const ins=await db.from('order_refunds').insert({id:raw.id,order_id:order.id,amount_minor:amount,reason,payme_sale_id:sale.sale_id,status:'refunding',
    credit_status:doc.kind==='credit'?'pending':'not_needed',linked_document_number:invoiceNumber,email_requested:raw.email_customer===true,created_by:await adminEmail(req)}).select('*').single();
  if(ins.error)throw Error(ins.error.code==='23505'?'refund_in_progress':'refund_save_failed');
  let row=ins.data;

  // ── PayMe ──
  let res:Response|null=null,body:any=null;
  try{
    res=await fetch(`${getPayMeBase()}api/refund-sale`,{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({seller_payme_id:Deno.env.get('PAYME_SELLER_ID'),payme_sale_id:sale.sale_id,...(full?{}:{sale_refund_amount:amount}),language:'en'}),
      signal:AbortSignal.timeout(30000)});
    body=await res.json().catch(()=>null);
  }catch{/* timeout or network: unknown */}
  const ok=res?.ok&&body&&Number(body.status_code)===0&&String(body.payme_status||'').toLowerCase()==='success';
  const refused=!ok&&body&&Number(body.status_code)===1&&res!==null&&res.status<500&&res.status!==429;
  if(ok){
    const left=Number(body.sale_refund_buffer);
    const u=await db.from('order_refunds').update({status:'refunded',refunded_at:new Date().toISOString(),payme_transaction_id:String(body.payme_transaction_id||'')||null,
      refundable_left_minor:Number.isFinite(left)?left:null,payme_detail:body.refunded_from_creditcard?'taken_from_seller_card':null}).eq('id',row.id).select('*').single();
    row=u.data||row;
  }else{
    const detail=String(body?.status_error_details||body?.status_additional_info||body?.status_error_code||(res?`http_${res.status}`:'no_response')).slice(0,300);
    const u=await db.from('order_refunds').update({status:refused?'failed':'needs_review',payme_detail:detail,
      ...(refused?{credit_status:doc.kind==='credit'?'not_needed':row.credit_status}:{})}).eq('id',row.id).select('*').single();
    return {refund:safe(u.data||row),refunded:false,refused:!!refused};
  }
  await noteOnOrder(db,order.id,sale.price_minor);

  // ── FinBot credit invoice, then the customer's email ──
  if(row.credit_status==='pending'){
    const check=await validateCredit(order,row.amount_minor,row.linked_document_number);
    if(check.ready)row=await issueCredit(db,row,order);
    else{const code=check.codes.includes('125')?'finbot_link_not_found':'finbot_check_failed '+check.codes.join(',');
      const u=await db.from('order_refunds').update({credit_status:'rejected',credit_error:code}).eq('id',row.id).select('*').single();row=u.data||row;}
  }
  if(row.email_requested&&(['not_needed','rejected'].includes(row.credit_status)||(row.credit_status==='issued'&&row.credit_pdf_path&&!row.credit_error)))row=await emailCustomer(db,row,order,sale.card_last4);
  return {refund:safe(row),refunded:true};
}

Deno.serve(async req=>{
  if(req.method==='OPTIONS')return new Response(null,{headers:cors});
  if(req.method!=='POST')return json({error:'POST_required'},405);
  if(!await isServiceOrAdmin(req))return forbidden(cors);
  const db=createClient(Deno.env.get('SUPABASE_URL')!,serviceKey(),{auth:{persistSession:false}});
  try{
    const raw=await req.json();
    if(raw.action==='preview'){if(!uuid(raw.order_id))throw Error('invalid_order_id');return json(await preview(db,raw.order_id));}
    if(raw.action==='refund')return json(await refund(db,req,raw));
    if(raw.action==='backfill_numbers'){
      const {data,error}=await db.from('order_receipts').select('*').eq('status','issued').is('document_reference',null).not('pdf_path','is',null).limit(Math.min(Number(raw.limit)||40,80));
      if(error)throw Error('receipts_unavailable');
      let found=0;const missing:string[]=[];
      for(const r of data||[]){const n=await ensureReceiptNumber(db,r).catch(()=>null);if(n)found++;else missing.push(r.order_id);}
      return json({checked:(data||[]).length,found,missing});
    }
    if(raw.action==='check_credit_format'){
      const {order,receipt}=await loadAll(db,String(raw.order_id||''));
      const doc=refundDocument(order,receipt);if(doc.kind!=='credit'||!doc.invoice_number)return json({error:'no_tax_invoice_number',doc});
      return json({...await validateCredit(order,Number(raw.amount_minor)||500,doc.invoice_number),creates_document:false});
    }
    if(!uuid(raw.id))throw Error('invalid_refund_id');
    const {data:row,error}=await db.from('order_refunds').select('*').eq('id',raw.id).single();
    if(error)throw Error('refund_not_found');
    if(raw.action==='retry_credit'){
      if(row.status!=='refunded'||!['rejected','pending'].includes(row.credit_status))throw Error('credit_not_retryable');
      const order=await receiptOrder(db,row.order_id);
      const check=await validateCredit(order,row.amount_minor,row.linked_document_number);
      if(!check.ready)return json({refund:safe(row),error:check.codes.includes('125')?'finbot_link_not_found':'finbot_check_failed'});
      return json({refund:safe(await issueCredit(db,row,order))});
    }
    if(raw.action==='email'){
      if(row.status!=='refunded')throw Error('not_refunded');
      const order=await receiptOrder(db,row.order_id);
      const sale=await paymeSale(row.payme_sale_id).catch(()=>({card_last4:null}));
      return json({refund:safe(await emailCustomer(db,row,order,sale.card_last4))});
    }
    if(raw.action==='pdf'){
      if(!row.credit_pdf_path)throw Error('pdf_unavailable');
      const {data,error:e}=await db.storage.from(BUCKET).createSignedUrl(row.credit_pdf_path,300);if(e)throw Error('pdf_link_failed');
      return json({url:data.signedUrl});
    }
    return json({error:'unsupported_action'},400);
  }catch(e){
    const code=e instanceof Error&&/^[a-z0-9_]+$/.test(e.message)?e.message:'refund_operation_failed';
    if(code==='refund_operation_failed')console.error('order-refunds',e);
    return json({error:code},400);
  }
});
