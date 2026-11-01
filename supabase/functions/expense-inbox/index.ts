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
async function readOnce(db:any,id:string){
 const key=Deno.env.get('OPENAI_API_KEY');if(!key)return {id,error:'reader_not_configured'};
 const row=await db.from('expense_inbox_files').select('storage_path,mime_type,original_name').eq('id',id).single();if(row.error)return {id,error:'file_unavailable'};
 const dl=await db.storage.from('expense-inbox').download(row.data.storage_path);if(dl.error)return {id,error:'file_unavailable'};
 const data=`data:${row.data.mime_type};base64,${b64(new Uint8Array(await dl.data.arrayBuffer()))}`;
 const doc=row.data.mime_type==='application/pdf'?{type:'file',file:{filename:row.data.original_name||'document.pdf',file_data:data}}:{type:'image_url',image_url:{url:data}};
 const prompt='This is a business expense document from Israel (receipt, tax invoice, bill), often in Hebrew. Reply with JSON only: {"is_expense":true|false,"supplier":"business name as printed","date":"YYYY-MM-DD document date","total":number (the final amount paid, including VAT),"vat":number (VAT amount, 0 if none shown),"currency":"ILS"|"USD"|"EUR"|...}. Use null for anything you cannot read. is_expense is false if it is not a receipt or invoice.';
 try{
  const res=await fetch('https://api.openai.com/v1/chat/completions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${key}`},
   body:JSON.stringify({model:'gpt-6-luna',max_completion_tokens:600,response_format:{type:'json_object'},messages:[{role:'user',content:[{type:'text',text:prompt},doc]}]})});
  const out=await res.json();const j=JSON.parse(out?.choices?.[0]?.message?.content||'{}');
  const minor=(v:unknown)=>typeof v==='number'&&isFinite(v)&&v>=0&&v<1e7?Math.round(v*100):null;
  const date=typeof j.date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(j.date)&&!isNaN(Date.parse(j.date))?j.date:null;
  const total=minor(j.total);
  const change=j.is_expense===false?{read_status:'not_expense'}:total===null?{read_status:'failed'}:
   {read_status:'read',supplier:typeof j.supplier==='string'?j.supplier.slice(0,120):null,doc_date:date,total_minor:total,vat_minor:minor(j.vat)??0,currency:typeof j.currency==='string'&&/^[A-Z]{3}$/.test(j.currency)?j.currency:'ILS'};
  await db.from('expense_inbox_files').update({...change,read_at:new Date().toISOString()}).eq('id',id).neq('read_status','manual');
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
 const incoming=!!ingress&&req.headers.get('x-expense-ingress')===ingress;
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
   const r=await db.from('expense_inbox_files').update({read_status:'manual',total_minor:Math.round(total*100),vat_minor:Math.round(vat*100),doc_date:date,supplier:typeof b.supplier==='string'?b.supplier.slice(0,120):null,currency:'ILS',read_at:new Date().toISOString()}).eq('id',b.id);
   if(r.error)throw Error('amount_save_failed');return json({saved:true});
  }
  if(b.action==='settings'){
   if(![5,10,15,20].includes(b.batch_size))throw Error('invalid_batch_size');
   const r=await db.from('expense_inbox_settings').update({batch_size:b.batch_size,updated_at:new Date().toISOString()}).eq('id',1);if(r.error)throw Error('settings_save_failed');await notify(db);return json({saved:true});
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
