import type {MorningReview} from './daynote-research';
export const DAYNOTE_TZ='Asia/Jerusalem';
export type Habit={id:string;label:string;category:string;enabled:boolean;position:number;followups:boolean;detail?:'time'|'number';detailLabel?:string;custom?:boolean};
export type Answer={value:'yes'|'no'|'skip';detail?:string;source:'questionnaire'|'note';note_id?:string;evidence?:string;at:string};
export type Journal={date:string;answers:Record<string,Answer>;questions:string[];cursor:number;completed:boolean;energy:number|null;readiness:number|null;cardio_load?:number|null;cardio_load_final?:boolean;morning?:MorningReview;revision:number;updated_at?:string};
export type Observation={date:string;habit_id:string|null;label:string;category:string;value:'yes'|'no'|null;detail?:string;evidence:string;uncertain:boolean};
export type JournalNote={id:string;date:string;transcript:string;observations:Observation[];decisions:Record<string,string>;source:string;created_at:string;processed?:boolean};
const definitions:[string,string,string,boolean,('time'|'number')?,string?][]=[
 ['caffeine','Did you have caffeine?','Food & drink',true,'time','Last caffeine time'],
 ['late_caffeine','Did you have caffeine after 14:00?','Food & drink',true],
 ['alcohol','Did you drink alcohol?','Food & drink',true,'number','Number of drinks'],
 ['late_meal','Did you eat within 2 hours of bedtime?','Food & drink',true,'time','Last meal time'],
 ['hydration','Did you drink enough water for you?','Food & drink',true],
 ['exercise','Did you exercise?','Movement',true,'time','Workout end time'],
 ['stress','Was your stress unusually high?','Mind & recovery',true],
 ['illness','Did you feel ill?','Health & travel',true],
 ['travel','Did you travel or sleep away from home?','Health & travel',false],
 ['late_exercise','Did you exercise within 2 hours of bedtime?','Movement',false],
 ['outdoors','Did you spend at least 20 minutes outdoors?','Movement',false],
 ['morning_light','Did you get outdoor light in the morning?','Movement',false],
 ['walk','Did you take a purposeful walk?','Movement',false],
 ['strength','Did you do strength training?','Movement',false],
 ['hard_training','Was your workout harder than usual?','Movement',false],
 ['stretching','Did you stretch or do gentle mobility?','Mind & recovery',false],
 ['relaxation','Did you make time to relax?','Mind & recovery',false],
 ['breathwork','Did you practise breathing exercises?','Mind & recovery',false],
 ['meditation','Did you meditate?','Mind & recovery',false],
 ['journal_writing','Did you reflect or write in a journal?','Mind & recovery',false],
 ['social_connection','Did you have meaningful social time?','Mind & recovery',false],
 ['evening_screens','Did you use a screen in the hour before bed?','Sleep environment',false],
 ['dark_room','Was your bedroom comfortably dark?','Sleep environment',false],
 ['cool_room','Was your bedroom comfortably cool?','Sleep environment',false],
 ['noise','Did noise disturb your sleep environment?','Sleep environment',false],
 ['sleep_mask','Did you use a sleep mask?','Sleep environment',false],
 ['consistent_bedtime','Did you follow your intended bedtime?','Sleep environment',false],
 ['nap','Did you take a nap?','Sleep environment',false,'number','Nap minutes'],
 ['late_work','Did you work in the hour before bed?','Sleep environment',false],
 ['heavy_meal','Did you have an unusually heavy meal?','Food & drink',false],
 ['eating_out','Did you eat out?','Food & drink',false],
 ['tobacco','Did you use tobacco or nicotine?','Food & drink',false],
 ['time_zone_change','Did you cross time zones?','Health & travel',false],
 ['pain','Did pain affect your day?','Health & travel',false],
 ['medication','Did you take medication you want to track?','Optional medication & supplements',false],
 ['supplement','Did you take a supplement you want to track?','Optional medication & supplements',false],
 ['magnesium','Did you take magnesium?','Optional medication & supplements',false],
 ['melatonin','Did you take melatonin?','Optional medication & supplements',false],
];
export const HABIT_CATALOG:Habit[]=definitions.map(([id,label,category,enabled,detail,detailLabel],position)=>({id,label,category,enabled,position,followups:false,detail,detailLabel}));
export function localDate(at:Date|string=new Date()){return new Intl.DateTimeFormat('en-CA',{timeZone:DAYNOTE_TZ,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(at));}
export function localHour(at:Date|string=new Date()){return Number(new Intl.DateTimeFormat('en-GB',{timeZone:DAYNOTE_TZ,hour:'2-digit',hourCycle:'h23'}).format(new Date(at)));}
export function shiftDate(date:string,days:number){const d=new Date(date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);}
/** Default to the current Jerusalem calendar day. The user can always choose another date. */
/** The journal day you are living in: it stays on the day you went to sleep until you wake up. After midnight it is still
 * yesterday until a main sleep has ended today (or noon, for nights the watch missed). */
export function suggestedDate(at:Date|string=new Date(),lastWakeAt?:string|null){const today=localDate(at);if(localHour(at)>=12)return today;return lastWakeAt&&localDate(lastWakeAt)===today&&Date.parse(lastWakeAt)<=new Date(at).getTime()?today:shiftDate(today,-1);}
export function validDate(date:unknown):date is string{return typeof date==='string'&&/^20\d\d-\d\d-\d\d$/.test(date)&&!Number.isNaN(Date.parse(date+'T12:00Z'))&&new Date(date+'T12:00Z').toISOString().slice(0,10)===date;}
export function emptyJournal(date:string,habits:Habit[]):Journal{return{date,answers:{},questions:habits.filter(h=>h.enabled).sort((a,b)=>a.position-b.position).map(h=>h.id),cursor:0,completed:false,energy:null,readiness:null,revision:0};}
/** Refresh the active sequence without deleting answers to disabled questions. */
export function reconcileQuestions(j:Journal,habits:Habit[]):Journal{
 const enabled=habits.filter(h=>h.enabled).sort((a,b)=>a.position-b.position).map(h=>h.id),allowed=new Set(enabled);
 const questions=[...new Set([...j.questions.filter(id=>allowed.has(id)),...enabled])];
 const next=j.questions.slice(j.cursor).find(id=>allowed.has(id));
 const added=questions.find(id=>!j.questions.includes(id)&&!j.answers[id]);
 const cursor=next?questions.indexOf(next):added?questions.indexOf(added):questions.length;
 return{...j,questions,cursor,completed:j.completed&&!questions.some(id=>!j.answers[id])};
}
export function recordAnswer(j:Journal,id:string,value:Answer['value'],at=new Date().toISOString()):Journal{return{...j,answers:{...j.answers,[id]:{value,source:'questionnaire',at}},cursor:Math.min(j.questions.length,j.cursor+1),completed:false};}
export function habitKey(label:string){return label.toLowerCase().replace(/^(did you|have you|were you|was your)\s+/,'').replace(/[?!.]/g,'').replace(/\s+/g,' ').trim();}
export function sleepJournalDate(start:string){const date=localDate(start);return localHour(start)<12?shiftDate(date,-1):date;}
export type Measurement={id:string;type:string;date:string;start_at:string|null;end_at:string|null;value:number|null;raw?:any};
/** Derived view only: real imported scores enrich analysis without inventing saved questionnaires. Explicit owner entries take priority. */
export function withGoogleScores(entries:Journal[],measurements:Measurement[]):Journal[]{
 const map=new Map(entries.map(j=>[j.date,{...j}]));
 for(const m of measurements.filter(m=>['google_readiness','google_cardio_load'].includes(m.type)&&m.value!==null).sort((a,b)=>Number(b.raw?.source==='google_android_review')-Number(a.raw?.source==='google_android_review'))){
  const j=map.get(m.date)||emptyJournal(m.date,[]);
  if(m.type==='google_readiness'&&(j.readiness===null||j.readiness===undefined))j.readiness=m.value;
  if(m.type==='google_cardio_load'&&(j.cardio_load===null||j.cardio_load===undefined)){j.cardio_load=m.value;j.cardio_load_final=m.raw?.final===true;}
  map.set(m.date,j);
 }
 return[...map.values()];
}
export type Comparison={habit_id:string;metric:string;yes_n:number;no_n:number;yes_mean:number|null;no_mean:number|null;difference:number|null;matched_difference:number|null;matched_n:number;label:string;missing:number;standard_error?:number;standardized_difference?:number;split_consistent?:boolean};
const mean=(a:number[])=>a.length?a.reduce((s,n)=>s+n,0)/a.length:null;
/** All numbers come from actual records. Morning ratings are dated by morning, not habit day. */
export function analyzeJournals(entries:Journal[],measurements:Measurement[],excludeIllnessTravel=true):{comparisons:Comparison[];matched_nights:number;weekly:ReturnType<typeof weeklyChanges>;limitations:string[]} {
 entries=withGoogleScores(entries,measurements).sort((a,b)=>a.date.localeCompare(b.date));
 const byDay=new Map(entries.map(j=>[j.date,j])),sleep=new Map<string,Measurement>();
 for(const m of measurements.filter(m=>m.type==='sleep'&&m.start_at&&m.end_at&&m.value!==null&&m.raw?.sleep?.metadata?.nap!==true)){
  const key=sleepJournalDate(m.start_at!);if(!sleep.has(key)||(sleep.get(key)!.value??0)<m.value!)sleep.set(key,m);
 }
 const metrics=['sleep_minutes','sleep_onset_minutes','hrv_ms','resting_hr','respiratory_rate','oxygen_saturation','skin_temperature_delta','sleep_score','body_score','sleep_quality','rested','sleepiness','energy','readiness'],habits=[...new Set(entries.flatMap(j=>Object.keys(j.answers)))],comparisons:Comparison[]=[];
 for(const id of habits)for(const metric of metrics){
  const yes:number[]=[],no:number[]=[],strata=new Map<string,{yes:number[];no:number[]}>();let missing=0;
  for(const j of entries){const answer=j.answers[id]?.value;if(answer!=='yes'&&answer!=='no')continue;
   if(excludeIllnessTravel&&(j.answers.illness?.value==='yes'||j.answers.travel?.value==='yes'))continue;
   const s=sleep.get(j.date),wake=s?.end_at?localDate(s.end_at):shiftDate(j.date,1);let value:number|null=null;
   if(metric==='sleep_minutes')value=byDay.get(wake)?.morning?.sleep_minutes??s?.value??null;
   if(metric==='sleep_quality'||metric==='rested'||metric==='sleepiness')value=byDay.get(wake)?.morning?.[metric==='sleep_quality'?'quality':metric]??null;
   if(metric==='sleep_onset_minutes'&&s?.start_at){const d=new Date(s.start_at);const mins=Number(new Intl.DateTimeFormat('en-GB',{timeZone:DAYNOTE_TZ,minute:'2-digit'}).format(d));value=localHour(d)*60+mins;if(value<720)value+=1440;}
   if(metric==='hrv_ms'||metric==='resting_hr')value=measurements.find(m=>m.date===wake&&m.type===(metric==='hrv_ms'?'daily-heart-rate-variability':'daily-resting-heart-rate'))?.value??null;
   if(metric==='respiratory_rate'||metric==='oxygen_saturation'||metric==='skin_temperature_delta'){const type=metric==='respiratory_rate'?'daily-respiratory-rate':metric==='oxygen_saturation'?'daily-oxygen-saturation':'daily-sleep-temperature-derivations';value=measurements.find(m=>m.date===wake&&m.type===type)?.value??null;}
   if(metric==='sleep_score'||metric==='body_score')value=measurements.find(m=>m.date===wake&&m.type===metric)?.value??null;
   if(metric==='energy'||metric==='readiness')value=byDay.get(wake)?.[metric]??null;
   if(value===null||!Number.isFinite(value)){missing++;continue;}(answer==='yes'?yes:no).push(value);
   const weekday=new Date(j.date+'T12:00Z').getUTCDay(),duration=s?.value===null||s?.value===undefined?'unknown':String(Math.floor(s.value/60));
   const key=`${weekday}|exercise:${j.answers.exercise?.value??'missing'}${metric==='hrv_ms'||metric==='resting_hr'?'|sleep-hours:'+duration:''}`;
   const stratum=strata.get(key)||{yes:[],no:[]};stratum[answer].push(value);strata.set(key,stratum);
  }
  if(!yes.length&&!no.length)continue;const a=mean(yes),b=mean(no);let weight=0,weighted=0;
  for(const g of strata.values())if(g.yes.length>=2&&g.no.length>=2){const w=Math.min(g.yes.length,g.no.length);weight+=w;weighted+=(mean(g.yes)!-mean(g.no)!)*w;}
  const effect=a===null||b===null?null:a-b;
  const half=(v:number[])=>[mean(v.slice(0,Math.floor(v.length/2))),mean(v.slice(Math.floor(v.length/2)))];const yh=half(yes),nh=half(no);
  const consistent=yes.length>=14&&no.length>=14&&effect!==null&&weight>=5&&Math.sign(weighted)===Math.sign(effect)&&yh.every((v,i)=>v!==null&&nh[i]!==null&&Math.sign(v!-nh[i]!)===Math.sign(effect));
  const variance=(v:number[])=>v.length>1?v.reduce((sum,x)=>sum+(x-mean(v)!)**2,0)/(v.length-1):0;
  const vy=variance(yes),vn=variance(no),standard_error=Math.sqrt(vy/Math.max(1,yes.length)+vn/Math.max(1,no.length)),pooled=Math.sqrt((vy+vn)/2);
  const standardized_difference=effect===null?0:pooled>0?effect/pooled:0;
  const split_consistent=effect!==null&&yh.every((v,i)=>v!==null&&nh[i]!==null&&Math.sign(v!-nh[i]!)===Math.sign(effect));
  comparisons.push({habit_id:id,metric,yes_n:yes.length,no_n:no.length,yes_mean:a,no_mean:b,difference:effect,matched_difference:weight?weighted/weight:null,matched_n:weight*2,standard_error,standardized_difference,split_consistent,label:consistent?'Reasonably consistent association':yes.length>=5&&no.length>=5?'Tentative association':'Insufficient observations',missing});
 }
 return{comparisons,matched_nights:sleep.size,weekly:weeklyChanges(entries,measurements),limitations:['Association is not causation. No diagnosis or medication advice.','Only explicit Yes and No are compared; skipped, unmentioned and missing are excluded.','Longest non-nap sleep is matched to the preceding waking day; unusual daytime/shift sleep may need review.','Matched comparisons require both groups within weekday and exercise strata; vitals also match whole-hour sleep duration. Sparse strata remain unadjusted.','Many habits are explored; chance findings and other unmeasured factors remain possible.']};
}

/** Rolling seven-day changes, calculated independently of the language model. */
export function weeklyChanges(entries:Journal[],measurements:Measurement[],today=localDate()){
 const recentStart=shiftDate(today,-6),previousStart=shiftDate(today,-13),metrics=['sleep_minutes','hrv_ms','resting_hr','energy','readiness'];
 return metrics.map(metric=>{
  const byDate=new Map<string,number>();
  if(metric==='energy'||metric==='readiness')for(const j of entries){const v=j[metric];if(v!==null&&v!==undefined)byDate.set(j.date,v);}
  else for(const m of measurements){const match=m.type===(metric==='sleep_minutes'?'sleep':metric==='hrv_ms'?'daily-heart-rate-variability':'daily-resting-heart-rate');if(!match||m.value===null||m.raw?.sleep?.metadata?.nap)continue;if(!byDate.has(m.date)||metric==='sleep_minutes'&&byDate.get(m.date)!<m.value)byDate.set(m.date,m.value);}
  const recent=[...byDate].filter(([d])=>d>=recentStart&&d<=today).map(([,v])=>v),previous=[...byDate].filter(([d])=>d>=previousStart&&d<recentStart).map(([,v])=>v);
  const a=mean(recent),b=mean(previous);return{metric,recent_n:recent.length,previous_n:previous.length,recent_mean:a,previous_mean:b,difference:a===null||b===null?null:a-b,recent_start:recentStart,previous_start:previousStart};
 });
}
