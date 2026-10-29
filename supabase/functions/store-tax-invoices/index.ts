// Store tax invoices (חשבונית מס) through FinBot. Admin only.
//   { action:'preview', id, store_id, email_requested? }  → what would be issued, no document created
//   { action:'issue', id, store_id, email_requested?, confirm:true } → issues it (once per id)
//   { action:'pdf', id }                    → short-lived link to the original PDF
//   { action:'set_number', id, number }     → the invoice number, when it couldn't be read from the PDF
//   { action:'release', id, confirm_not_in_finbot:true } → a refused invoice gives its months back
import {createClient} from 'https://esm.sh/@supabase/supabase-js@2';
import {forbidden,isServiceOrAdmin} from '../_shared/security.ts';
import {resultDocument} from '../_shared/finbot-receipt-model.ts';
import {originalPdf} from '../_shared/finbot-receipts.ts';
import {pdfLines,documentNumber,showsAmount} from '../_shared/finbot-pdf-text.ts';
import {invoiceCustomer,invoiceBills,invoicePayload,monthLabel} from '../_shared/store-invoice-model.ts';
import {VAT_RATE} from '../_shared/vat.ts';
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,apikey,x-client-info,content-type','Access-Control-Allow-Methods':'POST,OPTIONS'};
const json=(b:unknown,status=200)=>new Response(JSON.stringify(b),{status,headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'}});
function serviceKey(){const k=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');if(k)return k;return JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}').default||'';}
const clean=(r:any)=>{const {document_url,request_hash,...safe}=r;return safe;};
const uuid=(v:unknown)=>/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(String(v||''));

// Save the original PDF, read its number, and check it shows the total we expect.
async function finish(db:any,row:any){
 const bytes=await originalPdf(row.document_url),path=`store-invoices/${row.id}/invoice.pdf`;
 const up=await db.storage.from('order-receipts').upload(path,bytes,{contentType:'application/pdf',upsert:true});if(up.error)throw Error('pdf_storage_failed');
 const lines=await pdfLines(bytes).catch(()=>[] as string[]);
 const number=documentNumber(lines,'חשבונית מס'),amountOk=showsAmount(lines,row.gross_minor);
 const error_code=!number?'number_unreadable':!amountOk?'total_check_failed':null;
 const r=await db.from('store_tax_invoices').update({pdf_path:path,document_number:number,error_code}).eq('id',row.id).select('*').single();
 return r.data||row;
}
async function email(db:any,row:any){
 if(!row.email_requested||row.email_sent_at||!row.pdf_path)return row;
 try{
  const key=Deno.env.get('RESEND_API_KEY');if(!key)throw Error('email_not_configured');
  const file=await db.storage.from('order-receipts').download(row.pdf_path);if(file.error)throw Error('pdf_unavailable');
  const bytes=new Uint8Array(await file.data.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.slice(i,i+8192));
  const months=(row.billing_snapshot||[]).map(monthLabel).join(', ');
  const r=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json','Idempotency-Key':`store-invoice/${row.id}`},
   body:JSON.stringify({from:Deno.env.get('ORDER_EMAIL_FROM')||'Gremier Coffee <onboarding@resend.dev>',to:[row.customer_snapshot.email],
    reply_to:Deno.env.get('NOTIFY_EMAIL')||'gremiercoffee@gmail.com',subject:`Gremier Coffee — חשבונית מס${row.document_number?' '+row.document_number:''}`,
    text:`שלום ${row.customer_snapshot.name},\nמצורפת חשבונית מס עבור ${months}: ₪${(row.gross_minor/100).toFixed(2)} כולל מע"מ.\nתודה, גרמיר קפה`,
    attachments:[{filename:`Gremier-invoice-${row.document_number||row.id.slice(0,8)}.pdf`,content:btoa(binary)}]}),signal:AbortSignal.timeout(20000)});
  if(!r.ok)throw Error('email_delivery_failed');
  const saved=await db.from('store_tax_invoices').update({email_sent_at:new Date().toISOString(),email_error:null}).eq('id',row.id).select('*').single();return saved.data||row;
 }catch(e){const code=e instanceof Error?e.message:'email_delivery_failed';await db.from('store_tax_invoices').update({email_error:code}).eq('id',row.id);return {...row,email_error:code};}
}

Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response(null,{headers:cors});if(req.method!=='POST')return json({error:'POST_required'},405);
 if(!await isServiceOrAdmin(req))return forbidden(cors);
 const db=createClient(Deno.env.get('SUPABASE_URL')!,serviceKey(),{auth:{persistSession:false}});
 try{
  const raw=await req.json();
  if(!uuid(raw.id))throw Error('invalid_request_id');
  if(raw.action==='release'){
   // Only after checking in FinBot that the refused invoice was never created.
   if(raw.confirm_not_in_finbot!==true)throw Error('confirm_not_in_finbot');
   const r=await db.rpc('release_store_tax_invoice',{invoice:raw.id});if(r.error)throw Error('only_needs_review');
   return json({released:true});
  }
  if(['pdf','set_number','retry_email'].includes(raw.action)){
   const r=await db.from('store_tax_invoices').select('*').eq('id',raw.id).single();if(r.error||r.data.status!=='issued')throw Error('issued_invoice_required');
   let row=r.data;
   if(!row.pdf_path)row=await finish(db,row);
   if(raw.action==='set_number'){
    const n=String(raw.number||'').trim();if(!/^\d{1,9}$/.test(n))throw Error('invoice_number_digits');
    const u=await db.from('store_tax_invoices').update({document_number:n,error_code:null}).eq('id',row.id).select('*').single();if(u.error)throw Error('save_failed');
    return json({invoice:clean(u.data)});
   }
   if(raw.action==='retry_email')return json({invoice:clean(await email(db,row))});
   const signed=await db.storage.from('order-receipts').createSignedUrl(row.pdf_path,600);if(signed.error)throw Error('pdf_unavailable');
   return json({url:signed.data.signedUrl});
  }
  if(!['preview','issue'].includes(raw.action))return json({error:'unsupported_action'},400);
  if(!uuid(raw.store_id))throw Error('choose_store');
  const prior=await db.from('store_tax_invoices').select('*').eq('id',raw.id).maybeSingle();
  if(prior.data)return json({invoice:clean(prior.data),already_claimed:true});
  const c=await db.from('receipt_customers').select('*').eq('store_id',raw.store_id).is('archived_at',null).single();if(c.error)throw Error('store_customer_missing');
  const customer=invoiceCustomer(c.data);
  if(raw.email_requested&&!customer.email)throw Error('store_email_required');
  const b=await db.from('store_billing').select('id,store_id,year,month,total,paid_at,cancelled_at,tax_invoice_id').eq('store_id',raw.store_id).is('paid_at',null).is('cancelled_at',null).is('tax_invoice_id',null).gt('total',0);
  if(b.error)throw Error('billing_unavailable');
  const plan=invoiceBills(b.data,raw.store_id),payload=invoicePayload(customer,plan.lines);
  const summary={customer,months:plan.lines.map(l=>({id:l.id,label:monthLabel(l),net_minor:l.net_minor})),net_minor:plan.net_minor,vat_minor:plan.vat_minor,gross_minor:plan.gross_minor,vat_rate:VAT_RATE};
  if(raw.action==='preview')return json({preview:{...summary,payload},creates_document:false});
  if(raw.confirm!==true)return json({error:'confirm_required'},400);
  if(raw.gross_minor!==plan.gross_minor)throw Error('billing_changed_refresh_preview');
  const key=Deno.env.get('FINBOT_API_KEY');if(!key)throw Error('finbot_not_configured');
  const request_hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(payload))))).map(x=>x.toString(16).padStart(2,'0')).join('');
  const claim=await db.rpc('claim_store_tax_invoice',{d:{id:raw.id,request_hash,store_id:raw.store_id,customer_id:c.data.id,customer_snapshot:customer,
   net_minor:plan.net_minor,gross_minor:plan.gross_minor,vat_rate:VAT_RATE,email_requested:!!raw.email_requested},shares:plan.shares});
  if(claim.error)throw Error('month_already_invoiced_refresh');
  if(!claim.data.created)return json({invoice:clean(claim.data.invoice),already_claimed:true});
  let issued=false;
  try{
   // Never retried automatically: an unclear answer may still have created the document.
   const response=await fetch('https://api.finbotai.co.il/income',{method:'POST',headers:{'Content-Type':'application/json',secret:key},body:JSON.stringify(payload),signal:AbortSignal.timeout(25000)});
   if(!response.ok){const t=(await response.text()).split(key).join('[redacted]').slice(0,300);console.error('finbot invoice rejected',response.status,t);throw Error(`provider_http_${response.status}_needs_review`);}
   const doc=resultDocument(await response.json());
   const done=await db.from('store_tax_invoices').update({status:'issued',document_url:doc.url,issued_at:new Date().toISOString(),error_code:null}).eq('id',raw.id).eq('status','issuing').select('*').single();
   if(done.error)throw Error('invoice_save_needs_review');issued=true;
   let row=done.data;
   try{row=await finish(db,row);}catch{await db.from('store_tax_invoices').update({error_code:'pdf_unavailable'}).eq('id',raw.id);row.error_code='pdf_unavailable';}
   row=await email(db,row);
   return json({invoice:clean(row)});
  }catch(e){
   const code=e instanceof Error&&/^[a-z0-9_]+$/.test(e.message)?e.message:'provider_result_unknown';
   if(!issued)await db.from('store_tax_invoices').update({status:'needs_review',error_code:code}).eq('id',raw.id).eq('status','issuing');
   return json({error:code,invoice_id:raw.id,do_not_reissue:true},409);
  }
 }catch(e){return json({error:e instanceof Error&&/^[a-z0-9_]+$/.test(e.message)?e.message:'invoice_request_failed'},400);}
});
