import {test} from 'node:test';import assert from 'node:assert/strict';import {build} from 'esbuild';import {readFileSync} from 'node:fs';
const b=await build({stdin:{contents:"export * from './shared/daynote-research';export * from './shared/daynote-scores';export {shiftDate,emptyJournal,analyzeJournals} from './shared/daynote';",resolveDir:process.cwd()},bundle:true,write:false,format:'esm',platform:'node'});const m=await import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));
const date='2026-11-04',profile={age:32,reference_low:450,reference_high:480,functional_minutes:420,source:'owner_reported',friday_night_minutes:540,shabbos_nap_minutes:120};
const sleep=(d=date,minutes=420,id='api:'+d)=>({id,type:'sleep',date:d,start_at:m.shiftDate(d,-1)+'T22:00:00Z',end_at:d+'T06:00:00Z',value:minutes,raw:{dataSource:{device:{displayName:'Pixel Watch 4'},platform:'FITBIT'},sleep:{metadata:{processed:true}}}});
const nights=rows=>m.scoreNights(m.compactNights(rows));
const journal=(d,extra={})=>({...m.emptyJournal(d,[]),morning:{...m.EMPTY_MORNING,...extra}});
test('reference remains owner-reported; habitual short sleep never silently lowers sleep need',()=>{const ns=nights(Array.from({length:60},(_,i)=>sleep(m.shiftDate(date,-i),360)));const r=m.researchView(ns,[],date,profile);assert.equal(r.context.reference.reference_low,450);assert.equal(r.context.reference.reference_high,480);assert.equal(r.context.rested_reference,null);assert.equal(r.scores.sleep.value,55,'a habitual 6 hours stays well short of good');assert.equal(r.scores.body.value,null);});
test('Friday-night and Shabbos-nap defaults use the correct wake dates without writing measurements',()=>{const input=[],days=m.researchDays(input,[],'2026-11-01',profile),sat=days.find(d=>d.date==='2026-10-31'),sun=days.find(d=>d.date==='2026-11-01');assert.equal(sat.main_minutes,540);assert.equal(sat.method,'assumed');assert.equal(sun.naps_minutes,120);assert.equal(sun.naps_method,'assumed');assert.equal(days.find(d=>d.date==='2026-10-30').main_minutes,null);assert.equal(input.length,0);assert.ok(m.sleepContext(days,'2026-11-01',profile).week.assumed_dates.includes('2026-10-31'));});
test('manual corrections override both watch and defaults; zero nap is distinct from missing',()=>{const ns=nights([sleep('2026-10-31',400)]),js=[journal('2026-10-31',{sleep_minutes:510}),journal('2026-11-01',{naps_minutes:0})],days=m.researchDays(ns,js,'2026-11-01',profile);assert.equal(days.find(d=>d.date==='2026-10-31').main_minutes,510);assert.equal(days.at(-1).naps_minutes,0);assert.equal(days.at(-1).naps_method,'manual');assert.equal(days.at(-1).naps_complete,true);assert.equal(days.find(d=>d.date==='2026-10-30').naps_minutes,null);});
test('watch nap duplicates and overlapping sources count once; reported nap total replaces detected total',()=>{const nap={...sleep('2026-10-31',60),id:'api:nap',start_at:'2026-10-31T12:00:00Z',end_at:'2026-10-31T13:00:00Z',raw:{sleep:{metadata:{nap:true,processed:true}}}},archive={...nap,id:'takeout:google:nap',end_at:'2026-10-31T13:01:00Z'};const ns=nights([nap,archive,sleep('2026-11-01')]);assert.equal(ns.find(n=>n.date==='2026-10-31').naps.length,1);const ds=m.researchDays(ns,[journal('2026-11-01',{naps_minutes:120})],'2026-11-01',profile);assert.equal(ds.at(-1).naps_minutes,120);assert.equal(ds.at(-1).total_known,540);});
test('one long night never cancels previous short-night accounting, and missing nights are not zero',()=>{const rows=Array.from({length:7},(_,i)=>sleep(m.shiftDate(date,-i),i?360:480)),js=rows.map(r=>journal(r.date,{naps_minutes:0})),days=m.researchDays(nights(rows),js,date,m.EMPTY_SLEEP_PROFILE),p={...profile,friday_night_minutes:null,shabbos_nap_minutes:null};const c=m.sleepContext(days,date,p);assert.equal(c.week.recorded_shortfall_range[0],540);assert.equal(c.week.recorded_shortfall_range[1],720);assert.equal(c.week.complete,true);const missing=m.researchDays(nights(rows.filter(r=>r.date!=='2026-11-03')),js,date,p),cm=m.sleepContext(missing,date,p);assert.equal(cm.week.observed,6);assert.deepEqual(cm.week.missing_dates,['2026-11-03']);assert.equal(cm.week.complete,false);});
test('unobserved naps and assumed durations never become validated physiological debt',()=>{const c=m.researchView(nights([sleep()]),[],date,profile).context;assert.equal(c.week.complete,false);assert.ok(c.week.naps_unknown_dates.length>0);assert.match(c.limitation,/not measured physiological debt/);});
test('rested-night corroboration requires independent diary observations and excludes assumed nights',()=>{const rows=Array.from({length:20},(_,i)=>sleep(m.shiftDate(date,-i-1),450)),js=rows.map(r=>journal(r.date,{rested:8,sleepiness:2,alarm:false,opportunity:true,naps_minutes:0})),days=m.researchDays(nights(rows),js,date,profile),c=m.sleepContext(days,date,profile);assert.equal(c.rested_reference.low,450);assert.equal(c.rested_reference.high,450);assert.equal(c.reference.reference_high,480);const assumedDays=m.researchDays([],js,date,profile),c2=m.sleepContext(assumedDays,date,profile);assert.equal(c2.rested_reference,null);});
test('retrospective and future-dated reports do not qualify as timely independent training labels',()=>{const ns=nights([sleep()]);for(const at of ['2026-11-01T08:00:00Z','2026-11-10T08:00:00Z'])assert.equal(m.researchDays(ns,[journal(date,{quality:8,recorded_at:at})],date,profile).at(-1).eligible_rating,false);assert.equal(m.researchDays(ns,[journal(date,{quality:8,recorded_at:date+'T08:00:00Z'})],date,profile).at(-1).eligible_rating,true);});
function synthetic(n=151){return Array.from({length:n},(_,i)=>{const h=7+(i%7)/3;return {date:m.shiftDate(date,i-n+1),main_minutes:h*60,method:'watch',naps_minutes:0,naps_method:'manual',naps_complete:true,total_known:h*60,efficiency:.9,midpoint:120,timing_deviation:0,vitals:[],quality:3+2*(h-7),energy:3+2*(h-7),review:{...m.EMPTY_MORNING},eligible_rating:true,excluded:false,device:'watch4',physiology_protocol:'watch4|nightly',features:[h,.9,0,7,0,h-7,-(h-7),0,0]};});}
test('no score is issued just because signals look normal or labels are sparse',()=>{for(const n of [1,30,60,90]){const ds=synthetic(n);assert.equal(m.personalEstimate(ds,date,'body').value,null);}const ds=synthetic();for(const d of ds)d.energy=null;assert.equal(m.personalEstimate(ds,date,'body').value,null);});
test('synthetic independent signal can pass temporal evaluation; error and interval remain visible',()=>{const ds=synthetic(),r=m.personalEstimate(ds,date,'body');assert.notEqual(r.value,null,JSON.stringify(r));assert.ok(r.holdout>=30);assert.ok(r.mae<r.baseline_mae);assert.ok(r.interval[0]<=r.value&&r.interval[1]>=r.value);assert.equal(r.coefficients.length,9);assert.ok(r.coefficients.every(c=>Number.isFinite(c.contribution)));});
test('own-day and future outcomes cannot change that day’s prediction',()=>{const ds=synthetic(),r=m.personalEstimate(ds,date,'sleep'),changed=structuredClone(ds);changed.at(-1).quality=10;changed.push({...changed.at(-1),date:m.shiftDate(date,1),quality:0});assert.deepEqual(m.personalEstimate(changed,date,'sleep'),r);});
test('constant outcomes, unsupported ranges, missing physiology and device transitions withhold estimates',()=>{const constant=synthetic();for(const d of constant)d.energy=7;assert.equal(m.personalEstimate(constant,date,'body').value,null);const outside=synthetic();outside.at(-1).features[0]=14;assert.equal(m.personalEstimate(outside,date,'body').status,'Outside learned range');const missing=synthetic();missing.at(-1).features[5]=null;assert.equal(m.personalEstimate(missing,date,'body').value,null);const device=synthetic();device.at(-1).physiology_protocol='watch5';assert.equal(m.personalEstimate(device,date,'body').matched,0);});
test('assumed durations cannot become training labels or current-day predictions',()=>{const ds=synthetic();for(const d of ds)d.method='assumed';const r=m.personalEstimate(ds,date,'sleep');assert.equal(r.matched,0);assert.equal(r.value,null);});
test('profile and diary validation preserve unknown versus zero and reject impossible values',()=>{assert.equal(m.validSleepProfile(profile),true);assert.equal(m.validSleepProfile({...profile,reference_high:400}),false);assert.equal(m.validSleepProfile({...profile,age:12}),false);assert.equal(m.validMorning({...m.EMPTY_MORNING,naps_minutes:0}),true);assert.equal(m.validMorning({...m.EMPTY_MORNING,sleep_minutes:0}),false);assert.equal(m.validMorning({...m.EMPTY_MORNING,quality:11}),false);assert.equal(m.validMorning({...m.EMPTY_MORNING,alarm:'no'}),false);});
test('manual duration and reported quality join habits to the following wake date; assumptions are never injected',()=>{const js=[];for(let i=0;i<10;i++){const d=m.shiftDate(date,-i-1),j=journal(d),wake=journal(m.shiftDate(d,1),{sleep_minutes:400+i,quality:i<5?8:6});j.answers.caffeine={value:i<5?'yes':'no'};js.push({...wake,answers:j.answers,date:d});}const entries=[];for(let i=0;i<10;i++){const d=m.shiftDate(date,-i*2-1),j=journal(d),wake=journal(m.shiftDate(d,1),{sleep_minutes:i<5?480:420,quality:i<5?8:6});j.answers.caffeine={value:i<5?'yes':'no'};entries.push(j,wake);}const a=m.analyzeJournals(entries,[]);assert.equal(a.comparisons.find(c=>c.metric==='sleep_quality').difference,2);assert.equal(a.comparisons.find(c=>c.metric==='sleep_minutes').difference,60);assert.ok(!a.comparisons.some(c=>c.metric==='sleep_score'));});

const day=(i,minutes,extra={})=>({date:m.shiftDate(date,-i),main_minutes:minutes,method:'watch',efficiency:.97,long_awake:5,rem_share:.23,deep_minutes:70,excluded:false,vitals:[],features:[null,null,null,null,null,null,null,null,null],...extra});
const typical=(n,from=1)=>Array.from({length:n},(_,i)=>day(i+from,330+i%60,{efficiency:.95+(i%5)/100,long_awake:i%11,rem_share:.19+(i%9)/100,deep_minutes:55+i%30}));
const amazing={efficiency:.995,long_awake:0,rem_share:.3,deep_minutes:100},terrible={efficiency:.88,long_awake:40,rem_share:.1,deep_minutes:30};
const sleepScore=(minutes,extra,history=typical(80))=>m.baselineEstimate([...history,day(0,minutes,extra)],date,'sleep',profile).value;
test('length counts against your ideal, not your habit',()=>{
 const middle={efficiency:.97,long_awake:5,rem_share:.23,deep_minutes:70},short=sleepScore(360,middle),ideal=sleepScore(450,middle);
 assert.ok(short<70,'a typical 6 hours is not a good night just because it is usual: '+short);assert.ok(ideal>=80,String(ideal));
 assert.equal(m.sleepLengthPoints(240,450),0);assert.equal(m.sleepLengthPoints(450,450),100);assert.equal(m.sleepLengthPoints(540,450),115);assert.equal(m.sleepLengthPoints(800,450),115);
});
test('length and numbers can make up for each other, within limits',()=>{
 const shortAmazing=sleepScore(360,amazing),longTerrible=sleepScore(480,terrible),veryLongPoor=sleepScore(570,terrible);
 assert.ok(Math.abs(shortAmazing-longTerrible)<=8,`${shortAmazing} vs ${longTerrible}`);
 assert.ok(veryLongPoor>longTerrible,'extra length still helps past the ideal');
 assert.ok(sleepScore(480,amazing)>=95);assert.ok(sleepScore(300,amazing)<60,'great numbers do not erase a very short night');assert.ok(sleepScore(300,terrible)<30);
 assert.ok(sleepScore(360,amazing)>sleepScore(360,terrible)+20);
});
test('wake data is never compared across the July recording change',()=>{
 const date2=date,old=Array.from({length:60},(_,i)=>({...day(0,380,{efficiency:.91,long_awake:12}),date:m.shiftDate(m.RECORDING_CHANGE,-i-1)}));
 const recent=Array.from({length:30},(_,i)=>day(i+1,380,{efficiency:.97+(i%3)/100,long_awake:i%8}));
 const night=day(0,380,{efficiency:.97,long_awake:7});
 assert.ok(m.sleepQualityPoints([...old,...recent,night],date2)<60,'an ordinary recent night must not look great against old recordings');
 assert.equal(m.sleepQualityPoints([...old,...recent,night],date2),m.sleepQualityPoints([...recent,night],date2));
});
test('sleep gets a number from the first night; no reading or an assumed night gets none',()=>{
 const first=m.baselineEstimate([day(0,450)],date,'sleep',profile);assert.equal(first.value,83,'quality counts as average until there are nights to compare');assert.match(first.reason,/counts as average/);
 assert.equal(m.baselineEstimate(typical(40),date,'sleep',profile).value,null);
 assert.equal(m.baselineEstimate([...typical(40),day(0,540,{method:'assumed'})],date,'sleep',profile).value,null);
 assert.equal(m.sleepQualityPoints([...typical(40),day(0,400,{method:'manual',efficiency:null})],date),null);
 assert.equal(m.sleepQualityPoints([...typical(13),day(0,400)],date),null);assert.notEqual(m.sleepQualityPoints([...typical(14),day(0,400)],date),null);
 const ds=[...typical(40),...Array.from({length:10},(_,i)=>day(i+50,540,{method:'assumed',efficiency:.1})),day(0,400)];assert.equal(m.sleepQualityPoints(ds,date),m.sleepQualityPoints([...typical(40),day(0,400)],date),'assumed nights are not compared against');
});
const reading=(hrv,rhr)=>[{key:'hrv',value:hrv},{key:'rhr',value:rhr}];
const bodyDay=(i,hrvZ,rhrZ,hrv=80,rhr=56)=>day(i,400,{vitals:reading(hrv,rhr),features:[null,null,null,null,null,hrvZ,rhrZ,null,null]});
const bodyScore=ds=>m.baselineEstimate(ds,date,'body',profile).value;
test('Body Score puts your usual at 70, and one bad reading alone cannot sink it',()=>{
 const flat=Array.from({length:60},(_,i)=>bodyDay(i+1,0,0));
 assert.equal(bodyScore([...flat,bodyDay(0,0,0)]),70);
 assert.ok(bodyScore([...flat,bodyDay(0,1.5,-1.5)])>80);
 const oneBad=bodyScore([...flat,bodyDay(0,-1.5,1.5)]),week=Array.from({length:6},(_,i)=>bodyDay(i+1,-1.5,1.5)),sustained=bodyScore([...flat.slice(6),...week,bodyDay(0,-1.5,1.5)]);
 assert.ok(oneBad<70);assert.ok(sustained<oneBad,'a week of it counts for more than a single night');
 assert.equal(bodyScore(flat),null);assert.equal(bodyScore([...flat,day(0,400)]),null,'sleep without HRV or pulse gives no Body Score');
 assert.notEqual(bodyScore([...flat,bodyDay(0,null,-.5)]),null,'one reading is enough');
});
test('a good resting pulse cannot hide a clearly low HRV, and a good long-term trend never props up a bad night',()=>{
 const flat=Array.from({length:60},(_,i)=>bodyDay(i+1,0,0)),night=bodyDay(0,-1.7,-1.5);
 assert.ok(bodyScore([...flat,night])<70,'8 Nov 2026: HRV 16% low, pulse 3 beats low was 74 and green');
 const rising=Array.from({length:118},(_,i)=>bodyDay(i+1,0,0,i<28?90:75,56));
 assert.equal(bodyScore([...rising,bodyDay(0,-1.7,0,70,56)]),bodyScore([...flat,bodyDay(0,-1.7,0)]));
});
test('a slow slide shows up even when the last four weeks look normal',()=>{
 const steady=Array.from({length:118},(_,i)=>bodyDay(i+1,0,0,80,56)),slid=Array.from({length:118},(_,i)=>bodyDay(i+1,0,0,i<28?64:80,i<28?60:56));
 const before=bodyScore([...steady,bodyDay(0,0,0,80,56)]),after=bodyScore([...slid,bodyDay(0,0,0,64,60)]);assert.equal(m.scoreTone(before),'green');assert.equal(m.scoreTone(after),'yellow',String(after));
});
test('colors share one scale, and a model earned from your ratings still takes over',()=>{
 assert.equal(m.scoreTone(70),'green','your usual Body Score is green');assert.equal(m.scoreTone(60),'yellow');assert.equal(m.scoreTone(30),'red');
 assert.match(readFileSync('shared/daynote-research.ts','utf8'),/rated\.value!==null\?\{\.\.\.rated,basis:'ratings' as const\}:baselineEstimate/);
 assert.notEqual(m.personalEstimate(synthetic(),date,'body').value,null);
});
test('HRV and pulse baselines carry straight across the Takeout-to-live switch',()=>{
 const src=d=>({provider:'google',device:d,key:'google|'+d+'|daily'}),input=Array.from({length:20},(_,i)=>({date:m.shiftDate(date,i-19),sleep:null,vitals:{rhr:{value:56,source:src(i<19?'unknown-device':'Pixel Watch 4'),id:'x'+i}}}));
 const c=m.scoreNights(input).at(-1).body_components.find(c=>c.key==='rhr');assert.equal(c.count,19);assert.equal(c.z,0);
});
