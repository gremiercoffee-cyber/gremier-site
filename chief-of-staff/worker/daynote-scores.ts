import type {Env} from './env';
import {all,first,run,now,HttpError} from './db';
import {EMPTY_SLEEP_PROFILE,researchView,validSleepProfile,type SleepProfile} from '../shared/daynote-research';
import {shiftDate,type Measurement} from '../shared/daynote';
import {compactNights,scoreNights,SCORE_TYPES,SCORE_VERSION,type NightInput,type NightScore} from '../shared/daynote-scores';
type Dirty={date:string;revision:number};
/** Incremental derived cache. Source corrections invalidate their date and the following 28 baseline days.
 * Every write and checkpoint is fenced against concurrent source changes in the same atomic D1 batch. */
export async function refreshNightlyScores(env:Env,date:string){
 const dirty=await all<Dirty>(env,'SELECT date,revision FROM daynote_score_dirty ORDER BY CASE WHEN date BETWEEN ? AND ? THEN 0 ELSE 1 END,date LIMIT 30',shiftDate(date,-28),date);
 if(!dirty.length)return {processed:0};
 const dates=dirty.map(d=>d.date).sort(),from=dates[0],to=shiftDate(dates.at(-1)!,28);
 const [rows,existing]=await Promise.all([
  all<any>(env,`SELECT * FROM daynote_measurements WHERE date>=? AND date<=? AND type IN (${SCORE_TYPES.map(()=>'?').join(',')}) ORDER BY date,id`,shiftDate(from,-29),shiftDate(to,1),...SCORE_TYPES),
  all<{date:string;document:string}>(env,'SELECT date,document FROM daynote_nightly WHERE date>=? AND date<=?',from,to),
 ]);
 const inputs=compactNights(rows.map(r=>({...r,raw:JSON.parse(r.raw)})) as Measurement[]),known=new Set(inputs.map(n=>n.date));
 for(const d of [...existing,...dirty])if(!known.has(d.date)){inputs.push({date:d.date,sleep:null,vitals:{}} satisfies NightInput);known.add(d.date);}
 const old=new Map(existing.map(r=>[r.date,r.document])),snapshot=JSON.stringify(dirty),stamp=now();
 const fence="NOT EXISTS(SELECT 1 FROM json_each(?) q LEFT JOIN daynote_score_dirty d ON d.date=json_extract(q.value,'$.date') WHERE d.revision IS NULL OR d.revision!=json_extract(q.value,'$.revision'))";
 const statements:D1PreparedStatement[]=[];
 for(const n of scoreNights(inputs).filter(n=>n.date>=from&&n.date<=to)){
  const document=JSON.stringify(n);if(old.get(n.date)===document)continue;
  statements.push(env.DB.prepare(`INSERT INTO daynote_nightly(date,version,document,updated_at) SELECT ?,?,?,? WHERE ${fence} ON CONFLICT(date) DO UPDATE SET version=excluded.version,document=excluded.document,updated_at=excluded.updated_at WHERE daynote_nightly.document!=excluded.document`).bind(n.date,SCORE_VERSION,document,stamp,snapshot));
 }
 // Delete only the exact revisions consumed; a changed snapshot keeps all pending work for retry.
 statements.push(env.DB.prepare(`DELETE FROM daynote_score_dirty WHERE date IN (SELECT json_extract(value,'$.date') FROM json_each(?)) AND ${fence}`).bind(snapshot,snapshot));
 await env.DB.batch(statements);
 return {processed:dirty.length};
}
export async function scoreProfile(env:Env):Promise<SleepProfile>{const r=await first<{document:string;revision:number}>(env,'SELECT document,revision FROM daynote_score_profile WHERE id=1');return r?{...EMPTY_SLEEP_PROFILE,...JSON.parse(r.document),revision:r.revision}:{...EMPTY_SLEEP_PROFILE,revision:0};}
export async function saveScoreProfile(env:Env,input:any){
 const p={age:input.age,reference_low:input.reference_low,reference_high:input.reference_high,functional_minutes:input.functional_minutes,source:input.source,friday_night_minutes:input.friday_night_minutes,shabbos_nap_minutes:input.shabbos_nap_minutes},base=input.revision;
 if(!validSleepProfile(p)||!Number.isInteger(base)||base<0)throw new HttpError(400,'Check your adult sleep reference and duration defaults.');
 const document=JSON.stringify(p),stamp=now(),revision=base+1;
 const results=await env.DB.batch([env.DB.prepare('INSERT INTO daynote_score_profile(id,document,revision,updated_at) SELECT 1,?,?,? WHERE ?=0 OR EXISTS(SELECT 1 FROM daynote_score_profile WHERE id=1) ON CONFLICT(id) DO UPDATE SET document=excluded.document,revision=excluded.revision,updated_at=excluded.updated_at WHERE daynote_score_profile.revision=?').bind(document,revision,stamp,base,base),env.DB.prepare('INSERT OR IGNORE INTO daynote_score_profile_history(revision,document,updated_at) SELECT revision,document,updated_at FROM daynote_score_profile WHERE id=1 AND revision=? AND document=?').bind(revision,document)]);
 if(!results[0].meta.changes)throw new HttpError(409,'Sleep reference changed on another device. Reload before saving.');return scoreProfile(env);
}
const cache=new WeakMap<Env['DB'],Map<string,any>>();
export async function nightlyScores(env:Env,date:string){
 await refreshNightlyScores(env,date);
 const [entries,profile,pending]=await Promise.all([all<{document:string;updated_at:string}>(env,'SELECT document,updated_at FROM daynote_entries WHERE deleted=0 AND date>=? AND date<=? ORDER BY date',shiftDate(date,-364),date),scoreProfile(env),all<Dirty>(env,'SELECT date,revision FROM daynote_score_dirty ORDER BY date LIMIT 1')]);
 const journals=entries.map(r=>({...JSON.parse(r.document),updated_at:r.updated_at}));
 const lookback=119; // enough for the 90-night quality comparison and the longer body trend
 const records=await all<{date:string;document:string;updated_at:string}>(env,'SELECT date,document,updated_at FROM daynote_nightly WHERE date>=? AND date<=? ORDER BY date',shiftDate(date,-lookback),date);
 const key=JSON.stringify({date,profile,journals,records:records.map(r=>[r.date,r.updated_at])}),local=cache.get(env.DB)||new Map();cache.set(env.DB,local);if(local.has(key))return {...local.get(key),updating:pending.length>0};
 const nights=records.map(r=>JSON.parse(r.document) as NightScore);
 const result={...researchView(nights,journals,date,profile),updating:pending.length>0};local.set(key,result);if(local.size>4)local.delete(local.keys().next().value);return result;
}
