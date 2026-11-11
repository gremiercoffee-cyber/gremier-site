import type {Env} from './env';
import {all,first,run,now,uid,HttpError} from './db';
import {sealGoogleToken as seal,unsealGoogleToken as unseal} from './google';
import {localDate,shiftDate,type Measurement} from '../shared/daynote';
const API='https://api.prod.whoop.com/developer/v2',TOKEN='https://api.prod.whoop.com/oauth/oauth2/token';
export const WHOOP_SCOPES='read:cycles read:recovery read:sleep offline';
type Connection={client_id:string;client_secret:string;access_token:string|null;refresh_token:string|null;expires_at:number;scopes:string;generation:string;verified_at:string|null;last_success:string|null;last_attempt:string|null;last_error:string|null;backfill_before:string|null};
const connection=(env:Env)=>first<Connection>(env,'SELECT * FROM daynote_whoop WHERE id=1');
type History={end:string;streams:Record<string,{next:string|null;done:boolean}>;earliest:string|null};
async function historyState(env:Env):Promise<History|null>{const row=await first<{value:string}>(env,"SELECT value FROM daynote_settings WHERE key='whoop_history'");return row?JSON.parse(row.value):null;}
export async function whoopStatus(env:Env){const c=await connection(env),h=await historyState(env);return{configured:!!c,connected:!!c?.refresh_token,verified_fetch:!!c?.verified_at,last_success:c?.last_success??null,last_error:c?.last_error??null,backfill_before:c?.backfill_before??null,scopes:c?.scopes??'',history_complete:!!h&&Object.values(h.streams).every(s=>s.done),history_earliest:h?.earliest??null};}
export async function configureWhoop(env:Env,p:any){
 if(!env.GOOGLE_CLIENT_SECRET)throw new HttpError(503,'Existing server credential encryption is not configured.');
 if(typeof p.client_id!=='string'||!p.client_id.trim()||p.client_id.length>300||typeof p.client_secret!=='string'||!p.client_secret.trim()||p.client_secret.length>1000)throw new HttpError(400,'Enter the WHOOP app client ID and client secret.');
 await env.DB.batch([env.DB.prepare('DELETE FROM daynote_whoop_oauth'),env.DB.prepare('INSERT OR REPLACE INTO daynote_whoop(id,client_id,client_secret,generation) VALUES(1,?,?,?)').bind(p.client_id.trim(),await seal(env,p.client_secret.trim()),uid())]);return{ok:true};
}
const cb=(req:Request)=>new URL('/api/daynote/whoop/callback',req.url).toString();
export async function connectWhoop(env:Env,req:Request){
 const c=await connection(env);if(!c)throw new HttpError(503,'Configure your WHOOP developer app in Settings first.');
 const state=uid().replaceAll('-','');await run(env,'DELETE FROM daynote_whoop_oauth WHERE created_at<?',new Date(Date.now()-900000).toISOString());await run(env,'INSERT INTO daynote_whoop_oauth(state,created_at) VALUES(?,?)',state,now());
 const url=new URL('https://api.prod.whoop.com/oauth/oauth2/auth');url.search=new URLSearchParams({client_id:c.client_id,redirect_uri:cb(req),response_type:'code',scope:WHOOP_SCOPES,state}).toString();
 return new Response(JSON.stringify({url:url.toString()}),{headers:{'content-type':'application/json','cache-control':'no-store','set-cookie':`whoop_oauth=${state}; Path=/api/daynote/whoop; HttpOnly; Secure; SameSite=Lax; Max-Age=900`}});
}
async function exchange(env:Env,c:Connection,p:Record<string,string>){const r=await fetch(TOKEN,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:c.client_id,client_secret:await unseal(env,c.client_secret),...p})});if(!r.ok)throw new HttpError(r.status===400||r.status===401?401:502,'WHOOP authorization failed. Reconnect in Settings.');const t=await r.json() as any;if(!t.access_token||!t.refresh_token||!Number.isFinite(t.expires_in))throw new HttpError(502,'WHOOP returned incomplete credentials.');return t;}
async function get(path:string,token:string){let r:Response|undefined;for(let i=0;i<3;i++){r=await fetch(API+path,{headers:{authorization:'Bearer '+token}});if(r.status!==429&&r.status<500)break;if(i<2)await new Promise(resolve=>setTimeout(resolve,200*(i+1)));}if(!r!.ok)throw new HttpError(r!.status===401?401:502,`WHOOP data fetch failed (${r!.status}).`);return r!.json() as Promise<any>;}
export async function finishWhoopAuth(env:Env,req:Request){
 const q=new URL(req.url).searchParams,state=q.get('state')||'',cookie=req.headers.get('cookie')?.match(/(?:^|;\s*)whoop_oauth=([^;]+)/)?.[1];
 const back=(s:string)=>new Response(null,{status:302,headers:{location:new URL('/daynote/?connection=whoop_'+s,req.url).toString(),'cache-control':'no-store','set-cookie':'whoop_oauth=; Path=/api/daynote/whoop; HttpOnly; Secure; SameSite=Lax; Max-Age=0'}});
 if(!state||state!==cookie)return back('invalid_state');const saved=await first(env,'DELETE FROM daynote_whoop_oauth WHERE state=? AND created_at>=? RETURNING state',state,new Date(Date.now()-900000).toISOString());if(!saved)return back('expired_state');if(q.has('error'))return back('consent_denied');if(!q.get('code'))return back('missing_code');
 const c=await connection(env);if(!c)return back('not_configured');
 try{const t=await exchange(env,c,{grant_type:'authorization_code',code:q.get('code')!,redirect_uri:cb(req)});if(!['read:cycles','read:recovery','read:sleep'].every(s=>String(t.scope||'').split(' ').includes(s)))return back('missing_scopes');
 // Probe all required streams before storing a verified connection. Empty collections are valid, not invented observations.
 const userIds=new Set<string>();for(const path of ['/cycle?limit=1','/recovery?limit=1','/activity/sleep?limit=1']){const data=await get(path,t.access_token);if(!Array.isArray(data.records))return back('invalid_data');for(const p of data.records)if(p.user_id)userIds.add(String(p.user_id));}
 const existing=await all<any>(env,"SELECT DISTINCT json_extract(raw,'$.user_id') user_id FROM daynote_measurements WHERE type LIKE 'whoop_%'");for(const e of existing)if(e.user_id)userIds.add(String(e.user_id));if(userIds.size>1)return back('account_mismatch');
 const saved=await first(env,'UPDATE daynote_whoop SET access_token=?,refresh_token=?,expires_at=?,scopes=?,generation=?,verified_at=?,last_success=NULL,last_attempt=NULL,last_error=NULL,backfill_before=? WHERE id=1 AND generation=? RETURNING id',await seal(env,t.access_token),await seal(env,t.refresh_token),Date.now()+t.expires_in*1000,t.scope,uid(),now(),localDate(),c.generation);return back(saved?'verified':'configuration_changed');
 }catch{return back('authorization_failed');}
}
export function normalizeWhoop(kind:string,p:any):Measurement|null{
 if(!p||!['cycle','sleep','recovery'].includes(kind)||![String,Number].includes((kind==='recovery'?p.cycle_id:p.id)?.constructor)||kind==='cycle'&&(!p.start||!Number.isFinite(Date.parse(p.start))))return null;
 if(p.score_state!=='SCORED'||!p.score)return null;const date=p.end?localDate(p.end):p.start?localDate(p.start):p.created_at?localDate(p.created_at):null;if(!date)return null;
 let value=kind==='cycle'?p.score.strain:kind==='recovery'?p.score.recovery_score:null;
 if(kind==='sleep'){const s=p.score.stage_summary;const parts=[s?.total_light_sleep_time_milli,s?.total_slow_wave_sleep_time_milli,s?.total_rem_sleep_time_milli];if(parts.every(v=>typeof v==='number'&&v>=0))value=parts.reduce((a,b)=>a+b,0)/60000;}
 if(!Number.isFinite(value)||value<0||kind==='cycle'&&value>21||kind==='recovery'&&value>100)return null;
 return{id:`whoop:${kind}:${kind==='recovery'?p.cycle_id:p.id}`,type:'whoop_'+kind,date:kind==='cycle'?localDate(p.start):date,start_at:p.start||null,end_at:p.end||null,value,raw:p};
}
export async function syncWhoop(env:Env,force=false){
 const c=await connection(env);if(!c?.refresh_token||!c.verified_at)return{skipped:'Connect WHOOP first.'};if(!force&&c.last_attempt&&Date.parse(c.last_attempt)>Date.now()-(c.backfill_before?4:24)*3600000)return{skipped:'recently checked'};
 const stamp=now(),lease=new Date(Date.now()+240000).toISOString();if(!await first(env,"INSERT INTO daynote_settings(key,value) VALUES('whoop_lease',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE daynote_settings.value<? RETURNING key",lease,stamp))return{skipped:'sync in progress'};
 await run(env,'UPDATE daynote_whoop SET last_attempt=? WHERE id=1 AND generation=?',stamp,c.generation);
 try{let token=await unseal(env,c.access_token!);if(c.expires_at<Date.now()+60000){const t=await exchange(env,c,{grant_type:'refresh_token',refresh_token:await unseal(env,c.refresh_token),scope:'offline'});const saved=await first(env,'UPDATE daynote_whoop SET access_token=?,refresh_token=?,expires_at=? WHERE id=1 AND generation=? RETURNING id',await seal(env,t.access_token),await seal(env,t.refresh_token),Date.now()+t.expires_in*1000,c.generation);if(!saved)return{skipped:'disconnected'};token=t.access_token;}
 const previous=await historyState(env),history:History=previous||{end:stamp,streams:{cycle:{next:null,done:false},sleep:{next:null,done:false},recovery:{next:null,done:false}},earliest:null};
 const historical=!Object.values(history.streams).every(s=>s.done),today=localDate(),from=shiftDate(today,-7),to=shiftDate(today,2),records:Measurement[]=[],batches:D1PreparedStatement[]=[];
 for(const [kind,path]of [['cycle','/cycle'],['sleep','/activity/sleep'],['recovery','/recovery']]){
  if(historical&&history.streams[kind].done)continue;
  let next=historical?history.streams[kind].next||'':'',pages=0;
  do{
   const params=new URLSearchParams({limit:'25',...(historical?{end:history.end}:{start:from+'T00:00:00Z',end:to+'T00:00:00Z'}),...(next?{nextToken:next}:{})});
   const data=await get(path+'?'+params,token);if(!Array.isArray(data.records))throw new HttpError(502,'WHOOP returned an invalid collection.');
   for(const p of data.records){const m=normalizeWhoop(kind,p);if(m){records.push(m);if(!history.earliest||m.date<history.earliest)history.earliest=m.date;}}
   next=data.next_token||'';
   if(historical){history.streams[kind]={next:next||null,done:!next};break;}
   if(++pages>=8&&next)throw new HttpError(502,'WHOOP sync window is too large; retry.');
  }while(next);
  if(!historical){
   const column=kind==='cycle'?'start_at':kind==='sleep'?'end_at':"json_extract(raw,'$.created_at')";
   // Reconcile only after the complete window has fetched successfully. Retain
   // unchanged IDs so a repeated sync does not delete and rebuild their indexes.
   const ids=JSON.stringify(records.filter(m=>m.type==='whoop_'+kind).map(m=>m.id));
   batches.push(env.DB.prepare(`DELETE FROM daynote_measurements WHERE type=? AND ${column}>=? AND ${column}<? AND id NOT IN (SELECT value FROM json_each(?)) AND EXISTS(SELECT 1 FROM daynote_whoop WHERE generation=? AND refresh_token IS NOT NULL)`).bind('whoop_'+kind,from+'T00:00:00Z',to+'T00:00:00Z',ids,c.generation));
  }
 }
 const users=new Set(records.map(m=>String(m.raw.user_id)));for(const e of await all<any>(env,"SELECT DISTINCT json_extract(raw,'$.user_id') user_id FROM daynote_measurements WHERE type LIKE 'whoop_%'"))users.add(String(e.user_id));if(users.size>1)throw new HttpError(409,'Different WHOOP accounts cannot be combined.');
 for(const m of records)batches.push(env.DB.prepare('INSERT INTO daynote_measurements(id,type,date,start_at,end_at,value,raw,updated_at) SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM daynote_whoop WHERE generation=? AND refresh_token IS NOT NULL) ON CONFLICT(id) DO UPDATE SET date=excluded.date,start_at=excluded.start_at,end_at=excluded.end_at,value=excluded.value,raw=excluded.raw,updated_at=excluded.updated_at WHERE daynote_measurements.date IS NOT excluded.date OR daynote_measurements.start_at IS NOT excluded.start_at OR daynote_measurements.end_at IS NOT excluded.end_at OR daynote_measurements.value IS NOT excluded.value OR daynote_measurements.raw IS NOT excluded.raw').bind(m.id,m.type,m.date,m.start_at,m.end_at,m.value,JSON.stringify(m.raw),stamp,c.generation));
 if(historical)batches.push(env.DB.prepare("INSERT INTO daynote_settings(key,value) SELECT 'whoop_history',? WHERE EXISTS(SELECT 1 FROM daynote_whoop WHERE generation=? AND refresh_token IS NOT NULL) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(JSON.stringify(history),c.generation));
 if(batches.length>450)throw new HttpError(502,'WHOOP sync batch exceeds limit.');batches.push(env.DB.prepare('UPDATE daynote_whoop SET last_success=?,last_error=NULL,backfill_before=? WHERE id=1 AND generation=? AND refresh_token IS NOT NULL').bind(stamp,Object.values(history.streams).every(s=>s.done)?null:history.earliest,c.generation));await env.DB.batch(batches);return{ok:true,records:records.length,history_complete:Object.values(history.streams).every(s=>s.done)};

 }catch(e){const revoked=e instanceof HttpError&&e.status===401;await run(env,`UPDATE daynote_whoop SET last_error=?${revoked?',access_token=NULL,refresh_token=NULL':''} WHERE id=1 AND generation=?`,revoked?'WHOOP access expired or was revoked. Reconnect.':'WHOOP sync failed. Retry; previous data is retained.',c.generation);throw new HttpError(revoked?401:502,revoked?'Reconnect WHOOP.':'WHOOP sync failed. Previous data is safe.');}
 finally{await run(env,"DELETE FROM daynote_settings WHERE key='whoop_lease' AND value=?",lease);}
}
export async function disconnectWhoop(env:Env,removeConfig=false){await env.DB.batch([env.DB.prepare(removeConfig?'DELETE FROM daynote_whoop':'UPDATE daynote_whoop SET access_token=NULL,refresh_token=NULL,verified_at=NULL,generation=? WHERE id=1').bind(...(removeConfig?[]:[uid()])),env.DB.prepare('DELETE FROM daynote_whoop_oauth')]);return{ok:true};}
