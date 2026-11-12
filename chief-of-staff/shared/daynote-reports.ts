// Weekly/monthly health trends: every number here is calculated in code. The AI report only interprets them.
import {localDate,localHour,shiftDate,sleepJournalDate,DAYNOTE_TZ,type Journal,type Habit} from './daynote';

export type ReportKind='week'|'month';
export type Better='higher'|'lower'|'stable';
export type Judgment='better'|'worse'|'steady'|'unusual'|'unknown';
export type MeasurementRow={type:string;date:string;start_at?:string|null;end_at?:string|null;value:number|null;updated_at?:string|null;nap?:number|boolean|null};
export type Point={date:string;value:number};

/** What counts as a real change: smaller moves sit inside normal day-to-day noise and are called steady. */
export const TREND_METRICS:{key:string;label:string;unit:string;better:Better;steady:number;pct?:boolean;type?:string;decimals:number}[]=[
 {key:'sleep_minutes',label:'Sleep',unit:'min',better:'higher',steady:15,decimals:0},
 {key:'morning',label:'Morning rating',unit:'/10',better:'higher',steady:.5,decimals:1},
 {key:'hrv',label:'HRV',unit:'ms',better:'higher',steady:5,pct:true,type:'daily-heart-rate-variability',decimals:1},
 {key:'rhr',label:'Resting heart rate',unit:'bpm',better:'lower',steady:1.5,type:'daily-resting-heart-rate',decimals:1},
 {key:'resp',label:'Breathing rate',unit:'breaths/min',better:'stable',steady:.5,type:'daily-respiratory-rate',decimals:1},
 {key:'oxygen',label:'Blood oxygen',unit:'%',better:'stable',steady:1,type:'daily-oxygen-saturation',decimals:1},
 {key:'temp',label:'Skin temperature',unit:'°C vs usual',better:'stable',steady:.2,type:'daily-sleep-temperature-derivations',decimals:2},
];
export const metricInfo=(key:string)=>TREND_METRICS.find(m=>m.key===key);

const mean=(v:number[])=>v.length?v.reduce((a,b)=>a+b,0)/v.length:null;
const sd=(v:number[])=>{const m=mean(v);return m===null||v.length<2?null:Math.sqrt(v.reduce((a,b)=>a+(b-m)**2,0)/(v.length-1));};
const median=(v:number[])=>{if(!v.length)return null;const s=[...v].sort((a,b)=>a-b),i=s.length>>1;return s.length%2?s[i]:(s[i-1]+s[i])/2;};
const round=(v:number|null,d=1)=>v===null||!Number.isFinite(v)?null:Math.round(v*10**d)/10**d;
const inRange=(p:Point,a:string,b:string)=>p.date>=a&&p.date<=b;
const minutesOfDay=(iso:string)=>{const d=new Date(iso);return localHour(d)*60+Number(new Intl.DateTimeFormat('en-GB',{timeZone:DAYNOTE_TZ,minute:'2-digit'}).format(d));};
export const clock=(m:number|null)=>m===null?null:`${String(Math.floor(((Math.round(m)%1440)+1440)%1440/60)).padStart(2,'0')}:${String(((Math.round(m)%60)+60)%60).padStart(2,'0')}`;

/** Change against the previous window, judged by which direction is good for that measure. */
export function judge(key:string,current:number|null,previous:number|null,currentN:number,previousN:number,baseline:number|null=null,baselineN=0):{change:number|null;judgment:Judgment}{
 const m=metricInfo(key);if(!m||current===null||currentN<3)return{change:null,judgment:'unknown'};
 if(m.better==='stable'){
  // Breathing, oxygen and temperature: closeness to your own usual level matters, not up or down.
  if(baseline===null||baselineN<10)return{change:previous===null||previousN<3?null:current-previous,judgment:'unknown'};
  return{change:previous===null||previousN<3?null:current-previous,judgment:Math.abs(current-baseline)<=m.steady?'steady':'unusual'};
 }
 if(previous===null||previousN<3)return{change:null,judgment:'unknown'};
 const change=current-previous,threshold=m.pct?Math.abs(previous)*m.steady/100:m.steady;
 if(Math.abs(change)<=threshold)return{change,judgment:'steady'};
 return{change,judgment:(change>0)===(m.better==='higher')?'better':'worse'};
}

/** One value per day per measure: the latest daily reading; the main (longest, non-nap, 3h+) sleep per night,
 *  keyed to the day you went to sleep; your morning rating. */
export function dailySeries(rows:MeasurementRow[],entries:Pick<Journal,'date'|'morning'>[]){
 const out:Record<string,Point[]>={},latest=new Map<string,{value:number;at:string}>();
 for(const m of TREND_METRICS)if(m.type)for(const r of rows){if(r.type!==m.type||r.value===null||!Number.isFinite(r.value))continue;const k=m.key+'|'+r.date,old=latest.get(k);if(!old||(r.updated_at||'')>old.at)latest.set(k,{value:r.value,at:r.updated_at||''});}
 for(const [k,v]of latest){const [key,date]=k.split('|');(out[key]??=[]).push({date,value:v.value});}
 const nights=new Map<string,MeasurementRow>();
 for(const r of rows){if(r.type!=='sleep'||!r.start_at||!r.end_at||r.value===null||r.value<180||r.value>840||r.nap===true||r.nap===1)continue;const night=sleepJournalDate(r.start_at),old=nights.get(night);if(!old||old.value!<r.value)nights.set(night,r);}
 out.sleep_minutes=[...nights].map(([date,r])=>({date,value:r.value!}));
 out.bedtime=[...nights].map(([date,r])=>{let v=minutesOfDay(r.start_at!);if(v<720)v+=1440;return{date,value:v};});
 out.wake=[...nights].map(([date,r])=>({date,value:minutesOfDay(r.end_at!)}));
 out.morning=entries.filter(e=>e.morning?.overall!=null).map(e=>({date:e.date,value:e.morning!.overall!}));
 for(const k in out)out[k].sort((a,b)=>a.date.localeCompare(b.date));
 return out;
}

/** Averages over the trailing N days, for chart lines (needs at least minN readings in the window). */
export function rolling(points:Point[],days:number,minN=3):Point[]{
 const out:Point[]=[];for(const p of points){const from=shiftDate(p.date,-(days-1)),w=points.filter(q=>q.date>=from&&q.date<=p.date).map(q=>q.value);if(w.length>=minN)out.push({date:p.date,value:mean(w)!});}return out;
}

/** "Last 7 days vs the 7 before": for the summary above each graph. */
export function windowCompare(key:string,points:Point[],end:string,days:number){
 const start=shiftDate(end,-(days-1)),pStart=shiftDate(start,-days),pEnd=shiftDate(start,-1),bStart=shiftDate(start,-60);
 const cur=points.filter(p=>inRange(p,start,end)).map(p=>p.value),prev=points.filter(p=>inRange(p,pStart,pEnd)).map(p=>p.value),base=points.filter(p=>inRange(p,bStart,pEnd)).map(p=>p.value);
 const current=mean(cur),previous=mean(prev);
 return{current,previous,n:cur.length,previous_n:prev.length,...judge(key,current,previous,cur.length,prev.length,median(base),base.length)};
}

/** The most recent finished week (Sunday–Saturday) and month, once they are due (10:00 the day after). */
export function duePeriods(at=new Date()):{kind:ReportKind;start:string;end:string}[]{
 const today=localDate(at),hour=localHour(at),dow=new Date(today+'T12:00:00Z').getUTCDay(),out:{kind:ReportKind;start:string;end:string}[]=[];
 const weekEnd=shiftDate(today,-(((dow+1)%7)||7));if(today>shiftDate(weekEnd,1)||hour>=10)out.push({kind:'week',start:shiftDate(weekEnd,-6),end:weekEnd});
 const monthEnd=shiftDate(today.slice(0,8)+'01',-1);if(today.slice(8)!=='01'||hour>=10)out.push({kind:'month',start:monthEnd.slice(0,8)+'01',end:monthEnd});
 return out;
}

export function periodLabel(kind:ReportKind,start:string,end:string){
 const f=(d:string,o:Intl.DateTimeFormatOptions)=>new Intl.DateTimeFormat('en-GB',{...o,timeZone:'UTC'}).format(new Date(d+'T12:00:00Z'));
 return kind==='month'?f(start,{month:'long',year:'numeric'}):`${f(start,{day:'numeric',month:'short'})} – ${f(end,{day:'numeric',month:'short',year:'numeric'})}`;
}

/** Everything the report says about you, computed here: this period, the one before, and your 60-day usual. */
export function periodStats(kind:ReportKind,start:string,end:string,rows:MeasurementRow[],entries:Journal[],habits:Pick<Habit,'id'|'label'>[]=[]){
 const days=Math.round((Date.parse(end+'T12:00:00Z')-Date.parse(start+'T12:00:00Z'))/86400000)+1;
 const pStart=shiftDate(start,-days),pEnd=shiftDate(start,-1),bStart=shiftDate(start,-60),series=dailySeries(rows,entries);
 const window=(key:string,a:string,b:string)=>(series[key]||[]).filter(p=>inRange(p,a,b)).map(p=>p.value);
 const metrics=TREND_METRICS.map(m=>{
  const cur=window(m.key,start,end),prev=window(m.key,pStart,pEnd),base=window(m.key,bStart,pEnd);
  const current=mean(cur),previous=mean(prev),baseline=median(base),j=judge(m.key,current,previous,cur.length,prev.length,baseline,base.length);
  return{key:m.key,label:m.label,unit:m.unit,better:m.better,current:round(current,m.decimals),days:cur.length,previous:round(previous,m.decimals),previous_days:prev.length,usual:round(baseline,m.decimals),usual_days:base.length,change:round(j.change,m.decimals),judgment:j.judgment,day_to_day_sd:round(sd(cur),m.decimals),lowest:round(cur.length?Math.min(...cur):null,m.decimals),highest:round(cur.length?Math.max(...cur):null,m.decimals)};
 });
 const bed=window('bedtime',start,end),bedPrev=window('bedtime',pStart,pEnd),wake=window('wake',start,end),sleep=window('sleep_minutes',start,end);
 const sleepTiming={nights:bed.length,average_bedtime:clock(mean(bed)),bedtime_spread_minutes:round(sd(bed),0),previous_bedtime_spread_minutes:round(sd(bedPrev),0),previous_average_bedtime:clock(mean(bedPrev)),average_wake:clock(mean(wake)),nights_under_6h:sleep.filter(v=>v<360).length,nights_7h_or_more:sleep.filter(v=>v>=420).length};
 const sessions=(a:string,b:string)=>rows.filter(r=>r.type==='exercise'&&r.start_at&&localDate(r.start_at)>=a&&localDate(r.start_at)<=b),minutes=(l:MeasurementRow[])=>Math.round(l.reduce((s,r)=>s+(r.end_at&&r.start_at?Math.max(0,(Date.parse(r.end_at)-Date.parse(r.start_at))/60000):0),0));
 const ex=sessions(start,end),exPrev=sessions(pStart,pEnd);
 const inPeriod=entries.filter(e=>e.date>=start&&e.date<=end),counts=new Map<string,{yes:number;no:number}>();
 for(const e of inPeriod)for(const [id,a]of Object.entries(e.answers||{})){if(a.value!=='yes'&&a.value!=='no')continue;const c=counts.get(id)||{yes:0,no:0};c[a.value]++;counts.set(id,c);}
 const covered=new Set([...Object.values(series).flat().filter(p=>inRange(p,start,end)).map(p=>p.date)]).size;
 return{kind,start,end,label:periodLabel(kind,start,end),days,days_with_data:covered,previous_period:{start:pStart,end:pEnd},usual_window:{start:bStart,end:pEnd},metrics,sleep_timing:sleepTiming,
  exercise:{sessions:ex.length,minutes:minutes(ex),previous_sessions:exPrev.length,previous_minutes:minutes(exPrev)},
  journal:{days_logged:inPeriod.length,completed:inPeriod.filter(e=>e.completed).length,morning_ratings:inPeriod.filter(e=>e.morning?.overall!=null).length,habits:[...counts].map(([id,c])=>({habit:habits.find(h=>h.id===id)?.label||id,...c}))}};
}
export type PeriodStats=ReturnType<typeof periodStats>;
