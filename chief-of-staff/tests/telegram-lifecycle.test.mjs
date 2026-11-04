import {test} from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';import {readFileSync,readdirSync} from 'node:fs';import {build} from 'esbuild';
const b=await build({stdin:{contents:"export * from './worker/telegram-lifecycle';export {listJobChats,runResult,jobChat} from './worker/jobs';export {tg} from './worker/telegram-api';export {jobSections} from './shared/job-navigation';",resolveDir:process.cwd()},bundle:true,write:false,platform:'node',format:'esm'});
const m=await import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));
function setup(){const db=new DatabaseSync(':memory:');for(const f of readdirSync('migrations').filter(f=>f.endsWith('.sql')).sort())db.exec(readFileSync('migrations/'+f,'utf8'));
 const prepare=sql=>{let a=[];return{bind(...v){a=v;return this;},async first(){return db.prepare(sql).get(...a)??null;},async all(){return{results:db.prepare(sql).all(...a)};},async run(){return{meta:{changes:Number(db.prepare(sql).run(...a).changes)}};}};};
 const env={TELEGRAM_BOT_TOKEN:'fixture',DB:{prepare,batch:async ss=>{db.exec('BEGIN');try{for(const s of ss)await s.run();db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}}}};
 db.exec(`INSERT INTO settings(key,value) VALUES('telegram','{"owner_id":1,"group_id":-100}');INSERT INTO settings(key,value) VALUES('telegram_subjects','{"-100:99":{"name":"Project","feature":"coffee"},"-100:100":{"name":"Other"}}');INSERT INTO conversations(id,title,created_at,last_message_at) VALUES('c','Project','x','x');INSERT INTO settings(key,value) VALUES('telegram_threads','{"-100:99":"c"}');`);
 for(const [id,chat,topic] of [['a',-100,99],['b',-100,100],['other',-200,99]])db.prepare("INSERT INTO jobs(id,title,instructions,kind,status,chat_id,topic_id,created_at,updated_at) VALUES(?,'Job','Work','every','active',?,?,'x','x')").run(id,chat,topic);
 db.exec("INSERT INTO job_runs(id,job_id,status,engine,created_at) VALUES('r','a','running','api','x');INSERT INTO job_messages(id,job_id,role,text,created_at) VALUES('history','a','you','Keep original evidence','x')");return{env,db};}
async function withFetch(fn,body){const original=globalThis.fetch;globalThis.fetch=fn;try{return await body();}finally{globalThis.fetch=original;}}
const error=(description,code=400)=>new Response(JSON.stringify({ok:false,error_code:code,description}),{status:code});
const success=()=>new Response(JSON.stringify({ok:true,result:true}));
test('confirmed topic deletion removes only the matching app entry, cancels execution and preserves history',async()=>{
 const h=setup();const requests=[];await withFetch(async(u,o)=>{const v=JSON.parse(o.body);requests.push(v);return v.message_thread_id===99?error('Bad Request: TOPIC_ID_INVALID'):success();},async()=>{const r=await m.reconcileTopics(h.env,true);assert.equal(r.deleted,1);});
 assert.equal(h.db.prepare("SELECT status FROM jobs WHERE id='a'").get().status,'cancelled');assert.equal(h.db.prepare("SELECT status FROM job_runs WHERE id='r'").get().status,'skipped');assert.equal(h.db.prepare("SELECT status FROM jobs WHERE id='other'").get().status,'active');assert.equal(h.db.prepare("SELECT archived FROM conversations WHERE id='c'").get().archived,1);
 assert.equal(h.db.prepare('SELECT count(*) n FROM job_messages').get().n,1);assert.ok(!(await m.listJobChats(h.env)).some(j=>j.id==='a'));await assert.rejects(m.jobChat(h.env,'a'));assert.equal((await m.runResult(h.env,'r',{text:'Late result'})).ignored,true);
 assert.ok(requests.every(r=>!('name' in r)&&!('icon_custom_emoji_id' in r)),'checks cannot rename/reset topics');
});
test('closed topics, missing pin messages, permission failures and temporary errors never erase app jobs',async()=>{
 for(const [description,code] of [['TOPIC_NOT_MODIFIED',400],['TOPIC_CLOSED',400],['message to edit not found',400],['Forbidden: not an administrator',403],['temporary',500]]){
  const h=setup();await withFetch(async()=>error(description,code),async()=>await m.reconcileTopics(h.env,true));assert.equal(h.db.prepare("SELECT status FROM jobs WHERE id='a'").get().status,'active',description);
 }
});
test('missing-thread send errors reconcile immediately, but General and unrelated groups are protected',async()=>{
 const h=setup();await withFetch(async()=>error('Bad Request: message thread not found'),async()=>{await assert.rejects(m.tg(h.env,'sendMessage',{chat_id:-100,message_thread_id:99,text:'Update'}));});assert.equal(h.db.prepare("SELECT status FROM jobs WHERE id='a'").get().status,'cancelled');assert.equal(await m.forgetTopic(h.env,-200,99),false);assert.equal(await m.forgetTopic(h.env,-100,1),false);
});
test('topic checks are throttled and successful no-change checks keep existing topics',async()=>{
 const h=setup();let calls=0;await withFetch(async()=>{calls++;return error('TOPIC_NOT_MODIFIED');},async()=>{assert.equal((await m.reconcileTopics(h.env)).checked,2);assert.equal((await m.reconcileTopics(h.env)).checked,0);});assert.equal(calls,2);
});
test('Telegram rename updates the matching job and subject without changing other topics',async()=>{
 const h=setup();await m.syncTopicName(h.env,-100,99,'New project name');assert.equal(h.db.prepare("SELECT title FROM jobs WHERE id='a'").get().title,'New project name');assert.equal(h.db.prepare("SELECT title FROM jobs WHERE id='other'").get().title,'Job');assert.equal(JSON.parse(h.db.prepare("SELECT value FROM settings WHERE key='telegram_subjects'").get().value)['-100:99'].name,'New project name');
});
test('app navigation groups active work by project and separates paused and finished work',()=>{
 const r=m.jobSections([{id:'a',status:'active',project_id:'p',project_title:'Packaging'},{id:'b',status:'pending',project_id:'p',project_title:'Packaging'},{id:'c',status:'done'},{id:'d',status:'paused'},{id:'e',status:'cancelled'}]);assert.equal(r.active.length,1);assert.equal(r.active[0].jobs.length,2);assert.equal(r.finished.length,1);assert.equal(r.paused.length,1);assert.ok(!JSON.stringify(r).includes('cancelled'));
});
