import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {build} from 'esbuild';
Error.stackTraceLimit=0;
const result=await build({stdin:{contents:"export * from './shared/daynote';export * from './worker/daynote';export * from './worker/daynote-relationships';export * from './worker/daynote-google';export {default as worker} from './worker/index';export {sealGoogleToken} from './worker/google';export {assistantTools,chat} from './worker/assistant';export {learnPass} from './worker/learn';",resolveDir:process.cwd()},bundle:true,write:false,format:'esm',platform:'node'});
const m=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
function setup(){
 const db=new DatabaseSync(':memory:');for(const f of readdirSync('migrations').filter(f=>f.endsWith('.sql')).sort())db.exec(readFileSync('migrations/'+f,'utf8'));
 const prepare=sql=>{let binds=[];return{bind(...v){binds=v;return this;},first(){return db.prepare(sql).get(...binds)??null;},all(){return{results:db.prepare(sql).all(...binds)};},run(){return{meta:{changes:Number(db.prepare(sql).run(...binds).changes)}};}};};
 const env={DB:{prepare,batch:async s=>{db.exec('BEGIN');try{const results=s.map(x=>x.run());db.exec('COMMIT');return results;}catch(e){db.exec('ROLLBACK');throw e;}}},COS_ACCESS_TOKEN:'fixture-only',GOOGLE_CLIENT_ID:'fixture-client',GOOGLE_CLIENT_SECRET:'fixture-secret',TIMEZONE:'Asia/Jerusalem'};
 const count=t=>db.prepare('SELECT count(*) n FROM '+t).get().n;
 return{env,db,count,journal:date=>m.emptyJournal(date,m.HABIT_CATALOG),save:async(j,base=0,id=crypto.randomUUID())=>m.saveEntry(env,j.date,{entry:j,base_revision:base,mutation_id:id})};
}
const yes=(value='yes')=>({value,source:'questionnaire',at:new Date().toISOString()});
const provider=observations=>({complete:async()=>JSON.stringify({observations})});
const obs=(overrides={})=>({date:'2026-11-01',habit_id:'alcohol',label:'Did you drink alcohol?',category:'Food & drink',value:'yes',evidence:'a glass of wine',uncertain:false,...overrides});
async function withFetch(fn,body){const original=globalThis.fetch;globalThis.fetch=fn;try{return await body();}finally{globalThis.fetch=original;}}
const response=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});

test('journal defaults to the current Jerusalem day across midnight and daylight saving',()=>{
 assert.equal(m.suggestedDate('2026-11-01T23:30:00Z'),'2026-11-02');
 assert.equal(m.suggestedDate('2026-11-02T02:01:00Z'),'2026-11-02');
 assert.equal(m.suggestedDate('2026-07-03T00:30:00Z'),'2026-07-03');
 assert.equal(m.sleepJournalDate('2026-11-02T00:15:00Z'),'2026-11-01');
 assert.equal(m.sleepJournalDate('2026-11-01T20:30:00Z'),'2026-11-01');
 assert.equal(m.validDate('2026-02-30'),false);
});
test('answers advance as a pure local operation; Skip, No and absent are distinct',()=>{
 const h=setup(),j=h.journal('2026-11-01');const a=m.recordAnswer(j,j.questions[0],'no'),b=m.recordAnswer(a,j.questions[1],'skip');
 assert.equal(b.cursor,2);assert.equal(b.answers.caffeine.value,'no');assert.equal(b.answers.late_caffeine.value,'skip');assert.equal(b.answers.alcohol,undefined);assert.equal(j.cursor,0);
});
test('renaming/disabling a question preserves its stable identifier and historical answers',async()=>{
 const h=setup(),j=h.journal('2026-11-01');j.answers.alcohol=yes();await h.save(j);
 const edited=await m.saveHabit(h.env,{id:'alcohol',label:'Any alcoholic drinks?',enabled:false});assert.equal(edited.id,'alcohol');assert.equal((await m.getEntry(h.env,j.date)).answers.alcohol.value,'yes');
 await assert.rejects(m.saveHabit(h.env,{label:'Any alcoholic drinks?'}),/already exists/);
 const custom=await m.saveHabit(h.env,{id:'custom_fixture',label:'Did you use a sauna?',enabled:true});assert.equal(custom.id,'custom_fixture');
});
test('server acknowledgements are idempotent and stale device writes cannot silently replace data',async()=>{
 const h=setup(),j=h.journal('2026-11-01');j.answers.alcohol=yes('no');const r=await h.save(j,0,'op1');assert.equal(r.entry.revision,1);
 assert.equal((await h.save(j,0,'op1')).duplicate,true);assert.equal(h.count('daynote_mutations'),1);
 const edited={...r.entry,answers:{alcohol:yes('yes')}};await h.save(edited,1,'op2');
 await assert.rejects(h.save(j,0,'stale'),e=>e.status===409);assert.equal((await m.getEntry(h.env,j.date)).answers.alcohol.value,'yes');
 await m.deleteEntry(h.env,j.date);await assert.rejects(h.save(j,0,'deleted-stale'),e=>e.status===409);assert.equal(await m.getEntry(h.env,j.date),null);
});
test('invalid values, dates and invented habit IDs never enter confirmed records',async()=>{
 const h=setup();for(const mutate of [j=>j.answers.invented=yes(),j=>j.readiness=101,j=>j.energy=-1,j=>j.answers.alcohol={...yes(),value:'maybe'}]){const j=h.journal('2026-11-01');mutate(j);await assert.rejects(h.save(j),e=>e.status===400);}assert.equal(h.count('daynote_entries'),0);
});
test('voice extraction preserves explicit negation/uncertainty, never turns silence into No, and remains unconfirmed',async()=>{
 const h=setup();let prompt;
 const n=await m.extractDaynoteNote(h.env,{id:'note1',date:'2026-11-01',text:'No alcohol. Maybe I exercised. Coffee yesterday.',source:'pwa'},{complete:async req=>{prompt=JSON.parse(req.prompt);return JSON.stringify({observations:[obs({value:'no',evidence:'No alcohol'}),obs({habit_id:'exercise',label:'Did you exercise?',value:null,uncertain:true,evidence:'Maybe I exercised'}),obs({habit_id:'caffeine',label:'Did you have caffeine?',date:'2026-10-31',evidence:'Coffee yesterday'})]});}});
 assert.equal(n.observations.length,3);assert.equal(n.observations[0].value,'no');assert.equal(n.observations[1].value,null);assert.equal(h.count('daynote_entries'),0);assert.equal(h.count('daynote_notes'),1);assert.ok(prompt.calendar_date);assert.equal(prompt.timezone,'Asia/Jerusalem');
});
test('failed extraction retains the transcript and allows retry without adding health answers',async()=>{
 const h=setup();await assert.rejects(m.extractDaynoteNote(h.env,{id:'retry',date:'2026-11-01',text:'a glass of wine'},provider([obs({evidence:'invented quote'})])),/evidence/);
 assert.equal(h.count('daynote_notes'),1);assert.equal(h.count('daynote_entries'),0);
 await m.processDaynoteNote(h.env,'retry',provider([obs()]));assert.equal(JSON.parse(h.db.prepare("SELECT observations FROM daynote_notes WHERE id='retry'").get().observations).length,1);
});
test('a successfully processed empty note is not extracted again; failed notes retry using the same id',async()=>{
 const h=setup();let calls=0;const empty={complete:async()=>{calls++;return '{"observations":[]}';}};
 const first=await m.extractDaynoteNote(h.env,{id:'empty',date:'2026-11-01',text:'Nothing to add'},empty);
 assert.equal(first.processed,true);await m.extractDaynoteNote(h.env,{id:'empty',date:'2026-11-01',text:'Nothing to add'},empty);assert.equal(calls,1);
 await assert.rejects(m.extractDaynoteNote(h.env,{id:'failed-id',date:'2026-11-01',text:'Nothing to add'},{complete:async()=>{throw Error('temporary');}}));
 const retry=await m.extractDaynoteNote(h.env,{id:'failed-id',date:'2026-11-01',text:'Nothing to add'},empty);assert.equal(retry.processed,true);assert.equal(calls,2);
});
test('conflicting voice answers require an explicit keep/replace decision; daily tracking is separately approved',async()=>{
 const h=setup();await m.saveHabit(h.env,{id:'alcohol',enabled:false});const j=h.journal('2026-11-01');j.answers.alcohol=yes('no');await h.save(j);
 const n=await m.extractDaynoteNote(h.env,{id:'conflict',date:j.date,text:'a glass of wine'},provider([obs()]));
 await assert.rejects(m.confirmObservation(h.env,n.id,{index:0,date:j.date,value:'yes',action:'daily',base_revision:1}),e=>e.status===409);
 assert.equal((await m.daynoteHabits(h.env)).find(h=>h.id==='alcohol').enabled,false);
 await m.confirmObservation(h.env,n.id,{index:0,date:j.date,value:'yes',action:'daily',conflict:'replace',base_revision:1});
 assert.equal((await m.getEntry(h.env,j.date)).answers.alcohol.source,'note');assert.equal((await m.daynoteHabits(h.env)).find(h=>h.id==='alcohol').enabled,true);
 assert.equal((await m.confirmObservation(h.env,n.id,{index:0})).duplicate,true);
});
test('entry-only new habits remain disabled; dismissals persist and never create tasks or automatic questions',async()=>{
 const h=setup();const o=obs({habit_id:null,label:'Did you use a sauna?',category:'Recovery',evidence:'sauna'});
 const n=await m.extractDaynoteNote(h.env,{id:'custom',date:'2026-11-01',text:'sauna'},provider([o]));await m.confirmObservation(h.env,n.id,{index:0,date:'2026-11-01',value:'yes',label:o.label,action:'entry',base_revision:0});
 assert.equal((await m.daynoteHabits(h.env)).find(x=>x.label===o.label).enabled,false);assert.equal(h.count('daynote_suggestion_choices'),1);assert.equal(h.count('items'),0);
 const n2=await m.extractDaynoteNote(h.env,{id:'dismiss',date:'2026-11-02',text:'sauna'},provider([o]));await m.confirmObservation(h.env,n2.id,{index:0,action:'dismiss'});assert.equal(h.db.prepare('SELECT choice FROM daynote_suggestion_choices').get().choice,'dismiss');
});
test('the same explicit answer can be confirmed without a false empty-detail conflict',async()=>{
 const h=setup(),j=h.journal('2026-11-01');j.answers.alcohol=yes();await h.save(j);const n=await m.extractDaynoteNote(h.env,{id:'same',date:j.date,text:'a glass of wine'},provider([obs()]));await m.confirmObservation(h.env,n.id,{index:0,date:j.date,value:'yes',action:'entry',base_revision:1});assert.equal((await m.getEntry(h.env,j.date)).revision,2);
});
test('morning metrics and post-midnight sleep match the PREVIOUS waking day; missing/no/skip stay separate',()=>{
 const h=setup(),a=h.journal('2026-11-01'),b=h.journal('2026-11-02'),c=h.journal('2026-11-03');a.answers.alcohol=yes('yes');b.answers.alcohol=yes('no');b.energy=4;c.energy=8;
 const sleep=(id,start,end,value)=>({id,type:'sleep',date:m.localDate(end),start_at:start,end_at:end,value});
 const data=[sleep('s1','2026-11-01T22:30:00Z','2026-11-02T05:00:00Z',350),sleep('s2','2026-11-02T21:00:00Z','2026-11-03T05:00:00Z',460),sleep('dupe','2026-11-01T22:30:00Z','2026-11-02T05:00:00Z',340)];
 const r=m.analyzeJournals([a,b,c],data);const metric=r.comparisons.find(x=>x.habit_id==='alcohol'&&x.metric==='sleep_minutes');assert.equal(r.matched_nights,2);assert.equal(metric.yes_n,1);assert.equal(metric.no_n,1);assert.equal(metric.difference,-110);assert.equal(metric.label,'Insufficient observations');
 const energy=r.comparisons.find(x=>x.habit_id==='alcohol'&&x.metric==='energy');assert.equal(energy.yes_mean,4);assert.equal(energy.no_mean,8);
 b.answers.alcohol=yes('skip');assert.ok(!m.analyzeJournals([a,b,c],data).comparisons.find(x=>x.metric==='sleep_minutes').no_n);
});
test('empty accounts have no sample insights and illness/travel exclusions are explicit',()=>{
 assert.deepEqual(m.analyzeJournals([],[]).comparisons,[]);const h=setup(),j=h.journal('2026-11-01');j.answers.alcohol=yes();j.answers.illness=yes();assert.equal(m.analyzeJournals([j],[]).comparisons.length,0);
});
test('Health topic access requires owner, configured group AND registered Health topic',async()=>{
 const h=setup();h.db.prepare('INSERT INTO settings(key,value) VALUES(?,?)').run('telegram',JSON.stringify({owner_id:9,group_id:-10,private_id:9}));h.db.prepare('INSERT INTO settings(key,value) VALUES(?,?)').run('telegram_subjects',JSON.stringify({'-10:111':{name:'Health',feature:'health'},'-10:222':{name:'Coffee',feature:'coffee'}}));
 assert.equal(await m.healthTopicAllowed(h.env,9,-10,111),true);for(const args of [[8,-10,111],[9,9,111],[9,-10,222],[9,-10,undefined]])assert.equal(await m.healthTopicAllowed(h.env,...args),false);
 assert.ok(!m.assistantTools(h.env,'chat',[]).some(t=>t.name==='get_health_journal'));assert.equal((await m.daynotePreferences(h.env)).reminders,false);
});
test('Daynote APIs preserve existing bearer authentication and do not expose token fields in status/export',async()=>{
 const h=setup();const r=await m.worker.fetch(new Request('https://fixture.test/api/daynote/state'),h.env,{waitUntil(){}});assert.equal(r.status,401);
 const status=await m.daynoteConnection(h.env);assert.equal(status.connected,false);assert.equal(status.readiness_available,false);assert.ok(!('refresh_token'in status));
 const auth=await m.worker.fetch(new Request('https://fixture.test/api/daynote/state',{headers:{authorization:'Bearer fixture-only'}}),h.env,{waitUntil(){}});assert.equal(auth.status,200);assert.equal(auth.headers.get('cache-control'),'private, no-store');const data=await auth.json();assert.deepEqual(data.entries,[]);assert.deepEqual(data.measurements,[]);
});
test('OAuth uses read-only scopes, PKCE, cookie-bound single-use state and verifies a real API request',async()=>{
 const h=setup();const start=await m.healthConnect(h.env,new Request('https://fixture.test/api/daynote/google/connect'));const {url}=await start.json(),u=new URL(url),state=u.searchParams.get('state');assert.equal(u.searchParams.get('code_challenge_method'),'S256');assert.ok(!u.searchParams.get('scope').includes('write'));
 assert.match(start.headers.get('set-cookie'),/HttpOnly; Secure; SameSite=Lax/);
 const bad=await m.finishHealthAuth(h.env,new Request('https://fixture.test/api/daynote/google/callback?state='+state+'&code=code'));assert.match(bad.headers.get('location'),/invalid_state/);assert.equal(h.count('daynote_google'),0);
 const calls=[];await withFetch(async(url)=>{calls.push(String(url));if(String(url).includes('oauth2.googleapis.com/token'))return response({access_token:'synthetic-access',refresh_token:'synthetic-refresh',expires_in:3600,scope:m.HEALTH_SCOPES.join(' ')});if(String(url).endsWith('/identity'))return response({healthUserId:'fixture'});return response({dataPoints:[]});},async()=>{
  const r=await m.finishHealthAuth(h.env,new Request('https://fixture.test/api/daynote/google/callback?state='+state+'&code=code',{headers:{cookie:'daynote_oauth='+state}}));assert.match(r.headers.get('location'),/verified/);assert.equal(calls.length,3);
 });
 assert.equal((await m.daynoteConnection(h.env)).connected,true);const raw=h.db.prepare('SELECT refresh_token FROM daynote_google').get().refresh_token;assert.ok(!raw.includes('synthetic-refresh'));assert.equal(h.count('daynote_measurements'),0);
 const repeat=await m.finishHealthAuth(h.env,new Request('https://fixture.test/api/daynote/google/callback?state='+state+'&code=code',{headers:{cookie:'daynote_oauth='+state}}));assert.match(repeat.headers.get('location'),/expired_state/);
});
test('denied consent, failed identity and failed data fetch never claim a verified connection',async()=>{
 for(const mode of ['denied','identity','data']){const h=setup();const start=await m.healthConnect(h.env,new Request('https://fixture.test/api/daynote/google/connect'));const state=new URL((await start.json()).url).searchParams.get('state');
 await withFetch(async url=>String(url).includes('oauth2.googleapis.com')?response({access_token:'fixture',refresh_token:'fixture',expires_in:3600,scope:m.HEALTH_SCOPES[0]}):String(url).endsWith('/identity')?response({},mode==='identity'?400:200):response({},403),async()=>{await m.finishHealthAuth(h.env,new Request('https://fixture.test/api/daynote/google/callback?state='+state+(mode==='denied'?'&error=access_denied':'&code=c'),{headers:{cookie:'daynote_oauth='+state}}));});assert.equal(h.count('daynote_google'),0);}
});
test('Google v4 parsing retains stages/provenance and never invents a score or missing HRV',()=>{
 const p={name:'users/fixture/dataTypes/sleep/dataPoints/1',sleep:{interval:{startTime:'2026-11-01T22:00:00Z',endTime:'2026-11-02T05:00:00Z'},summary:{minutesAsleep:'380'},stages:[{type:'REM'}]}};const s=m.normalizeHealthPoint('sleep',p);assert.equal(s.value,380);assert.equal(s.raw.sleep.stages[0].type,'REM');assert.equal(s.date,'2026-11-02');
 assert.equal(m.normalizeHealthPoint('daily-heart-rate-variability',{name:'hrv',dailyHeartRateVariability:{date:{year:2026,month:11,day:2}}}).value,null);
 assert.equal(m.availableTypes(m.HEALTH_SCOPES[0]).length,1);
});
async function connected(h,expires=Date.now()+3600000){h.db.prepare('INSERT INTO daynote_google(id,refresh_token,access_token,expires_at,scopes,generation,verified_at,backfill_before) VALUES(1,?,?,?,?,?,?,?)').run(await m.sealGoogleToken(h.env,'fixture-refresh'),await m.sealGoogleToken(h.env,'fixture-access'),expires,m.HEALTH_SCOPES[0],'fixture-generation',new Date().toISOString(),m.localDate());}
test('incremental fetch deduplicates records, retries transient errors and records a real successful sync time',async()=>{
 const h=setup();await connected(h);let attempts=0;
 await withFetch(async(url)=>{assert.match(String(url),/^https:\/\/health.googleapis.com\/v4\//);attempts++;if(attempts===1)return response({},503);return response({dataPoints:[{name:'sleep1',sleep:{interval:{startTime:new Date(Date.now()-8*3600000).toISOString(),endTime:new Date().toISOString()},summary:{minutesAsleep:'400'}}}]});},async()=>{await m.healthSync(h.env,true);await m.healthSync(h.env,true);});
 assert.equal(h.count('daynote_measurements'),1);assert.ok((await m.daynoteConnection(h.env)).last_success);assert.equal(attempts,3);
});

test('exercise sync uses Google session civil dates rather than unsupported physical start filters',async()=>{
 const h=setup();await connected(h);h.db.prepare('UPDATE daynote_google SET scopes=?').run(m.HEALTH_SCOPES[2]);let calls=0;
 await withFetch(async url=>{const u=new URL(url);calls++;assert.match(u.pathname,/\/exercise\/dataPoints$/);assert.match(u.searchParams.get('filter'),/^exercise\.interval\.civil_start_time >= "\d{4}-\d{2}-\d{2}" AND exercise\.interval\.civil_start_time < "\d{4}-\d{2}-\d{2}"$/);return response({dataPoints:[]});},async()=>{const result=await m.healthSync(h.env,true);assert.deepEqual(result.synced,['exercise']);assert.deepEqual(result.warnings,[]);});
 assert.equal(calls,1);assert.ok((await m.daynoteConnection(h.env)).last_success);
});

test('heart-rate sync uses physical-time filters, paginates and stores observed-minute summaries rather than raw sample rows',async()=>{
 const h=setup();await connected(h);h.db.prepare('UPDATE daynote_google SET scopes=?').run(m.HEALTH_SCOPES[1]);let calls=0;
 await withFetch(async url=>{const u=new URL(url);if(!u.pathname.includes('/heart-rate/'))return response({dataPoints:[]});calls++;assert.equal(u.searchParams.get('pageSize'),'10000');assert.match(u.searchParams.get('filter'),/heart_rate.sample_time.physical_time/);const t=new Date(Date.now()-3600000),minute=Math.floor(t.getTime()/60000)*60000;return response({dataPoints:[{name:'hr'+calls,heartRate:{sampleTime:{physicalTime:new Date(minute+(calls===1?0:10000)).toISOString()},beatsPerMinute:calls===1?'80':'100'},dataSource:{device:{model:'Pixel Watch'}}}],nextPageToken:calls===1?'next-page':undefined});},async()=>{await m.healthSync(h.env,true);});
 assert.equal(calls,2);const rows=h.db.prepare("SELECT * FROM daynote_measurements WHERE type='heart-rate-summary'").all();assert.equal(rows.length,1);const raw=JSON.parse(rows[0].raw);assert.equal(raw.coverage_minutes,1);assert.deepEqual(raw.bins,[[90,1]]);assert.equal(raw.source,'google_api_hr');assert.equal(h.db.prepare("SELECT count(*) n FROM daynote_measurements WHERE type='heart-rate'").get().n,0);
});
test('revoked tokens stop future syncs; disconnect during an in-flight fetch prevents health-data writes',async()=>{
 const h=setup();await connected(h,0);await withFetch(async()=>response({},400),async()=>{await assert.rejects(m.healthSync(h.env,true));});assert.equal((await m.daynoteConnection(h.env)).connected,false);assert.ok((await m.healthSync(h.env,true)).skipped);
 const other=setup();await connected(other);await withFetch(async()=>{await m.disconnectHealth(other.env);return response({dataPoints:[{name:'late',sleep:{interval:{startTime:'2026-11-01T20:00Z',endTime:'2026-11-02T05:00Z'},summary:{minutesAsleep:'400'}}}]});},async()=>{assert.equal((await m.healthSync(other.env,true)).skipped,'disconnected');});assert.equal(other.count('daynote_measurements'),0);
});
test('journal deletion and full Daynote deletion preserve unrelated Chief of Staff work',async()=>{
 const h=setup();const j=h.journal('2026-11-01');await h.save(j);h.db.prepare("INSERT INTO items(id,kind,title,status,created_at,updated_at) VALUES('keep','task','Unrelated task','open','2026-11-01','2026-11-01')").run();
 await m.daynoteRoute(new Request('https://fixture.test/api/daynote/data',{method:'DELETE'}),h.env);assert.equal(h.count('items'),1);assert.equal(h.count('daynote_entries'),0);assert.equal(h.count('daynote_notes'),0);
});


test('Health conversations have only health tools, cannot reuse General, and are excluded from global memory learning',async()=>{
 const h=setup();h.env.OPENAI_API_KEY='fixture-never-sent';const requests=[];
 const reply=JSON.stringify({text:'No measurements yet.',tool_calls:[]});
 const modelReply=()=>response({id:'fixture-response',status:'completed',output_text:reply,output:[{type:'message',id:'m',role:'assistant',status:'completed',content:[{type:'output_text',text:reply,annotations:[]}]}]});
 const deferred=[];
 await withFetch(async(url,init)=>{requests.push(JSON.parse(init.body));return modelReply();},async()=>{
  const health=await m.chat(h.env,'Sensitive health fixture: how was my sleep?','text',null,{channel:'telegram',subject:{name:'Health',feature:'health'},defer:p=>deferred.push(p)});
  await Promise.all(deferred);// The health chat offers its tools inside the private prompt (the same request works on Codex, Claude or the API).
  const sent=JSON.stringify(requests[0]);assert.ok(sent.includes('get_health_journal'));assert.ok(!sent.includes('\\"remember\\"'));assert.ok(!sent.includes('load_tools'));assert.equal(health.engine,'api','no plan runner online: the API answers');assert.equal(h.db.prepare('SELECT privacy_scope FROM conversations WHERE id=?').get(health.conversation.id).privacy_scope,'health');
  const general=await m.chat(h.env,'What should I do?','text',health.conversation.id,{defer:p=>deferred.push(p)});await Promise.all(deferred);assert.notEqual(general.conversation.id,health.conversation.id);
 });
 const learning=[];await withFetch(async(url,init)=>{learning.push(JSON.parse(init.body));return response({id:'learn-fixture',object:'response',status:'completed',output_text:'{"suggestions":[]}',output:[{type:'message',id:'m',role:'assistant',status:'completed',content:[{type:'output_text',text:'{"suggestions":[]}',annotations:[]}]}]});},async()=>{const learningResult=await m.learnPass(h.env,true);assert.equal(learningResult.error,undefined);});
 assert.ok(learning.length);assert.ok(!JSON.stringify(learning).includes('Sensitive health fixture'));
});

test('manual Google cardio load keeps native units, final status and missing versus zero across saves',async()=>{const h=setup(),j=h.journal('2026-11-01');j.cardio_load=175;j.cardio_load_final=true;j.readiness=65;const saved=await h.save(j);assert.equal(saved.entry.cardio_load,175);assert.equal(saved.entry.cardio_load_final,true);assert.equal(saved.entry.readiness,65);const zero={...saved.entry,cardio_load:0};const z=await h.save(zero,1,'zero-load');assert.equal(z.entry.cardio_load,0);const missing={...z.entry,cardio_load:null,cardio_load_final:false};assert.equal((await h.save(missing,2,'missing-load')).entry.cardio_load,null);await assert.rejects(h.save({...missing,cardio_load:-1},3,'invalid-load'));});
test('Google daily respiratory, oxygen and temperature data retain their native units and missing values',()=>{
 const date={year:2026,month:11,day:3},make=(type,key,fields)=>m.normalizeHealthPoint(type,{name:'users/me/dataTypes/'+type+'/dataPoints/a',[key]:{date,...fields}});
 assert.equal(make('daily-respiratory-rate','dailyRespiratoryRate',{breathsPerMinute:15.3}).value,15.3);
 assert.equal(make('daily-oxygen-saturation','dailyOxygenSaturation',{averagePercentage:97}).value,97);
 assert.ok(Math.abs(make('daily-sleep-temperature-derivations','dailySleepTemperatureDerivations',{nightlyTemperatureCelsius:34.2,baselineTemperatureCelsius:34}).value-.2)<1e-8);
 assert.equal(make('daily-sleep-temperature-derivations','dailySleepTemperatureDerivations',{nightlyTemperatureCelsius:34}).value,null);
});
test('additional daily measurements compare confirmed habit days against the following morning',()=>{
 const j=(date,v)=>({...m.emptyJournal(date,[]),answers:{coffee:yes(v)}});
 const x=m.analyzeJournals([j('2026-10-31','yes'),j('2026-11-01','no')],[{id:'r1',date:'2026-11-01',type:'daily-respiratory-rate',value:17,start_at:null,end_at:null},{id:'r2',date:'2026-11-02',type:'daily-respiratory-rate',value:15,start_at:null,end_at:null}],false);
 const c=x.comparisons.find(c=>c.habit_id==='coffee'&&c.metric==='respiratory_rate');assert.equal(c.difference,2);assert.equal(c.yes_n,1);assert.equal(c.no_n,1);assert.equal(c.label,'Insufficient observations');
});

test('relationship suggestions require confirmed evidence and approval, preserve dismissals and count both answers',async()=>{
 const h=setup(),env=h.env;await m.saveHabit(env,{id:'custom_work',label:'Did you work late?',category:'Work',enabled:false});
 const transcript='I had coffee and worked late',noteId='relation-note';h.db.prepare("INSERT INTO daynote_notes(id,date,transcript,observations,decisions,source,created_at,processed) VALUES(?,?,?,'[]','{}','pwa',?,1)").run(noteId,'2026-11-01',transcript,new Date().toISOString());
 const j=m.emptyJournal('2026-11-01',await m.daynoteHabits(env));j.answers={caffeine:{...yes(),source:'note',note_id:noteId,evidence:'coffee'},custom_work:{...yes(),source:'note',note_id:noteId,evidence:'worked late'}};
 await m.saveEntry(env,j.date,{mutation_id:'relation-entry',base_revision:0,entry:j});
 const model={complete:async()=>JSON.stringify({relationships:[{parent_id:'caffeine',related_id:'custom_work',evidence:'coffee and worked late',rationale:'Explore whether late work and coffee coincide.'},{parent_id:'caffeine',related_id:'custom_work',evidence:'invented quote',rationale:'No'}]})};
 await m.suggestRelationships(env,noteId,model);let links=await m.relationships(env);assert.equal(links.length,1);assert.equal(links[0].status,'suggested');assert.equal((await m.relationshipStats(env)).length,0);
 await m.decideRelationship(env,links[0].id,'approved');let stats=await m.relationshipStats(env);assert.equal(stats[0].groups.yes.yes,1);assert.equal(stats[0].groups.no.yes,0);
 await m.decideRelationship(env,links[0].id,'dismissed');await m.suggestRelationships(env,noteId,model);links=await m.relationships(env);assert.equal(links.length,1);assert.equal(links[0].status,'dismissed');assert.equal((await m.relationshipStats(env)).length,0);
});

test('daily Google vitals without resource names retain stable per-type per-date identities',()=>{
 const date={year:2026,month:11,day:3};const a=m.normalizeHealthPoint('daily-heart-rate-variability',{dailyHeartRateVariability:{date,averageHeartRateVariabilityMilliseconds:42}}),b=m.normalizeHealthPoint('daily-resting-heart-rate',{dailyRestingHeartRate:{date,beatsPerMinute:55}});assert.equal(a.value,42);assert.equal(b.value,55);assert.notEqual(a.id,b.id);assert.equal(a.id,m.normalizeHealthPoint('daily-heart-rate-variability',{dailyHeartRateVariability:{date,averageHeartRateVariabilityMilliseconds:45}}).id);
});

 test('disabled questions leave a saved sequence immediately, preserving answers and resume position',()=>{
 const habits=m.HABIT_CATALOG.map(h=>({...h}));let j=m.emptyJournal('2026-11-03',habits);
 j=m.recordAnswer(j,'caffeine','yes');j=m.recordAnswer(j,'late_caffeine','no');
 for(const h of habits)if(['caffeine','alcohol'].includes(h.id))h.enabled=false;
 let active=m.reconcileQuestions(j,habits);
 assert.ok(!active.questions.includes('caffeine'));assert.ok(!active.questions.includes('alcohol'));
 assert.equal(active.questions[active.cursor],'late_meal');assert.equal(active.answers.caffeine.value,'yes');
 assert.deepEqual(m.reconcileQuestions(active,habits),active);
 for(const h of habits)h.enabled=false;active=m.reconcileQuestions(j,habits);assert.deepEqual(active.questions,[]);
 assert.equal(active.cursor,0);assert.equal(active.answers.late_caffeine.value,'no');
 });
