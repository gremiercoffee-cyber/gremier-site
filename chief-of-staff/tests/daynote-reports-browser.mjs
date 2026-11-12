import {chromium} from 'playwright';import assert from 'node:assert/strict';import {build} from 'esbuild';import {mkdirSync} from 'node:fs';
const b=await build({stdin:{contents:"export * from './shared/daynote';",resolveDir:process.cwd()},bundle:true,write:false,platform:'node',format:'esm'});const {HABIT_CATALOG,localDate,shiftDate}=await import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));
const URL0=process.env.DAYNOTE_TEST_URL||'http://127.0.0.1:5186/daynote/';mkdirSync('.local',{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true,timezoneId:'Asia/Jerusalem'});
const date=localDate(),vitals=Array.from({length:70},(_,i)=>({id:'v'+i,type:'daily-heart-rate-variability',date:shiftDate(date,-i),value:i<7?60+i%3:50+i%4,updated_at:'2026-11-03T12:00:00Z'}));
const state={habits:HABIT_CATALOG,entries:[],notes:[],choices:[],deleted:[],measurements:[],measurement_days:[],connection:{connected:false},preferences:{reminders:false,weekly_summary:true,reminder_time:'21:00'}};
const metrics=[{key:'sleep_minutes',label:'Sleep',unit:'min',judgment:'better',current:452,days:7,previous:401,usual:420,change:51},{key:'hrv',label:'HRV',unit:'ms',judgment:'better',current:61.2,days:7,previous:52.1,usual:51,change:9.1},{key:'rhr',label:'Resting heart rate',unit:'bpm',judgment:'steady',current:58,days:7,previous:58.4,usual:58,change:-.4},{key:'oxygen',label:'Blood oxygen',unit:'%',judgment:'unknown',current:null,days:0,previous:null,usual:null,change:null}];
const report={id:'rep1',kind:'week',period_start:'2026-11-01',period_end:'2026-11-07',status:'ready',model:'gpt-6.1-sol',ready_at:'2026-11-08T08:05:00Z',sources:['https://aasm.org/x','https://pubmed.ncbi.nlm.nih.gov/1'],
 stats:{metrics,sleep_timing:{nights:7,average_bedtime:'23:40',bedtime_spread_minutes:48,previous_bedtime_spread_minutes:70,average_wake:'07:10',nights_under_6h:1,nights_7h_or_more:5},exercise:{sessions:2,minutes:75,previous_sessions:1,previous_minutes:30},journal:{days_logged:5,completed:4,morning_ratings:4,habits:[]}},
 analysis:{direction:'better',headline:'More sleep and a higher HRV this week.',summary:'You slept 51 minutes more a night than the week before.',findings:[{metric:'hrv',verdict:'better',text:'HRV rose about 9 ms.'}],focus:[{title:'Keep bedtime within 30 minutes',why:'Your bedtime still moved 48 minutes night to night.',how:'Aim for lights out by 23:30, Shabbat included.',evidence:'Cohort studies link regular sleep timing with better outcomes.',sources:['https://aasm.org/x']}],watch:''}};
const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(()=>localStorage.setItem('cos.token','fixture'));
await page.route('**/api/daynote/**',async route=>{const u=new URL(route.request().url());let data=state;if(u.pathname.endsWith('/reports'))data=[{id:'rep1',kind:'week',period_start:'2026-11-01',period_end:'2026-11-07',status:'ready',direction:'better',headline:report.analysis.headline,ready_at:report.ready_at},{id:'rep2',kind:'month',period_start:'2026-10-01',period_end:'2026-10-31',status:'running',direction:null,headline:null,ready_at:null}];else if(u.pathname.endsWith('/reports/rep1'))data=report;else if(u.pathname.endsWith('/vitals'))data=vitals;else if(u.pathname.endsWith('/insights'))data={comparisons:[]};else if(u.pathname.endsWith('/relationships')||u.pathname.endsWith('/relationships/stats'))data=[];else if(u.pathname.endsWith('/dashboard'))data={date,personal:{}};await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});});
try{
 await page.goto(URL0);await page.getByRole('button',{name:/Start journal/}).waitFor();
 const skip=page.getByRole('button',{name:'Skip today'});if(await skip.waitFor({timeout:4000}).then(()=>true,()=>false))await skip.click();
 await page.getByRole('button',{name:/HRV/}).first().click();await page.getByRole('heading',{name:'HRV',exact:true}).waitFor();
 await page.getByText('Last 7 days').waitFor();assert.ok(await page.locator('.dn-trend-pill.v-better').count()>=1,'7-day HRV rise is shown as better');
 assert.equal(await page.locator('.dn-avg-line.week').count(),1,'7-day average line drawn');await page.getByText('7-day average').waitFor();
 await page.screenshot({path:'.local/reports-trend.png',fullPage:true});
 await page.goto(URL0+'?report=rep1');await page.getByRole('heading',{name:'More sleep and a higher HRV this week.'}).waitFor();
 await page.getByText('Keep bedtime within 30 minutes').waitFor();await page.getByText('Heading the right way').waitFor();await page.getByText('7h 32m').waitFor();
 await page.screenshot({path:'.local/reports-view.png',fullPage:true});
 await page.getByRole('button',{name:'← All reports'}).click();await page.getByText('Being written…').waitFor();await page.getByText('1 Nov – 7 Nov 2026').waitFor();
 await page.screenshot({path:'.local/reports-list.png',fullPage:true});
 assert.deepEqual(errors,[]);console.log('reports browser ok');
}finally{await browser.close();}
