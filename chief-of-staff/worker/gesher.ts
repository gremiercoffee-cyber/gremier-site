import type {Env} from './env';
import {all,first,run,createItem} from './db';
import {notify} from './push';
import {ACCOUNT,REFERRAL,SENDER,SENDERS,VERSION,templates,notification,authenticated,decision,freshText,type Mail} from './gesher-rules';
import {gmailAdapter,type GmailAdapter} from './gesher-gmail';
const log=(env:Env,event:string,detail:string,id:string|null=null)=>run(env,'INSERT INTO gesher_log(created_at,case_id,event,detail) VALUES(?,?,?,?)',Date.now(),id,event,detail);
export async function approvalDigest(){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify({VERSION,templates,senders:SENDERS,account:ACCOUNT,referral:REFERRAL,safeguards:'future-only;one-contact-per-address;authenticated-exact-replies;no-reminders;uncertain-no-retry;v1'}))))).map(x=>x.toString(16).padStart(2,'0')).join('');}
async function alert(env:Env,detail:string,id?:string){
 await log(env,'attention',detail,id);
 const item=await createItem(env,{title:id?`Review Aish Gesher unsubscribe case ${id}`:'Check Aish Gesher unsubscribe monitor',notes:detail,category:'yeshiva',source:'gesher-monitor',priority:2});
 await notify(env,'watch','Aish Gesher monitor needs attention',detail,item.id,'/',{topic:'gesher:'+ (id||'monitor')});
}
export async function ingest(env:Env,m:Mail,historical=false){
 const existing=await first<any>(env,'SELECT message_id,status FROM gesher_notifications WHERE message_id=?',m.id);
 if(existing&&(existing.status!=='accepted'||await first(env,'SELECT id FROM gesher_cases WHERE notification_id=? OR email=(SELECT email FROM gesher_notifications WHERE message_id=?)',m.id,m.id)))return;
 const n=notification(m),id=crypto.randomUUID(),t=Date.now();
 const statement=env.DB.prepare('INSERT OR IGNORE INTO gesher_notifications(message_id,thread_id,received_at,email,event_key,status,reason,created_at) VALUES(?,?,?,?,?,?,?,?)').bind(m.id,m.threadId,m.at,n.email,n.event||null,n.email?'accepted':'review',n.reason,t);
 if(!n.email){await statement.run();await alert(env,`Notification ${m.id}: ${n.reason}`);return;}
 await env.DB.batch([statement,env.DB.prepare("INSERT OR IGNORE INTO gesher_cases(id,email,notification_id,event_key,status,created_at,updated_at,subscriber_name) VALUES(?,?,?,?,?,?,?,?)").bind(id,n.email,m.id,n.event,historical?'historical':'pending',t,t,n.name||null)]);
 await log(env,'notification','Validated notification '+m.id);
}
async function queue(env:Env,c:any,kind:'clarification'|'referral'){
 const id=crypto.randomUUID();await run(env,"INSERT OR IGNORE INTO gesher_outbox(id,case_id,kind,state,rfc_id,created_at) VALUES(?,?,?,'pending',?,?)",id,c.id,kind,`gesher-${id}@aish.edu`,Date.now());
}
async function sent(env:Env,o:any,m:{id:string;threadId?:string}){
 const t=Date.now();await env.DB.batch([
 env.DB.prepare("UPDATE gesher_outbox SET state='sent',gmail_id=?,thread_id=?,sent_at=?,error=NULL WHERE id=?").bind(m.id,m.threadId||null,t,o.id),
 env.DB.prepare(o.kind==='clarification'?"UPDATE gesher_cases SET status='contacted',contact_message_id=?,contact_thread_id=?,updated_at=? WHERE id=?":"UPDATE gesher_cases SET status='referred',referral_message_id=?,updated_at=? WHERE id=?").bind(...(o.kind==='clarification'?[m.id,m.threadId||null,t,o.case_id]:[m.id,t,o.case_id]))]);
 await log(env,'sent',o.kind+' Gmail ID '+m.id,o.case_id);
}
async function handleReply(env:Env,c:any,adapter:GmailAdapter){
 const msgs=(await adapter.thread(c.contact_thread_id)).filter(m=>!m.sent&&m.at>=(c.created_at||0));
 const o=await first<any>(env,"SELECT * FROM gesher_outbox WHERE case_id=? AND kind='clarification'",c.id);
 for(const m of msgs){
  if(await first(env,'SELECT message_id FROM gesher_responses WHERE message_id=?',m.id))continue;
  const verified=authenticated(m,c.email)&&(!m.auto||m.auto.toLowerCase()==='no')&&m.references.includes('<'+o.rfc_id+'>');
  const d=verified?decision(m.text):'review';
  await env.DB.batch([
   env.DB.prepare('INSERT OR IGNORE INTO gesher_responses(message_id,case_id,received_at,decision,excerpt) VALUES(?,?,?,?,?)').bind(m.id,c.id,m.at,d,freshText(m.text).slice(0,1500)),
   env.DB.prepare('UPDATE gesher_cases SET status=?,response_message_id=?,updated_at=? WHERE id=?').bind(d==='resubscribe'?'requested':d==='intentional'?'intentional':'review',m.id,Date.now(),c.id)]);
  if(d==='review')await alert(env,'Ambiguous or unverified reply; no referral sent.',c.id);
 }
}
export async function gesherStatus(env:Env){return{config:await first(env,'SELECT * FROM gesher_config WHERE id=1'),counts:await all(env,'SELECT status,count(*) AS count FROM gesher_cases GROUP BY status'),outbox:await all(env,'SELECT state,count(*) AS count FROM gesher_outbox GROUP BY state'),templates,template_version:VERSION,approval_digest:await approvalDigest(),logs:await all(env,'SELECT * FROM gesher_log ORDER BY id DESC LIMIT 15')};}
export async function checkGesherScheduler(env:Env){
 const c=await first<any>(env,'SELECT mode,last_check FROM gesher_config WHERE id=1');if(!c||c.mode==='paused'||!c.last_check)return;
 const old=await first(env,"SELECT key FROM settings WHERE key='gesher_stale_alert'");
 if(Date.now()-c.last_check>20*60000&&!old){await run(env,"INSERT OR IGNORE INTO settings(key,value) VALUES('gesher_stale_alert','1')");await alert(env,'Office unsubscribe scheduler has not checked in for over 20 minutes. Verify computer power, sign-in, internet and scheduled task.');}
 else if(Date.now()-c.last_check<=20*60000&&old)await run(env,"DELETE FROM settings WHERE key='gesher_stale_alert'");
}
export async function gesherTick(env:Env,provided?:GmailAdapter){
 // Durable lease protects overlapping scheduler ticks and expires after a crashed request.
 const t=Date.now(),lock=await first<any>(env,"INSERT INTO settings(key,value) VALUES('gesher_lock',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE CAST(settings.value AS INTEGER)<? RETURNING value",String(t),t-4*60000);
 if(!lock)return{busy:true};
 try{
  const cfg=await first<any>(env,'SELECT * FROM gesher_config WHERE id=1');if(!cfg||cfg.mode==='paused')return{paused:true};
  const adapter=provided||await gmailAdapter(env);
  // Owner confirms past subscribers were already contacted. Build a suppression baseline, never a catch-up send queue.
  if(!cfg.baseline_done){
   const baseline=await adapter.list(`{${SENDERS.map(s=>'from:'+s).join(' ')}} subject:(Unsubscribe Notification Aish Gesher) before:${Math.ceil(cfg.watch_from/1000)}`,cfg.baseline_page);
   for(const x of baseline.messages||[]){const m=await adapter.get(x.id);if(m.at<cfg.watch_from)await ingest(env,m,true);}
   await run(env,'UPDATE gesher_config SET baseline_page=?,baseline_done=? WHERE id=1',baseline.nextPageToken||null,baseline.nextPageToken?0:1);
   if(baseline.nextPageToken){await run(env,'UPDATE gesher_config SET last_check=? WHERE id=1',Date.now());return{ok:true,mode:cfg.mode,baseline_in_progress:true,sending_authorized:false};}
  }
  const q=`{${SENDERS.map(s=>'from:'+s).join(' ')}} subject:(Unsubscribe Notification Aish Gesher) after:${Math.floor(cfg.watch_from/1000)}`;
  const page=await adapter.list(q,cfg.scan_page);
  for(const x of page.messages||[]){const m=await adapter.get(x.id);if(m.at>=cfg.watch_from)await ingest(env,m);}
  await run(env,'UPDATE gesher_config SET scan_page=? WHERE id=1',page.nextPageToken||null);
  const enabled=cfg.mode==='enabled'&&cfg.approved_at&&cfg.approved_by&&cfg.template_version===VERSION&&cfg.approval_digest===await approvalDigest();
  // Replies are read even if sending is later disabled. No nonresponse timeout or reminder path exists.
  const cases=await all<any>(env,"SELECT * FROM gesher_cases WHERE status='contacted' AND contact_thread_id IS NOT NULL ORDER BY checked_at LIMIT 5");
  for(const c of cases){await handleReply(env,c,adapter);await run(env,'UPDATE gesher_cases SET checked_at=? WHERE id=?',t,c.id);}
  if(enabled){
   const pending=await all<any>(env,"SELECT c.* FROM gesher_cases c JOIN gesher_notifications n ON n.message_id=c.notification_id WHERE c.status='pending' AND n.received_at>=? LIMIT 5",cfg.approved_at);
   for(const c of pending){
    // Detect previous manual contacts as well as records created by this workflow.
    const previous=await adapter.list(`in:sent to:${c.email} (Gesher unsubscribe)`);
    if(previous.messages?.length){await run(env,"UPDATE gesher_cases SET status='review',updated_at=? WHERE id=?",t,c.id);await alert(env,'Possible prior manual contact; clarification withheld.',c.id);}else await queue(env,c,'clarification');
   }
   for(const c of await all<any>(env,"SELECT * FROM gesher_cases WHERE status='requested' LIMIT 5"))await queue(env,c,'referral');
   const out=await all<any>(env,"SELECT o.*,c.email,c.subscriber_name,c.status AS case_status FROM gesher_outbox o JOIN gesher_cases c ON c.id=o.case_id WHERE o.state IN ('pending','sending','uncertain') ORDER BY o.created_at LIMIT 5");
   for(const o of out){
    if(o.state!=='pending'){
     const found=await adapter.list('in:sent rfc822msgid:'+o.rfc_id);
     if(found.messages?.length===1){const m=await adapter.get(found.messages[0].id);if(m.sent&&m.from.toLowerCase().includes(ACCOUNT))await sent(env,o,m);}
     else if(o.state==='sending'){await run(env,"UPDATE gesher_outbox SET state='uncertain',error='No definitive Gmail receipt; no resend' WHERE id=?",o.id);await alert(env,'Uncertain send outcome; no resend attempted.',o.case_id);}continue;
    }
    if((o.kind==='referral'&&o.case_status!=='requested')||(o.kind==='clarification'&&o.case_status!=='pending')){await run(env,"UPDATE gesher_outbox SET state='blocked' WHERE id=?",o.id);continue;}
    if(o.kind==='referral'&&!o.subscriber_name){await run(env,"UPDATE gesher_outbox SET state='blocked',error='Subscriber name requires review' WHERE id=?",o.id);await alert(env,'Subscriber name missing or ambiguous; referral withheld.',o.case_id);continue;}
    // Re-read approval immediately before each irreversible send.
    const approved=await first<any>(env,'SELECT * FROM gesher_config WHERE id=1');
    if(approved.mode!=='enabled'||approved.approval_digest!==await approvalDigest()||!approved.approved_at||!approved.approved_by)break;
    const claimed=await first(env,"UPDATE gesher_outbox SET state='sending',attempted_at=? WHERE id=? AND state='pending' RETURNING id",Date.now(),o.id);if(!claimed)continue;
    const template=templates[o.kind as 'clarification'|'referral'];
    try{const m=await adapter.send(o.kind==='clarification'?o.email:REFERRAL,template.subject,template.body.replace('{email}',o.email).replace('{name}',o.subscriber_name||''),o.rfc_id);await sent(env,o,m);}catch{await run(env,"UPDATE gesher_outbox SET state='uncertain',error='Send result uncertain; reconciliation required' WHERE id=?",o.id);await alert(env,'Gmail send uncertain. Never automatically resent.',o.case_id);}
   }
  }
  await run(env,'UPDATE gesher_config SET last_check=?,last_error=NULL WHERE id=1',Date.now());
  return{ok:true,mode:cfg.mode,sending_authorized:!!enabled,scanned:(page.messages||[]).length};
 }catch{
  const old=await first<any>(env,'SELECT last_error FROM gesher_config WHERE id=1');
  await run(env,"UPDATE gesher_config SET last_check=?,last_error='Monitor check failed; inspect Gmail connection or service' WHERE id=1",Date.now());
  if(!old?.last_error)await alert(env,'Unsubscribe check failed. Check Gmail authorization and scheduler; next tick retries reads.');
  return{ok:false,error:'Monitor check failed; see attention task'};
 }finally{await run(env,"DELETE FROM settings WHERE key='gesher_lock' AND value=?",String(t));}
}
