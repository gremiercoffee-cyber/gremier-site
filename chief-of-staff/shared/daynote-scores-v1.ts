import {localDate,shiftDate,sleepJournalDate,type Measurement} from './daynote';

export const SCORE_VERSION='sleep-body-1';
/** Display bands only; not clinical or vendor thresholds. */
export const scoreTone=(score:number|null|undefined)=>score===null||score===undefined?'neutral':score>=85?'deep-green':score>=70?'green':score>=55?'yellow':score>=40?'orange':'red';
export const SCORE_TYPES=['sleep','daily-heart-rate-variability','daily-resting-heart-rate','daily-respiratory-rate','daily-oxygen-saturation','daily-sleep-temperature-derivations'];
export type VitalKey='hrv'|'rhr'|'resp'|'oxygen'|'temp';
const keys:VitalKey[]=['hrv','rhr','resp','oxygen','temp'];
const limits:Record<VitalKey,[number,number]>={hrv:[1,500],rhr:[25,150],resp:[5,40],oxygen:[50,100],temp:[-5,5]};
const floors={hrv:.1,rhr:2,resp:1,oxygen:1,temp:.2};
const clamp=(v:number,low=0,high=100)=>Math.max(low,Math.min(high,v));
const round=(n:number)=>Math.round(n*100)/100;
const valid=(v:unknown,low:number,high:number):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=low&&v<=high;
const median=(v:number[])=>{const a=[...v].sort((x,y)=>x-y),i=Math.floor(a.length/2);return a.length%2?a[i]:(a[i-1]+a[i])/2;};
/** Unknown device stays isolated; a provider name alone is not a device identity. */
export function measurementSource(m:Measurement){
 const r=m.raw||{},d=r.dataSource?.device||r.provenance?.device;
 const provider=m.type.startsWith('whoop')?'whoop':m.id.startsWith('takeout:google:')||m.id.startsWith('api:')||m.id.startsWith('users/')||r.dataSource?.platform==='FITBIT'?'google':r.source||'unknown';
 const device=typeof d==='string'?d:d?.id||d?.displayName||d?.model||'unknown-device';
 return {provider,device,key:`${provider}|${device}|${m.type==='sleep'?'sleep-session':m.type==='daily-resting-heart-rate'?'daily-rhr':'nightly-daily'}`};
}
type Source=ReturnType<typeof measurementSource>;
export type SleepAggregate={id:string;start:string;end:string;journal_date:string;minutes:number;interval_minutes:number;efficiency:number;midpoint:number;source:Source;stages:Record<string,number>|null;long_awake_minutes:number|null;awakenings:number|null;stage_coverage:number|null;flags:string[]};
type Reading={value:number;source:Source;id:string};
export type NightInput={date:string;sleep:SleepAggregate|null;vitals:Partial<Record<VitalKey,Reading>>};
export type Component={key:string;score:number|null;weight:number;count:number;value:number|null;center?:number;spread?:number;z?:number;source?:Source};
export type NightScore=NightInput&{version:string;sleep_score:number|null;body_score:number|null;sleep_components:Component[];body_components:Component[];sleep_coverage:number;body_coverage:number;quality:string;missing:string[]};
function clockMinutes(at:number){const d=new Date(at);const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Jerusalem',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(d).split(':');return +parts[0]*60+(+parts[1]);}
const distance=(a:number,b:number)=>((a-b+2160)%1440)-720;
function circularCenter(values:number[]){return values.reduce((best,x)=>values.reduce((s,v)=>s+Math.abs(distance(v,x)),0)<values.reduce((s,v)=>s+Math.abs(distance(v,best)),0)?x:best,values[0]);}
/** Reduce epochs to fixed aggregates; short awakenings may overlap stages and are never added twice. */
export function sleepAggregate(m:Measurement):SleepAggregate|null{
 const s=m.raw?.sleep||{},start=Date.parse(m.start_at||s.interval?.startTime),end=Date.parse(m.end_at||s.interval?.endTime),minutes=m.value;
 if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start||!valid(minutes,1,1080)||minutes>(end-start)/60000+1||(end-start)/60000>1200||s.metadata?.nap===true||s.metadata?.processed===false)return null;
 const saved=m.raw?.sleep_aggregate;if(saved&&saved.id===m.id&&Date.parse(saved.start)===start&&Date.parse(saved.end)===end&&saved.minutes===minutes)return saved;
 const interval=(end-start)/60000,flags:string[]=[];let stages:Record<string,number>|null=null,coverage:number|null=null,longAwake:number|null=null,awakenings:number|null=null;
 if(Array.isArray(s.stages)&&s.stages.length){
  const totals:Record<string,number>={};let previous=start,total=0,long=0,count=0,ok=true;
  for(const stage of [...s.stages].sort((a,b)=>Date.parse(a.startTime)-Date.parse(b.startTime))){const a=Date.parse(stage.startTime),b=Date.parse(stage.endTime);if(!Number.isFinite(a)||!Number.isFinite(b)||a<start||b>end||b<=a||a<previous){ok=false;break;}previous=b;const n=(b-a)/60000;total+=n;totals[String(stage.type)]=(totals[String(stage.type)]||0)+n;if(stage.type==='AWAKE'){count++;if(n>=5)long+=n;}}
  if(ok){stages=Object.fromEntries(Object.entries(totals).map(([k,v])=>[k,round(v)]));coverage=round(total/interval);if(coverage>=.9){longAwake=round(long);awakenings=count;}else flags.push('Partial stage coverage');}else flags.push('Invalid or overlapping stages');
 }
 if(minutes<180)flags.push('Very short main sleep');if(interval>960)flags.push('Unusually long sleep interval');
 return {id:m.id,start:new Date(start).toISOString(),end:new Date(end).toISOString(),journal_date:sleepJournalDate(new Date(start).toISOString()),minutes,interval_minutes:round(interval),efficiency:round(clamp(minutes/interval,0,1)),midpoint:clockMinutes((start+end)/2),source:measurementSource(m),stages,long_awake_minutes:longAwake,awakenings,stage_coverage:coverage,flags};
}
export function compactSleepMeasurement(m:Measurement):Measurement{
 const aggregate=sleepAggregate(m);
 const r=m.raw||{},s=r.sleep||{};
 return {...m,raw:{source:r.source||'google_api',dataSource:r.dataSource,archive_sha256:r.archive_sha256,exported_at:r.exported_at,file:r.file,row:r.row,sleep_id:r.sleep_id,updated_at:r.updated_at,sleep:{interval:s.interval,summary:s.summary,metadata:s.metadata},sleep_aggregate:aggregate}};
}
const priority=(m:Measurement)=>m.id.startsWith('takeout:')?1:2;
/** Prefer current API records over archive duplicates; choose the longest non-nap session once per wake date. */
export function compactNights(measurements:Measurement[]):NightInput[]{
 const days=new Map<string,NightInput>(),sleeps=new Map<string,{m:Measurement;s:SleepAggregate}>();
 const get=(date:string)=>{if(!days.has(date))days.set(date,{date,sleep:null,vitals:{}});return days.get(date)!;};
 const chosen=new Map<string,Measurement>();
 for(const m of [...measurements].sort((a,b)=>a.id.localeCompare(b.id))){
  if(m.type==='sleep'){const s=sleepAggregate(m);if(!s)continue;const date=localDate(s.end),old=sleeps.get(date);if(!old||priority(m)>priority(old.m)||priority(m)===priority(old.m)&&s.minutes>old.s.minutes)sleeps.set(date,{m,s});continue;}
  const i=SCORE_TYPES.indexOf(m.type)-1;if(i<0)continue;const key=keys[i];if(!key||!valid(m.value,...limits[key]))continue;
  const k=m.date+'|'+key,old=chosen.get(k);if(!old||priority(m)>priority(old)||priority(m)===priority(old)&&String((m as any).updated_at||'')>String((old as any).updated_at||''))chosen.set(k,m);
 }
 for(const [date,{s}]of sleeps)get(date).sleep=s;
 for(const m of chosen.values()){const key=keys[SCORE_TYPES.indexOf(m.type)-1];get(m.date).vitals[key]={value:m.value!,source:measurementSource(m),id:m.id};}
 return [...days.values()].sort((a,b)=>a.date.localeCompare(b.date));
}
/** Published evidence selects dimensions; these curves and weights are our versioned, unvalidated design choices. */
export function scoreNight(n:NightInput,history:NightInput[]):NightScore{
 const prior=history.filter(p=>p.date<n.date&&p.date>=shiftDate(n.date,-28)),s=n.sleep;
 const duration=s? s.minutes<420?clamp(s.minutes/420*100):100:null;
 const continuity=s?clamp((s.efficiency-.65)/.30*100):null;
 const mids=s?prior.filter(p=>p.sleep?.source.key===s.source.key).map(p=>p.sleep!.midpoint):[];
 const center=mids.length>=7?circularCenter(mids):null,delta=s&&center!==null?Math.abs(distance(s.midpoint,center)):null;
 const timing=delta===null?null:clamp(100-Math.max(0,delta-30)/150*100);
 const sleep_components:Component[]=[{key:'duration',score:duration,weight:.6,count:s?1:0,value:s?.minutes??null},{key:'continuity',score:continuity,weight:.25,count:s?1:0,value:s?s.efficiency*100:null},{key:'timing',score:timing,weight:.15,count:mids.length,value:delta}];
 const weighted=(cs:Component[])=>{const coverage=cs.reduce((v,c)=>v+(c.score===null?0:c.weight),0);return {coverage:round(coverage),score:coverage?Math.round(cs.reduce((v,c)=>v+(c.score===null?0:c.score*c.weight),0)/coverage):null};};
 const sleepResult=weighted(sleep_components),body_components:Component[]=[{key:'sleep',score:sleepResult.score,weight:.4,count:s?1:0,value:sleepResult.score}];
 for(const key of ['hrv','rhr','resp','temp','oxygen']as const){
  const r=n.vitals[key],past=r?prior.map(p=>p.vitals[key]).filter((v):v is Reading=>!!v&&v.source.key===r.source.key):[],values=past.map(p=>key==='hrv'?Math.log(p.value):p.value),c:Component={key,value:r?.value??null,score:null,weight:{hrv:.25,rhr:.20,resp:.10,temp:.05,oxygen:0}[key],count:values.length,source:r?.source};
  if(r&&values.length>=14){const center=median(values),spread=Math.max(floors[key],1.4826*median(values.map(v=>Math.abs(v-center)))),z=((key==='hrv'?Math.log(r.value):r.value)-center)/spread;
   // Moderate favorable HRV/RHR deviations are not unlimited rewards. Both extreme tails reduce the index.
   const departure=key==='hrv'?Math.max(0,-z-.5,z-2):key==='rhr'?Math.max(0,z-.5,-z-2):Math.max(0,Math.abs(z)-.5);
   Object.assign(c,{center:round(key==='hrv'?Math.exp(center):center),spread:round(spread),z:round(z),score:key==='oxygen'?null:round(clamp(100-25*departure))});
  }
  body_components.push(c);
 }
 const body=weighted(body_components),physiology=body_components.filter(c=>c.weight>0&&c.key!=='sleep'&&c.score!==null);
 const eligible=sleepResult.score!==null&&physiology.length>=2&&physiology.some(c=>c.key==='hrv'||c.key==='rhr')&&body.coverage>=.7;
 const missing=[...sleep_components.filter(c=>c.score===null).map(c=>'Sleep '+c.key),...body_components.filter(c=>c.weight>0&&c.score===null&&c.key!=='sleep').map(c=>`${c.key}: ${c.value===null?'missing':`learning ${c.count}/14 days`}`)];
 return {...n,version:SCORE_VERSION,sleep_score:sleepResult.score,body_score:eligible?body.score:null,sleep_components,body_components,sleep_coverage:sleepResult.coverage,body_coverage:body.coverage,quality:s?.flags.length?'Review sleep interval':sleepResult.coverage===1&&body.coverage===1?'Full input coverage':'Partial input coverage',missing};
}
export function scoreNights(inputs:NightInput[]){const sorted=[...inputs].sort((a,b)=>a.date.localeCompare(b.date));return sorted.map(n=>scoreNight(n,sorted));}
