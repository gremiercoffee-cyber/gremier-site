import {localDate,shiftDate,sleepJournalDate,HABIT_CATALOG,type Habit,type Measurement,type Journal} from './daynote';
import {bedtimeFor} from './recovery';
export const PERSONAL_VERSION='personal-health-1';
const mean=(v:number[])=>v.reduce((a,b)=>a+b,0)/v.length;
const clamp=(v:number,a:number,b:number)=>Math.max(a,Math.min(b,v));
const quantile=(v:number[],p=.5)=>{const a=[...v].sort((a,b)=>a-b);return a.length?a[Math.floor((a.length-1)*p)]:null;};
const finite=(v:unknown,a:number,b:number):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=a&&v<=b;
const median=(v:number[])=>quantile(v)!;
const z=(v:number,history:number[],floor:number)=>clamp((v-median(history))/Math.max(floor,1.4826*median(history.map(x=>Math.abs(x-median(history))))),-3,3);
const priority=(m:Measurement)=>m.raw?.source==='google_android_review'?4:m.id.startsWith('users/')?3:m.id.startsWith('takeout:')?2:1;
export type PersonalDay={date:string;hrv:number|null;rhr:number|null;sleep:number|null;in_bed:number|null;features:number[]|null;recovery:number|null;vendor:number|null;load:number|null;load_minutes:number;load_at:string|null;load_complete:boolean;answers:Journal['answers'];energy:number|null};
function pick(rows:Measurement[],type:string,date:string){return rows.filter(m=>m.type===type&&m.date===date).sort((a,b)=>(type==='heart-rate-summary'?(Number(b.raw?.coverage_minutes)||0)-(Number(a.raw?.coverage_minutes)||0):0)||priority(b)-priority(a)||a.id.localeCompare(b.id))[0];}
/** One source per day, one mean per observed minute. Gaps are never filled or scaled to 24h. */
export function summarizeHeartRate(points:any[],source='google_api_hr',captured_at=new Date().toISOString()):Measurement[]{
 const streams=new Map<string,Map<number,number[]>>();
 for(const p of points){const h=p.heartRate,t=Date.parse(h?.sampleTime?.physicalTime),b=Number(h?.beatsPerMinute);if(!Number.isFinite(t)||t>Date.parse(captured_at)||!finite(b,30,240)||p.dataSource?.recordingMethod==='MANUALLY_ENTERED')continue;const key=JSON.stringify(p.dataSource||{}),minutes=streams.get(key)||new Map<number,number[]>(),minute=Math.floor(t/60000),values=minutes.get(minute)||[];if(!values.includes(b))values.push(b);minutes.set(minute,values);streams.set(key,minutes);}
 const days=new Map<string,{bins:Map<number,number>;minutes:number;first:number;last:number}>();
 for(const [stream,minutes]of streams){const byDay=new Map<string,typeof days extends Map<any,infer V>?V:never>();for(const [minute,values]of minutes){const date=localDate(new Date(minute*60000).toISOString()),d=byDay.get(date)||{bins:new Map(),minutes:0,first:minute,last:minute},b=Math.round(mean(values));d.bins.set(b,(d.bins.get(b)||0)+1);d.minutes++;d.first=Math.min(d.first,minute);d.last=Math.max(d.last,minute);byDay.set(date,d);}for(const [date,d]of byDay)if(!days.has(date)||d.minutes>days.get(date)!.minutes)days.set(date,d);void stream;}
 return [...days].map(([date,d])=>({id:'api:google:heart-rate-summary:'+date,type:'heart-rate-summary',date,start_at:new Date(d.first*60000).toISOString(),end_at:new Date((d.last+1)*60000).toISOString(),value:null,raw:{source,captured_at,coverage_minutes:d.minutes,bins:[...d.bins].sort((a,b)=>a[0]-b[0]),method:'one-source-per-day; distinct readings averaged within observed minute; no gap filling',final:date<localDate(captured_at)&&d.minutes>=720}}));
}
/** Explicit personal load index input: sum(observed minutes * max(0,(HR-RHR)/RHR)^2).
 * This is our excess-heart-rate index, NOT WHOOP Strain, Google Cardio Load or validated TRIMP. */
export function loadImpulse(m:Measurement|undefined,rest:number|null){
 if(!m||!finite(rest,35,120)||!Array.isArray(m.raw?.bins))return null;
 const bins=m.raw.bins as unknown[];if(!bins.length||bins.length>211)return null;let total=0,minutes=0;
 for(const bin of bins){if(!Array.isArray(bin)||bin.length!==2||!finite(bin[0],30,240)||!finite(bin[1],1,1500))return null;minutes+=bin[1];total+=bin[1]*Math.max(0,(bin[0]-rest)/rest)**2;}
 return minutes<=1500&&m.raw.coverage_minutes===minutes?{impulse:total,minutes}:null;
}
export function personalDays(measurements:Measurement[],journals:Journal[],through:string):PersonalDay[]{
 const eligible=measurements.filter(m=>m.date<=through),dates=[...new Set(eligible.map(m=>m.date))].sort(),rows:PersonalDay[]=[];
 const sleeps=new Map<string,Measurement>();for(const s of eligible.filter(m=>m.type==='sleep'&&m.start_at&&m.end_at&&m.raw?.sleep?.metadata?.nap!==true&&m.raw?.sleep?.metadata?.processed!==false&&finite(m.value,180,840))){if(localDate(s.end_at!)>through)continue;const d=localDate(s.end_at!),old=sleeps.get(d);if(!old||s.value!>old.value!||s.value===old.value&&priority(s)>priority(old))sleeps.set(d,s);}
 for(const date of dates){
  const past=rows.filter(r=>r.date>=shiftDate(date,-35)&&r.date<date),hs=past.filter(r=>r.hrv!==null).map(r=>Math.log(r.hrv!)),rs=past.filter(r=>r.rhr!==null).map(r=>r.rhr!),ss=past.filter(r=>r.sleep!==null).map(r=>r.sleep!);
  const h=pick(eligible,'daily-heart-rate-variability',date)?.value,r=pick(eligible,'daily-resting-heart-rate',date)?.value,s=sleeps.get(date),hrv=finite(h,1,500)?h:null,rhr=finite(r,35,120)?r:null,sleep=s?.value??null;
  const duration=s?.start_at&&s.end_at?(Date.parse(s.end_at)-Date.parse(s.start_at))/60000:null,inBed=duration!==null&&sleep!==null&&duration>=sleep&&duration<=960?duration:null;
  const features=hrv!==null&&rhr!==null&&sleep!==null&&inBed!==null&&hs.length>=14&&rs.length>=14&&ss.length>=14?[z(Math.log(hrv),hs,.1),z(rhr,rs,2),z(sleep,ss,30)]:null;
  const recovery=features?Math.round(clamp(50+12*(.5*features[0]-.3*features[1]+.2*features[2]),0,100)):null;
  const summary=pick(eligible,'heart-rate-summary',date),rest=rhr??(rs.length>=14?median(rs):null),load=loadImpulse(summary,rest),j=journals.find(j=>j.date===date),v=pick(eligible,'google_readiness',date)?.value;
  rows.push({date,hrv,rhr,sleep:inBed===null?null:sleep,in_bed:inBed,features,recovery,vendor:finite(j?.readiness,0,100)?j!.readiness!:finite(v,0,100)?v:null,load:load?.impulse??null,load_minutes:load?.minutes??0,load_at:summary?.end_at??null,load_complete:!!summary?.raw?.final&&date<through,answers:j?.answers||{},energy:j?.energy??null});
 }return rows;
}
type Example={date:string;x:number[];y:number};
type Fit={weights:number[];means:number[];scales:number[]};
function fit(examples:Example[],lambda=10):Fit|null{
 if(examples.length<20)return null;const n=examples[0].x.length,means=Array.from({length:n},(_,i)=>mean(examples.map(r=>r.x[i]))),scales=means.map((m,i)=>Math.max(.1,Math.sqrt(mean(examples.map(r=>(r.x[i]-m)**2))))),a=Array.from({length:n+1},()=>Array(n+2).fill(0));
 for(const r of examples){const x=[1,...r.x.map((v,i)=>(v-means[i])/scales[i])];for(let i=0;i<=n;i++){for(let j=0;j<=n;j++)a[i][j]+=x[i]*x[j];a[i][n+1]+=x[i]*r.y;}}
 for(let i=1;i<=n;i++)a[i][i]+=lambda;
 for(let i=0;i<=n;i++){let pivot=i;for(let k=i+1;k<=n;k++)if(Math.abs(a[k][i])>Math.abs(a[pivot][i]))pivot=k;[a[i],a[pivot]]=[a[pivot],a[i]];if(Math.abs(a[i][i])<1e-8)return null;const d=a[i][i];for(let j=i;j<=n+1;j++)a[i][j]/=d;for(let k=0;k<=n;k++)if(k!==i){const f=a[k][i];for(let j=i;j<=n+1;j++)a[k][j]-=f*a[i][j];}}
 return{weights:a.map(r=>r[n+1]),means,scales};
}
const predict=(f:Fit,x:number[])=>f.weights[0]+x.reduce((s,v,i)=>s+f.weights[i+1]*(v-f.means[i])/f.scales[i],0);
/** Rolling-origin evaluation. A vendor label is a comparison target, not physiological ground truth. */
function evaluate(examples:Example[],baselineFeature:number|null=null){let error=0,base=0,n=0;for(let i=40;i<examples.length;i++){const train=examples.slice(Math.max(0,i-180),i),f=fit(train);if(!f)continue;const r=examples[i];error+=Math.abs(predict(f,r.x)-r.y);const baseline=baselineFeature===null?null:fit(train.map(e=>({...e,x:[e.x[baselineFeature]]})));base+=Math.abs((baseline?predict(baseline,[r.x[baselineFeature!]]):mean(train.map(r=>r.y)))-r.y);n++;}return{n,mae:n?error/n:null,baseline_mae:n?base/n:null,improves:n>=14&&error<base*.95};}
function calibration(rows:PersonalDay[]){const examples=rows.filter(r=>r.features&&r.vendor!==null).map(r=>({date:r.date,x:r.features!,y:r.vendor!})),evaluation=evaluate(examples);return{examples,model:evaluation.improves?fit(examples.slice(-180)):null,evaluation};}
const knownConfound=(r:PersonalDay)=>['illness','travel','time_zone_change'].some(k=>r.answers[k]?.value==='yes');
export function personalModel(measurements:Measurement[],journals:Journal[],date:string,wakeTime:string|null=null,habits:Habit[]=HABIT_CATALOG){
 const rows=personalDays(measurements,journals,date),today=rows.find(r=>r.date===date),history=rows.filter(r=>r.date<date),cal=calibration(history),rawScore=today?.recovery??null;
 // Vendor labels are external checks only. They NEVER set the primary recovery score.
 const value=rawScore;
 const loads=history.filter(r=>r.load!==null&&r.load_complete).map(r=>r.load!),scale=loads.length>=14?Math.max(1,quantile(loads,.9)!):null,load=today?.load??null;
 const ownLoad=load===null?null:{value:scale===null?null:Math.round(clamp(100*(1-Math.exp(-Math.log(10)*load/scale)),0,100)),weighted_minutes:Math.round(load*10)/10,coverage_minutes:today!.load_minutes,observed_at:today!.load_at,complete:today!.load_complete,scale_days:loads.length,source:'Personal cardiovascular load',partial:!today!.load_complete};
 // Outcome rows connect the habit/load day to the following morning. No same-night or future leakage.
 const outcomes:Example[]=[],usable=rows.filter(r=>r.features&&r.sleep!==null&&!knownConfound(r));
 for(const next of usable){const prior=rows.find(r=>r.date===shiftDate(next.date,-1));if(!prior?.features||prior.load===null||!prior.load_complete||knownConfound(prior))continue;outcomes.push({date:next.date,x:[prior.recovery!,Math.log1p(prior.load),next.sleep!],y:clamp(50+12*(.625*next.features![0]-.375*next.features![1]),0,100)});}
 const loadExamples=history.filter(r=>r.load!==null&&r.load_complete).flatMap(r=>{const native=pick(measurements,'google_cardio_load',r.date),j=journals.find(j=>j.date===r.date),v=j?.cardio_load_final&&finite(j.cardio_load,0,100000)?j.cardio_load:native?.raw?.final===true?native.value:null;return finite(v,0,100000)?[{date:r.date,x:[Math.log1p(r.load!)],y:v}]:[];}),loadEvaluation=evaluate(loadExamples),loadFit=loadEvaluation.improves?fit(loadExamples.slice(-180)):null;
 const forecastEval=evaluate(outcomes,2),forecast=forecastEval.improves?fit(outcomes.slice(-180)):null;
 // Sleep target uses actual future-morning outcomes, not vendor numbers on the load day.
 const matches=load===null||today?.recovery===null||today?.recovery===undefined?[]:outcomes.filter(e=>Math.abs(e.x[0]-today.recovery!)<=15&&Math.abs(e.x[1]-Math.log1p(load))<=.5),good=matches.filter(e=>e.y>=60);
 const whoopBaselines=measurements.filter(m=>m.type==='whoop_sleep'&&m.end_at&&localDate(m.end_at)<=date).map(m=>Number(m.raw?.score?.sleep_needed?.baseline_milli)/60000).filter(v=>finite(v,360,600));
 const googleRested=history.filter(r=>r.recovery!==null&&r.recovery>=60&&r.sleep!==null&&(r.energy===null||r.energy>=6)&&!knownConfound(r)).map(r=>r.sleep!);
 const baseline=googleRested.length>=14?quantile(googleRested,.6):whoopBaselines.length>=14?median(whoopBaselines):null;
 const learned=matches.length>=12&&good.length>=5?Math.max(quantile(good.map(e=>e.x[2]),.6)!,median(matches.map(e=>e.x[2]))):null;
 let target=learned??baseline,basis=learned!==null?'Similar days followed by above-baseline HRV/RHR recovery':googleRested.length>=14?'Sleep observed before above-baseline Google-measured mornings':'Historical WHOOP baseline sleep need; not current WHOOP calibration';
 const lastWeek=history.filter(r=>r.date>=shiftDate(date,-7)&&r.sleep!==null),debt=baseline!==null&&lastWeek.length>=5?Math.max(0,lastWeek.reduce((sum,r)=>sum+baseline-r.sleep!,0)):null;
 // Conservative recovery allowance is a versioned heuristic, not a fitted biological debt equation.
 const debtAllowance=debt===null?0:Math.min(60,debt/4),napMinutes=measurements.filter(m=>m.type==='sleep'&&m.raw?.sleep?.metadata?.nap===true&&m.end_at&&localDate(m.end_at)===date&&finite(m.value,10,180)).reduce((sum,m)=>sum+m.value!,0),napCredit=Math.min(45,napMinutes*.5);
 if(target!==null)target=Math.ceil(clamp(target+debtAllowance-napCredit,420,600)/15)*15;
 const awake=medianOrNull(history.filter(r=>r.in_bed!==null&&r.sleep!==null).map(r=>r.in_bed!-r.sleep!)),inBed=target===null||awake===null?null:Math.ceil((target+awake)/15)*15;
 const prediction=forecast&&today?.recovery!==null&&today?.recovery!==undefined&&load!==null&&target!==null?Math.round(clamp(predict(forecast,[today.recovery,Math.log1p(load),target]),0,100)):null;
 const missing=[...(!today?.sleep?['sleep']:[]),...(today?.hrv===null||today?.hrv===undefined?['HRV']:[]),...(today?.rhr===null||today?.rhr===undefined?['resting heart rate']:[]),...(load===null?['heart-rate samples']:[])];
 const associations=habitEffects(rows,journals,date,habits);
 const sleepDetails=sleepContext(measurements,date);
 const wellbeing={reported_energy:today?.energy??null,paired_mornings:rows.filter(r=>r.recovery!==null&&r.energy!==null).length};
 return{version:PERSONAL_VERSION,date,sleep:sleepDetails,wellbeing,recovery:value===null?null:{value,source:'Personal recovery estimate',method:'Independent personal-baseline index',band:value>=60?'Above baseline':value<40?'Below baseline':'Typical',baseline_days:history.filter(r=>r.features).length,confidence:'experimental'},load:ownLoad,plan:target===null?null:{sleep_minutes:target,range_minutes:[Math.max(420,target-30),Math.min(600,target+30)],time_in_bed_minutes:inBed,bedtime:wakeTime&&inBed?bedtimeFor(date,wakeTime,inBed):null,basis,conditional:learned!==null,similar_nights:matches.length,good_nights:good.length,baseline_minutes:baseline,debt_allowance_minutes:Math.round(debtAllowance),nap_credit_minutes:Math.round(napCredit),predicted_next_baseline_index:prediction},calibration:{provider:'google',training_n:cal.examples.length,...cal.evaluation,estimated_google_reference:cal.model&&today?.features?Math.round(clamp(predict(cal.model,today.features),0,100)):null,status:cal.model?'reference_fit_available':'not_validated',meaning:'Agreement with Google Readiness, not validation of health or performance'},load_calibration:{training_n:loadExamples.length,...loadEvaluation,estimated_google_reference:loadFit&&load!==null?Math.max(0,Math.round(predict(loadFit,[Math.log1p(load)]))):null,status:loadFit?'improves_on_vendor_baseline':'not_validated'},forecast:{training_n:outcomes.length,...forecastEval,meaning:'Retrospective conditional fit using actual subsequent sleep; predicts HRV/RHR recovery index, not a prospective guarantee',baseline:'sleep-only regression',status:forecast?'improves_on_baseline':'not_validated'},habits:associations,missing,requires_whoop:false,limitations:['Experimental personal indices, not Google Readiness or WHOOP Strain. Index points are not probabilities. Published research motivates the inputs, not our exact prototype weights.','Missing watch time is unknown, not zero load; no upscaling to a complete day.','Vendor scores are comparison checks only and never determine Personal Recovery or Personal Load. WHOOP sleep need is an explicitly labelled fallback prior.','Cardiovascular load does not measure muscular strain from resistance work.','Sleep target describes associations. Changing sleep duration is not guaranteed to cause higher recovery.','Debt and nap adjustments are conservative heuristics. Sleep stages are not treated as precise ground truth.']};
}
function medianOrNull(v:number[]){return v.length?median(v):null;}
function habitEffects(rows:PersonalDay[],journals:Journal[],date:string,habits:Habit[]){const allowed=new Map(habits.filter(h=>!/supplement|medication/i.test(h.category)).map(h=>[h.id,h.label]));const out:{id:string;label:string;n_yes:number;n_no:number;difference:number}[]=[];const ids=[...new Set(journals.filter(j=>j.date<date).flatMap(j=>Object.keys(j.answers)))];for(const id of ids){if(!allowed.has(id)||/supplement|medication/.test(id))continue;const yes:number[]=[],no:number[]=[];for(const next of rows){if(next.recovery===null)continue;const prior=journals.find(j=>j.date===shiftDate(next.date,-1));if(!prior||knownConfound({...next,answers:prior.answers}))continue;const a=prior.answers[id]?.value;if(a==='yes')yes.push(next.recovery);else if(a==='no')no.push(next.recovery);}if(yes.length>=7&&no.length>=7)out.push({id,label:allowed.get(id)!,n_yes:yes.length,n_no:no.length,difference:Math.round((mean(yes)-mean(no))*10)/10});}return out.sort((a,b)=>Math.abs(b.difference)-Math.abs(a.difference)).slice(0,5);}

/** Duration, continuity and timing are distinct sleep-health dimensions. No universal REM/deep quotas. */
function sleepContext(points:Measurement[],date:string){
 const sleeps=points.filter(m=>m.type==='sleep'&&m.start_at&&m.end_at&&localDate(m.end_at)<=date&&m.raw?.sleep?.metadata?.nap!==true&&finite(m.value,180,840)).sort((a,b)=>b.value!-a.value!);
 const today=sleeps.find(m=>localDate(m.end_at!)===date),unique=new Map<string,Measurement>();for(const s of sleeps)if(localDate(s.end_at!)>=shiftDate(date,-14)&&!unique.has(localDate(s.end_at!)))unique.set(localDate(s.end_at!),s);
 const mins=(s:string)=>{const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Jerusalem',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(s));return Number(parts.find(p=>p.type==='hour')?.value)*60+Number(parts.find(p=>p.type==='minute')?.value);};
 const bedtimes=[...unique.values()].map(s=>mins(s.start_at!)),angles=bedtimes.map(m=>m/1440*2*Math.PI),center=angles.length?Math.atan2(mean(angles.map(Math.sin)),mean(angles.map(Math.cos))):null;
 const deviation=center===null?null:Math.round(mean(angles.map(a=>Math.abs(Math.atan2(Math.sin(a-center),Math.cos(a-center)))))*1440/(2*Math.PI));
 const inBed=today?(Date.parse(today.end_at!)-Date.parse(today.start_at!))/60000:null;
 return{duration_minutes:today?.value??null,efficiency_percent:today&&inBed&&inBed>=today.value!?Math.round(100*today.value!/inBed):null,bedtime_variation_minutes:bedtimes.length>=7?deviation:null,timing_n:bedtimes.length,stage_policy:'REM and deep sleep are shown as device estimates, not optimized to fixed minute/percentage targets',below_adult_duration_guideline:today?today.value!<420:null};
}
