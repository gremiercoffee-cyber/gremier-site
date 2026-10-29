import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {build} from 'esbuild';

// Jobs with a fake model and a fake Telegram: starting, hourly runs until a time limit, weekly asking first,
// posting only changes, choosing the engine, the Codex runner, and the API taking over a slow plan run.
globalThis.__model=[];globalThis.__bg=[];globalThis.__tg=[];
const out=await build({entryPoints:['worker/jobs.ts'],bundle:true,write:false,format:'esm',platform:'node',plugins:[{name:'fakes',setup(b){
 b.onLoad({filter:/[\\/]worker[\\/]ai\.ts$/},()=>({contents:`export function getProvider(){return {
  complete:async()=>globalThis.__model.shift()??'{}',
  startBackground:async(r)=>{globalThis.__bg.push(r);return 'bg'+globalThis.__bg.length},
  checkBackground:async(id)=>globalThis.__done?.[id]??{done:false},
 }}`,loader:'js'}));
}}]});
const jobs=await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`);
globalThis.fetch=async(url,init)=>{const method=String(url).split('/').pop();const body=JSON.parse(init.body);globalThis.__tg.push({method,body});
 return new Response(JSON.stringify({ok:true,result:method==='createForumTopic'?{message_thread_id:77}:{}}),{headers:{'content-type':'application/json'}});};

function env(extra={}){
 const db=new DatabaseSync(':memory:');for(const f of readdirSync('migrations').filter(f=>f.endsWith('.sql')).sort())db.exec(readFileSync('migrations/'+f,'utf8'));
 db.prepare('INSERT INTO settings(key,value) VALUES(?,?)').run('timezone','"Asia/Jerusalem"');
 db.prepare('INSERT INTO settings(key,value) VALUES(?,?)').run('telegram',JSON.stringify({owner_id:1,group_id:-100}));
 const prepare=sql=>{let args=[];return{bind(...v){args=v;return this},async first(){return db.prepare(sql).get(...args)??null},async all(){return{results:db.prepare(sql).all(...args)}},async run(){return{meta:{changes:Number(db.prepare(sql).run(...args).changes)}}}}};
 return {db,env:{DB:{prepare},TELEGRAM_BOT_TOKEN:'fixture',...extra}};
}
const reset=()=>{globalThis.__model.length=0;globalThis.__bg.length=0;globalThis.__tg.length=0;globalThis.__done={};};
const posts=()=>globalThis.__tg.filter(t=>t.method==='sendMessage');

test('a new job gets its own topic and waits for Start; Start runs it and schedules the next hourly run',async()=>{
 reset();const {env:e,db}=env();
 const r=await jobs.createJob(e,{title:'US elections',instructions:'Hourly updates on the US elections. End with what to watch next.',kind:'every',every_minutes:60,until:'2026-11-04T23:00',engine:'api'});
 assert.equal(r.status,'waiting for Start');
 assert.equal(globalThis.__tg[0].method,'createForumTopic');
 const intro=posts()[0].body;assert.equal(intro.message_thread_id,77);assert.match(intro.reply_markup.inline_keyboard[0][0].callback_data,/^start:/);
 assert.equal(globalThis.__bg.length,0,'nothing runs before Start');
 await jobs.handleButton(e,intro.reply_markup.inline_keyboard[0][0].callback_data,-100,77,5);
 assert.equal(globalThis.__bg.length,1,'runs right away on the API it was given');
 assert.match(globalThis.__bg[0].prompt,/THE TASK[^]*End with what to watch next/);
 const j=db.prepare('SELECT * FROM jobs').get();assert.equal(j.status,'active');assert.ok(Date.parse(j.next_run_at)>Date.now()+50*60_000);
 assert.equal(j.until_at,'2026-11-04T21:00:00.000Z','the time limit is local time');
});

test('hourly: results post in the topic, "nothing changed" stays quiet, and it ends at its time limit',async()=>{
 reset();const {env:e,db}=env();
 const {id}=await jobs.createJob(e,{title:'Elections',instructions:'Watch the count.',kind:'every',every_minutes:60,engine:'api'});
 await jobs.handleButton(e,`start:${id}`,-100,77,5);
 globalThis.__done={bg1:{done:true,text:'Pennsylvania called.'}};
 await jobs.tickJobs(e);
 assert.match(posts().at(-1).body.text,/Pennsylvania called\.[^]*via API/);
 // the next run compares with the last one and may say nothing changed
 db.prepare("UPDATE jobs SET next_run_at=? WHERE id=?").run(new Date(Date.now()-1000).toISOString(),id);
 await jobs.tickJobs(e);
 assert.match(globalThis.__bg.at(-1).prompt,/previous update[^]*Pennsylvania called/);
 const before=posts().length;globalThis.__done.bg2={done:true,text:'NO_CHANGE'};
 await jobs.tickJobs(e);
 assert.equal(posts().length,before,'no post when nothing changed');
 db.prepare("UPDATE jobs SET next_run_at=?, until_at=? WHERE id=?").run(new Date(Date.now()-1000).toISOString(),new Date(Date.now()-500).toISOString(),id);
 await jobs.tickJobs(e);
 assert.equal(db.prepare('SELECT status FROM jobs WHERE id=?').get(id).status,'done');assert.match(posts().at(-1).body.text,/time limit/);
});

test('weekly: asks before each report and runs only on Yes; Skip skips',async()=>{
 reset();const {env:e,db}=env();
 const {id}=await jobs.createJob(e,{title:'Cold brew market',instructions:'Weekly cold-brew market report with action items for Gremier.',kind:'weekly',weekday:0,time:'09:00',engine:'api'});
 await jobs.handleButton(e,`start:${id}`,-100,77,5);
 assert.equal(globalThis.__bg.length,1,'the first report runs on Start');assert.equal(globalThis.__bg[0].purpose,'job_report');
 db.prepare("UPDATE jobs SET next_run_at=? WHERE id=?").run(new Date(Date.now()-1000).toISOString(),id);
 await jobs.tickJobs(e);
 const ask=posts().at(-1).body;assert.match(ask.text,/this week's/);assert.equal(globalThis.__bg.length,1,'asks, does not run');
 const [yes,skip]=ask.reply_markup.inline_keyboard[0].map(b=>b.callback_data);
 await jobs.handleButton(e,skip,-100,77,9);
 assert.equal(globalThis.__bg.length,1);assert.match(posts().at(-1).body.text,/Skipped/);
 await jobs.handleButton(e,yes,-100,77,9);
 assert.equal(globalThis.__bg.length,1,'a skipped week cannot be run afterwards');
});

test('Automatic uses the plans only: Codex when on with room, then Claude; the API only when chosen',async()=>{
 reset();
 const job={engine:'auto'};
 let {env:e,db}=env();
 assert.equal(await jobs.pickEngine(e,job),null,'no plan free: wait, never the API by itself');
 assert.equal(await jobs.pickEngine(e,{engine:'api'}),'api');
 db.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES('codex_runner',?)").run(JSON.stringify({seen_at:new Date().toISOString(),primary:10,secondary:30}));
 assert.equal(await jobs.pickEngine(e,job),'codex');
 db.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES('codex_runner',?)").run(JSON.stringify({seen_at:new Date().toISOString(),primary:90,secondary:30}));
 assert.equal(await jobs.pickEngine(e,job),null,'a nearly used-up Codex plan is left alone');
 ({env:e,db}=env({CLAUDE_ROUTINE_URL:'https://example/fire',CLAUDE_ROUTINE_TOKEN:'x'}));
 assert.equal(await jobs.pickEngine(e,job),'claude');
 db.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES('claude_limited_until',?)").run(JSON.stringify(new Date(Date.now()+3600_000).toISOString()));
 assert.equal(await jobs.pickEngine(e,job),null,'Claude is avoided after hitting its limit');
 assert.equal(await jobs.pickEngine(e,{engine:'codex'}),null,'a chosen plan that is offline: wait for it');
});

test('the Codex runner takes the run and answers; a run Codex never finishes waits for a plan (not the API)',async()=>{
 reset();const {env:e,db}=env();
 db.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES('codex_runner',?)").run(JSON.stringify({seen_at:new Date().toISOString(),primary:5,secondary:5}));
 const {id}=await jobs.createJob(e,{title:'Bean prices',instructions:'Arabica price now.',kind:'once'});
 await jobs.handleButton(e,`start:${id}`,-100,77,5);
 assert.equal(globalThis.__bg.length,0,'queued for Codex, not the API');
 const next=await jobs.nextCodexRun(e,{device:'home',primary:6,secondary:5});
 assert.match(next.run.prompt,/Arabica price now/);
 assert.equal((await jobs.nextCodexRun(e,{device:'home'})).run,null,'taken once');
 await jobs.runResult(e,next.run.id,{text:'286¢/lb (ICE).'});
 assert.match(posts().at(-1).body.text,/286¢[^]*via Codex plan/);
 assert.equal(db.prepare('SELECT status FROM jobs WHERE id=?').get(id).status,'done');
 // another run that Codex never answers
 const second=await jobs.createJob(e,{title:'Bean prices again',instructions:'Again.',kind:'once'});
 await jobs.handleButton(e,`start:${second.id}`,-100,77,6);
 db.prepare("UPDATE job_runs SET started_at=? WHERE status='queued'").run(new Date(Date.now()-20*60_000).toISOString());
 db.prepare("UPDATE settings SET value=? WHERE key='codex_runner'").run(JSON.stringify({seen_at:new Date(Date.now()-3600_000).toISOString(),primary:5,secondary:5}));
 await jobs.tickJobs(e);
 assert.equal(globalThis.__bg.length,0,'not moved to the API by itself');
 assert.match(posts().at(-1).body.text,/Waiting for your Claude or Codex plan[^]*use the API/);
});

test('replying in the topic changes the job: stop, how often, and how it reports',async()=>{
 reset();const {env:e,db}=env();
 const {id}=await jobs.createJob(e,{title:'Elections',instructions:'Watch the count.',kind:'every',every_minutes:60});
 await jobs.handleButton(e,`start:${id}`,-100,77,5);
 globalThis.__model.push(JSON.stringify({changes:{every_minutes:30,instructions:'Watch the count. End with action items for me.'},run_now:false,reply:'Every 30 minutes, with action items.'}));
 const j=db.prepare('SELECT * FROM jobs WHERE id=?').get(id);
 assert.equal(await jobs.talkToJob(e,j,'check every half hour and give me action items at the end'),'Every 30 minutes, with action items.');
 const after=db.prepare('SELECT * FROM jobs WHERE id=?').get(id);assert.equal(after.every_minutes,30);assert.match(after.instructions,/action items/);
 assert.equal(await jobs.talkToJob(e,after,'stop'),"Done, it's stopped.");
 assert.equal(db.prepare('SELECT status FROM jobs WHERE id=?').get(id).status,'stopped');
});

test('Claude plan: the run gets a one-time reply link; only that link, once, can answer it',async()=>{
 reset();const {env:e}=env({CLAUDE_ROUTINE_URL:'https://example/fire',CLAUDE_ROUTINE_TOKEN:'x'});
 const {id}=await jobs.createJob(e,{title:'Cold brew',instructions:'Weekly cold-brew market with action items.',kind:'once'});
 await jobs.handleButton(e,`start:${id}`,-100,77,5);
 const fire=globalThis.__tg.find(t=>t.method==='fire');
 const payload=JSON.parse(fire.body.text);
 assert.match(payload.task,/action items/);
 const m=payload.reply_url.match(/\/api\/runs\/([\w-]+)\/result\?k=(\w+)$/);assert.ok(m,'reply link');
 assert.equal((await jobs.replyWithToken(e,m[1],'wrong-token-wrong-token',{text:'x'})).ok,false);
 await jobs.replyWithToken(e,m[1],m[2],{text:'Cold brew demand is up 12%.'});
 assert.match(posts().at(-1).body.text,/up 12%[^]*via Claude plan/);
 assert.equal((await jobs.replyWithToken(e,m[1],m[2],{text:'again'})).ok,false,'used once');
});

test('a job can use a chosen model: by name on the API, and passed on to Codex',async()=>{
 reset();const {env:e,db}=env();
 const {id}=await jobs.createJob(e,{title:'Deep dive',instructions:'Deep market analysis.',kind:'once',model:'sol',engine:'api'});
 await jobs.handleButton(e,`start:${id}`,-100,77,5);
 assert.equal(globalThis.__bg[0].model,'gpt-6.1-sol');
 const j=db.prepare('SELECT * FROM jobs WHERE id=?').get(id);
 globalThis.__model.push(JSON.stringify({changes:{model:'terra'},run_now:false,reply:'Using Terra now.'}));
 await jobs.talkToJob(e,j,'use terra for this');
 assert.equal(db.prepare('SELECT model FROM jobs WHERE id=?').get(id).model,'gpt-6.1-terra');
 db.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES('codex_runner',?)").run(JSON.stringify({seen_at:new Date().toISOString(),primary:1,secondary:1}));
 const c=await jobs.createJob(e,{title:'Codex model',instructions:'x',kind:'once',engine:'codex',model:'gpt-5.5'});
 await jobs.handleButton(e,`start:${c.id}`,-100,77,6);
 assert.equal((await jobs.nextCodexRun(e,{device:'home'})).run.model,'gpt-5.5');
});

test('in the app: the chat keeps every message, buttons work from it, and unread counts clear when opened',async()=>{
 reset();const {env:e}=env();
 const {id}=await jobs.createJob(e,{title:'Bean prices',instructions:'Arabica price now.',kind:'once',engine:'api'});
 let list=await jobs.listJobChats(e);assert.equal(list[0].pinned,true);assert.equal(list[0].unread,1);
 let chat=await jobs.jobChat(e,id);
 assert.equal(chat.messages[0].role,'bot');const start=chat.messages[0].buttons[0][0].data;assert.match(start,/^start:/);
 assert.equal((await jobs.listJobChats(e))[0].unread,0,'opened = read');
 await jobs.pressButton(e,start);
 chat=await jobs.jobChat(e,id);assert.equal(chat.messages[0].buttons,null,'a used button is gone');assert.equal(chat.busy,true);
 globalThis.__done={bg1:{done:true,text:'286¢/lb.'}};await jobs.tickJobs(e);
 globalThis.__model.push(JSON.stringify({changes:{},run_now:false,reply:'It was 286¢ per pound.'}));
 const j=(await jobs.jobChat(e,id));
 assert.equal(await jobs.messageJob(e,{...j,last_result:'286¢/lb.'},'what was the price?','app'),'It was 286¢ per pound.');
 chat=await jobs.jobChat(e,id);assert.deepEqual(chat.messages.slice(-2).map(m=>m.role),['you','bot']);
});

test('unpinning turns a repeating job off; pinning it again turns it back on',async()=>{
 reset();const {env:e,db}=env();
 const {id}=await jobs.createJob(e,{title:'Elections',instructions:'Watch.',kind:'every',every_minutes:60,engine:'api'});
 await jobs.pressButton(e,`start:${id}`);
 await jobs.setPinned(e,id,false);
 let row=db.prepare('SELECT * FROM jobs WHERE id=?').get(id);assert.equal(row.status,'paused');assert.equal(row.pinned,0);assert.equal(row.next_run_at,null);
 await jobs.setPinned(e,id,true);
 row=db.prepare('SELECT * FROM jobs WHERE id=?').get(id);assert.equal(row.status,'active');assert.ok(row.next_run_at);
 assert.match((await jobs.jobChat(e,id)).messages.at(-1).text,/Back on/);
});
