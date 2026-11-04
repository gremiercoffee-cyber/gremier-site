// Isolated synthetic browser fixture only. Never run this against the owner's production account.
// Start `npm exec vite preview -- --host 127.0.0.1 --port 5181` after building.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {writeFileSync} from 'node:fs';
const b=await build({stdin:{contents:"export * from './shared/daynote';export * from './shared/recovery';export * from './shared/personal-health';",resolveDir:process.cwd()},bundle:true,write:false,format:'esm',platform:'node'});
const {HABIT_CATALOG,buildRecoveryDashboard,personalModel}=await import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1,isMobile:true,hasTouch:true,timezoneId:'Asia/Jerusalem'});
const importedFixture=[{id:'takeout:google:r:2026-10-30',type:'google_readiness',date:'2026-10-30',value:65,raw:{source:'google_takeout'}},{id:'takeout:google:l:2026-10-30',type:'google_cardio_load',date:'2026-10-30',value:125,raw:{source:'google_takeout',final:true}}];
let offline=false,puts=0;const state={habits:HABIT_CATALOG,entries:[],notes:[],choices:[],deleted:[],measurements:importedFixture,measurement_days:[{date:'2026-10-30',records:2}],latest_readiness_date:'2026-10-30',connection:{configured:true,connected:false,last_success:null},preferences:{reminders:false,weekly_summary:false,reminder_time:'21:00'}};
const errors=[];const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('console',msg=>{if(msg.type()==='error')console.log('BROWSER',msg.text());});page.on('requestfailed',r=>console.log('FAILED',r.url(),r.failure()));
await context.addInitScript(()=>localStorage.setItem('cos.token','synthetic-browser-test-only'));
await context.route('**/api/daynote/**',async route=>{
 if(offline)return route.abort('internetdisconnected');
 const req=route.request(),url=new URL(req.url());let data=state,status=200;
 if(req.method()==='PUT'&&url.pathname.includes('/entries/')){puts++;const body=req.postDataJSON();await new Promise(r=>setTimeout(r,1100));const entry={...body.entry,revision:body.base_revision+1};state.entries=state.entries.filter(e=>e.date!==entry.date).concat(entry);data={entry};}
 else if(url.pathname.endsWith('/dashboard'))data={...buildRecoveryDashboard(importedFixture,state.entries,HABIT_CATALOG,url.searchParams.get('date')),personal:personalModel(importedFixture,state.entries,url.searchParams.get('date'))};
 else if(url.pathname.endsWith('/insights'))data={matched_nights:0,comparisons:[],limitations:['No fabricated insights.']};
 else if(req.method()==='POST'&&url.pathname.endsWith('/notes')){status=502;data={error:'Synthetic transcription failure; recording kept.'};}
 else if(req.method()==='POST'&&url.pathname.endsWith('/habits'))data=req.postDataJSON();
 await route.fulfill({status,contentType:'application/json',headers:{'cache-control':'no-store'},body:JSON.stringify(data)});
});
const pause=()=>page.waitForTimeout(340);
const openNotes=async()=>{await page.getByRole('button',{name:'Open menu',exact:true}).click();await page.getByRole('button',{name:'Notes & check-in',exact:false}).click();};
try{
 await page.goto('http://127.0.0.1:5181/daynote/');await page.getByRole('button',{name:'Start journal',exact:false}).waitFor();
 await page.evaluate(async()=>{await navigator.serviceWorker.ready;if(!navigator.serviceWorker.controller)await new Promise(resolve=>navigator.serviceWorker.addEventListener('controllerchange',resolve,{once:true}));});
 await page.screenshot({path:'.local/daynote-today-mobile.png',fullPage:false});
 assert.equal(await page.locator('html').evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(8, 12, 16)');
 assert.equal(await page.locator('main .dn-big').count(),1,'home has one primary journal action');assert.ok(await page.getByRole('region',{name:'Personal health estimates'}).isVisible());
 assert.equal(await page.getByLabel('Journal date',{exact:true}).inputValue(),new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jerusalem',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()));
 await page.getByRole('button',{name:'Start journal',exact:false}).click();await page.getByTestId('question').waitFor();
 const cdp=await context.newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
 offline=true;await context.setOffline(true);const initialPuts=puts;
 await page.getByTestId('yes').dblclick({delay:30});await page.waitForTimeout(90);
 assert.equal(await page.getByTestId('question').textContent(),HABIT_CATALOG[1].label,'double tap must not answer the next question');assert.equal(puts,initialPuts);
 await pause();await page.getByTestId('no').click();await page.waitForTimeout(90);
 assert.equal(await page.getByTestId('question').textContent(),HABIT_CATALOG[2].label);
 await pause();await page.getByTestId('skip').click();await page.waitForTimeout(90);
 const local=await page.evaluate(()=>JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k=>k.startsWith('daynote.day.')))));
 assert.equal(local.journal.answers.caffeine.value,'yes');assert.equal(local.journal.answers.late_caffeine.value,'no');assert.equal(local.journal.answers.alcohol.value,'skip');
 const timings=await page.evaluate(()=>window.__daynoteTimings||[]);assert.ok(timings.length>=3);assert.ok(Math.max(...timings)<100,'tap-to-render target: '+JSON.stringify(timings));
 await page.screenshot({path:'.local/daynote-question-mobile.png',fullPage:false});
 await page.reload();await page.getByRole('button',{name:'Resume journal',exact:false}).waitFor();await page.getByRole('button',{name:'Resume journal',exact:false}).click();
 assert.equal(await page.getByTestId('question').textContent(),HABIT_CATALOG[3].label,'offline reload resumes cursor');
 await pause();await page.getByRole('button',{name:'Back / change',exact:false}).click();await page.waitForTimeout(90);assert.equal(await page.getByTestId('question').textContent(),HABIT_CATALOG[2].label);
 await pause();await page.getByTestId('no').click();await page.waitForTimeout(90);
 offline=false;await context.setOffline(false);await page.evaluate(()=>window.dispatchEvent(new Event('online')));await page.waitForTimeout(150);
 await pause();await page.getByTestId('yes').click();await page.waitForTimeout(1400);await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.waitForTimeout(1500);
 assert.equal(state.entries[0].answers.alcohol.value,'no');assert.equal(state.entries[0].answers.late_meal.value,'yes','edits during an in-flight save must survive its acknowledgement');
 const latest=await page.evaluate(()=>JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k=>k.startsWith('daynote.day.')))));
 assert.equal(latest.dirty,false);assert.equal(latest.journal.answers.late_meal.value,'yes');
 await page.evaluate(()=>{navigator.mediaDevices.getUserMedia=async()=>{throw new DOMException('Synthetic denial','NotAllowedError');};});
 await openNotes();await page.getByRole('button',{name:'Record voice note',exact:false}).click();await page.getByRole('alert').filter({hasText:'Microphone permission was denied'}).waitFor();assert.ok(await page.getByRole('button',{name:'Record voice note',exact:false}).isVisible());
 // The pending blob must remain after a failed processing request and after reload.
 await page.evaluate(async()=>{const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('daynote-private-audio',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});await new Promise((resolve,reject)=>{const t=db.transaction('recordings','readwrite');t.objectStore('recordings').put({id:'fixture-audio',date:'2026-11-01',blob:new Blob(['synthetic-not-real-audio'],{type:'audio/webm'})},'current');t.oncomplete=resolve;t.onerror=reject;});db.close();});
 await page.reload();await openNotes();await page.getByRole('button',{name:'Process recording'}).waitFor();await page.getByRole('button',{name:'Process recording'}).click();await page.getByRole('alert').filter({hasText:'Synthetic transcription failure'}).waitFor();assert.ok(await page.getByRole('button',{name:'Process recording'}).isVisible());
 await page.reload();await openNotes();await page.getByRole('button',{name:'Process recording'}).waitFor();
 await page.getByLabel('Readiness · Google',{exact:true}).fill('65');await page.getByLabel('Cardio load · Google',{exact:true}).fill('175');await page.getByLabel('Final load for this day').check();await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.waitForTimeout(1500);await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.waitForTimeout(1500);
 assert.equal(state.entries[0].readiness,65);assert.equal(state.entries[0].cardio_load,175);assert.equal(state.entries[0].cardio_load_final,true);
 await page.getByRole('button',{name:'Open menu',exact:true}).click();await page.getByRole('button',{name:'History',exact:false}).click();await page.getByRole('button',{name:/2026-10-30/}).click();await page.getByText('Tracker reference scores',{exact:true}).click();await page.getByRole('region',{name:'Recovery dashboard'}).getByText('Google · imported',{exact:true}).first().waitFor();assert.equal(await page.getByLabel('Journal date',{exact:true}).inputValue(),'2026-10-30');assert.ok(!state.entries.some(e=>e.date==='2026-10-30'),'viewing imported measurements must not create a questionnaire');
 const sensitiveCached=await page.evaluate(async()=>{const keys=await caches.keys(),urls=[];for(const k of keys)for(const req of await(await caches.open(k)).keys())urls.push(req.url);return urls.filter(u=>u.includes('/api/'));});assert.deepEqual(sensitiveCached,[]);
 assert.deepEqual(errors,[]);
 const report={viewport:'390×844',browser:'Headless Chrome, 4× CPU throttling; synthetic fixture',tap_to_next_paint_ms:timings,max_ms:Math.max(...timings),network_independent:true,offline_reload_resume:true,double_tap_guard:true,skip_distinct_from_no:true,back_edit:true,in_flight_edits_preserved:true,mic_denial:true,audio_failure_retry_persistence:true,sensitive_api_cache_entries:0,production_health_data_used:false,imported_history_navigation:true};
 writeFileSync('.local/daynote-browser-results.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}catch(e){console.log('HTML',await page.content());console.log('DEBUG',await page.locator('body').innerText().catch(()=>''),errors);console.log('LOCAL',await page.evaluate(()=>JSON.stringify(localStorage)).catch(()=>''));console.log('CACHE',await page.evaluate(async()=>{const out={};for(const k of await caches.keys())out[k]=(await(await caches.open(k)).keys()).map(r=>r.url);return out;}).catch(()=>''));await page.screenshot({path:'.local/daynote-browser-failure.png'}).catch(()=>{});throw e;}finally{await context.close();await browser.close();}
