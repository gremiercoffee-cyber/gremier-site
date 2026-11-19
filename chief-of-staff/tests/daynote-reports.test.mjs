import {test} from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';import {readFileSync,readdirSync} from 'node:fs';import {build} from 'esbuild';
const compiled=await build({stdin:{contents:"export * from './worker/daynote-reports';export * from './shared/daynote-reports';export {healthReminders} from './worker/daynote-notifications';",resolveDir:process.cwd()},bundle:true,write:false,platform:'node',format:'esm'});
const m=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
function setup(){const db=new DatabaseSync(':memory:');for(const f of readdirSync('migrations').filter(f=>f.endsWith('.sql')).sort())db.exec(readFileSync('migrations/'+f,'utf8'));const prepare=sql=>{let args=[];return{bind(...v){args=v;return this},async first(){return db.prepare(sql).get(...args)??null},async all(){return{results:db.prepare(sql).all(...args)}},async run(){return{meta:{changes:Number(db.prepare(sql).run(...args).changes)}}}}};return{db,env:{DB:{prepare},VAPID_PUBLIC_KEY:'fixture',VAPID_PRIVATE_JWK:'{}'}};}
const measure=(h,id,type,date,value,extra={})=>h.db.prepare('INSERT INTO daynote_measurements(id,type,date,start_at,end_at,value,raw,updated_at) VALUES(?,?,?,?,?,?,?,?)').run(id,type,date,extra.start??null,extra.end??null,value,JSON.stringify(extra.raw??{}),date+'T08:00:00Z');
function night(h,date,minutes,nap=false){const start=date+'T20:30:00Z',end=new Date(Date.parse(start)+minutes*60000).toISOString();measure(h,'sleep:'+start,'sleep',end.slice(0,10),minutes,{start,end,raw:{sleep:{metadata:{nap}}}});}
function fake(){const calls=[],results=new Map();return{calls,results,async startBackground(req){calls.push(req);return 'resp_'+calls.length;},async checkBackground(id){return results.get(id)??{done:false};}};}
const good=JSON.stringify({direction:'better',headline:'Sleep and HRV both improved.',summary:'More sleep.',findings:[{metric:'hrv',verdict:'better',text:'Up.'}],focus:[{title:'Keep a fixed wake time',why:'x',how:'y',evidence:'z',sources:['https://aasm.org/a']},{title:'b',why:'',how:'',evidence:''},{title:'c',why:'',how:'',evidence:''},{title:'d',why:'',how:'',evidence:''}],watch:'',sources:['https://pubmed.ncbi.nlm.nih.gov/1','not a url']});
// Sunday 8 Nov 2026, 11:00 Israel time.
const sunday=new Date('2026-11-08T09:00:00Z');

test('reports are due the morning after the week (Sun–Sat) and month end',()=>{
 assert.deepEqual(m.duePeriods(sunday),[{kind:'week',start:'2026-11-01',end:'2026-11-07'},{kind:'month',start:'2026-10-01',end:'2026-10-31'}]);
 assert.deepEqual(m.duePeriods(new Date('2026-11-08T06:00:00Z')).map(p=>p.kind),['month'],'week report waits until 10:00 Sunday');
 assert.deepEqual(m.duePeriods(new Date('2026-12-01T06:00:00Z')).map(p=>p.start),['2026-11-22'],'month report waits until 10:00 on the 1st');
});

test('period stats judge direction per measure and skip naps',()=>{
 const rows=[];for(let i=0;i<14;i++){const d=new Date(Date.parse('2026-10-25T12:00:00Z')+i*86400000).toISOString().slice(0,10),cur=d>='2026-11-01';
  rows.push({type:'daily-heart-rate-variability',date:d,value:cur?60:50},{type:'daily-resting-heart-rate',date:d,value:cur?60:58},{type:'sleep',date:d,start_at:d+'T20:30:00Z',end_at:d+'T23:59:00Z',value:cur?450:390});}
 rows.push({type:'sleep',date:'2026-11-03',start_at:'2026-11-03T21:00:00Z',end_at:'2026-11-04T09:00:00Z',value:700,nap:1});
 const s=m.periodStats('week','2026-11-01','2026-11-07',rows,[]),by=k=>s.metrics.find(x=>x.key===k);
 assert.equal(by('hrv').judgment,'better');assert.equal(by('rhr').judgment,'worse');
 assert.equal(by('sleep_minutes').current,450,'the nap row is not counted as a night');assert.equal(by('sleep_minutes').judgment,'better');
 assert.equal(by('oxygen').judgment,'unknown');assert.equal(s.days_with_data,7);
 const w=m.windowCompare('hrv',m.dailySeries(rows,[]).hrv,'2026-11-07',7);assert.equal(w.judgment,'better');assert.equal(w.change,10);
});

test('thin period: canned report, no AI call',async()=>{
 const h=setup(),p=fake();await m.healthReports(h.env,sunday,p);
 assert.equal(p.calls.length,0);
 const rows=h.db.prepare('SELECT kind,status,analysis FROM daynote_reports ORDER BY kind').all();
 assert.deepEqual(rows.map(r=>[r.kind,r.status]),[['month','ready'],['week','ready']]);
 assert.equal(JSON.parse(rows[1].analysis).direction,'not_enough_data');
});

test('one Sol job per period, parsed when done, retried, notice sent once',async()=>{
 const h=setup(),p=fake();for(let i=0;i<70;i++){const d=new Date(Date.parse('2026-09-01T12:00:00Z')+i*86400000).toISOString().slice(0,10);night(h,d,420+(i%5)*10);measure(h,'hrv:'+d,'daily-heart-rate-variability',d,50+i%7);}
 await Promise.all([m.healthReports(h.env,sunday,p),m.healthReports(h.env,sunday,p)]);
 assert.equal(p.calls.length,2,'one week and one month job, not four');
 assert.ok(p.calls.every(c=>c.model==='gpt-6.1-sol'&&c.effort==='high'&&c.maxSearches>0));
 assert.match(p.calls[0].prompt,/DATA \(calculated by code\)/);
 p.results.set('resp_1',{done:true,text:'Here you go:\n'+good,searches:4,sources:['https://www.sleepfoundation.org/x']});
 p.results.set('resp_2',{done:true,failed:'timeout'});
 await m.healthReports(h.env,sunday,p);
 const ready=h.db.prepare("SELECT * FROM daynote_reports WHERE status='ready'").get(),a=JSON.parse(ready.analysis);
 assert.equal(a.focus.length,3,'at most three focus items');assert.equal(ready.model,'gpt-6.1-sol');
 assert.deepEqual(JSON.parse(ready.sources).sort(),['https://aasm.org/a','https://pubmed.ncbi.nlm.nih.gov/1','https://www.sleepfoundation.org/x']);
 const list=await m.listReports(h.env);assert.equal(list.find(r=>r.id===ready.id).headline,'Sleep and HRV both improved.');
 assert.equal((await m.getReport(h.env,ready.id)).analysis.direction,'better');
 // The failed one is retried only after 30 minutes.
 // Stamps use the real clock, so pin the failure time to the fixture's Sunday (a real "now" would make a newer week due).
 h.db.prepare("UPDATE daynote_reports SET updated_at=? WHERE status='failed'").run(sunday.toISOString());
 await m.healthReports(h.env,new Date(sunday.getTime()+10*60000),p);assert.equal(p.calls.length,2);
 await m.healthReports(h.env,new Date(sunday.getTime()+31*60000),p);assert.equal(p.calls.length,3);
 assert.equal(h.db.prepare("SELECT attempts FROM daynote_reports WHERE status='running'").get().attempts,2);
 // Ready notice: generic text, sent once.
 h.db.prepare('INSERT INTO daynote_push_subscriptions(endpoint,subscription,created_at) VALUES(?,?,?)').run('https://example.test','{}','2026-11-05');
 const sent=[],deliver=async(_,msg)=>{sent.push(msg);return{sent:1,failed:0}};
 const ra=new Date(ready.ready_at),noon=new Date(Date.UTC(ra.getUTCFullYear(),ra.getUTCMonth(),ra.getUTCDate(),10,0));
 const when=noon<ra?new Date(noon.getTime()+86400000):noon;
 await m.healthReminders(h.env,when,deliver);await m.healthReminders(h.env,new Date(when.getTime()+600000),deliver);
 const notes=sent.filter(s=>s.tag==='daynote-report');assert.equal(notes.length,1);
 assert.match(notes[0].title,/health report is ready/);assert.ok(notes[0].url.endsWith('?report='+ready.id));assert.doesNotMatch(notes[0].body,/\d/);
});

test('inline citations and tracking tags are removed',()=>{
 const a=m.parseReport(JSON.stringify({direction:'steady',headline:'Steady.',summary:'Seven hours is advised. ([aasm.org](https://aasm.org/x?utm_source=openai)) See [NSF](https://thensf.org/y).',focus:[{title:'t',why:'w',how:'h',evidence:'e ([s.org](https://s.org/a%2528b%2529?utm_source=openai))',sources:['https://s.org/a%2528b%2529?utm_source=openai','https://s.org/a%28b%29']}],sources:['https://aasm.org/x?utm_source=openai','https://aasm.org/x']}));
 assert.equal(a.summary,'Seven hours is advised. See NSF.');assert.equal(a.focus[0].evidence,'e');
 assert.deepEqual(a.focus[0].sources,['https://s.org/a%28b%29']);assert.deepEqual(a.sources,['https://aasm.org/x']);
});
