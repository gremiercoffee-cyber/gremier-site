import {createClient} from 'https://esm.sh/@supabase/supabase-js@2';
import {forbidden,isServiceOrAdmin} from '../_shared/security.ts';
import {sendWebPushToAdmins} from '../_shared/web-push.ts';
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,apikey,x-client-info,content-type,x-expense-ingress','Access-Control-Allow-Methods':'POST,OPTIONS'};
const json=(b:unknown,status=200)=>new Response(JSON.stringify(b),{status,headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'}});
function serviceKey(){return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}').default||'';}
async function notify(db:any){
 const result=await db.rpc('expense_notification_claim');if(result.error||!result.data)return;
 const count=Number(result.data),payload={title:'Expense batch available',body:`${count} documents waiting. Open your next batch to share.`,url:'/admin.html?finance=expenses&expense_share=1',tag:'expense-batch-ready',actions:[{action:'share_expenses',title:'Share batch'}]};
 await sendWebPushToAdmins(db,payload);
}
// Read the supplier, date, total and VAT off a document (photo or PDF) with OpenAI, and save them on the row.
function b64(bytes:Uint8Array){let s='';for(let i=0;i<bytes.length;i+=0x8000)s+=String.fromCharCode(...bytes.subarray(i,i+0x8000));return btoa(s);}
// Two tries: the reader sometimes comes back empty on a big phone photo.
async function readDocument(db:any,id:string){const first:any=await readOnce(db,id);return first.read_status==='failed'||first.error==='read_failed'?await readOnce(db,id):first;}
// Shekels per one unit of a foreign currency on the document date: Bank of Israel representative rate
// (the last published one on or before that day), else the ECB rate.
export async function fxRate(currency:string,date:string|null):Promise<{rate:number,date:string}|null>{
 const today=new Date().toISOString().slice(0,10),day=date&&/^\d{4}-\d{2}-\d{2}$/.test(date)&&date<=today?date:today;
 const from=new Date(Date.parse(day)-12*864e5).toISOString().slice(0,10);
 try{
  const r=await fetch(`https://edge.boi.gov.il/FusionEdgeServer/sdmx/v2/data/dataflow/BOI.STATISTICS/EXR/1.0/RER_${currency}_ILS?startperiod=${from}&endperiod=${day}&format=csv`,{signal:AbortSignal.timeout(15000)});
  if(r.ok){
   const rows=(await r.text()).trim().split('\n').slice(1).map(l=>l.split(',')).filter(c=>/^\d{4}-\d{2}-\d{2}$/.test(c[12]||'')&&Number(c[13])>0).sort((x,y)=>x[12].localeCompare(y[12]));
   const last=rows[rows.length-1];if(last)return {rate:Number(last[13])/10**(Number(last[10])||0),date:last[12]};
  }
 }catch(_){}
 try{const r=await fetch(`https://api.frankfurter.dev/v1/${day}?base=${currency}&symbols=ILS`,{signal:AbortSignal.timeout(15000)});const j=await r.json();if(Number(j?.rates?.ILS)>0)return {rate:Number(j.rates.ILS),date:j.date||day};}catch(_){}
 return null;
}
// Hebrew documents count only with the words "חשבונית מס" (חשבונית מס, חשבונית מס קבלה, חשבונית מס/קבלה ...).
export const HEB_TAX_INVOICE=/חשבונית\s*[-–]?\s*מס(?![א-ת])/;
export function taxInvoiceCheck(j:any):{ok:true}|{ok:false,reason:string}{
 const words=[j.title,j.tax_invoice_words].filter((x:unknown)=>typeof x==='string').join(' ');
 const hebrew=j.language==='he'||/[א-ת]/.test(String(j.title||''));
 if(!hebrew)return {ok:true};
 if(HEB_TAX_INVOICE.test(words))return {ok:true};
 const kind=String(j.doc_kind||'');
 return {ok:false,reason:kind==='order_confirmation'?'Order confirmation, not a tax invoice (no "חשבונית מס")':kind==='payment_confirmation'?'Payment confirmation, not a tax invoice (no "חשבונית מס")':'No "חשבונית מס" on this Hebrew document'};
}
async function readOnce(db:any,id:string){
 const key=Deno.env.get('OPENAI_API_KEY');if(!key)return {id,error:'reader_not_configured'};
 const row=await db.from('expense_inbox_files').select('storage_path,mime_type,original_name,status').eq('id',id).single();if(row.error)return {id,error:'file_unavailable'};
 const dl=await db.storage.from('expense-inbox').download(row.data.storage_path);if(dl.error)return {id,error:'file_unavailable'};
 const data=`data:${row.data.mime_type};base64,${b64(new Uint8Array(await dl.data.arrayBuffer()))}`;
 const doc=row.data.mime_type==='application/pdf'?{type:'file',file:{filename:row.data.original_name||'document.pdf',file_data:data}}:{type:'image_url',image_url:{url:data}};
 const prompt='This is a business expense document (receipt, tax invoice, bill, order confirmation), often Hebrew from Israel, sometimes English from abroad. It may hold several documents (e.g. an order confirmation and a tax invoice); describe the tax invoice if there is one. Reply with JSON only: {"is_expense":true|false,"doc_kind":"tax_invoice"|"tax_invoice_receipt"|"receipt"|"invoice"|"order_confirmation"|"payment_confirmation"|"quote"|"other","language":"he"|"en"|"other" (main language of the document),"title":"the document title exactly as printed, e.g. חשבונית מס קבלה 7296","tax_invoice_words":"the exact Hebrew words if the document says חשבונית מס anywhere, else null","supplier":"business name as printed","date":"YYYY-MM-DD document date","total":number (final amount paid, including VAT, in the document currency),"vat":number (VAT amount, 0 if none shown),"currency":"ILS"|"USD"|"EUR"|...}. Use null for anything you cannot read. is_expense is false if it is not a receipt, invoice or order/purchase document.';
 try{
  const res=await fetch('https://api.openai.com/v1/chat/completions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${key}`},
   body:JSON.stringify({model:'gpt-6-luna',max_completion_tokens:800,response_format:{type:'json_object'},messages:[{role:'user',content:[{type:'text',text:prompt},doc]}]})});
  const out=await res.json();const j=JSON.parse(out?.choices?.[0]?.message?.content||'{}');
  const minor=(v:unknown)=>typeof v==='number'&&isFinite(v)&&v>=0&&v<1e7?Math.round(v*100):null;
  const date=typeof j.date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(j.date)&&!isNaN(Date.parse(j.date))?j.date:null;
  const total=minor(j.total),currency=typeof j.currency==='string'&&/^[A-Z]{3}$/.test(j.currency)?j.currency:'ILS';
  const kind=typeof j.doc_kind==='string'?j.doc_kind.slice(0,40):null,base={doc_kind:kind,supplier:typeof j.supplier==='string'?j.supplier.slice(0,120):null,doc_date:date};
  let change:Record<string,unknown>;
  if(j.is_expense===false)change={read_status:'not_expense',doc_kind:kind};
  else if(total===null)change={read_status:'failed',...base};
  else{
   const vat=minor(j.vat)??0;
   change={read_status:'read',...base,total_minor:total,vat_minor:vat,currency:'ILS',orig_total_minor:null,orig_vat_minor:null,orig_currency:null,fx_rate:null,fx_date:null,hold_reason:null};
   if(currency!=='ILS'){
    // Foreign document: keep the original amount and show it in shekels at the rate for its date.
    const fx=await fxRate(currency,date);
    change=fx?{...change,total_minor:Math.round(total*fx.rate),vat_minor:Math.round(vat*fx.rate),orig_total_minor:total,orig_vat_minor:vat,orig_currency:currency,fx_rate:fx.rate,fx_date:fx.date}
     :{...change,read_status:'failed',total_minor:null,orig_total_minor:total,orig_vat_minor:vat,orig_currency:currency,hold_reason:'Could not get the '+currency+' rate; add the shekel amount by hand'};
   }
   const tax=taxInvoiceCheck(j);
   if(!tax.ok)change={...change,read_status:'no_tax_invoice',hold_reason:tax.reason};
  }
  await db.from('expense_inbox_files').update({...change,read_at:new Date().toISOString()}).eq('id',id).neq('read_status','manual');
  // Not a tax invoice: kept out of the accountant's batches (archived with the reason); "Move to waiting" undoes it.
  if(change.read_status==='no_tax_invoice')await db.from('expense_inbox_files').update({status:'archived'}).eq('id',id).eq('status','pending').eq('read_status','no_tax_invoice');
  return {id,...change,...(change.read_status==='failed'?{reason:String(out?.error?.message||out?.choices?.[0]?.message?.content||out?.choices?.[0]?.finish_reason||'').slice(0,300)}:{})};
 }catch(_){await db.from('expense_inbox_files').update({read_status:'failed',read_at:new Date().toISOString()}).eq('id',id).neq('read_status','manual');return {id,error:'read_failed'};}
}
function mime(bytes:Uint8Array){
 if(new TextDecoder().decode(bytes.slice(0,5))==='%PDF-')return 'application/pdf';
 if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return 'image/jpeg';
 if(bytes.slice(0,8).join(',')==='137,80,78,71,13,10,26,10')return 'image/png';
 if(new TextDecoder().decode(bytes.slice(0,4))==='RIFF'&&new TextDecoder().decode(bytes.slice(8,12))==='WEBP')return 'image/webp';
 throw Error('supported_files_are_pdf_jpeg_png_webp');
}
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response(null,{headers:cors});if(req.method!=='POST')return json({error:'POST_required'},405);
 const ingress=Deno.env.get('EXPENSE_INGRESS_SECRET');
 const ingressCos=Deno.env.get('EXPENSE_INGRESS_SECRET_COS'),given=req.headers.get('x-expense-ingress')||'';
 // Two senders may deliver email documents: the Gmail script (attachments) and Chief of Staff (links, email bodies).
 const incoming=!!given&&((!!ingress&&given===ingress)||(!!ingressCos&&given===ingressCos));
 if(!incoming&&!await isServiceOrAdmin(req))return forbidden(cors);
 const db=createClient(Deno.env.get('SUPABASE_URL')!,serviceKey(),{auth:{persistSession:false}});
 try{
  if((req.headers.get('content-type')||'').startsWith('multipart/form-data')){
   if(Number(req.headers.get('content-length'))>22*1024*1024)return json({error:'maximum_file_size_20mb'},413);
   const form=await req.formData(),file=form.get('file');if(!(file instanceof File)||file.size<5||file.size>20*1024*1024)throw Error('maximum_file_size_20mb');
   if(incoming&&String(form.get('recipient')||'').toLowerCase()!=='gremiercoffee+expenses@gmail.com')throw Error('wrong_expense_recipient');
   const bytes=new Uint8Array(await file.arrayBuffer()),type=mime(bytes),sha=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(x=>x.toString(16).padStart(2,'0')).join('');
   const prior=await db.from('expense_inbox_files').select('id').eq('sha256',sha).maybeSingle();if(prior.error)throw Error('inbox_unavailable');if(prior.data){if(incoming)await db.from('expense_inbox_settings').update({email_last_received_at:new Date().toISOString()}).eq('id',1);await notify(db);return json({saved:true,duplicate:true,id:prior.data.id});}
   const id=crypto.randomUUID(),path=`${id}/original.${type==='application/pdf'?'pdf':type.split('/')[1]}`;
   const uploaded=await db.storage.from('expense-inbox').upload(path,bytes,{contentType:type,upsert:false});if(uploaded.error)throw Error('upload_failed');
   const result=await db.from('expense_inbox_files').insert({id,storage_path:path,original_name:file.name.slice(0,200),mime_type:type,size_bytes:bytes.length,sha256:sha,source:incoming?'email':'upload',
    source_reference:incoming?String(form.get('reference')||'').slice(0,250):null,sender:incoming?'gremiercoffee+expenses@gmail.com':null});
   if(result.error){await db.storage.from('expense-inbox').remove([path]);if(result.error.code==='23505')return json({saved:true,duplicate:true});throw Error('upload_record_failed');}
   if(incoming)await db.from('expense_inbox_settings').update({email_last_received_at:new Date().toISOString()}).eq('id',1);
   // Read the amount in the background, so saving stays quick.
   (globalThis as any).EdgeRuntime?.waitUntil?.(readDocument(db,id));
   await notify(db);return json({saved:true,id});
  }
  const b=await req.json();
  if(incoming){
   if(b.action!=='heartbeat'||!Number.isInteger(b.error_count)||b.error_count<0||b.error_count>100)return json({error:'attachment_required'},400);
   const r=await db.from('expense_inbox_settings').update({email_last_checked_at:new Date().toISOString(),email_error_count:b.error_count}).eq('id',1);
   if(r.error)throw Error('connection_status_failed');return json({saved:true});
  }
  if(b.action==='read'){
   // Read these documents (or up to 8 not read yet).
   let ids:string[]=Array.isArray(b.ids)?b.ids.filter((x:any)=>/^[0-9a-f-]{36}$/i.test(x)).slice(0,8):[];
   if(!ids.length){const r=await db.from('expense_inbox_files').select('id').in('read_status',b.retry?['unread','failed']:['unread']).neq('status','archived').order('created_at').limit(8);ids=(r.data||[]).map((x:any)=>x.id);}
   const results=[];for(const id of ids)results.push(await readDocument(db,id));
   return json({read:results});
  }
  if(b.action==='set_amount'){
   // A correction by hand: total (₪, incl. VAT), VAT, date, supplier.
   if(!/^[0-9a-f-]{36}$/i.test(String(b.id||'')))throw Error('file_unavailable');
   const total=Number(b.total),vat=Number(b.vat||0);if(!isFinite(total)||total<0||total>=1e7||!isFinite(vat)||vat<0||vat>total)throw Error('invalid_amount');
   const date=typeof b.date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(b.date)?b.date:null;
   const r=await db.from('expense_inbox_files').update({read_status:'manual',total_minor:Math.round(total*100),vat_minor:Math.round(vat*100),doc_date:date,supplier:typeof b.supplier==='string'?b.supplier.slice(0,120):null,currency:'ILS',hold_reason:null,orig_total_minor:null,orig_vat_minor:null,orig_currency:null,fx_rate:null,fx_date:null,read_at:new Date().toISOString()}).eq('id',b.id);
   if(r.error)throw Error('amount_save_failed');return json({saved:true});
  }
  if(b.action==='settings'){
   if(![5,10,15,20].includes(b.batch_size))throw Error('invalid_batch_size');
   const r=await db.from('expense_inbox_settings').update({batch_size:b.batch_size,updated_at:new Date().toISOString()}).eq('id',1);if(r.error)throw Error('settings_save_failed');await notify(db);return json({saved:true});
  }
  if(b.action==='restore'){
   // A document held back (or archived) goes back to Waiting.
   if(!/^[0-9a-f-]{36}$/i.test(String(b.id||'')))throw Error('file_unavailable');
   const r=await db.from('expense_inbox_files').update({status:'pending',hold_reason:null}).eq('id',b.id).eq('status','archived');if(r.error)throw Error('restore_failed');
   await notify(db);return json({saved:true});
  }
  if(b.action==='original'){
   const file=await db.from('expense_inbox_files').select('storage_path').eq('id',b.id).single();if(file.error)throw Error('file_unavailable');
   const r=await db.storage.from('expense-inbox').createSignedUrl(file.data.storage_path,600);if(r.error)throw Error('file_unavailable');return json({url:r.data.signedUrl});
  }
  if(['filed','archive','shared','unshare'].includes(b.action)){
   const ids=Array.isArray(b.ids)?b.ids:[];if(ids.length<1||ids.length>20||ids.some((x:any)=>!/^[0-9a-f-]{36}$/i.test(x)))throw Error('choose_up_to_20_files');
   const now=new Date().toISOString();
   // shared: the batch left the phone (share sheet / ZIP) and leaves the waiting list, labelled with when.
   // filed: done, from waiting or shared. unshare: a shared batch goes back to waiting.
   const change:Record<string,unknown>=b.action==='filed'?{status:'filed',filed_at:now}:b.action==='archive'?{status:'archived'}:b.action==='shared'?{status:'shared',shared_at:now,batch_id:crypto.randomUUID()}:{status:'pending',shared_at:null,batch_id:null};
   const from=b.action==='filed'?['pending','shared']:b.action==='unshare'?['shared']:['pending'];
   const q=db.from('expense_inbox_files').update(change).in('id',ids).in('status',from);
   const r=await q;
   if(r.error)throw Error('filing_status_failed');
   // Filing a waiting batch gives it its own batch id; a shared batch keeps the one it was shared with.
   if(b.action==='filed')await db.from('expense_inbox_files').update({batch_id:crypto.randomUUID()}).in('id',ids).is('batch_id',null);
   await notify(db);return json({saved:true,...(b.action==='shared'?{batch_id:change.batch_id}:{})});
  }
  return json({error:'unsupported_action'},400);
 }catch(e){return json({error:e instanceof Error&&/^[a-z0-9_]+$/.test(e.message)?e.message:'expense_request_failed'},400);}
});
