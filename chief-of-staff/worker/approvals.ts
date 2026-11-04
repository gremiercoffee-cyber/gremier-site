/** One approvals list for the app (and a read-only view for ChatGPT): emails, WhatsApps, alumni sheet updates,
 * AI jobs and deletions, each as a short card. Deciding goes to the system that owns the approval, unchanged. */
import type {Env} from './env';
import {all,first,HttpError} from './db';
import type {ApprovalCard} from '../shared/types';

const short=(s:unknown,n:number)=>{const t=String(s??'').replace(/\s+/g,' ').trim();return t.length>n?t.slice(0,n-1).trimEnd()+'…':t;};
const json=(s:string|null)=>{try{return s?JSON.parse(s):{};}catch{return {};}};
const date=(s:unknown)=>{const d=new Date(String(s??''));return Number.isFinite(d.getTime())?d.toLocaleDateString('en-GB',{timeZone:'Asia/Jerusalem',weekday:'short',day:'numeric',month:'short'}):'';};

function actionCard(a:{id:string;action:string;payload:string;description:string;created_at:string}):ApprovalCard{
 const p=json(a.payload),base={id:a.id,source:'action' as const,created_at:a.created_at};
 if(a.action==='send_gmail_draft')return{...base,kind:'email',title:`Email to ${short(p.to,60)}`,detail:short(p.subject,90),preview:p.preview?short(p.preview,280):undefined,meta:p.account?`From ${p.account}`:undefined,link:p.account?`https://mail.google.com/mail/?authuser=${encodeURIComponent(p.account)}#drafts`:undefined,approve:'Send'};
 if(a.action==='share_file')return{...base,kind:'share',title:`Share a file with ${short(p.email,60)}`,detail:short(a.description,120),approve:'Share'};
 if(/^delete_|^forget_/.test(a.action))return{...base,kind:'delete',title:short(a.description,90),approve:'Delete'};
 if(a.action.startsWith('ai_')){const [first,...rest]=a.description.split('\n');return{...base,kind:'ai',title:short(first,90),detail:rest.length?short(rest.join(' '),160):undefined,approve:'Run'};}
 return{...base,kind:'other',title:short(a.description,120),approve:'Approve'};
}

export async function listApprovals(env:Env):Promise<ApprovalCard[]>{
 const [actions,whatsapps,alumni]=await Promise.all([
  all<any>(env,"SELECT id,action,payload,description,created_at FROM pending_actions WHERE status='pending' ORDER BY created_at DESC LIMIT 50"),
  all<any>(env,"SELECT id,recipient,text,created_at FROM whatsapp_outbox WHERE status='pending' ORDER BY created_at DESC LIMIT 50").catch(()=>[]),
  all<any>(env,"SELECT id,sender,said_at,observation,text FROM alumni_visit_events WHERE status='awaiting_approval' ORDER BY said_at LIMIT 50").catch(()=>[]),
 ]);
 const cards:ApprovalCard[]=[
  ...actions.map(actionCard),
  ...whatsapps.map(w=>({id:w.id,source:'whatsapp' as const,kind:'whatsapp' as const,title:`WhatsApp to ${short(w.recipient,60)}`,preview:short(w.text,280),approve:'Send',created_at:w.created_at})),
  ...alumni.map(e=>{const o=json(e.observation);const when=[o.arrival&&`arrives ${date(o.arrival)}`,o.leaving&&`leaves ${date(o.leaving)}`].filter(Boolean).join(' · ');
   return{id:e.id,source:'alumni' as const,kind:'alumni' as const,title:`Alumni visit: ${short(o.name||e.sender,60)}`,detail:[when||'No dates yet',o.uncertain&&o.reason?`Check: ${short(o.reason,120)}`:''].filter(Boolean).join(' · '),preview:short(e.text,280),meta:'Adds to the alumni sheet',approve:'Add to sheet',created_at:e.said_at};}),
 ];
 return cards.sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)));
}

export async function decideApproval(env:Env,source:string,id:string,decision:string){
 if(!['approve','reject'].includes(decision))throw new HttpError(400,'decision must be approve or reject');
 if(source==='action'){const {decidePendingAction}=await import('./assistant');return decidePendingAction(env,id,decision);}
 if(source==='whatsapp'){const {decideOutbox}=await import('./whatsapp');return{ok:true,outcome:await decideOutbox(env,id,decision==='approve'?'approved':'cancelled')};}
 if(source==='alumni'){
  const e=await first<{approval_hash:string}>(env,"SELECT approval_hash FROM alumni_visit_events WHERE id=? AND status='awaiting_approval'",id);
  if(!e)throw new HttpError(409,'This update is no longer waiting for approval.');
  const {decideAlumni}=await import('./alumni-visits');const r=await decideAlumni(env,id,{decision,approval_hash:e.approval_hash});
  return{ok:true,outcome:r.status==='approved'?'Approved. The sheet updates on the next run.':'Declined. The sheet was not changed.'};
 }
 throw new HttpError(404,'Unknown approval.');
}

/** New approvals buzz the phone once (app notification, never Telegram). The card itself lives on Today. */
export async function announceApprovals(env:Env){
 const {run,getSettings}=await import('./db');const {sendPush}=await import('./push');const {isShabbat}=await import('./shabbat');
 const mark=await first<{value:string}>(env,"SELECT value FROM settings WHERE key='approvals_announced'");
 const since=mark?.value??new Date(Date.now()-10*60_000).toISOString();
 if(isShabbat((await getSettings(env)).timezone||'Asia/Jerusalem'))return 0;
 const fresh=(await listApprovals(env)).filter(c=>String(c.created_at)>since);
 await run(env,"INSERT OR REPLACE INTO settings (key,value) VALUES ('approvals_announced',?)",new Date().toISOString());
 if(!fresh.length)return 0;
 const title=fresh.length===1?`Needs your OK: ${fresh[0].title}`:`${fresh.length} things need your OK`;
 const body=fresh.length===1?(fresh[0].detail??fresh[0].preview??''):fresh.slice(0,3).map(c=>c.title).join(' · ');
 await sendPush(env,{title,body:short(body,160),url:'/?tab=today',tag:'cos:approvals'});
 return fresh.length;
}
