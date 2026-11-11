import {localDate,shiftDate,type Journal} from './daynote';
import type {NightScore} from './daynote-scores';
export const RESEARCH_VERSION='sleep-body-2';
export type MorningReview={overall?:number|null;quality:number|null;rested:number|null;sleepiness:number|null;alarm:boolean|null;opportunity:boolean|null;sleep_minutes:number|null;naps_minutes:number|null;recorded_at?:string};
export const EMPTY_MORNING:MorningReview={quality:null,rested:null,sleepiness:null,alarm:null,opportunity:null,sleep_minutes:null,naps_minutes:null};
export type SleepProfile={age:number|null;reference_low:number|null;reference_high:number|null;functional_minutes:number|null;source:'owner_reported'|'unset';friday_night_minutes:number|null;shabbos_nap_minutes:number|null;revision?:number};
export const EMPTY_SLEEP_PROFILE:SleepProfile={age:null,reference_low:null,reference_high:null,functional_minutes:null,source:'unset',friday_night_minutes:null,shabbos_nap_minutes:null};
const finite=(v:unknown,low:number,high:number):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=low&&v<=high;
export function validMorning(r:any){return r&&typeof r==='object'&&!Array.isArray(r)&&(r.overall===undefined||r.overall===null||finite(r.overall,0,10)&&Number.isInteger(r.overall))&&['quality','rested','sleepiness'].every(k=>r[k]===null||finite(r[k],0,10))&&['alarm','opportunity'].every(k=>r[k]===null||typeof r[k]==='boolean')&&(r.sleep_minutes===null||finite(r.sleep_minutes,1,1080))&&(r.naps_minutes===null||finite(r.naps_minutes,0,600));}
export function validSleepProfile(p:any):p is SleepProfile{return p&&['owner_reported','unset'].includes(p.source)&&(p.age===null||Number.isInteger(p.age)&&finite(p.age,18,100))&&(p.reference_low===null&&p.reference_high===null||finite(p.reference_low,240,720)&&finite(p.reference_high,p.reference_low,840))&&(p.functional_minutes===null||finite(p.functional_minutes,180,720))&&(p.friday_night_minutes===null||finite(p.friday_night_minutes,1,1080))&&(p.shabbos_nap_minutes===null||finite(p.shabbos_nap_minutes,0,600));}
const mean=(v:number[])=>v.reduce((a,b)=>a+b,0)/v.length;
const quantile=(v:number[],p=.5)=>{const a=[...v].sort((a,b)=>a-b),i=(a.length-1)*p,lo=Math.floor(i);return a[lo]+(a[Math.ceil(i)]-a[lo])*(i-lo);};
const clip=(v:number,lo=0,hi=10)=>Math.max(lo,Math.min(hi,v));
const circleDistance=(a:number,b:number)=>Math.abs(((a-b+2160)%1440)-720);
export type ResearchDay={date:string;main_minutes:number|null;method:'watch'|'manual'|'assumed'|'missing';naps_minutes:number|null;naps_method:'watch'|'manual'|'assumed'|'missing';naps_complete:boolean;total_known:number|null;efficiency:number|null;deep_minutes?:number|null;rem_share?:number|null;long_awake?:number|null;midpoint:number|null;timing_deviation:number|null;vitals:NightScore['body_components'];quality:number|null;energy:number|null;review:MorningReview|null;eligible_rating:boolean;excluded:boolean;device:string;physiology_protocol:string;features:(number|null)[]};
/** All diary fields belong to the displayed wake date. naps_minutes explicitly covers the PREVIOUS waking day. */
export function researchDays(nights:NightScore[],journals:Journal[],through:string,profile:SleepProfile=EMPTY_SLEEP_PROFILE):ResearchDay[]{
 const ns=new Map(nights.filter(n=>n.date<=through).map(n=>[n.date,n])),js=new Map(journals.filter(j=>j.date<=through).map(j=>[j.date,j]));
 const dates=[...new Set([...ns.keys(),...js.keys(),...Array.from({length:90},(_,i)=>shiftDate(through,-i))])].sort(),result:ResearchDay[]=[];let windowStart=0;
 for(const date of dates){const n=ns.get(date),j=js.get(date),review=j?.morning??null,manual=review?.sleep_minutes,isSaturday=new Date(date+'T12:00:00Z').getUTCDay()===6,isSunday=new Date(date+'T12:00:00Z').getUTCDay()===0,assumedMain=isSaturday?profile.friday_night_minutes:null,main=finite(manual,1,1080)?manual:n?.sleep?.minutes??assumedMain;
  const method=finite(manual,1,1080)?'manual':n?.sleep?'watch':assumedMain!==null?'assumed':'missing',priorDay=ns.get(shiftDate(date,-1));
  // A reported total takes precedence over detected naps, never sums onto the same naps again.
  const detected=(priorDay?.naps||[]).reduce((s,p)=>s+p.minutes,0),reported=review?.naps_minutes;
  const assumedNap=isSunday?profile.shabbos_nap_minutes:null,naps=finite(reported,0,600)?reported:detected>0?detected:assumedNap,naps_method=finite(reported,0,600)?'manual':detected>0?'watch':assumedNap!==null?'assumed':'missing';
  // Days are in date order, so the 28-day window only ever moves forward: a full year stays cheap.
  const from28=shiftDate(date,-28),from6=shiftDate(date,-6);while(windowStart<result.length&&result[windowStart].date<from28)windowStart++;
  const past=result.slice(windowStart),mids=method==='watch'?past.filter(r=>r.method==='watch'&&r.device===n?.sleep?.source.key&&r.midpoint!==null).map(r=>r.midpoint!):[];
  const spread=mids.map(a=>mids.reduce((s,x)=>s+circleDistance(x,a),0));
  const center=mids.length>=7?mids[spread.reduce((best,v,i)=>spread[best]<=v?best:i,0)]:null;
  const recent=past.filter(r=>r.date>=from6&&r.method!=='assumed'&&r.main_minutes!==null).map(r=>r.main_minutes!/60),vitals=n?.body_components.filter(c=>c.key!=='sleep')||[];
  const z=(key:string)=>{const c=vitals.find(c=>c.key===key);return c?.z===undefined?null:c.z;};
  const at=review?.recorded_at?Date.parse(review.recorded_at):NaN,lag=(at-Date.parse(date+'T00:00:00Z'))/3600000;
  const day:ResearchDay={date,main_minutes:main,method,naps_minutes:naps,naps_method,naps_complete:finite(reported,0,600),total_known:main===null?null:main+(naps||0),efficiency:method==='watch'?n?.sleep?.efficiency??null:null,deep_minutes:method==='watch'&&n?.sleep?.stages?n.sleep.stages.DEEP??0:null,rem_share:method==='watch'&&n?.sleep?.stages&&n.sleep.minutes?(n.sleep.stages.REM??0)/n.sleep.minutes:null,long_awake:method==='watch'?n?.sleep?.long_awake_minutes??null:null,midpoint:method==='watch'?n?.sleep?.midpoint??null:null,timing_deviation:center!==null&&n?.sleep?circleDistance(n.sleep.midpoint,center):null,vitals,quality:review?.quality??null,energy:j?.energy??null,review,eligible_rating:Number.isFinite(at)&&localDate(new Date(at))>=date&&localDate(new Date(at))<=shiftDate(date,1)&&(!n?.sleep||at>=Date.parse(n.sleep.end)),excluded:[j,js.get(shiftDate(date,-1))].some(v=>v?.answers.illness?.value==='yes'||v?.answers.travel?.value==='yes'),device:n?.sleep?.source.key||'manual',physiology_protocol:['hrv','rhr'].map(k=>vitals.find(v=>v.key===k)?.source?.key||'missing').join(';'),features:[]};
  day.features=[main===null?null:main/60,day.efficiency,day.timing_deviation===null?null:day.timing_deviation/60,recent.length>=3?mean(recent):null,day.naps_complete&&naps!==null?naps/60:null,z('hrv'),z('rhr'),z('resp'),z('temp')];result.push(day);
 }return result;
}
export function sleepContext(days:ResearchDay[],date:string,profile:SleepProfile){
 const lookup=new Map(days.map(d=>[d.date,d])),day=lookup.get(date),low=profile.reference_low,high=profile.reference_high;
 const seven=Array.from({length:7},(_,i)=>{const d=shiftDate(date,i-6),r=lookup.get(d);return {date:d,minutes:r?.total_known??null,naps_complete:r?.naps_complete??false,method:r?.method||'missing',naps_method:r?.naps_method||'missing'};});
 const observed=seven.filter(d=>d.minutes!==null),missing=seven.filter(d=>d.minutes===null).map(d=>d.date),unknownNaps=seven.filter(d=>d.minutes!==null&&!d.naps_complete).map(d=>d.date);
 const gap=low!==null&&high!==null&&observed.length?[observed.reduce((s,d)=>s+Math.max(0,low-d.minutes!),0),observed.reduce((s,d)=>s+Math.max(0,high-d.minutes!),0)]:null;
 const assumed=seven.filter(d=>d.method==='assumed'||d.naps_method==='assumed').map(d=>d.date);
 const qualified=days.filter(d=>d.method!=='assumed'&&d.naps_method!=='assumed'&&d.date<date&&d.date>=shiftDate(date,-90)&&!d.excluded&&d.main_minutes!==null&&d.review?.alarm===false&&d.review?.opportunity===true&&finite(d.review.rested,7,10)&&finite(d.review.sleepiness,0,3)&&d.naps_complete);
 // Observed rested nights are corroboration, not laboratory-derived physiological need. No automatic target reduction.
 const learned=qualified.length>=14?{low:Math.round(quantile(qualified.map(d=>d.main_minutes!),.25)),high:Math.round(quantile(qualified.map(d=>d.main_minutes!),.75)),count:qualified.length,label:'Observed rested-night range; not measured biological need'}:null;
 return {reference:profile,main_minutes:day?.main_minutes??null,method:day?.method??'missing',naps_minutes:day?.naps_minutes??null,naps_method:day?.naps_method??'missing',naps_complete:day?.naps_complete??false,known_sleep_minutes:day?.total_known??null,adequacy_range:day?.total_known!==null&&day?.total_known!==undefined&&low!==null&&high!==null?[Math.round(100*day.total_known/high),Math.round(100*day.total_known/low)]:null,week:{observed:observed.length,assumed_dates:assumed,missing_dates:missing,naps_unknown_dates:unknownNaps,recorded_shortfall_range:gap,complete:missing.length===0&&unknownNaps.length===0&&assumed.length===0,days:seven},rested_reference:learned,qualified_reference_nights:qualified.length,limitation:'Recorded shortfall is an accounting comparison with your reference, not measured physiological debt. Extra sleep does not erase prior shortfalls.'};
}

type Example={date:string;x:(number|null)[];y:number;method:string;device:string};
function solve(a:number[][],b:number[]){const n=b.length,m=a.map((r,i)=>[...r,b[i]]);for(let k=0;k<n;k++){let p=k;for(let i=k+1;i<n;i++)if(Math.abs(m[i][k])>Math.abs(m[p][k]))p=i;[m[k],m[p]]=[m[p],m[k]];const d=m[k][k];if(Math.abs(d)<1e-10)return null;for(let j=k;j<=n;j++)m[k][j]/=d;for(let i=0;i<n;i++)if(i!==k){const f=m[i][k];for(let j=k;j<=n;j++)m[i][j]-=f*m[k][j];}}return m.map(r=>r[n]);}
function fit(rows:Example[]){
 const p=rows[0].x.length,centers=Array.from({length:p},(_,i)=>{const a=rows.map(r=>r.x[i]).filter((x):x is number=>x!==null);return a.length?quantile(a):0;}),scales=centers.map((c,i)=>{const v=rows.map(r=>r.x[i]).filter((x):x is number=>x!==null);return Math.max(.01,v.length?Math.sqrt(mean(v.map(x=>(x-c)**2))):1);});
 const design=(x:(number|null)[])=>[1,...x.map((v,i)=>((v??centers[i])-centers[i])/scales[i]),...x.map(v=>v===null?1:0)],xs=rows.map(r=>design(r.x)),n=xs[0].length,a=Array.from({length:n},()=>Array(n).fill(0)),b=Array(n).fill(0);
 for(let k=0;k<rows.length;k++)for(let i=0;i<n;i++){b[i]+=xs[k][i]*rows[k].y;for(let j=0;j<n;j++)a[i][j]+=xs[k][i]*xs[k][j];}for(let i=1;i<n;i++)a[i][i]+=10;const beta=solve(a,b);if(!beta)return null;
 return {predict:(x:(number|null)[])=>clip(design(x).reduce((s,v,i)=>s+v*beta[i],0)),beta,centers,scales,contributions:(x:(number|null)[])=>x.map((v,i)=>((v??centers[i])-centers[i])/scales[i]*beta[i+1])};
}
export type PersonalEstimate={value:number|null;interval:[number,number]|null;status:string;matched:number;holdout:number;mae:number|null;baseline_mae:number|null;reason:string;coefficients?:{feature:string;coefficient:number;contribution:number}[];target:string;basis?:'baseline'|'ratings'};
const featureNames=['sleep hours','asleep fraction','midpoint deviation','previous six-day observed mean sleep','reported previous-day nap hours','log-HRV deviation','resting pulse deviation','breathing deviation','temperature deviation'];
/** A preregistered research gate, not clinical validation. No vendor score is a target. */
export function personalEstimate(days:ResearchDay[],date:string,kind:'sleep'|'body'):PersonalEstimate{
 const current=days.find(d=>d.date===date),p=kind==='sleep'?5:9,target=kind==='sleep'?'reported sleep quality':'reported morning energy';
 const examples:Example[]=days.filter(d=>d.method!=='assumed'&&d.date<date&&(kind==='sleep'||d.physiology_protocol===current?.physiology_protocol)&&d.eligible_rating&&!d.excluded&&d.main_minutes!==null&&finite(kind==='sleep'?d.quality:d.energy,0,10)&&(kind==='sleep'||d.features[5]!==null&&d.features[6]!==null)).map(d=>({date:d.date,x:d.features.slice(0,p),y:(kind==='sleep'?d.quality:d.energy)!,method:d.method,device:d.device}));
 const out:PersonalEstimate={value:null,interval:null,status:'Learning',matched:examples.length,holdout:0,mae:null,baseline_mae:null,reason:'Needs at least 60 earlier training days plus 30 later test days with timely morning ratings.',target};
 if(examples.length<90)return out;
 const errors:number[]=[],baseErrors:number[]=[],improvements:number[]=[],testCases:{x:(number|null)[];method:string;device:string;error:number}[]=[];
 // Every test date is predicted using earlier examples only. Train-only imputation/scaling includes missingness indicators.
 const evaluated=60+30*Math.floor((examples.length-60)/30);
 for(let i=60;i<evaluated;i++){const train=examples.slice(Math.max(0,i-180),i),f=fit(train);if(!f)continue;const y=examples[i].y,pred=f.predict(examples[i].x),error=Math.abs(y-pred),baseline=Math.abs(y-quantile(train.map(r=>r.y))),last=Math.abs(y-train.at(-1)!.y);errors.push(error);testCases.push({x:examples[i].x,method:examples[i].method,device:examples[i].device,error});baseErrors.push(Math.min(baseline,last));improvements.push(Math.min(baseline,last)-error);}
 out.holdout=errors.length;out.mae=errors.length?mean(errors):null;out.baseline_mae=baseErrors.length?mean(baseErrors):null;
 // Fixed non-overlapping seven-observation blocks: uncertainty in average error improvement, accounting approximately for dependence.
 const blocks=Array.from({length:Math.floor(improvements.length/7)},(_,i)=>mean(improvements.slice(i*7,i*7+7))),mu=blocks.length?mean(blocks):0,se=blocks.length>1?Math.sqrt(blocks.reduce((s,v)=>s+(v-mu)**2,0)/(blocks.length-1)/blocks.length):Infinity;
 if(errors.length<30||out.baseline_mae===null||out.baseline_mae<.2||out.mae!>out.baseline_mae*.9||mu-3.2*se<=0){out.reason='The model has not reliably beaten simple earlier-rating baselines on later dates.';return out;}
 if(!current||current.method==='assumed'||current.main_minutes===null||kind==='body'&&(current.features[5]===null||current.features[6]===null)){out.status='Missing inputs';out.reason='Current sleep and, for Body Score, calibrated HRV and resting pulse are required.';return out;}
 const x=current.features.slice(0,p),pattern=(v:(number|null)[])=>v.map(n=>n===null?'0':'1').join('');if(examples.filter(r=>pattern(r.x)===pattern(x)&&r.method===current.method&&r.device===current.device).length<10){out.reason='Not enough earlier examples with this measurement method and missing-data pattern.';return out;}
 for(let j=0;j<p;j++)if(x[j]!==null){const v=examples.map(r=>r.x[j]).filter((v):v is number=>v!==null);if(!v.length||x[j]!<Math.min(...v)||x[j]!>Math.max(...v)){out.status='Outside learned range';out.reason='Current measurements fall outside the observed training range; no extrapolated score.';return out;}}
 const f=fit(examples.slice(-180));if(!f)return out;const matchingErrors=testCases.filter(r=>pattern(r.x)===pattern(x)&&r.method===current.method&&r.device===current.device).map(r=>r.error);if(matchingErrors.length<10){out.reason='Fewer than 10 later-date test predictions for this device, method and missing-data pattern.';return out;}const residualRadius=(values:number[])=>{const e=[...values].sort((a,b)=>a-b);return e[Math.min(e.length-1,Math.ceil((e.length+1)*.9)-1)];},q=Math.max(residualRadius(errors),residualRadius(matchingErrors));if(q>2){out.reason='Prediction uncertainty is wider than 40 points; numerical estimate withheld.';return out;}
 const value=f.predict(x);return {...out,value:Math.round(value*10),interval:[Math.floor(clip(value-q)*10),Math.ceil(clip(value+q)*10)],status:'Personally evaluated estimate',reason:'An estimate of your own rating, not a clinical health or performance assessment. Interval is empirical, not a guaranteed coverage claim.',coefficients:f.beta.slice(1,p+1).map((coefficient,i)=>({feature:featureNames[i],coefficient,contribution:f.contributions(x)[i]}))};
}
/** The watch's wake recording changed here (about 20 awakenings a night became about 2, with no change in deep, REM, HRV or pulse). Never compare wake data across it. */
export const RECORDING_CHANGE='2026-07-11';
const SLEEP_LENGTH_SHARE=.65,USUAL_BODY_SCORE=70,BODY_POINTS_PER_UNIT=20;
const QUALITY_SIGNALS:{weight:number;floor:number;read:(d:ResearchDay)=>number|null|undefined}[]=[
 {weight:.25,floor:.02,read:d=>d.efficiency},
 {weight:.25,floor:5,read:d=>d.long_awake===null||d.long_awake===undefined?null:-d.long_awake},
 {weight:.3,floor:.03,read:d=>d.rem_share},
 {weight:.2,floor:10,read:d=>d.deep_minutes},
];
const hm=(m:number)=>`${Math.floor(m/60)}h${String(Math.round(m%60)).padStart(2,'0')}`;
/** 0 at 4 hours, 100 at the low end of your ideal, then up to 115 by 90 minutes past it, so a long night can offset poor numbers. */
export function sleepLengthPoints(minutes:number,low:number){return minutes<=low?Math.max(0,100*(minutes-240)/(low-240)):100+15*Math.min(1,(minutes-low)/90);}
/** How good the night was against your own recent nights, 0-100, or null when it can't be judged. Not dependent on how long you slept. */
export function sleepQualityPoints(days:ResearchDay[],date:string){
 const current=days.find(d=>d.date===date);if(!current||current.method!=='watch')return null;
 const usable=QUALITY_SIGNALS.filter(q=>q.read(current)!==null&&q.read(current)!==undefined);if(!usable.length)return null;
 const from=shiftDate(date,-90),era=date>=RECORDING_CHANGE,past=days.filter(d=>d.date<date&&d.date>=from&&d.date>=RECORDING_CHANGE===era&&d.method==='watch'&&!d.excluded&&usable.every(q=>q.read(d)!==null&&q.read(d)!==undefined));
 if(past.length<14)return null;
 const scales=usable.map(q=>{const v=past.map(d=>q.read(d)!),center=quantile(v);return {center,spread:Math.max(q.floor,1.4826*quantile(v.map(x=>Math.abs(x-center))))};});
 const total=usable.reduce((s,q)=>s+q.weight,0),combined=(d:ResearchDay)=>usable.reduce((s,q,i)=>s+q.weight/total*(q.read(d)!-scales[i].center)/scales[i].spread,0),tonight=combined(current),others=past.map(combined);
 return Math.round(100*(others.filter(v=>v<tonight).length+others.filter(v=>v===tonight).length/2)/others.length);
}
const bodyReading=(d:ResearchDay,key:string)=>d.vitals?.find(c=>c.key===key)?.value??null;
/** Positive is better. Today against the previous 28 days, the past week against the same, and the past week against the months before, to catch slow slides. */
export function bodyDeviation(days:ResearchDay[],date:string){
 const by=new Map(days.map(d=>[d.date,d])),current=by.get(date);if(!current)return null;
 // HRV leads: it is the more sensitive recovery signal, and resting pulse arrives in whole beats, so a 1-2 beat change is partly rounding.
 const signals=[{z:(d:ResearchDay)=>d.features[5],key:'hrv',long:(v:number)=>Math.log(v),unit:.1,sign:1,weight:.65},{z:(d:ResearchDay)=>d.features[6],key:'rhr',long:(v:number)=>v,unit:2,sign:-1,weight:.35}];
 const week=Array.from({length:7},(_,i)=>by.get(shiftDate(date,-i))).filter((d):d is ResearchDay=>!!d),older=days.filter(d=>d.date<=shiftDate(date,-28)&&d.date>=shiftDate(date,-118));
 const parts=signals.map(s=>{const today=s.z(current);if(today===null||today===undefined)return null;
  const weekZ=week.map(s.z).filter((v):v is number=>v!==null&&v!==undefined),recent=week.map(d=>bodyReading(d,s.key)).filter((v):v is number=>v!==null),base=older.map(d=>bodyReading(d,s.key)).filter((v):v is number=>v!==null);
  const terms:[number,number][]=[[.5,s.sign*today]];if(weekZ.length>=3)terms.push([.3,s.sign*mean(weekZ)]);// The long view only ever pulls down: it exists to catch a slow slide, never to cushion a bad night.
  if(recent.length>=3&&base.length>=14)terms.push([.2,Math.min(0,s.sign*(s.long(quantile(recent))-s.long(quantile(base)))/s.unit)]);
  return {weight:s.weight,value:terms.reduce((t,[w,v])=>t+w*v,0)/terms.reduce((t,[w])=>t+w,0)};}).filter((v):v is {weight:number;value:number}=>v!==null);
 return parts.length?parts.reduce((t,p)=>t+p.weight*p.value,0)/parts.reduce((t,p)=>t+p.weight,0):null;
}
/**
 * Available from the first night, with no ratings needed. See docs/SLEEP_BODY_SCORES.md for the evidence and its limits.
 * Sleep adds length and quality, so either can make up for the other. Body places your usual at 70.
 */
export function baselineEstimate(days:ResearchDay[],date:string,kind:'sleep'|'body',profile:SleepProfile=EMPTY_SLEEP_PROFILE):PersonalEstimate{
 const out:PersonalEstimate={value:null,interval:null,status:'Missing inputs',matched:0,holdout:0,mae:null,baseline_mae:null,reason:'',target:kind==='sleep'?'length against your ideal, plus quality against your recent nights':'your HRV and resting heart rate against your own recent readings',basis:'baseline'};
 const current=days.find(d=>d.date===date);
 if(kind==='body'){
  const deviation=bodyDeviation(days,date);
  if(deviation===null){out.reason='No HRV or resting heart rate reading for this date yet.';return out;}
  const value=Math.round(clip(USUAL_BODY_SCORE+BODY_POINTS_PER_UNIT*deviation,1,100));
  return {...out,value,status:'From your readings',matched:days.filter(d=>d.date<date&&d.features[5]!==null&&d.features[5]!==undefined).length,reason:`${USUAL_BODY_SCORE} is your usual. Above it, your readings look better than usual; below it, worse. HRV counts for about two thirds and resting heart rate for one third. Last night counts most, then the past week. A slow slide over recent months can lower it, but a good long-term trend never props up a bad night. This is not a medical measure.`};
 }
 if(!current||current.main_minutes===null||current.method==='assumed'){out.reason=current?.method==='assumed'?'This duration is your usual, not a measurement, so it gets no score.':'No sleep reading for this night yet.';return out;}
 const low=profile.reference_low??420,length=sleepLengthPoints(current.main_minutes,low),quality=sleepQualityPoints(days,date),value=Math.round(clip(SLEEP_LENGTH_SHARE*length+(1-SLEEP_LENGTH_SHARE)*(quality??50),1,100));
 return {...out,value,status:'From your sleep',matched:days.filter(d=>d.date<date&&d.method==='watch').length,reason:`You slept ${hm(current.main_minutes)} against your ${hm(low)} minimum, worth ${Math.round(length)} points for length. ${quality===null?'There are no watch details to judge quality, so it counts as average':`Quality scored ${quality}, from staying asleep, REM and deep sleep compared with your recent nights`}. Length counts for 65% and quality for 35%, so one can make up for the other. Watches estimate sleep stages roughly, and this is not a medical measure.`};
}
export function researchView(nights:NightScore[],journals:Journal[],date:string,profile:SleepProfile){const days=researchDays(nights,journals,date,profile),choose=(kind:'sleep'|'body')=>{const rated=personalEstimate(days,date,kind);return rated.value!==null?{...rated,basis:'ratings' as const}:baselineEstimate(days,date,kind,profile);},sleep=choose('sleep'),body=choose('body');return {version:RESEARCH_VERSION,date,context:sleepContext(days,date,profile),scores:{sleep,body},night:(()=>{const n=nights.find(n=>n.date===date);return n?{...n,sleep_score:null,body_score:null,sleep_components:[],body_components:n.body_components.map(c=>({...c,score:null,weight:0}))}:null;})(),history:days.filter(d=>d.date>=shiftDate(date,-29)).map(d=>({id:d.date,date:d.date,sleep:d.quality===null?null:d.quality*10,body:d.energy===null?null:d.energy*10})),history_kind:'reported',experimental:true};}
