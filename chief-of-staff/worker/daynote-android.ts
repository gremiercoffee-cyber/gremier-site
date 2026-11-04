import type {Env} from './env';
import {all,first,HttpError,now,run,uid} from './db';
import {localDate,validDate} from '../shared/daynote';
const response=(v:unknown,status=200)=>new Response(JSON.stringify(v),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
const random=()=>Array.from(crypto.getRandomValues(new Uint8Array(24)),b=>b.toString(16).padStart(2,'0')).join('');
export const androidHash=async(s:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))),b=>b.toString(16).padStart(2,'0')).join('');
export async function androidOwnerRoute(env:Env,req:Request,path:string){
 if(path==='/android/devices'&&req.method==='GET')return response({devices:await all(env,'SELECT id,created_at,last_success FROM daynote_android_devices')});
 if(path==='/android/pair'&&req.method==='POST'){
  const code=random();await env.DB.batch([env.DB.prepare('DELETE FROM daynote_android_pairs'),env.DB.prepare('INSERT INTO daynote_android_pairs(hash,expires_at) VALUES(?,?)').bind(await androidHash(code),Date.now()+600000)]);return response({code,expires_in:600});
 }
 if(path==='/android/devices'&&req.method==='DELETE'){await env.DB.batch([env.DB.prepare('DELETE FROM daynote_android_devices'),env.DB.prepare('DELETE FROM daynote_android_pairs')]);return response({ok:true});}
 return null;
}
/** Only these routes accept a scoped device credential, never the Chief of Staff passcode. */
export async function androidDeviceRoute(env:Env,req:Request){
 try{
  if(req.method!=='POST')throw new HttpError(405,'POST required');
  const text=await req.text();if(text.length>4096)throw new HttpError(413,'Request too large');
  let p:any;try{p=JSON.parse(text);}catch{throw new HttpError(400,'Invalid JSON');}
  if(!p||typeof p!=='object'||Array.isArray(p))throw new HttpError(400,'Invalid JSON object');
  const path=new URL(req.url).pathname;
  if(path==='/api/daynote/android-device/redeem'){
   if(typeof p.code!=='string'||! /^[a-f0-9]{48}$/.test(p.code))throw new HttpError(401,'Invalid or expired pairing code');
   const result=await env.DB.prepare('DELETE FROM daynote_android_pairs WHERE hash=? AND expires_at>? RETURNING hash').bind(await androidHash(p.code),Date.now()).first();
   if(!result)throw new HttpError(401,'Invalid or expired pairing code');
   const token=random();await run(env,'INSERT INTO daynote_android_devices(id,token_hash,created_at) VALUES(?,?,?)',uid(),await androidHash(token),now());return response({token});
  }
  if(path!=='/api/daynote/android-device/scores')throw new HttpError(404,'Not found');
  const token=(req.headers.get('authorization')||'').replace(/^Bearer /,'');
  if(!/^[a-f0-9]{48}$/.test(token))throw new HttpError(401,'Device not paired');
  const device=await first<{id:string}>(env,'SELECT id FROM daynote_android_devices WHERE token_hash=?',await androidHash(token));
  if(!device)throw new HttpError(401,'Device revoked. Pair again.');
  if(!p||p.confirmed!==true||p.package!=='com.fitbit.FitbitMobile'||!validDate(p.date)||p.date>localDate()||p.date<'2020-01-01'||!Number.isFinite(Date.parse(p.captured_at))||Math.abs(Date.now()-Date.parse(p.captured_at))>86400000)throw new HttpError(400,'Review the date and captured scores first');
  const points:[string,number][]=[];
  if(p.readiness!==null&&p.readiness!==undefined){if(!Number.isInteger(p.readiness)||p.readiness<0||p.readiness>100)throw new HttpError(400,'Invalid readiness');points.push(['google_readiness',p.readiness]);}
  if(p.cardio_load!==null&&p.cardio_load!==undefined){if(!Number.isFinite(p.cardio_load)||p.cardio_load<0||p.cardio_load>100000)throw new HttpError(400,'Invalid cardio load');points.push(['google_cardio_load',p.cardio_load]);}
  if(!points.length||typeof p.final!=='boolean')throw new HttpError(400,'No reviewed scores');
  const raw=JSON.stringify({source:'google_android_review',device_id:device.id,captured_at:p.captured_at,confirmed:true,final:p.final&&p.date<localDate()});
  // Gate writes on live credential membership to prevent an in-flight upload after revocation.
  const results=await env.DB.batch(points.map(([type,value])=>env.DB.prepare('INSERT INTO daynote_measurements(id,type,date,value,raw,updated_at) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM daynote_android_devices WHERE id=?) ON CONFLICT(id) DO UPDATE SET value=excluded.value,raw=excluded.raw,updated_at=excluded.updated_at').bind('android:google:'+type+':'+p.date,type,p.date,value,raw,now(),device.id)));
  if(!results.every(r=>r.meta.changes))throw new HttpError(401,'Device revoked');
  await run(env,'UPDATE daynote_android_devices SET last_success=? WHERE id=?',now(),device.id);return response({ok:true,count:points.length});
 }catch(e){return response({error:e instanceof HttpError?e.message:'Upload failed; retry later'},e instanceof HttpError?e.status:500);}
}
