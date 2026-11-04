import type {Env} from './env';
import {now,HttpError} from './db';
import {validDate,type Measurement} from '../shared/daynote';
const allowed=new Set(['google_readiness','google_cardio_load','sleep','daily-heart-rate-variability','daily-resting-heart-rate']);
export async function importTakeoutRecords(env:Env,p:any){
 if(!/^[a-f0-9]{64}$/.test(p.archive_sha256)||!Number.isFinite(Date.parse(p.exported_at))||!Array.isArray(p.records)||!p.records.length||p.records.length>20)throw new HttpError(400,'Invalid Takeout batch.');
 const records:Measurement[]=p.records;
 for(const m of records){
  if(typeof m.id!=='string'||!m.id.startsWith('takeout:google:')||m.id.length>200||!allowed.has(m.type)||!validDate(m.date)||!Number.isFinite(m.value)||m.value!<0||m.value!>(m.type==='google_readiness'?100:m.type==='sleep'?1440:100000)||m.raw?.source!=='google_takeout'||m.raw.archive_sha256!==p.archive_sha256||JSON.stringify(m.raw).length>150000)throw new HttpError(400,'Invalid or unsupported Takeout measurement.');
  if(m.type==='sleep'&&(!m.start_at||!m.end_at||!Number.isFinite(Date.parse(m.start_at))||Date.parse(m.end_at)<=Date.parse(m.start_at)))throw new HttpError(400,'Invalid sleep interval.');
 }
 const stamp=now();await env.DB.batch(records.map(m=>env.DB.prepare("INSERT INTO daynote_measurements(id,type,date,start_at,end_at,value,raw,updated_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET date=excluded.date,start_at=excluded.start_at,end_at=excluded.end_at,value=excluded.value,raw=excluded.raw,updated_at=excluded.updated_at WHERE COALESCE(json_extract(daynote_measurements.raw,'$.exported_at'),'')<=json_extract(excluded.raw,'$.exported_at')").bind(m.id,m.type,m.date,m.start_at,m.end_at,m.value,JSON.stringify(m.raw),stamp)));
 return{imported:records.length};
}
