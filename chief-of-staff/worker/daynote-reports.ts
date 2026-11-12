// Weekly and monthly Health Journal reports, shown only in the app (Reports). Numbers come from code
// (shared/daynote-reports); GPT-6.1 Sol on the API reads them, checks published research with web search,
// and writes the verdict and what to focus on. Runs from the 5-minute cron; one report per period.
import type {Env} from './env';
import {all,first,run,now,uid,HttpError} from './db';
import {getProvider,type ModelProvider} from './ai';
import {duePeriods,periodStats,type MeasurementRow,type PeriodStats,type ReportKind} from '../shared/daynote-reports';
import {shiftDate,type Journal} from '../shared/daynote';

export const REPORT_MODEL='gpt-6.1-sol';
const MAX_ATTEMPTS=3,DIRECTIONS=['better','steady','worse','mixed','not_enough_data'];
type Row={id:string;kind:ReportKind;period_start:string;period_end:string;status:string;stats:string;analysis:string|null;sources:string|null;model:string|null;ref:string|null;attempts:number;error:string|null;created_at:string;updated_at:string;ready_at:string|null};

const SYSTEM=`You write a private weekly or monthly health-trends report for one person from his own wearable and journal data.

Rules:
- Every number about him must come from the DATA. Never invent or estimate values that are not there. If a measure has too few days, say so instead of judging it.
- Use the code's comparisons: this period vs the previous one, and vs his usual (median of the previous 60 days). The "judgment" field already treats small moves as normal day-to-day noise ("steady"); do not overstate them. For breathing rate, blood oxygen and skin temperature, what matters is staying close to his usual, not up or down.
- Decide the overall direction (better, steady, worse, mixed, or not_enough_data) from the measures that matter most for recovery and sleep: sleep duration and regularity, HRV and resting heart rate, and his own morning rating.
- Ground every recommendation in good evidence. Use web search to check it: prefer systematic reviews and meta-analyses, randomized trials, and guidelines from bodies such as the American Academy of Sleep Medicine, the National Sleep Foundation, the American Heart Association, WHO and NIH. Cite the specific pages you used. Do not cite blogs, product sites or news when a primary or authoritative source exists. Say plainly when evidence is weak or mixed.
- Consumer wearables estimate HRV, resting heart rate and sleep; they are best for within-person trends, not absolute values. Mention this only where it changes the conclusion.
- Associations from his journal (habit vs measurement) are not proof of cause; say "linked with", not "caused".
- Give at most 3 focus areas, ranked by likely impact for HIM given these numbers, each specific and doable in the coming week or month. Prefer one clear change over a list of generic tips.
- No diagnosis. Only suggest seeing a doctor if the data show a sustained, multi-measure change (for example resting heart rate up together with temperature or breathing changes over several days), and say why.
- Context: he lives in Israel, runs a small business, and keeps Shabbat (Friday night and Saturday sleep often differ from weekdays). The week runs Sunday to Saturday.
- Write plainly and warmly, in short sentences, for a phone screen. No jargon without a short explanation.

Reply with ONLY one JSON object, no markdown fence:
{"direction":"better|steady|worse|mixed|not_enough_data","headline":"one sentence verdict","summary":"2-4 sentences: which way things are heading and why, with his numbers","findings":[{"metric":"metric key from the data, or sleep_timing / exercise / journal","verdict":"better|steady|worse|unusual|unknown","text":"1-2 sentences"}],"focus":[{"title":"short imperative","why":"why this matters for him, citing his numbers","how":"concrete steps for the coming period","evidence":"what the research shows, 1-2 sentences, naming the type of evidence","sources":["https://..."]}],"watch":"anything to keep an eye on, or empty string","sources":["https://... every source you relied on"]}`;

function prompt(stats:PeriodStats,associations:unknown,profile:unknown){
 return `REPORT: ${stats.kind==='week'?'weekly':'monthly'} report for ${stats.label} (${stats.start} to ${stats.end}).

DATA (calculated by code):
${JSON.stringify(stats)}

HIS SLEEP REFERENCE (self-reported):
${JSON.stringify(profile??null)}

JOURNAL PATTERNS ACROSS ALL HISTORY (habit yes vs no days; only pairs with at least 5 days each):
${JSON.stringify(associations??[])}`;
}

/** Enough to say something real: at least 3 days of any measurement in the period. */
const thin=(s:PeriodStats)=>s.days_with_data<3;

async function inputs(env:Env,kind:ReportKind,start:string,end:string){
 const from=shiftDate(start,-130),to=shiftDate(end,2);
 const rows=await all<MeasurementRow>(env,"SELECT type,date,start_at,end_at,value,updated_at,CASE WHEN type='sleep' THEN json_extract(raw,'$.sleep.metadata.nap') END AS nap FROM daynote_measurements WHERE date>=? AND date<=? AND type IN ('sleep','exercise','daily-heart-rate-variability','daily-resting-heart-rate','daily-respiratory-rate','daily-oxygen-saturation','daily-sleep-temperature-derivations')",from,to);
 const {daynoteEntries,daynoteHabits,daynoteAnalysis}=await import('./daynote');
 const [entries,habits]=await Promise.all([daynoteEntries(env),daynoteHabits(env)]);
 const stats=periodStats(kind,start,end,rows,entries as Journal[],habits);
 let associations:unknown=[],profile:unknown=null;
 try{const a=await daynoteAnalysis(env);associations=(a.comparisons||[]).filter((c:any)=>c.yes_n>=5&&c.no_n>=5&&c.difference!==null).slice(0,12).map((c:any)=>({habit:habits.find(h=>h.id===c.habit_id)?.label||c.habit_id,metric:c.metric,yes_mean:c.yes_mean,no_mean:c.no_mean,difference:c.difference,yes_days:c.yes_n,no_days:c.no_n}));}catch{/* patterns are optional context */}
 try{const {scoreProfile}=await import('./daynote-scores');const p=await scoreProfile(env);profile={age:p.age,ideal_low_minutes:p.reference_low,ideal_high_minutes:p.reference_high,workable_minutes:p.functional_minutes};}catch{/* optional */}
 return{stats,associations,profile};
}

async function begin(env:Env,r:Row,provider:ModelProvider){
 const stats=JSON.parse(r.stats) as PeriodStats;
 if(thin(stats)){
  const analysis={direction:'not_enough_data',headline:`Not enough data for ${stats.label}.`,summary:`Only ${stats.days_with_data} day${stats.days_with_data===1?'':'s'} had watch or journal readings, so there is nothing reliable to compare. Wear the watch overnight and answer the morning question, and the next report will have something to say.`,findings:[],focus:[],watch:'',sources:[]};
  await run(env,"UPDATE daynote_reports SET status='ready',analysis=?,sources='[]',model=NULL,ready_at=?,updated_at=? WHERE id=?",JSON.stringify(analysis),now(),now(),r.id);return;
 }
 const {associations,profile}=JSON.parse(r.analysis||'{}');
 const ref=await provider.startBackground({system:SYSTEM,prompt:prompt(stats,associations,profile),maxSearches:8,maxTokens:16000,model:REPORT_MODEL,effort:'high',purpose:'health_report'});
 await run(env,"UPDATE daynote_reports SET status='running',ref=?,attempts=attempts+1,analysis=NULL,error=NULL,updated_at=? WHERE id=?",ref,now(),r.id);
}

/** Web-search answers carry inline "([site](url))" citations and tracking tags: the app shows sources separately. */
export const cleanUrl=(u:string)=>{let v=u.replace(/%2528/gi,'%28').replace(/%2529/gi,'%29');try{const x=new URL(v);for(const k of [...x.searchParams.keys()])if(/^utm_/.test(k))x.searchParams.delete(k);v=x.toString();}catch{/* keep as is */}return v;};
const cleanText=(t:unknown)=>typeof t==='string'?t.replace(/\s*\(\[[^\]]*\]\([^)]*\)\)/g,'').replace(/\[([^\]]+)\]\(https?:[^)]*\)/g,'$1').replace(/\s{2,}/g,' ').trim():t;
const urls=(l:unknown)=>Array.isArray(l)?[...new Set(l.filter((u:unknown):u is string=>typeof u==='string'&&/^https?:\/\//.test(u)).map(cleanUrl))]:[];
export function cleanAnalysis(v:any){
 return{...v,headline:cleanText(v.headline),summary:cleanText(v.summary),watch:cleanText(v.watch??''),findings:Array.isArray(v.findings)?v.findings.map((f:any)=>({...f,text:cleanText(f.text)})):[],focus:Array.isArray(v.focus)?v.focus.slice(0,3).map((f:any)=>({...f,title:cleanText(f.title),why:cleanText(f.why),how:cleanText(f.how),evidence:cleanText(f.evidence),sources:urls(f.sources)})):[],sources:urls(v.sources)};
}
export function parseReport(text:string){
 const s=text.indexOf('{'),e=text.lastIndexOf('}');
 try{const v=JSON.parse(text.slice(s,e+1));if(v&&DIRECTIONS.includes(v.direction)&&typeof v.headline==='string')return cleanAnalysis(v);}catch{/* fall through */}
 return null;
}

/** Cron: create due reports, then collect finished ones. Safe to run concurrently (one row per period). */
export async function healthReports(env:Env,at=new Date(),provider:ModelProvider=getProvider(env)){
 for(const p of duePeriods(at)){
  if(await first(env,'SELECT 1 FROM daynote_reports WHERE kind=? AND period_start=?',p.kind,p.start))continue;
  const {stats,associations,profile}=await inputs(env,p.kind,p.start,p.end),t=now();
  const row=await first<Row>(env,"INSERT INTO daynote_reports(id,kind,period_start,period_end,status,stats,analysis,attempts,created_at,updated_at) VALUES(?,?,?,?,'starting',?,?,0,?,?) ON CONFLICT(kind,period_start) DO NOTHING RETURNING *",uid(),p.kind,p.start,p.end,JSON.stringify(stats),JSON.stringify({associations,profile}),t,t);
  if(row)try{await begin(env,row,provider);}catch(e){await run(env,"UPDATE daynote_reports SET status='failed',attempts=attempts+1,error=?,updated_at=? WHERE id=?",String((e as Error).message).slice(0,300),now(),row.id);}
 }
 for(const r of await all<Row>(env,"SELECT * FROM daynote_reports WHERE status='running' AND ref IS NOT NULL")){
  const res=await provider.checkBackground(r.ref!,'health_report');if(!res.done)continue;
  if(res.failed!==undefined){await run(env,"UPDATE daynote_reports SET status='failed',error=?,updated_at=? WHERE id=? AND status='running'",String(res.failed).slice(0,300),now(),r.id);continue;}
  const analysis=parseReport(res.text);
  if(!analysis){await run(env,"UPDATE daynote_reports SET status='failed',error='The report came back in an unexpected format.',updated_at=? WHERE id=? AND status='running'",now(),r.id);continue;}
  const sources=[...new Set([...analysis.sources,...analysis.focus.flatMap((f:any)=>Array.isArray(f.sources)?f.sources:[]),...res.sources].filter(u=>/^https?:\/\//.test(u)).map(cleanUrl))].slice(0,20);
  await run(env,"UPDATE daynote_reports SET status='ready',analysis=?,sources=?,model=?,ref=NULL,ready_at=?,updated_at=? WHERE id=? AND status='running'",JSON.stringify(analysis),JSON.stringify(sources),REPORT_MODEL,now(),now(),r.id);
 }
 // A failed attempt is retried after 30 minutes, at most three times in all.
 for(const r of await all<Row>(env,"SELECT * FROM daynote_reports WHERE status='failed' AND attempts<? AND updated_at<?",MAX_ATTEMPTS,new Date(at.getTime()-30*60000).toISOString())){
  const {associations,profile}=await inputs(env,r.kind,r.period_start,r.period_end);
  const claimed=await first<Row>(env,"UPDATE daynote_reports SET status='starting',analysis=?,updated_at=? WHERE id=? AND status='failed' RETURNING *",JSON.stringify({associations,profile}),now(),r.id);
  if(claimed)try{await begin(env,claimed,provider);}catch(e){await run(env,"UPDATE daynote_reports SET status='failed',attempts=attempts+1,error=?,updated_at=? WHERE id=?",String((e as Error).message).slice(0,300),now(),r.id);}
 }
}

const view=(r:Row)=>({id:r.id,kind:r.kind,period_start:r.period_start,period_end:r.period_end,status:r.status==='starting'?'running':r.status,stats:JSON.parse(r.stats),analysis:r.status==='ready'&&r.analysis?cleanAnalysis(JSON.parse(r.analysis)):null,sources:r.sources?urls(JSON.parse(r.sources)):[],model:r.model,ready_at:r.ready_at,attempts:r.attempts});
export async function listReports(env:Env){
 return all(env,"SELECT id,kind,period_start,period_end,CASE status WHEN 'starting' THEN 'running' ELSE status END AS status,CASE WHEN status='ready' THEN json_extract(analysis,'$.direction') END AS direction,CASE WHEN status='ready' THEN json_extract(analysis,'$.headline') END AS headline,ready_at FROM daynote_reports ORDER BY period_end DESC,kind LIMIT 80");
}
export async function getReport(env:Env,id:string){const r=await first<Row>(env,'SELECT * FROM daynote_reports WHERE id=?',id);if(!r)throw new HttpError(404,'Report not found.');return view(r);}
