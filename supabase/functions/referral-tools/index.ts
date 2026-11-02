import {createClient} from 'https://esm.sh/@supabase/supabase-js@2';
import {isServiceOrAdmin} from '../_shared/security.ts';
import {dateRange} from '../_shared/web-journey-model.ts';
import {signToken} from '../_shared/engage.ts';
import {sendOrderEmails} from '../_shared/order-email.ts';
import {reminderText} from '../_shared/referral-model.ts';
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'GET,POST,OPTIONS'};
const json=(v:unknown,status=200)=>new Response(JSON.stringify(v),{status,headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'}});
function serviceKey(){const k=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');return k||Object.values(JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}'))[0] as string;}
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response(null,{headers:cors});
 try{
  const db=createClient(Deno.env.get('SUPABASE_URL')!,serviceKey(),{auth:{persistSession:false}}),url=new URL(req.url);
  if(req.method==='GET'&&url.searchParams.has('optout')){
   const email=(url.searchParams.get('optout')||'').trim().toLowerCase();
   if(!email||url.searchParams.get('t')!==await signToken('referral-optout',email))return json({error:'invalid_link'},403);
   const r=await db.from('cart_reminder_optouts').upsert({email});if(r.error)throw Error('optout_failed');
   return new Response('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Gremier Coffee</title><main style="font-family:sans-serif;max-width:440px;margin:60px auto;padding:20px"><h1>Gremier Coffee</h1><p>You are unsubscribed from promotional reminders.</p><p dir="rtl">הוסרתם מתזכורות שיווקיות.</p></main>',{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}});
  }
  if(req.method!=='POST')return json({error:'POST_required'},405);
  if(!await isServiceOrAdmin(req))return json({error:'admin_only'},403);
  const body=await req.json();
  if(body.action==='report'){
   const {start,end}=dateRange(body),r=await db.rpc('referral_report',{from_day:start,to_day:end});
   if(r.error)throw Error('report_unavailable');return json({...r.data,from:start,to:end});
  }
  if(body.action!=='reminders')return json({error:'unsupported_action'},400);
  const candidates=await db.rpc('referral_reminder_candidates');if(candidates.error)throw Error('candidates_unavailable');
  const own=[Deno.env.get('NOTIFY_EMAIL')||'gremiercoffee@gmail.com','yonigrey@gmail.com'].map(x=>x.toLowerCase());
  const rows=(candidates.data||[]).filter((r:any)=>!own.includes(r.email.toLowerCase()));
  if(body.dry_run===true)return json({eligible:rows.length,preview:reminderText('REF-EXAMPLE','https://gremiercoffee.co.il/'),'rule':'One email after 3 days; no recorded share, open or redemption; paying customers only; opt-outs excluded.'});
  let sent=0,failed=0,skipped=0;
  for(const row of rows){
   if(sent+failed>0)await new Promise(resolve=>setTimeout(resolve,650));
   // Recheck immediately before claiming; unique code prevents concurrent sends.
   const still=await db.rpc('referral_reminder_candidates');if(still.error)throw Error('candidates_unavailable');
   if(!(still.data||[]).some((r:any)=>r.code===row.code)){skipped++;continue;}
   const claim=await db.from('referral_reminders').insert({code:row.code});if(claim.error){skipped++;continue;}
   const stop=`${Deno.env.get('SUPABASE_URL')}/functions/v1/referral-tools?optout=${encodeURIComponent(row.email)}&t=${await signToken('referral-optout',row.email)}`;
   const mail=reminderText(row.code,stop);
   const result=await sendOrderEmails({skipOwner:true,ownerSubject:'',ownerText:'',customerEmail:row.email,customerSubject:mail.subject,customerText:mail.text});
   // Never retry an ambiguous send automatically: avoids duplicate customer emails.
   const save=await db.from('referral_reminders').update({status:result.ok?'sent':'failed',sent_at:result.ok?new Date().toISOString():null}).eq('code',row.code);
   if(save.error)console.error('referral reminder status update failed');
   if(result.ok)sent++;else failed++;
  }
  return json({sent,failed,skipped});
 }catch{return json({error:'referral_tools_unavailable'},500);}
});
