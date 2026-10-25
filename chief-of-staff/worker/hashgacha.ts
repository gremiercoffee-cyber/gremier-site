import type {Env} from './env';
import type {HashgachaCampaign,HashgachaTarget} from '../shared/hashgacha';
import {all,first,HttpError,localParts,now,run,uid,updateItem,getSettings} from './db';
import {notify} from './push';
import {isShabbat} from './shabbat';
import {attentionState,blockWindow} from './attention';
import {isDrivingBlock} from './work-context';
export interface SourceReport {class_id:number;class_name:string;rabbi_name:string|null;rabbi_email:string|null;seder:string;week_of:string;expected:number;submitted:number;last_submission:string|null}
export const hashgachaConfigured=(env:Env)=>!!env.HASHGACHA_READ_KEY&&!!env.HASHGACHA_ANON_KEY;
export function reportState(row:SourceReport|undefined,week:string):HashgachaTarget['state']{
 if(!row||row.week_of!==week||row.expected<=0||!Number.isInteger(row.expected)||!Number.isInteger(row.submitted)||row.submitted<0||row.submitted>row.expected)return 'unknown';
 if(row.submitted===0)return 'missing';
 if(!row.last_submission||!Number.isFinite(Date.parse(row.last_submission)))return 'unknown';
 return row.submitted===row.expected?'received':'partial';
}
export async function sourceReports(env:Env,week:string):Promise<SourceReport[]>{
 if(!/^\d{4}-\d{2}-\d{2}$/.test(week)||new Date(`${week}T12:00:00Z`).getUTCDay()!==0)throw new HttpError(400,'Supply the Sunday reporting-week date.');
 if(!hashgachaConfigured(env))throw new Error('Hashgacha is not connected.');
 const response=await fetch('https://uamogipdeoonteezduvs.supabase.co/rest/v1/rpc/cos_hashgacha_status',{method:'POST',headers:{'content-type':'application/json',apikey:env.HASHGACHA_ANON_KEY!,authorization:`Bearer ${env.HASHGACHA_ANON_KEY}`},body:JSON.stringify({access_key:env.HASHGACHA_READ_KEY,week_date:week}),signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw new Error(`Hashgacha status check failed (${response.status}).`);
 const rows=await response.json() as SourceReport[];
 if(!Array.isArray(rows)||rows.some(r=>!Number.isInteger(r.class_id)||r.week_of!==week||!Number.isInteger(r.expected)||!Number.isInteger(r.submitted))||new Set(rows.map(r=>r.class_id)).size!==rows.length)throw new Error('Hashgacha returned an invalid reporting snapshot.');
 return rows;
}
export async function hashgachaCampaigns(env:Env):Promise<HashgachaCampaign[]>{
 const campaigns=await all<Omit<HashgachaCampaign,'targets'>>(env,"SELECT * FROM hashgacha_campaigns ORDER BY week_of DESC,created_at DESC");
 return Promise.all(campaigns.map(async c=>({...c,targets:await all<HashgachaTarget>(env,'SELECT t.*,i.status AS item_status,i.muted,i.nudge_after,i.due_at FROM hashgacha_targets t JOIN items i ON i.id=t.item_id WHERE campaign_id=? ORDER BY t.name,t.class_id',c.id)})));
}
export async function trackHashgacha(env:Env,p:{week_of:string;label?:string;project_id?:string;bindings:{class_id:number;item_id:string}[]}){
 if(!Array.isArray(p.bindings)||!p.bindings.length)throw new HttpError(400,'Choose the report follow-up tasks to track.');
 const rows=await sourceReports(env,p.week_of),classes=new Set<number>(),items=new Set<string>();
 const bindings=[];
 for(const b of p.bindings){if(classes.has(b.class_id)||items.has(b.item_id))throw new HttpError(400,'Each class and task can only be mapped once.');classes.add(b.class_id);items.add(b.item_id);
  const row=rows.find(r=>r.class_id===b.class_id),item=await first<{id:string;project_id:string|null}>(env,"SELECT id,project_id FROM items WHERE id=? AND status='open'",b.item_id);
  if(!row||!item||p.project_id&&item.project_id!==p.project_id)throw new HttpError(400,'Use the correct existing report follow-up task and class.');
  if(await first(env,'SELECT 1 FROM hashgacha_targets WHERE item_id=?',b.item_id))throw new HttpError(400,'That task is already tracked.');bindings.push({...b,row});
 }
 const id=uid(),t=now();await run(env,'INSERT INTO hashgacha_campaigns(id,week_of,label,project_id,created_at,updated_at) VALUES(?,?,?,?,?,?)',id,p.week_of,p.label??`Hashgacha — week of ${p.week_of}`,p.project_id??null,t,t);
 for(const b of bindings){await run(env,'INSERT INTO hashgacha_targets(campaign_id,class_id,name,email,item_id) VALUES(?,?,?,?,?)',id,b.class_id,b.row.rabbi_name??b.row.class_name,b.row.rabbi_email,b.item_id);await run(env,"UPDATE items SET completion_source='hashgacha',reply_required=0 WHERE id=?",b.item_id);await run(env,'UPDATE nudges SET dismissed=1 WHERE item_id=?',b.item_id);}
 await syncHashgacha(env,{remind:false});return {id,status:'tracking',week_of:p.week_of};
}
/** Poll exact bound periods; never infer a report from an email, count admin edits, or roll into a new week. */
export async function syncHashgacha(env:Env,opts:{remind?:boolean}={}){
 if(!hashgachaConfigured(env))return {skipped:true};
 const campaigns=(await hashgachaCampaigns(env)).filter(c=>c.status==='active');
 const snapshots=new Map<string,Promise<SourceReport[]>>();
 for(const c of campaigns){
  try{
   let promise=snapshots.get(c.week_of);if(!promise){promise=sourceReports(env,c.week_of);snapshots.set(c.week_of,promise);}const rows=await promise;
   const current:HashgachaTarget[]=[];
   for(const target of c.targets){const row=rows.find(r=>r.class_id===target.class_id),state=reportState(row,c.week_of);
    // Once verified received, keep that receipt even if the live roster later changes.
    const confirmed=target.state==='received';const next=confirmed?target:{...target,state,expected:row?.expected??null,submitted:row?.submitted??null,last_submission:row?.last_submission??null};
    current.push(next);await run(env,'UPDATE hashgacha_targets SET state=?,expected=?,submitted=?,last_submission=? WHERE campaign_id=? AND class_id=?',next.state,next.expected,next.submitted,next.last_submission,c.id,target.class_id);
    if(next.state==='received'){const item=await first<{status:string}>(env,'SELECT status FROM items WHERE id=?',target.item_id);if(item?.status==='open')await updateItem(env,target.item_id,{status:'done'});}
   }
   const complete=current.length>0&&current.every(t=>t.state==='received'),stamp=now();
   await run(env,'UPDATE hashgacha_campaigns SET status=?,last_checked_at=?,last_error=NULL,updated_at=? WHERE id=?',complete?'completed':'active',stamp,stamp,c.id);
   const missing=current.filter(t=>(t.state==='missing'||t.state==='partial')&&t.item_status==='open'&&!t.muted&&(!t.nudge_after||Date.parse(t.nudge_after)<=Date.now())&&(!t.due_at||Date.parse(t.due_at)<=Date.now())),unknown=current.filter(t=>t.state==='unknown');
   const body=[missing.length?`Still missing: ${missing.map(t=>t.name+(t.state==='partial'?` (${t.submitted}/${t.expected})`:'')).join(', ')}.`:'',unknown.length?`Could not verify: ${unknown.map(t=>t.name).join(', ')}.`:''].filter(Boolean).join(' ');
   const title=`Hashgacha: ${current.filter(t=>t.state==='received').length} of ${current.length} reports received`;
   if(complete)await run(env,"UPDATE nudges SET dismissed=1 WHERE topic_key LIKE ?",`hashgacha:${c.id}:%`);
   else await run(env,"UPDATE nudges SET title=?,body=?,updated_at=? WHERE dismissed=0 AND topic_key LIKE ?",title,body,stamp,`hashgacha:${c.id}:%`);
   if(!complete&&opts.remind!==false&&missing.length){const tz=(await getSettings(env)).timezone,local=localParts(tz),attention=await attentionState(env);
    const driving=[...attention.blocks.values()].some(b=>isDrivingBlock(b)&&blockWindow(b,tz,attention.at).current);
    if(local.hour>=10&&local.hour<21&&!driving&&!isShabbat(tz)&&c.last_reminded_date!==local.date){
     await notify(env,'hashgacha',title,body,null,'/',{topic:`hashgacha:${c.id}:${local.date}`});await run(env,'UPDATE hashgacha_campaigns SET last_reminded_date=? WHERE id=?',local.date,c.id);
    }
   }
  }catch(e){await run(env,'UPDATE hashgacha_campaigns SET last_error=? WHERE id=?',(e as Error).message.slice(0,200),c.id);}
 }
 return {checked:campaigns.length};
}
