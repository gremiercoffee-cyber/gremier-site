import {localDate,shiftDate,sleepJournalDate,withGoogleScores,type Journal,type Measurement} from './daynote';
import type {RecoveryNight} from './recovery';
export type TransferNight=RecoveryNight&{provider:'whoop'|'google'};
const q=(v:number[],p=.5)=>{const a=[...v].sort((a,b)=>a-b);return a.length?a[Math.min(a.length-1,Math.max(0,Math.round(p*(a.length-1))))]:null;};
const green=(r:TransferNight)=>r.recovery>=(r.provider==='google'?65:67);
/** Percentile is relative to personal history, never a vendor score conversion. */
export function personalRank(values:number[],value:number){if(!values.length)return null;return(values.filter(v=>v<value).length+values.filter(v=>v===value).length/2)/values.length;}
function varied(v:number[]){return v.length>=14&&new Set(v).size>=4;}
export function googleRecoveryNights(measurements:Measurement[],entries:Journal[]):TransferNight[]{
 entries=withGoogleScores(entries,measurements);
 const days=new Map(entries.map(j=>[j.date,j])),sleeps=new Map<string,Measurement>();
 for(const s of measurements.filter(m=>m.type==='sleep'&&m.start_at&&m.end_at&&m.value!==null&&m.raw?.sleep?.metadata?.nap!==true)){const date=sleepJournalDate(s.start_at!);if(!sleeps.has(date)||sleeps.get(date)!.value!<s.value!)sleeps.set(date,s);}
 const rows:TransferNight[]=[];for(const j of entries){const s=sleeps.get(j.date),wake=s?.end_at&&localDate(s.end_at),after=wake?days.get(wake):undefined,load=j.cardio_load;
  if(j.readiness===null||load===null||load===undefined||!j.cardio_load_final||!s?.start_at||!s.end_at||!wake||wake<=j.date||after?.readiness===null||after?.readiness===undefined||j.answers.illness?.value==='yes'||j.answers.travel?.value==='yes')continue;
  const inBed=(Date.parse(s.end_at)-Date.parse(s.start_at))/60000;if(s.value!<180||s.value!>840||inBed<s.value!||inBed>960||!Number.isFinite(load)||load<0)continue;
  rows.push({provider:'google',date:j.date,wake_date:wake,sleep_start:s.start_at,sleep_end:s.end_at,strain:load,prior_recovery:j.readiness,recovery:after.readiness,sleep_minutes:s.value!,in_bed_minutes:inBed,answers:j.answers});
 }return rows.sort((a,b)=>a.sleep_end.localeCompare(b.sleep_end));
}
function vectors(rows:TransferNight[],provider:string){const days=new Set<string>();const unique=rows.filter(r=>r.provider===provider&&!days.has(r.date)&&!!days.add(r.date));return{load:unique.map(r=>r.strain),readiness:unique.map(r=>r.prior_recovery)};}
function nearby(rows:TransferNight[],load:number,readiness:number,provider:'whoop'|'google'){
 const own=vectors(rows,provider),loadRank=personalRank(own.load,load),readyRank=personalRank(own.readiness,readiness),ownReady=varied(own.load)&&varied(own.readiness);
 // Native comparisons continue even before a cross-device bridge can be calibrated.
 const native=rows.filter(r=>r.provider===provider&&Math.abs(r.prior_recovery-readiness)<=20&&(ownReady?Math.abs(personalRank(own.load,r.strain)!-loadRank!)<=.15:Math.abs(r.strain-load)<=Math.max(1,load*.15)));
 const other=provider==='google'?'whoop':'google',foreign=vectors(rows,other),foreignReady=varied(foreign.load)&&varied(foreign.readiness);
 const withinRange=own.load.length>0&&load>=Math.min(...own.load)&&load<=Math.max(...own.load)&&readiness>=Math.min(...own.readiness)&&readiness<=Math.max(...own.readiness);
 const nativeReady=own.load.length>=28&&native.length>=12&&native.filter(green).length>=5;
 const transfer=!nativeReady&&ownReady&&foreignReady&&withinRange?rows.filter(r=>r.provider===other&&Math.abs(personalRank(foreign.load,r.strain)!-loadRank!)<=.15&&Math.abs(personalRank(foreign.readiness,r.prior_recovery)!-readyRank!)<=.2):[];
 // One outcome per waking day, preferring the current device. Never count two watches as two people/nights.
 const seen=new Set(native.map(r=>r.date)),near=[...native,...transfer.filter(r=>!seen.has(r.date)&&!!seen.add(r.date))];
 return{near,native_ready:nativeReady,own_n:own.load.length,foreign_n:foreign.load.length,bridge_ready:ownReady&&foreignReady&&withinRange,load_percentile:ownReady?Math.round(loadRank!*100):null,readiness_percentile:ownReady?Math.round(readyRank!*100):null,foreign_used:near.filter(r=>r.provider!==provider).length};
}
function uniqueNights(rows:TransferNight[],provider:'whoop'|'google') {const map=new Map<string,TransferNight>();for(const r of rows)if(!map.has(r.date)||r.provider===provider)map.set(r.date,r);return[...map.values()].sort((a,b)=>a.sleep_end.localeCompare(b.sleep_end));}
function evaluate(rows:TransferNight[]){let n=0,error=0,base=0;for(const r of uniqueNights(rows,'google')){const train=rows.filter(p=>p.wake_date<=r.date&&p.date<r.date);if(new Set(train.map(p=>p.date)).size<28)continue;const match=nearby(train,r.strain,r.prior_recovery,r.provider).near.filter(p=>Math.abs(p.sleep_minutes-r.sleep_minutes)<=45);if(match.length<10)continue;const p=match.filter(green).length/match.length,b=uniqueNights(train,r.provider),baseline=b.filter(green).length/b.length,y=green(r)?1:0;n++;error+=(p-y)**2;base+=(baseline-y)**2;}
 return{n,brier:n?error/n:null,baseline_brier:n?base/n:null,status:n>=10&&error<base?'improves_on_baseline':'not_validated'};
}
function calibrationPairs(rows:TransferNight[]){const w=new Map(rows.filter(r=>r.provider==='whoop').map(r=>[r.date,r]));return rows.filter(r=>r.provider==='google'&&w.has(r.date)).map(r=>({whoop:w.get(r.date)!,google:r}));}
function correlation(xs:number[],ys:number[]){const a=xs.reduce((a,b)=>a+b,0)/xs.length,b=ys.reduce((a,b)=>a+b,0)/ys.length;let xy=0,xx=0,yy=0;for(let i=0;i<xs.length;i++){xy+=(xs[i]-a)*(ys[i]-b);xx+=(xs[i]-a)**2;yy+=(ys[i]-b)**2;}return xx&&yy?xy/Math.sqrt(xx*yy):null;}
export function transferLearning(whoop:RecoveryNight[],google:TransferNight[],date:string,load:number|null,readiness:number|null){
 const rows:TransferNight[]=[...whoop.filter(r=>r.wake_date<=date).sort((a,b)=>b.sleep_end.localeCompare(a.sleep_end)).slice(0,180).map(r=>({...r,provider:'whoop' as const})),...google.filter(r=>r.wake_date<=date&&r.wake_date>=shiftDate(date,-180))];
 const matched=load===null||readiness===null?{near:[],native_ready:false,own_n:rows.filter(r=>r.provider==='google').length,foreign_n:rows.filter(r=>r.provider==='whoop').length,bridge_ready:false,load_percentile:null,readiness_percentile:null,foreign_used:0}:nearby(rows,load,readiness,'google');
 const overlap=calibrationPairs(rows),rho=(key:'strain'|'prior_recovery')=>overlap.length>=14?correlation(overlap.map(r=>personalRank(overlap.map(p=>p.google[key]),r.google[key])!),overlap.map(r=>personalRank(overlap.map(p=>p.whoop[key]),r.whoop[key])!)):null;
 const loadRho=rho('strain'),readyRho=rho('prior_recovery'),contradiction=overlap.length>=14&&(loadRho===null||readyRho===null||loadRho<.5||readyRho<.5);
 // Paired data can disprove the distribution bridge. Do not force a match if the devices disagree.
 const near=contradiction?matched.near.filter(r=>r.provider==='google'):matched.near,greens=near.filter(green),all=uniqueNights(rows,'google');
 let minutes=all.length>=28&&near.length>=12&&greens.length>=5?Math.max(q(greens.map(r=>r.sleep_minutes),.6)!,q(near.map(r=>r.sleep_minutes))!):null;
 let basis=near.length&&near.every(r=>r.provider==='google')?'Comparable Google nights at similar personal load and starting readiness. An association, not a guaranteed sleep requirement.':'Similar personal load/recovery percentiles across devices; vendor-native high thresholds. Approximate transfer, not equal scores.',baseline=false;
 let evidence=near;
 if(minutes===null){const old=rows.filter(r=>r.provider==='whoop'),good=old.filter(green);if(old.length>=28&&good.length>=5){minutes=Math.max(q(good.map(r=>r.sleep_minutes),.6)!,q(old.map(r=>r.sleep_minutes))!);evidence=old;baseline=true;basis='Starting sleep baseline from WHOOP history. Not yet conditional on today’s Google scores.';}}
 const awake=q(evidence.map(r=>r.in_bed_minutes-r.sleep_minutes)),rounded=minutes===null?null:Math.ceil(minutes/15)*15,inBed=rounded===null||awake===null?null:Math.ceil((rounded+awake)/15)*15;
 return{rows,near,minutes:rounded,in_bed_minutes:inBed,basis,baseline,evidence,learning:{n:all.length,required_n:28,similar_n:near.length,required_similar:12,green_n:greens.length,required_green:5,status:minutes===null?'collecting':baseline?'starting_baseline':'exploratory',evaluation:evaluate(rows)},bridge:{status:matched.native_ready?'google_native':contradiction?'devices_disagree':matched.bridge_ready?'provisional_percentile_bridge':'collecting_google_baseline',google_n:matched.own_n,whoop_n:matched.foreign_n,required_google_n:14,overlap_n:overlap.length,load_correlation:loadRho,readiness_correlation:readyRho,load_percentile:matched.load_percentile,readiness_percentile:matched.readiness_percentile,transferred_n:contradiction?0:matched.foreign_used}};
}
