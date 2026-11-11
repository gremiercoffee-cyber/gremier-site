import {localDate,shiftDate,sleepJournalDate,type Measurement} from './daynote';

export const SCORE_VERSION='nightly-inputs-2';
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
export type NapAggregate={id:string;minutes:number;start:string;end:string;source:Source};
export type NightInput={date:string;sleep:SleepAggregate|null;naps?:NapAggregate[];vitals:Partial<Record<VitalKey,Reading>>};
export type Component={key:string;score:number|null;weight:number;count:number;value:number|null;center?:number;spread?:number;z?:number;source?:Source};
export type NightScore=NightInput&{version:string;sleep_score:number|null;body_score:number|null;sleep_components:Component[];body_components:Component[];sleep_coverage:number;body_coverage:number;quality:string;missing:string[]};
function clockMinutes(at:number){const d=new Date(at);const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Jerusalem',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(d).split(':');return +parts[0]*60+(+parts[1]);}
const distance=(a:number,b:number)=>((a-b+2160)%1440)-720;
function circularCenter(values:number[]){return values.reduce((best,x)=>values.reduce((s,v)=>s+Math.abs(distance(v,x)),0)<values.reduce((s,v)=>s+Math.abs(distance(v,best)),0)?x:best,values[0]);}
/** Reduce epochs to fixed aggregates; short awakenings may overlap stages and are never added twice. */
export function sleepAggregate(m:Measurement):SleepAggregate|null{
 const s=m.raw?.sleep||{},start=Date.parse(m.start_at||s.interval?.startTime),end=Date.parse(m.end_at||s.interval?.endTime),minutes=m.value;
 if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start||!valid(minutes,1,1080)||minutes>(end-start)/60000+1||(end-start)/60000>1200||s.metadata?.nap===true||s.metadata?.processed===false)return null;
 if(minutes<180&&s.metadata?.mainSleep!==true)return null;
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
 const napRows=new Map<string,Measurement>();
 const days=new Map<string,NightInput>(),sleeps=new Map<string,{m:Measurement;s:SleepAggregate}>();
 const get=(date:string)=>{if(!days.has(date))days.set(date,{date,sleep:null,vitals:{}});return days.get(date)!;};
 const chosen=new Map<string,Measurement>();
 for(const m of [...measurements].sort((a,b)=>a.id.localeCompare(b.id))){
  if(m.type==='sleep'){if(m.raw?.sleep?.metadata?.nap===true){const a=Date.parse(m.start_at||''),b=Date.parse(m.end_at||'');if(Number.isFinite(a)&&Number.isFinite(b)&&b>a&&valid(m.value,1,600)&&m.value<=(b-a)/60000+1&&m.raw.sleep.metadata.processed!==false){const key=a+':'+b,old=napRows.get(key);if(!old||priority(m)>priority(old))napRows.set(key,m);}continue;}const s=sleepAggregate(m);if(!s)continue;const date=localDate(s.end),old=sleeps.get(date);if(!old||priority(m)>priority(old.m)||priority(m)===priority(old.m)&&s.minutes>old.s.minutes)sleeps.set(date,{m,s});continue;}
  const i=SCORE_TYPES.indexOf(m.type)-1;if(i<0)continue;const key=keys[i];if(!key||!valid(m.value,...limits[key]))continue;
  const k=m.date+'|'+key,old=chosen.get(k);if(!old||priority(m)>priority(old)||priority(m)===priority(old)&&String((m as any).updated_at||'')>String((old as any).updated_at||''))chosen.set(k,m);
 }
 for(const [date,{s}]of sleeps)get(date).sleep=s;
 const chosenNaps:Measurement[]=[];for(const m of [...napRows.values()].sort((a,b)=>priority(b)-priority(a)||(b.value||0)-(a.value||0)))if(!chosenNaps.some(old=>Date.parse(m.start_at!)<Date.parse(old.end_at!)&&Date.parse(m.end_at!)>Date.parse(old.start_at!)))chosenNaps.push(m);
 for(const m of chosenNaps){const d=get(localDate(m.end_at!));(d.naps??=[]).push({id:m.id,minutes:m.value!,start:m.start_at!,end:m.end_at!,source:measurementSource(m)});}
 for(const m of chosen.values()){const key=keys[SCORE_TYPES.indexOf(m.type)-1];get(m.date).vitals[key]={value:m.value!,source:measurementSource(m),id:m.id};}
 return [...days.values()].sort((a,b)=>a.date.localeCompare(b.date));
}
/** Descriptive input/baseline snapshot only. V1 marks are retired; v2 estimates require independent evaluation. */
export function scoreNight(n:NightInput,history:NightInput[]):NightScore{
 const prior=history.filter(p=>p.date<n.date&&p.date>=shiftDate(n.date,-28)),body_components:Component[]=[];
 for(const key of keys){const r=n.vitals[key],past=r?prior.map(p=>p.vitals[key]).filter((v):v is Reading=>!!v&&v.source.provider===r.source.provider):[],values=past.map(p=>key==='hrv'?Math.log(p.value):p.value),c:Component={key,value:r?.value??null,score:null,weight:0,count:values.length,source:r?.source};
 if(r&&values.length>=14){const center=median(values),spread=Math.max(floors[key],1.4826*median(values.map(v=>Math.abs(v-center)))),z=((key==='hrv'?Math.log(r.value):r.value)-center)/spread;Object.assign(c,{center:round(key==='hrv'?Math.exp(center):center),spread:round(spread),z:round(z)});}body_components.push(c);}
 return {...n,version:SCORE_VERSION,sleep_score:null,body_score:null,sleep_components:[],body_components,sleep_coverage:n.sleep?1:0,body_coverage:body_components.filter(c=>c.z!==undefined).length/5,quality:'Descriptive measurements; personal scores evaluated separately',missing:body_components.filter(c=>c.z===undefined).map(c=>c.key+': '+(c.value===null?'missing':`learning ${c.count}/14 days`))};
}
export function scoreNights(inputs:NightInput[]){const sorted=[...inputs].sort((a,b)=>a.date.localeCompare(b.date));return sorted.map(n=>scoreNight(n,sorted));}
