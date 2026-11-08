import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {build} from 'esbuild';
const bundle=await build({entryPoints:['worker/home-jobs.ts'],bundle:true,write:false,format:'esm',platform:'node'});
const m=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
function setup(){
 const db=new DatabaseSync(':memory:');for(const f of readdirSync('migrations').filter(f=>f.endsWith('.sql')).sort())db.exec(readFileSync('migrations/'+f,'utf8'));
 const prepare=sql=>{let args=[];return{bind(...v){args=v;return this},async first(){return db.prepare(sql).get(...args)??null},async all(){return{results:db.prepare(sql).all(...args)}},async run(){return{meta:{changes:Number(db.prepare(sql).run(...args).changes)}}}}};
 db.prepare('INSERT INTO settings(key,value) VALUES(?,?)').run('timezone','"Asia/Jerusalem"');
 return {db,env:{DB:{prepare},HASHGACHA_READ_KEY:'fixture-read-key',HASHGACHA_ANON_KEY:'fixture-anon'}};
}
const row=(id,submitted=0,expected=5,extra={})=>({class_id:id,class_name:'Class '+id,rabbi_name:'Rabbi '+id,rabbi_email:`rabbi${id}@example.test`,seder:'night',week_of:'2026-10-18',expected,submitted,last_submission:submitted?'2026-10-22T19:00:00Z':null,...extra});
let calls=0;
async function withSource(rows,fn){const original=globalThis.fetch;globalThis.fetch=async()=>{calls++;return Response.json(rows);};try{return await fn();}finally{globalThis.fetch=original;}}

test('Hashgacha shows who has reported as progress, never as tasks, and names who is still out',async t=>{
 t.mock.timers.enable({apis:['Date'],now:new Date('2026-10-22T10:00:00Z')});
 const h=setup();
 const jobs=await withSource([row(1,5),row(2),row(3,0,5,{rabbi_email:null})],()=>m.homeJobs(h.env));
 const card=jobs.find(j=>j.id==='hashgacha');
 assert.deepEqual(card.progress,{done:1,total:2});assert.equal(card.status,'1 of 2 rabbis have reported');
 assert.deepEqual(card.rows.map(r=>[r.icon,r.label]),[['⏳','Rabbi 2'],['✅','Rabbi 1'],['📭','Rabbi 3']]);
 assert.match(card.next,/Thursday at 21:00/);assert.equal(card.can_stop,true);
 assert.equal(h.db.prepare("SELECT COUNT(*) n FROM items").get().n,0,'no task is created for anyone');
});
test('the Hashgacha app is asked at most every 10 minutes unless you press Check now',async t=>{
 t.mock.timers.enable({apis:['Date'],now:new Date('2026-10-22T10:00:00Z')});
 const h=setup();calls=0;
 await withSource([row(1,5)],async()=>{await m.homeJobs(h.env);await m.homeJobs(h.env);});
 assert.equal(calls,1);
 await withSource([row(1,5)],()=>m.homeJobs(h.env,{force:true}));assert.equal(calls,2);
 t.mock.timers.setTime(Date.parse('2026-10-22T10:11:00Z'));
 await withSource([row(1,5)],()=>m.homeJobs(h.env));assert.equal(calls,3);
});
test('a failed check keeps the last numbers and says so',async t=>{
 t.mock.timers.enable({apis:['Date'],now:new Date('2026-10-22T10:00:00Z')});
 const h=setup();
 await withSource([row(1,5),row(2)],()=>m.homeJobs(h.env));
 const original=globalThis.fetch;globalThis.fetch=async()=>new Response('nope',{status:500});
 try{const card=(await m.homeJobs(h.env,{force:true})).find(j=>j.id==='hashgacha');assert.deepEqual(card.progress,{done:1,total:2});assert.match(card.note,/Last check failed/);}
 finally{globalThis.fetch=original;}
});
test('next step follows the reminder schedule',()=>{
 const tz='Asia/Jerusalem',at=s=>new Date(s);
 assert.match(m.nextHashgachaStep(tz,at('2026-10-24T19:00:00Z'),2,true,new Set()),/going out tonight/);
 assert.match(m.nextHashgachaStep(tz,at('2026-10-25T05:00:00Z'),2,true,new Set()),/today at 9:00/);
 assert.match(m.nextHashgachaStep(tz,at('2026-10-25T12:00:00Z'),2,true,new Set()),/No more reminders/);
 assert.match(m.nextHashgachaStep(tz,at('2026-10-23T10:00:00Z'),2,true,new Set()),/Saturday night, after Shabbat/);
 assert.match(m.nextHashgachaStep(tz,at('2026-10-23T10:00:00Z'),0,true,new Set()),/Everyone has reported/);
 assert.match(m.nextHashgachaStep(tz,at('2026-10-23T10:00:00Z'),2,false,new Set()),/reminders are off/);
});
test('Stop: Hashgacha turns reminders off; a waiting reply is cleared on its own; research jobs stop',async t=>{
 t.mock.timers.enable({apis:['Date'],now:new Date('2026-10-22T10:00:00Z')});
 const h=setup();
 for(const id of ['w1','w2'])h.db.prepare("INSERT INTO items(id,title,kind,status,source,created_at,updated_at) VALUES(?,?,'waiting','open','gmail','2026-10-20','2026-10-20')").run(id,'Wait for quote '+id);
 h.db.prepare("INSERT INTO jobs(id,title,instructions,kind,status,created_at,updated_at) VALUES('j','Supplier research','Find suppliers','once','active','2026-10-20','2026-10-20')").run();
 const jobs=await withSource([row(1,5)],()=>m.homeJobs(h.env));
 assert.deepEqual(jobs.map(j=>j.id),['hashgacha','j','waiting']);
 const waiting=jobs.find(j=>j.id==='waiting');assert.equal(waiting.can_stop,false);assert.ok(waiting.rows.every(r=>r.stoppable));assert.equal(waiting.rows.find(r=>r.id==='w1').label,'Quote w1');
 h.db.prepare("UPDATE items SET title='Await Gershon’s plans' WHERE id='w2'").run();assert.equal((await m.homeJobs(h.env)).find(j=>j.id==='waiting').rows.find(r=>r.id==='w2').label,'Gershon’s plans');
 await assert.rejects(m.stopHomeJob(h.env,'waiting'),/Choose which reply/);
 await m.stopHomeJob(h.env,'waiting','w1');
 assert.equal(h.db.prepare("SELECT status FROM items WHERE id='w1'").get().status,'dropped');assert.equal(h.db.prepare("SELECT status FROM items WHERE id='w2'").get().status,'open');
 await m.stopHomeJob(h.env,'j');assert.equal(h.db.prepare("SELECT status FROM jobs WHERE id='j'").get().status,'stopped');
 await m.stopHomeJob(h.env,'hashgacha');
 const after=await withSource([row(1,5)],()=>m.homeJobs(h.env));
 assert.equal(after.find(j=>j.id==='hashgacha').can_stop,false);assert.equal(after.some(j=>j.id==='j'),false);
});
