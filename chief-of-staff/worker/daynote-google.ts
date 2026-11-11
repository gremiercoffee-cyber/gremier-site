import {refreshNightlyScores} from './daynote-scores';
import {compactSleepMeasurement} from '../shared/daynote-scores';
import {summarizeHeartRate} from '../shared/personal-health';
import type {Env} from './env';
import {all,first,HttpError,now,run,uid} from './db';
import {sealGoogleToken,unsealGoogleToken} from './google';
import {localDate,shiftDate,type Measurement} from '../shared/daynote';
export const HEALTH_SCOPES=['sleep','health_metrics_and_measurements','activity_and_fitness'].map(s=>'https://www.googleapis.com/auth/googlehealth.'+s+'.readonly');
const API='https://health.googleapis.com/v4/users/me';
type Connection={refresh_token:string;access_token:string;expires_at:number;scopes:string;generation:string;verified_at:string;last_success:string|null;last_attempt:string|null;last_error:string|null;backfill_before:string|null};
const row=(env:Env)=>first<Connection>(env,'SELECT * FROM daynote_google WHERE id=1');
export async function daynoteConnection(env:Env){const r=await row(env);return{configured:!!(env.GOOGLE_CLIENT_ID&&env.GOOGLE_CLIENT_SECRET),connected:!!r?.refresh_token,verified_fetch:!!r?.verified_at,last_success:r?.last_success??null,last_error:r?.last_error??null,scopes:r?.scopes.split(' ')??[],backfill_before:r?.backfill_before??null,readiness_available:false,readiness_note:'Google Readiness is not exposed in the current published Google Health API data types. You can enter the score manually; Health Journal does not calculate Google Readiness.'};}
const b64=(bytes:Uint8Array)=>btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const callback=(req:Request)=>new URL('/api/daynote/google/callback',req.url).toString();
export async function healthConnect(env:Env,req:Request){
 if(!env.GOOGLE_CLIENT_ID||!env.GOOGLE_CLIENT_SECRET)throw new HttpError(503,'The existing Google OAuth client is not configured.');
 const state=uid(),verifier=b64(crypto.getRandomValues(new Uint8Array(32))),challenge=b64(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))));
 await run(env,'DELETE FROM daynote_oauth WHERE created_at<?',new Date(Date.now()-4*3600000).toISOString());
 await run(env,'INSERT INTO daynote_oauth(state,verifier,created_at) VALUES(?,?,?)',state,await sealGoogleToken(env,verifier),now());
 const url=new URL('https://accounts.google.com/o/oauth2/v2/auth');url.search=new URLSearchParams({client_id:env.GOOGLE_CLIENT_ID,redirect_uri:callback(req),response_type:'code',access_type:'offline',prompt:'consent select_account',scope:HEALTH_SCOPES.join(' '),state,code_challenge:challenge,code_challenge_method:'S256'}).toString();
 return new Response(JSON.stringify({url:url.toString()}),{headers:{'content-type':'application/json','cache-control':'no-store','set-cookie':`daynote_oauth=${state}; Path=/api/daynote/google; HttpOnly; Secure; SameSite=Lax; Max-Age=900`}});
}
async function tokenExchange(env:Env,params:Record<string,string>){
 const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:env.GOOGLE_CLIENT_ID!,client_secret:env.GOOGLE_CLIENT_SECRET!,...params})});
 if(!r.ok)throw new HttpError(r.status===400?401:502,'Google authorization failed. Reconnect and check the consent/client settings.');
 return await r.json() as {access_token:string;refresh_token?:string;expires_in:number;scope?:string};
}
export async function finishHealthAuth(env:Env,req:Request){
 const q=new URL(req.url).searchParams,state=q.get('state')||'',bound=req.headers.get('cookie')?.match(/(?:^|;\s*)daynote_oauth=([^;]+)/)?.[1];
 const back=(s:string)=>new Response(null,{status:302,headers:{location:new URL('/daynote/?connection='+s,req.url).toString(),'cache-control':'no-store','set-cookie':'daynote_oauth=; Path=/api/daynote/google; HttpOnly; Secure; SameSite=Lax; Max-Age=0'}});
 if(!state||bound!==state)return back('invalid_state');
 const saved=await first<{verifier:string}>(env,'DELETE FROM daynote_oauth WHERE state=? AND created_at>=? RETURNING verifier',state,new Date(Date.now()-4*3600000).toISOString());
 if(!saved)return back('expired_state');if(q.has('error'))return back('consent_denied');if(!q.get('code'))return back('missing_code');
 try{
  const tokens=await tokenExchange(env,{code:q.get('code')!,redirect_uri:callback(req),grant_type:'authorization_code',code_verifier:await unsealGoogleToken(env,saved.verifier)});
  if(!tokens.refresh_token)return back('missing_refresh_token');
  const headers={authorization:'Bearer '+tokens.access_token};
  const identity=await fetch(API+'/identity',{headers});if(!identity.ok)return back(identity.status===400?'account_not_linked':'identity_failed');
  const types=availableTypes(tokens.scope||'');if(!types.length)return back('missing_scopes');
  // A real authorized data request MUST succeed before marking connected or enabling backfill.
  const probe=await fetch(`${API}/dataTypes/${types[0].type}/dataPoints?pageSize=1`,{headers});if(!probe.ok)return back('data_fetch_failed');await probe.json();
  const stamp=now(),generation=uid();
  await run(env,'INSERT OR REPLACE INTO daynote_google(id,refresh_token,access_token,expires_at,scopes,generation,verified_at,last_success,last_attempt,last_error,backfill_before) VALUES(1,?,?,?,?,?,?,NULL,NULL,NULL,?)',await sealGoogleToken(env,tokens.refresh_token),await sealGoogleToken(env,tokens.access_token),Date.now()+tokens.expires_in*1000,tokens.scope||'',generation,stamp,localDate());
  return back('verified');
 }catch{return back('authorization_failed');}
}
export function availableTypes(scopes:string){return[
 {type:'sleep',field:'sleep.interval.end_time',scope:HEALTH_SCOPES[0]},
 {type:'daily-heart-rate-variability',field:'daily_heart_rate_variability.date',scope:HEALTH_SCOPES[1]},
 {type:'daily-resting-heart-rate',field:'daily_resting_heart_rate.date',scope:HEALTH_SCOPES[1]},
 {type:'daily-respiratory-rate',field:'daily_respiratory_rate.date',scope:HEALTH_SCOPES[1]},
 {type:'daily-oxygen-saturation',field:'daily_oxygen_saturation.date',scope:HEALTH_SCOPES[1]},
 {type:'daily-sleep-temperature-derivations',field:'daily_sleep_temperature_derivations.date',scope:HEALTH_SCOPES[1]},
 {type:'exercise',field:'exercise.interval.civil_start_time',scope:HEALTH_SCOPES[2]},
 ].filter(t=>scopes.split(' ').includes(t.scope));}
export function normalizeHealthPoint(type:string,p:any):Measurement|null{
 if(!p||typeof p!=='object')return null;
 const data=type==='sleep'?p.sleep:type==='exercise'?p.exercise:type==='daily-heart-rate-variability'?p.dailyHeartRateVariability:type==='daily-resting-heart-rate'?p.dailyRestingHeartRate:type==='daily-respiratory-rate'?p.dailyRespiratoryRate:type==='daily-oxygen-saturation'?p.dailyOxygenSaturation:p.dailySleepTemperatureDerivations;
 if(!data)return null;const start=data.interval?.startTime??null,end=data.interval?.endTime??null;
 let date=data.date?`${String(data.date.year).padStart(4,'0')}-${String(data.date.month).padStart(2,'0')}-${String(data.date.day).padStart(2,'0')}`:end?localDate(end):start?localDate(start):null;
 if(!date)return null;
 const v=type==='sleep'?data.summary?.minutesAsleep:type==='daily-heart-rate-variability'?data.averageHeartRateVariabilityMilliseconds:type==='daily-resting-heart-rate'?data.beatsPerMinute:type==='daily-respiratory-rate'?data.breathsPerMinute:type==='daily-oxygen-saturation'?data.averagePercentage:type==='daily-sleep-temperature-derivations'&&Number.isFinite(data.nightlyTemperatureCelsius)&&Number.isFinite(data.baselineTemperatureCelsius)?data.nightlyTemperatureCelsius-data.baselineTemperatureCelsius:null;
 const id=typeof p.name==='string'&&p.name.trim()?p.name:`api:${type}:${date}:${start||''}`;
 if(!type.startsWith('daily-')&&!start&&!p.name)return null;
 return{id,type,date,start_at:start,end_at:end,value:v===null||v===undefined||!Number.isFinite(Number(v))?null:Number(v),raw:p};
}
async function access(env:Env,c:Connection){
 if(c.expires_at>Date.now()+60000)return unsealGoogleToken(env,c.access_token);
 const t=await tokenExchange(env,{refresh_token:await unsealGoogleToken(env,c.refresh_token),grant_type:'refresh_token'});
 await run(env,'UPDATE daynote_google SET access_token=?,expires_at=? WHERE id=1 AND generation=?',await sealGoogleToken(env,t.access_token),Date.now()+t.expires_in*1000,c.generation);return t.access_token;
}
export async function healthSync(env:Env,force=false,vitalsOnly=false,historyDays=7,includeHeartRate=false,sleepOnly=false){
 const c=await row(env);if(!c?.refresh_token||!c.verified_at)return{skipped:'Connect Google Health and verify a real fetch first.'};
 if(!force&&c.last_attempt&&Date.parse(c.last_attempt)>Date.now()-4*3600000)return{skipped:'recently checked'};
 const stamp=now(),lease=new Date(Date.now()+240000).toISOString();
 if(!await first(env,"INSERT INTO daynote_settings(key,value) VALUES('sync_lease',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE daynote_settings.value<? RETURNING key",lease,stamp))return{skipped:'sync in progress'};
 if(!sleepOnly)await run(env,'UPDATE daynote_google SET last_attempt=? WHERE id=1 AND generation=?',stamp,c.generation);
 try{
  const token=await access(env,c),today=localDate(),end=shiftDate(today,2),start=shiftDate(today,-Math.min(28,Math.max(7,historyDays))),backfillEnd=c.backfill_before&&c.backfill_before>shiftDate(today,-90)?c.backfill_before:null;
  // First sync recent measurements. Subsequent passes alternate historical chunks and fresh overlap.
  const useBackfill=!vitalsOnly&&!sleepOnly&&!!backfillEnd&&!!c.last_success&&new Date().getUTCMinutes()%30<15;
  const from=useBackfill?shiftDate(backfillEnd!,-7):start,to=useBackfill?backfillEnd!:end;
  const records:Measurement[]=[],warnings:string[]=[],successTypes:string[]=[];const streamCounts:Record<string,{received:number;parsed:number}>={};
  const streams=sleepOnly?availableTypes(c.scopes).filter(t=>t.type==='sleep'):[...availableTypes(c.scopes).filter(t=>!vitalsOnly||t.type.startsWith('daily-')),...(!vitalsOnly&&includeHeartRate&&c.scopes.split(' ').includes(HEALTH_SCOPES[1])?[{type:'heart-rate',field:'heart_rate.sample_time.physical_time',scope:HEALTH_SCOPES[1]}]:[])];
  for(const t of streams){
   let pageToken:string|undefined,pages=0;const collected:Measurement[]=[],hrPoints:any[]=[];const streamFrom=t.type==='heart-rate'?shiftDate(today,-2):from,streamTo=t.type==='heart-rate'?shiftDate(today,1):to;
   do{
    const daily=t.field.endsWith('.date')||t.field.includes('.civil_');const filter=`${t.field} >= "${daily?streamFrom:streamFrom+'T00:00:00Z'}" AND ${t.field} < "${daily?streamTo:streamTo+'T00:00:00Z'}"`;
    const params=new URLSearchParams({pageSize:t.type==='heart-rate'?'10000':'25',filter,...(pageToken?{pageToken}:{})});
    let response:Response|undefined;
    for(let attempt=0;attempt<3;attempt++){response=await fetch(`${API}/dataTypes/${t.type}/dataPoints?${params}`,{headers:{authorization:'Bearer '+token}});if(response.status!==429&&response.status<500)break;if(attempt<2)await new Promise(r=>setTimeout(r,150*(attempt+1)));}
    if(response!.status===401)throw new HttpError(401,'Google access was revoked or expired. Reconnect.');
    if(!response!.ok){warnings.push(`${t.type}: Google returned ${response!.status}. Check granted scopes and account access.`);break;}
    const data=await response!.json() as {dataPoints?:any[];nextPageToken?:string};
    const counts=streamCounts[t.type]??{received:0,parsed:0};counts.received+=(data.dataPoints||[]).length;counts.parsed+=(data.dataPoints||[]).filter(p=>!!normalizeHealthPoint(t.type,p)).length;streamCounts[t.type]=counts;
    if(t.type==='heart-rate')hrPoints.push(...(data.dataPoints||[]));else collected.push(...(data.dataPoints||[]).map(p=>normalizeHealthPoint(t.type,p)).filter((p):p is Measurement=>!!p));pageToken=data.nextPageToken;pages++;
    if(pages>=12&&pageToken){warnings.push(`${t.type}: history exceeds this sync window; other measurements will continue syncing.`);break;}
    if(!pageToken){if(t.type!=='heart-rate'&&streamCounts[t.type].parsed<streamCounts[t.type].received){warnings.push(`${t.type}: incomplete parsing; existing stream kept.`);}else{records.push(...(t.type==='heart-rate'?summarizeHeartRate(hrPoints,'google_api_hr',stamp):collected));successTypes.push(t.type);}}
   }while(pageToken);
  }
  // A disconnect while requests were in flight must prevent subsequent writes.
  if((await row(env))?.generation!==c.generation)return{skipped:'disconnected'};
  const statements:D1PreparedStatement[]=[];
  // Successful windows reconcile missing API IDs, then upsert only changed payloads.
  // Never touch owner archives. No delete/reinsert churn on identical repeated syncs.
  for(const type of successTypes){
   const storedType=type==='heart-rate'?'heart-rate-summary':type,column=type==='sleep'?'end_at':type==='exercise'?'start_at':'date',daily=column==='date';
   const ids=records.filter(m=>m.type===storedType).map(m=>m.id);
   const lo=type==='heart-rate'?shiftDate(today,-2):daily?from:from+'T00:00:00Z',hi=type==='heart-rate'?shiftDate(today,1):daily?to:to+'T00:00:00Z';
   statements.push(env.DB.prepare(`DELETE FROM daynote_measurements WHERE type=? AND id NOT LIKE 'takeout:%' AND ${column}>=? AND ${column}<? AND id NOT IN (SELECT value FROM json_each(?)) AND EXISTS(SELECT 1 FROM daynote_google WHERE generation=?)`).bind(storedType,lo,hi,JSON.stringify(ids),c.generation));
  }
  for(const record of records){const m=record.type==='sleep'?compactSleepMeasurement(record):record;
   if(record.type==='sleep')statements.push(env.DB.prepare("INSERT INTO daynote_legacy_sleep(id,raw,source_updated_at) SELECT id,raw,updated_at FROM daynote_measurements WHERE id=? AND json_type(raw,'$.sleep.stages')='array' AND EXISTS(SELECT 1 FROM daynote_google WHERE generation=?) ON CONFLICT(id) DO NOTHING").bind(m.id,c.generation));
   statements.push(env.DB.prepare('INSERT INTO daynote_measurements(id,type,date,start_at,end_at,value,raw,updated_at) SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM daynote_google WHERE generation=?) ON CONFLICT(id) DO UPDATE SET date=excluded.date,start_at=excluded.start_at,end_at=excluded.end_at,value=excluded.value,raw=excluded.raw,updated_at=excluded.updated_at WHERE daynote_measurements.date IS NOT excluded.date OR daynote_measurements.start_at IS NOT excluded.start_at OR daynote_measurements.end_at IS NOT excluded.end_at OR daynote_measurements.value IS NOT excluded.value OR daynote_measurements.raw IS NOT excluded.raw').bind(m.id,m.type,m.date,m.start_at,m.end_at,m.value,JSON.stringify(m.raw),stamp,c.generation));
  }
  if(successTypes.length)statements.push(env.DB.prepare('UPDATE daynote_google SET last_success=?,last_error=?,backfill_before=? WHERE id=1 AND generation=?').bind(stamp,warnings.join(' ')||null,useBackfill&&!warnings.some(w=>!/^daily-(respiratory-rate|oxygen-saturation|sleep-temperature-derivations):/.test(w))?from:c.backfill_before, c.generation));
  else statements.push(env.DB.prepare('UPDATE daynote_google SET last_error=? WHERE id=1 AND generation=?').bind(warnings.join(' ')||'No authorized streams.',c.generation));
  if(statements.length>450)throw new HttpError(502,'Sync window is too large; existing data kept.');
  await env.DB.batch(statements);
  const score_update=await refreshNightlyScores(env,today).catch(()=>({pending:true}));
  return{score_update,synced:successTypes,records:records.length,warnings,range:{from,to},backfill_verified:true,stream_counts:streamCounts};
 }catch(e){const revoked=e instanceof HttpError&&e.status===401;await run(env,`UPDATE daynote_google SET last_error=?${revoked?",refresh_token='',access_token=''":''} WHERE id=1 AND generation=?`,revoked?'Authorization expired or revoked. Reconnect Google Health.':'Sync failed; existing data kept. Retry later.',c.generation);throw e;}
 finally{await run(env,"DELETE FROM daynote_settings WHERE key='sync_lease' AND value=?",lease);}
}
export async function disconnectHealth(env:Env){await env.DB.batch([env.DB.prepare('DELETE FROM daynote_google'),env.DB.prepare('DELETE FROM daynote_oauth')]);/* This OAuth client is shared with Chief of Staff: local removal stops syncing without revoking its Workspace grants. */}
