import {createClient} from 'https://esm.sh/@supabase/supabase-js@2';
import {forbidden,isServiceOrAdmin} from '../_shared/security.ts';
import {customerFields,normalizeManualInput,manualPayload} from '../_shared/manual-receipt-model.ts';
import {resultDocument} from '../_shared/finbot-receipt-model.ts';
import {originalPdf} from '../_shared/finbot-receipts.ts';
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,apikey,x-client-info,content-type','Access-Control-Allow-Methods':'POST,OPTIONS'};
const json=(b:unknown,status=200)=>new Response(JSON.stringify(b),{status,headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'}});
function serviceKey(){const k=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');if(k)return k;return JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}').default||'';}
const clean=(r:any)=>{const {document_url,request_hash,...safe}=r;return safe;};
async function pdf(db:any,row:any) {
 if(row.pdf_path)return row;
 const bytes=await originalPdf(row.document_url),path=`business/${row.id}/receipt.pdf`;
 const {error}=await db.storage.from('order-receipts').upload(path,bytes,{contentType:'application/pdf',upsert:true});if(error)throw Error('pdf_storage_failed');
 const r=await db.from('business_receipts').update({pdf_path:path,error_code:null}).eq('id',row.id).select('*').single();if(r.error)throw Error('pdf_status_failed');return r.data;
}
async function email(db:any,row:any){
 if(!row.email_requested||row.email_sent_at)return row;
 try{
  row=await pdf(db,row);
  const key=Deno.env.get('RESEND_API_KEY');if(!key)throw Error('email_not_configured');
  const file=await db.storage.from('order-receipts').download(row.pdf_path);if(file.error)throw Error('pdf_unavailable');
  const bytes=new Uint8Array(await file.data.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.slice(i,i+8192));
  const r=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json','Idempotency-Key':`business-receipt/${row.id}`},
   body:JSON.stringify({from:Deno.env.get('ORDER_EMAIL_FROM')||'Gremier Coffee <onboarding@resend.dev>',to:[row.customer_snapshot.email],
    reply_to:Deno.env.get('NOTIFY_EMAIL')||'gremiercoffee@gmail.com',subject:'Gremier Coffee — קבלה',text:`שלום ${row.customer_snapshot.name},\nמצורפת קבלה על תשלום בסך ₪${(row.amount_minor/100).toFixed(2)}.\nתודה, גרמיר קפה`,
    attachments:[{filename:`Gremier-receipt-${row.id.slice(0,8)}.pdf`,content:btoa(binary)}]}),signal:AbortSignal.timeout(20000)});
  if(!r.ok)throw Error('email_delivery_failed');
  const saved=await db.from('business_receipts').update({email_sent_at:new Date().toISOString(),email_error:null}).eq('id',row.id).select('*').single();return saved.data||row;
 }catch(e){const code=e instanceof Error?e.message:'email_delivery_failed';await db.from('business_receipts').update({email_error:code}).eq('id',row.id);return {...row,email_error:code};}
}
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response(null,{headers:cors});if(req.method!=='POST')return json({error:'POST_required'},405);
 if(!await isServiceOrAdmin(req))return forbidden(cors);
 const db=createClient(Deno.env.get('SUPABASE_URL')!,serviceKey(),{auth:{persistSession:false}});
 try{
  const raw=await req.json();
  if(['pdf','repair_pdf','retry_email'].includes(raw.action)){
   const r=await db.from('business_receipts').select('*').eq('id',raw.id).single();if(r.error||r.data.status!=='issued')throw Error('issued_receipt_required');
   let row=await pdf(db,r.data);if(raw.action==='retry_email')row=await email(db,row);
   if(raw.action==='pdf'){const signed=await db.storage.from('order-receipts').createSignedUrl(row.pdf_path,600);if(signed.error)throw Error('pdf_unavailable');return json({url:signed.data.signedUrl});}
   return json({receipt:clean(row)});
  }
  if(!['preview','issue'].includes(raw.action))return json({error:'unsupported_action'},400);
  const input=normalizeManualInput(raw);
  const request_hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(input))))).map(x=>x.toString(16).padStart(2,'0')).join('');
  const prior=await db.from('business_receipts').select('*').eq('id',input.id).maybeSingle();if(prior.error)throw Error('receipt_status_unavailable');
  if(prior.data){if(prior.data.request_hash!==request_hash)throw Error('request_changed_start_new_receipt');return json({receipt:clean(prior.data),already_claimed:true});}
  const c=await db.from('receipt_customers').select('*').eq('id',input.customer_id).is('archived_at',null).single();if(c.error)throw Error('customer_not_available');
  if((raw.action==='issue'||input.customer_version)&&input.customer_version!==String(c.data.updated_at||''))throw Error('customer_changed_refresh_preview');
  const customer=customerFields(c.data),store_id=c.data.store_id||null;
  let bills:any[]=[];
  if(store_id){
   if(!input.billing_ids.length)throw Error('choose_paid_months');
   const r=await db.from('store_billing').select('id,store_id,year,month,total,paid_at,cancelled_at').in('id',input.billing_ids);if(r.error)throw Error('billing_unavailable');bills=r.data;
   if(bills.length!==input.billing_ids.length||bills.some(b=>b.store_id!==store_id||b.paid_at||b.cancelled_at))throw Error('month_not_outstanding');
   const total=bills.reduce((s,b)=>s+Math.round(Number(b.total)*100),0);if(total!==input.billed_total_minor)throw Error('billing_changed_refresh_preview');
   if(total!==input.amount_minor&&input.adjustment_reason.length<3)throw Error('adjustment_reason_required');
  }else if(input.billing_ids.length)throw Error('customer_not_linked_to_store');
  const payload=manualPayload(input,customer);
  if(raw.action==='preview')return json({preview:{...input,customer,store_id,bills,payload},creates_document:false});
  if(raw.payment_received!==true||raw.not_already_receipted!==true)return json({error:'confirm_received_and_no_existing_receipt'},400);
  if(input.email_requested&&!Deno.env.get('RESEND_API_KEY'))throw Error('email_not_configured');
  const key=Deno.env.get('FINBOT_API_KEY');if(!key)throw Error('finbot_not_configured');
  const claim=await db.rpc('claim_business_receipt',{d:{...input,request_hash,store_id,customer_snapshot:customer},bill_ids:input.billing_ids});
  if(claim.error)throw Error('payment_or_month_already_claimed_refresh');
  if(!claim.data.created)return json({receipt:clean(claim.data.receipt),already_claimed:true});
  let issued=false;
  try{
   const response=await fetch('https://api.finbotai.co.il/income',{method:'POST',headers:{'Content-Type':'application/json',secret:key},body:JSON.stringify(payload),signal:AbortSignal.timeout(25000)});
   if(!response.ok)throw Error(`provider_http_${response.status}_needs_review`);
   const doc=resultDocument(await response.json());
   const complete=await db.rpc('complete_business_receipt',{receipt:input.id,doc_url:doc.url});if(complete.error)throw Error('receipt_save_needs_review');issued=true;
   let row=(await db.from('business_receipts').select('*').eq('id',input.id).single()).data;
   try{row=await pdf(db,row);}catch{await db.from('business_receipts').update({error_code:'pdf_unavailable'}).eq('id',input.id);row.error_code='pdf_unavailable';}
   row=await email(db,row);return json({receipt:clean(row)});
  }catch(e){
   const code=e instanceof Error&&/^[a-z0-9_]+$/.test(e.message)?e.message:'provider_result_unknown';
   if(!issued)await db.from('business_receipts').update({status:'needs_review',error_code:code}).eq('id',input.id).eq('status','issuing');
   return json({error:code,receipt_id:input.id,do_not_reissue:true},409);
  }
 }catch(e){return json({error:e instanceof Error&&/^[a-z0-9_]+$/.test(e.message)?e.message:'receipt_request_failed'},400);}
});
