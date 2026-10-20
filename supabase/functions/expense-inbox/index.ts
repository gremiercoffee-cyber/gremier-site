import {createClient} from 'https://esm.sh/@supabase/supabase-js@2';
import {forbidden,isServiceOrAdmin} from '../_shared/security.ts';
import {sendWebPushToAdmins} from '../_shared/web-push.ts';
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,apikey,x-client-info,content-type,x-expense-ingress','Access-Control-Allow-Methods':'POST,OPTIONS'};
const json=(b:unknown,status=200)=>new Response(JSON.stringify(b),{status,headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'}});
function serviceKey(){return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}').default||'';}
async function notify(db:any){
 const result=await db.rpc('expense_notification_claim');if(result.error||!result.data)return;
 const count=Number(result.data),payload={title:'Expenses ready to file',body:`You have ${count} expense documents waiting. Open Expenses to prepare your batch.`,url:'/admin.html?finance=expenses',tag:'expense-batch-ready'};
 await sendWebPushToAdmins(db,payload);
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
   await notify(db);return json({saved:true,id});
  }
  const b=await req.json();
  if(incoming){
   if(b.action!=='heartbeat'||!Number.isInteger(b.error_count)||b.error_count<0||b.error_count>100)return json({error:'attachment_required'},400);
   const r=await db.from('expense_inbox_settings').update({email_last_checked_at:new Date().toISOString(),email_error_count:b.error_count}).eq('id',1);
   if(r.error)throw Error('connection_status_failed');return json({saved:true});
  }
  if(b.action==='settings'){
   if(![5,10,15,20].includes(b.batch_size))throw Error('invalid_batch_size');
   const r=await db.from('expense_inbox_settings').update({batch_size:b.batch_size,updated_at:new Date().toISOString()}).eq('id',1);if(r.error)throw Error('settings_save_failed');await notify(db);return json({saved:true});
  }
  if(b.action==='original'){
   const file=await db.from('expense_inbox_files').select('storage_path').eq('id',b.id).single();if(file.error)throw Error('file_unavailable');
   const r=await db.storage.from('expense-inbox').createSignedUrl(file.data.storage_path,600);if(r.error)throw Error('file_unavailable');return json({url:r.data.signedUrl});
  }
  if(b.action==='filed'||b.action==='archive'){
   const ids=Array.isArray(b.ids)?b.ids:[];if(ids.length<1||ids.length>20||ids.some((x:any)=>!/^[0-9a-f-]{36}$/i.test(x)))throw Error('choose_up_to_20_files');
   const r=await db.from('expense_inbox_files').update({status:b.action==='filed'?'filed':'archived',...(b.action==='filed'?{filed_at:new Date().toISOString(),batch_id:crypto.randomUUID()}: {})}).in('id',ids).eq('status','pending');
   if(r.error)throw Error('filing_status_failed');await notify(db);return json({saved:true});
  }
  return json({error:'unsupported_action'},400);
 }catch(e){return json({error:e instanceof Error&&/^[a-z0-9_]+$/.test(e.message)?e.message:'expense_request_failed'},400);}
});
