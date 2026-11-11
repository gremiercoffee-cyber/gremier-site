import type {Env} from './env';
import {localDate,shiftDate,sleepJournalDate,type Journal} from '../shared/daynote';
import type {NightScore} from '../shared/daynote-scores';
import {DAYNOTE_NOTIFICATION_DEFAULTS,unusualVitals,type DaynotePreferences} from '../shared/daynote-alerts';
import {all,first,run,HttpError} from './db';
import {sendPush,pushConfigured,type PushMessage} from './push';
import {isShabbat} from './shabbat';
import {healthSync} from './daynote-google';
const HEALTH_URL='https://health.gremiercoffee.co.il/daynote/';
export async function daynotePreferences(env:Env):Promise<DaynotePreferences>{const row=await first<{value:string}>(env,"SELECT value FROM daynote_settings WHERE key='preferences'");return {...DAYNOTE_NOTIFICATION_DEFAULTS,...(row?JSON.parse(row.value):{})};}
export async function saveDaynotePreferences(env:Env,p:any){
 const previous=await daynotePreferences(env),next={...previous,...p},time=/^([01]\d|2[0-3]):[0-5]\d$/;
 if(!time.test(next.reminder_time)||!time.test(next.morning_time)||next.wake_time!==null&&!time.test(next.wake_time))throw new HttpError(400,'Choose valid reminder and wake times.');
 const value:DaynotePreferences={reminders:!!next.reminders,reminder_time:next.reminder_time,morning_reminders:!!next.morning_reminders,morning_time:next.morning_time,health_alerts:!!next.health_alerts,weekly_summary:!!next.weekly_summary,wake_time:next.wake_time};
 await run(env,"INSERT INTO daynote_settings(key,value) VALUES('preferences',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE daynote_settings.value IS NOT excluded.value",JSON.stringify(value));return value;
}
export async function healthNotificationStatus(env:Env){const row=await first<{health:number;existing:number}>(env,'SELECT (SELECT count(*) FROM daynote_push_subscriptions) health,(SELECT count(*) FROM push_subscriptions) existing');return{configured:pushConfigured(env),health_devices:row?.health||0,existing_devices:row?.existing||0};}
export async function subscribeHealth(env:Env,p:any){
 let u:URL;try{u=new URL(p?.endpoint);}catch{throw new HttpError(400,'Invalid notification subscription.');}
 if(u.protocol!=='https:'||u.username||u.password||u.port||!(/(^|\.)push\.apple\.com$|(^|\.)push\.services\.mozilla\.com$|(^|\.)notify\.windows\.com$|^fcm\.googleapis\.com$/.test(u.hostname))||u.href.length>2500||!/^[-_A-Za-z0-9]{87}$/.test(p.keys?.p256dh||'')||!/^[-_A-Za-z0-9]{22}$/.test(p.keys?.auth||''))throw new HttpError(400,'Invalid notification subscription.');
 const value=JSON.stringify({endpoint:u.href,keys:{p256dh:p.keys.p256dh,auth:p.keys.auth}});
 await run(env,'INSERT INTO daynote_push_subscriptions(endpoint,subscription,created_at) VALUES(?,?,?) ON CONFLICT(endpoint) DO UPDATE SET subscription=excluded.subscription WHERE daynote_push_subscriptions.subscription IS NOT excluded.subscription',u.href,value,new Date().toISOString());return{ok:true};
}
/** The most recent finished main sleep (naps and sessions under 3 hours don't count as waking up for the day). */
export async function latestWake(env:Env,at=new Date()){
 return first<{start_at:string;end_at:string}>(env,"SELECT start_at,end_at FROM daynote_measurements WHERE type='sleep' AND start_at IS NOT NULL AND end_at>? AND end_at<=? AND value BETWEEN 180 AND 840 AND json_extract(raw,'$.sleep.metadata.nap') IS NOT 1 AND json_extract(raw,'$.sleep.metadata.processed') IS NOT 0 ORDER BY end_at DESC LIMIT 1",new Date(at.getTime()-20*3600000).toISOString(),at.toISOString());
}
/** Google is otherwise read every 4 hours; in the morning look at just the sleep stream until today's wake-up has been seen. */
export async function pollForWake(env:Env,at=new Date(),sync=healthSync){
 const p=await daynotePreferences(env),hour=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Jerusalem',hour:'2-digit',hourCycle:'h23'}).format(at);
 if(!p.morning_reminders||hour<'05'||hour>='13'||isShabbat('Asia/Jerusalem',at))return;
 const wake=await latestWake(env,at);if(wake&&localDate(wake.end_at)===localDate(at))return;
 await sync(env,true,false,7,false,true);
}
export async function healthReminders(env:Env,at=new Date(),deliver=sendPush,weekly?:()=>Promise<string>){
 const p=await daynotePreferences(env);if(!p.reminders&&!p.morning_reminders&&!p.health_alerts&&!p.weekly_summary||isShabbat('Asia/Jerusalem',at)||!pushConfigured(env))return;
 const devices=await healthNotificationStatus(env);if(!devices.health_devices&&!devices.existing_devices)return;
 const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jerusalem'}).format(at),time=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Jerusalem',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(at);
 const minutes=(t:string)=>+t.slice(0,2)*60 + +t.slice(3),within=(t:string)=>minutes(time)>=minutes(t)&&minutes(time)-minutes(t)<120;
 const notices:{key:string;message:PushMessage}[]=[];
 const row=await first<{document:string}>(env,'SELECT document FROM daynote_entries WHERE date=? AND deleted=0',date),j:Journal|null=row?JSON.parse(row.document):null;
 if(p.morning_reminders&&time>='03:00'&&time<'18:00'){
  // Sent once a day, after waking: when the night's sleep shows up, or at noon if the watch missed it.
  const wake=await latestWake(env,at),woke=wake&&localDate(wake.end_at)===date?wake:null;
  const detected=!!woke&&at.getTime()-Date.parse(woke.end_at)<=6*3600000&&!isShabbat('Asia/Jerusalem',new Date(woke.end_at)),missed=!woke&&time>='12:00'&&time<'14:00';
  if(detected||missed){
   const night=woke?sleepJournalDate(woke.start_at):shiftDate(date,-1),nightRow=night<date&&p.reminders?await first<{document:string}>(env,'SELECT document FROM daynote_entries WHERE date=? AND deleted=0',night):null;
   const journalOpen=night<date&&p.reminders&&!(nightRow?JSON.parse(nightRow.document) as Journal:null)?.completed,feelOpen=j?.morning?.overall==null,weekday=new Intl.DateTimeFormat('en-GB',{weekday:'long',timeZone:'UTC'}).format(new Date(night+'T12:00Z'));
   if(feelOpen)notices.push({key:'morning:'+date,message:{title:'Good morning',body:journalOpen?`How do you feel today? You also haven’t finished ${weekday}’s journal.`:'How do you feel today? One quick rating.',url:HEALTH_URL+'?checkin=1&date='+date+(journalOpen?'&journal_date='+night:''),tag:'daynote-morning'}});
   else if(journalOpen)notices.push({key:'morning:'+date,message:{title:`Finish ${weekday}’s journal`,body:'You haven’t finished it yet. Take a moment to close it out.',url:HEALTH_URL+'?journal=1&date='+night,tag:'daynote-morning'}});
  }
 }
 if(p.reminders&&within(p.reminder_time)&&!j?.completed)notices.push({key:'journal:'+date,message:{title:'Let’s close out your day',body:'Your evening journal is ready. Take a moment to check in.',url:HEALTH_URL+'?journal=1&date='+date,tag:'daynote-journal'}});
 if(p.health_alerts&&time>='09:00'&&time<'21:00'){
  // Bounded, compact current-night cache only; no raw history scan on cron.
  const n=await first<{document:string}>(env,'SELECT document FROM daynote_nightly WHERE date=? AND NOT EXISTS(SELECT 1 FROM daynote_score_dirty WHERE date=?)',date,date),notice=unusualVitals(n?JSON.parse(n.document) as NightScore:null);
  if(notice)notices.push({key:'vitals:'+date,message:{title:'A change in your usual pattern',body:'A few readings look different today. Open Health Journal to review what changed.',url:HEALTH_URL+'?vitals=1&date='+date,tag:'daynote-vitals'}});
 }
 if(p.weekly_summary&&weekly&&new Date(date+'T12:00Z').getUTCDay()===0&&within('19:00')){
  const sent=await first(env,'SELECT key FROM daynote_notice_delivery WHERE key=? AND sent_at IS NOT NULL','summary:'+date);
  if(!sent)notices.push({key:'summary:'+date,message:{title:'Health Journal · weekly review',body:(await weekly()).split('\n').slice(1,4).join(' · '),url:HEALTH_URL,tag:'daynote-summary'}});
 }
 for(const n of notices){
  const claimed=await first(env,'INSERT INTO daynote_notice_delivery(key,created_at,claim_until) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET claim_until=excluded.claim_until WHERE daynote_notice_delivery.sent_at IS NULL AND daynote_notice_delivery.claim_until<? RETURNING key',n.key,at.toISOString(),at.getTime()+120000,at.getTime());if(!claimed)continue;
  try{const result=await deliver(env,{...n.message,health:true});if(result.sent>0){await run(env,'UPDATE daynote_notice_delivery SET sent_at=? WHERE key=?',at.toISOString(),n.key);await run(env,'DELETE FROM daynote_notice_delivery WHERE created_at<?',new Date(at.getTime()-30*86400000).toISOString());}else await run(env,'DELETE FROM daynote_notice_delivery WHERE key=? AND sent_at IS NULL',n.key);}
  catch(e){await run(env,'DELETE FROM daynote_notice_delivery WHERE key=? AND sent_at IS NULL',n.key);throw e;}
 }
}
