import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {build} from 'esbuild';
const bundle=await build({stdin:{contents:"export * from './worker/job-briefs';export {setPinned,nextCodexRun,finishRun,jobChat} from './worker/jobs';export {emailPrompt,finishEmailRun,emailRunFailed,checkEmailReplies} from './worker/outreach';export {default as worker} from './worker/index';",resolveDir:process.cwd()},bundle:true,write:false,format:'esm',platform:'node'});
const m=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
function setup(){
 const db=new DatabaseSync(':memory:');for(const file of readdirSync('migrations').filter(f=>f.endsWith('.sql')).sort())db.exec(readFileSync('migrations/'+file,'utf8'));
 const prepare=sql=>{let a=[];return{bind(...args){a=args;return this;},async first(){return db.prepare(sql).get(...a)??null;},async all(){return{results:db.prepare(sql).all(...a)};},async run(){return{meta:{changes:Number(db.prepare(sql).run(...a).changes)}};}};};
 const env={DB:{prepare,batch:async ss=>{db.exec('BEGIN');try{const r=[];for(const s of ss)r.push(await s.run());db.exec('COMMIT');return r;}catch(e){db.exec('ROLLBACK');throw e;}}},COS_ACCESS_TOKEN:'fixture'};
 const stamp=new Date().toISOString();
 db.prepare("INSERT INTO jobs(id,title,instructions,kind,engine,status,created_at,updated_at) VALUES('job','Packaging','Find suitable printed carriers','once','codex','active',?,?)").run(stamp,stamp);
 const email=(id='e',number=1)=>db.prepare("INSERT INTO job_emails(id,job_id,number,to_email,subject,body,status,created_at) VALUES(?,'job',?,'supplier@example.test','Quote request','Please quote 250','sent',?)").run(id,number,stamp);
 const report=(id,revision,text,started='2026-11-01T10:00:00Z')=>db.prepare("INSERT INTO job_runs(id,job_id,status,context_revision,result,created_at,started_at,finished_at) VALUES(?,'job','done',?,?,?, ?,?)").run(id,revision,text,stamp,started,stamp);
 return{db,env,email,report};
}
const doc=(summary='Current situation')=>({summary,recommendation:'Compare quotes',next_action:'Wait for replies',questions:[]});
const reply=data=>new Response(JSON.stringify({ok:true,result:data}),{headers:{'content-type':'application/json'}});
async function withFetch(fn,body){const orig=globalThis.fetch;globalThis.fetch=fn;try{return await body();}finally{globalThis.fetch=orig;}}

test('existing jobs migrate without losing their instructions and only relevant changes invalidate briefs',async()=>{
 const h=setup();let k=await m.jobKnowledge(h.env,'job');assert.equal(k.revision,1);assert.equal(k.brief,null);
 h.email();k=await m.jobKnowledge(h.env,'job');assert.equal(k.revision,2);
 await m.saveBrief(h.env,'job',2,doc());h.db.exec("UPDATE job_emails SET checked_at='2026-11-02' WHERE id='e'");assert.equal((await m.jobKnowledge(h.env,'job')).stale,false);
 h.db.exec("UPDATE job_emails SET reply_text='Quote is 8 shekels',status='replied' WHERE id='e'");k=await m.jobKnowledge(h.env,'job');assert.equal(k.stale,true);assert.equal(k.emails[0].reply_text,'Quote is 8 shekels');
});
test('late model responses cannot overwrite newer correspondence or brief versions',async()=>{
 const h=setup();let release;const waiting=new Promise(r=>release=r);
 const pending=m.refreshBrief(h.env,'job',{complete:async()=>{await waiting;return JSON.stringify(doc('Old summary'));}});
 await new Promise(r=>setTimeout(r,10));h.email();await m.saveBrief(h.env,'job',2,doc('New quote'));release();assert.equal(await pending,false);
 const k=await m.jobKnowledge(h.env,'job');assert.equal(k.brief.summary,'New quote');assert.equal(k.stale,false);assert.equal((await m.briefHistory(h.env,'job')).length,1);
});
test('brief versions are immutable and No Change retains the last substantive report',async()=>{
 const h=setup();h.report('r',1,'Actual findings');h.report('no',2,'NO_CHANGE');await m.saveBrief(h.env,'job',1,doc('First'));
 await m.saveBrief(h.env,'job',1,doc('Overwrite'));assert.equal((await m.jobKnowledge(h.env,'job')).brief.summary,'First');assert.equal((await m.jobKnowledge(h.env,'job')).reports[0].result,'Actual findings');
 h.db.exec("UPDATE jobs SET instructions='Include refrigerated board' WHERE id='job'");await m.saveBrief(h.env,'job',2,doc('Second'));assert.equal((await m.briefHistory(h.env,'job')).length,2);
});
test('an older run finishing later does not become the current report',async()=>{
 const h=setup();h.report('new',5,'Newer source report','2026-11-02T10:00:00Z');h.report('old',2,'Older source report','2026-11-01T10:00:00Z');assert.equal((await m.jobKnowledge(h.env,'job')).reports[0].id,'new');
});
test('pin/unpin never changes execution status or schedule',async()=>{
 const h=setup();h.db.exec("UPDATE jobs SET next_run_at='2026-11-03T10:00Z' WHERE id='job'");await m.setPinned(h.env,'job',false);const j=h.db.prepare("SELECT * FROM jobs WHERE id='job'").get();assert.equal(j.status,'active');assert.equal(j.next_run_at,'2026-11-03T10:00Z');
});
test('project links use existing folders and job context stays isolated',async()=>{
 const h=setup();h.db.exec("INSERT INTO projects(id,name,description,area,status,created_at,updated_at) VALUES('p','Mini packaging','','business','active','x','x')");await m.linkJobProject(h.env,'job','p');assert.equal((await m.jobKnowledge(h.env,'job')).project_title,'Mini packaging');await assert.rejects(m.linkJobProject(h.env,'job','missing'));
 h.db.exec("INSERT INTO jobs(id,title,instructions,kind,status,created_at,updated_at) VALUES('other','Private','Other secret','once','active','x','x')");assert.ok(!JSON.stringify(await m.jobContext(h.env,'job')).includes('Other secret'));
});
test('every Codex research run and email draft receives current brief, owner decisions and correspondence',async()=>{
 const h=setup();h.email();h.db.exec("UPDATE job_emails SET reply_text='New price 8',status='replied' WHERE id='e'");h.db.exec("INSERT INTO job_messages(id,job_id,role,text,created_at) VALUES('owner','job','you','Use blue print','2026-11-02')");h.db.exec("INSERT INTO job_runs(id,job_id,status,engine,created_at) VALUES('run','job','queued','codex','2026-11-02')");
 const result=await m.nextCodexRun(h.env,{device:'fixture'});assert.match(result.run.prompt,/New price 8/);assert.match(result.run.prompt,/Use blue print/);
 const j=h.db.prepare("SELECT * FROM jobs WHERE id='job'").get();assert.match(await m.emailPrompt(h.env,j,{mode:'email_draft',ask:'Ask suppliers'}),/New price 8/);
});
test('Telegram uses a single pinned message and never posts briefs to General or a different group',async()=>{
 const h=setup();h.env.TELEGRAM_BOT_TOKEN='fixture-only';h.db.exec("INSERT INTO settings(key,value) VALUES('telegram','{\"owner_id\":1,\"group_id\":-100}')");await m.saveBrief(h.env,'job',1,doc());
 const methods=[];await withFetch(async(url,opts)=>{const body=JSON.parse(opts.body);methods.push({method:String(url).split('/').at(-1),body});return reply({message_id:42});},async()=>{
  assert.equal(await m.publishBrief(h.env,'job'),false);assert.equal(methods.length,0);
  h.db.exec("UPDATE jobs SET chat_id=-100,topic_id=99 WHERE id='job'");assert.equal(await m.publishBrief(h.env,'job'),true);assert.equal(await m.publishBrief(h.env,'job'),true);
  h.email();await m.saveBrief(h.env,'job',2,doc('Updated quote'));assert.equal(await m.publishBrief(h.env,'job'),true);
 });
 assert.equal(methods.filter(x=>x.method==='sendMessage').length,1);assert.equal(methods.filter(x=>x.method==='editMessageText').length,1);assert.equal(methods.find(x=>x.method==='sendMessage').body.message_thread_id,99);
});
test('Telegram permission failures are visible and never claim a successful mirror',async()=>{
 const h=setup();h.env.TELEGRAM_BOT_TOKEN='fixture';h.db.exec("INSERT INTO settings(key,value) VALUES('telegram','{\"owner_id\":1,\"group_id\":-100}')");h.db.exec("UPDATE jobs SET chat_id=-100,topic_id=99 WHERE id='job'");await m.saveBrief(h.env,'job',1,doc());
 await withFetch(async()=>new Response(JSON.stringify({ok:false,description:'Forbidden'})),async()=>assert.equal(await m.publishBrief(h.env,'job'),false));const k=await m.jobKnowledge(h.env,'job');assert.equal(k.telegram.synced,false);assert.match(k.telegram.error,/permissions/);
});
test('failed email sends are uncertain and cannot silently become retryable drafts',async()=>{
 const h=setup();h.email();h.db.exec("UPDATE job_emails SET status='sending' WHERE id='e'");await m.emailRunFailed(h.env,{mode:'email_send',ask:'[\"e\"]'});assert.equal(h.db.prepare("SELECT status FROM job_emails WHERE id='e'").get().status,'uncertain');assert.equal((await m.jobKnowledge(h.env,'job')).state,'Needs you');
});
test('private brief APIs reject unauthenticated requests',async()=>{
 const h=setup();const response=await m.worker.fetch(new Request('https://fixture/api/jobs/job/brief/history'),h.env,{waitUntil(){}});assert.equal(response.status,401);
});

test('subsequent supplier replies are tracked and failed checks do not advance last-checked time',async()=>{
 const h=setup();h.email();h.db.prepare("UPDATE job_emails SET thread_id='thread',sent_at=?,checked_at=NULL WHERE id='e'").run(new Date(Date.now()-86400000).toISOString());
 let date=new Date(Date.now()-60000).toISOString();let text='First quote';
 const reader=async()=>({messages:[{from_user:false,from:'Supplier',date,text}]});
 await m.checkEmailReplies(h.env,reader);let k=await m.jobKnowledge(h.env,'job');assert.equal(k.emails[0].reply_text,'First quote');assert.equal(k.emails[0].status,'replied');
 h.db.exec("UPDATE job_emails SET checked_at=NULL WHERE id='e'");date=new Date().toISOString();text='Updated quote';await m.checkEmailReplies(h.env,reader);k=await m.jobKnowledge(h.env,'job');assert.equal(k.emails[0].reply_text,'Updated quote');
 h.db.exec("UPDATE job_emails SET checked_at=NULL WHERE id='e'");await m.checkEmailReplies(h.env,async()=>{throw new Error('Revoked');});assert.equal((await m.jobKnowledge(h.env,'job')).emails[0].checked_at,null);
});

test('updates within the same project invalidate related briefs and include current correspondence',async()=>{
 const h=setup();h.db.exec("INSERT INTO projects(id,name,description,area,status,created_at,updated_at) VALUES('p','Packaging','','business','active','x','x')");
 await m.linkJobProject(h.env,'job','p');h.db.exec("INSERT INTO jobs(id,title,instructions,kind,status,project_id,created_at,updated_at) VALUES('related','Quotes','Get quotes','once','active','p','x','x')");
 const before=(await m.jobKnowledge(h.env,'related')).revision;await m.saveBrief(h.env,'related',before,doc());h.email();h.db.exec("UPDATE job_emails SET reply_text='New confirmed price',status='replied' WHERE id='e'");
 const k=await m.jobKnowledge(h.env,'related');assert.equal(k.stale,true);assert.ok(k.revision>before);assert.equal(k.related_jobs[0].latest_correspondence[0].reply_text,'New confirmed price');
});
