import {createClient} from 'https://esm.sh/@supabase/supabase-js@2';
import {forbidden,isServiceOrAdmin} from '../_shared/security.ts';
import {receiptSettings,receiptRow,receiptOrder,receiptPreviewOrder,issueFinbotReceipt,repairReceiptPdf,sendReceiptTest} from '../_shared/finbot-receipts.ts';
import {amountMinor,israelDate,receiptPayload} from '../_shared/finbot-receipt-model.ts';
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,apikey,x-client-info,content-type','Access-Control-Allow-Methods':'POST,OPTIONS'};
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'}});
function serviceKey(){const key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');if(key)return key;try{const keys=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}');return keys.default||keys.service_role||''}catch{return ''}}
Deno.serve(async req=>{
  if(req.method==='OPTIONS')return new Response(null,{headers:cors});
  if(req.method!=='POST')return json({error:'POST required'},405);
  if(!await isServiceOrAdmin(req))return forbidden(cors);
  try {
    const body=await req.json();
    const db=createClient(Deno.env.get('SUPABASE_URL')!,serviceKey(),{auth:{persistSession:false}});
    if(body.action==='settings')return json({settings:await receiptSettings(db),configured:!!Deno.env.get('FINBOT_API_KEY')});
    const id=String(body.order_id||'');
    if(body.action==='disable') {
      const {error}=await db.from('finbot_receipt_settings').update({enabled:false,starts_at:null,updated_at:new Date().toISOString()}).eq('id',1);
      if(error)throw Error('settings_save_failed');return json({enabled:false});
    }
    if(!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id))return json({error:'invalid_order_id'},400);
    if(body.action==='preview') {
      const order=await receiptPreviewOrder(db,id);
      const paymentDate=order.payment_confirmed_at?israelDate(order.payment_confirmed_at):String(body.payment_date||'');
      return json({payload:receiptPayload(order,paymentDate),existing:await receiptRow(db,id),creates_document:false});
    }
    if(body.action==='issue_test') {
      if(body.confirm_real_receipt!==true)return json({error:'real_receipt_confirmation_required'},400);
      const settings=await receiptSettings(db);
      if(settings.enabled)return json({error:'disable_automation_before_test'},409);
      const result=await issueFinbotReceipt(db,id,{test:true,paymentDate:String(body.payment_date||'')});
      if(result.receipt?.status==='issued'&&result.receipt.is_test&&result.receipt.pdf_path)await sendReceiptTest(db,id);
      return json(result);
    }
    if(body.action==='retry_pdf')return json({receipt:await repairReceiptPdf(db,id)});
    if(body.action==='send_test_email')return json(await sendReceiptTest(db,id));
    if(body.action==='approve_enable') {
      const row=await receiptRow(db,id);
      if(body.reviewed_pdf_and_email!==true||row?.status!=='issued'||!row.is_test||!row.pdf_path||!row.test_email_sent_at)return json({error:'review_a_successful_test_first'},409);
      if(!Deno.env.get('FINBOT_API_KEY'))return json({error:'finbot_not_configured'},409);
      const now=new Date().toISOString();
      const {error}=await db.from('finbot_receipt_settings').update({enabled:true,starts_at:now,reviewed_test_order_id:id,updated_at:now}).eq('id',1);
      if(error)throw Error('settings_save_failed');return json({enabled:true,starts_at:now});
    }
    if(body.action==='link_manual') {
      const order=await receiptOrder(db,id),existing=await receiptRow(db,id);
      if(order.payment_status!=='paid')return json({error:'paid_order_required'},400);
      if(existing&&!['needs_review'].includes(existing.status))return json({error:'receipt_already_linked_or_issuing'},409);
      const ref=String(body.document_reference||'').trim();
      if(!ref||ref.length>120||!/^\d{4}-\d{2}-\d{2}$/.test(String(body.payment_date)))return json({error:'receipt_number_and_payment_date_required'},400);
      const patch={order_id:id,status:'external',document_reference:ref,amount_minor:amountMinor(order.total),payment_date:body.payment_date,error_code:null};
      const result=existing?await db.from('order_receipts').update(patch).eq('order_id',id).eq('status','needs_review'):await db.from('order_receipts').insert(patch);
      if(result.error)throw Error('manual_link_failed');return json({linked:true});
    }
    if(body.action==='pdf') {
      const row=await receiptRow(db,id);
      if(!row?.pdf_path)return json({error:'pdf_unavailable'},404);
      const {data,error}=await db.storage.from('order-receipts').createSignedUrl(row.pdf_path,300);
      if(error)throw Error('pdf_link_failed');return json({url:data.signedUrl});
    }
    return json({error:'unsupported_action'},400);
  } catch(e) {
    const code=e instanceof Error&&/^[a-z_]+$/.test(e.message)?e.message:'receipt_operation_failed';
    return json({error:code},400);
  }
});
