import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {build} from 'esbuild';

// Emails from a research chat: Codex writes them, the user taps Send, Codex sends exactly that from Gmail,
// and replies are tracked in the chat. Fake model, fake Telegram, fake Gmail thread reads.
globalThis.__model=[];globalThis.__tg=[];globalThis.__threads={};
const out=await build({entryPoints:['worker/jobs.ts'],bundle:true,write:false,format:'esm',platform:'node',plugins:[{name:'fakes',setup(b){
 b.onLoad({filter:/[\\/]worker[\\/]ai\.ts$/},()=>({contents:`export function getProvider(){return {
  complete:async()=>globalThis.__model.shift()??'{}', startBackground:async()=>'bg', checkBackground:async()=>({done:false}) }}`,loader:'js'}));
 // Only the email module's Gmail reads are faked; everything else keeps the real google.ts.
 b.onResolve({filter:/^\.\/google$/},(a)=>/outreach\.ts$/.test(a.importer)?{path:'fake-gmail',namespace:'fake'}:undefined);
 b.onLoad({filter:/^fake-gmail$/,namespace:'fake'},()=>({contents:`export async function readThread(env,id){const t=globalThis.__threads[id];if(!t)throw new Error('no thread');return t}`,loader:'js'}));
}}]});
const jobs=await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`);
globalThis.fetch=async(url,init)=>{const method=String(url).split('/').pop();const body=JSON.parse(init.body);globalThis.__tg.push({method,body});
 return new Response(JSON.stringify({ok:true,result:method==='createForumTopic'?{message_thread_id:77}:{}}),{headers:{'content-type':'application/json'}});};

function env(){
 const db=new DatabaseSync(':memory:');for(const f of readdirSync('migrations').filter(f=>f.endsWith('.sql')).sort())db.exec(readFileSync('migrations/'+f,'utf8'));
 db.prepare('INSERT INTO settings(key,value) VALUES(?,?)').run('timezone','"Asia/Jerusalem"');
 db.prepare('INSERT INTO settings(key,value) VALUES(?,?)').run('telegram',JSON.stringify({owner_id:1,group_id:-100}));
 db.prepare("INSERT INTO settings(key,value) VALUES('codex_runner',?)").run(JSON.stringify({seen_at:new Date().toISOString(),primary:1,secondary:1}));
 const prepare=sql=>{let args=[];return{bind(...v){args=v;return this},async first(){return db.prepare(sql).get(...args)??null},async all(){return{results:db.prepare(sql).all(...args)}},async run(){return{meta:{changes:Number(db.prepare(sql).run(...args).changes)}}}}};
 return {db,env:{DB:{prepare},TELEGRAM_BOT_TOKEN:'fixture'}};
}
const posts=()=>globalThis.__tg.filter(t=>t.method==='sendMessage').map(t=>t.body);
async function researched(e,db){
 const {id}=await jobs.createJob(e,{title:'Bottle suppliers',instructions:'Find 1L PET bottle suppliers in Israel.',kind:'once',engine:'codex'});
 await jobs.pressButton(e,`start:${id}`);
 const r=await jobs.nextCodexRun(e,{device:'home'});
 await jobs.runResult(e,r.run.id,{text:'1. PlastiCo, sales@plastico.co.il\n2. BottleTech (no email listed)'});
 return db.prepare('SELECT * FROM jobs WHERE id=?').get(id);
}

test('"email them" → Codex writes drafts (with the research); nothing is sent before Send',async()=>{
 globalThis.__tg.length=0;const {env:e,db}=env();const j=await researched(e,db);
 globalThis.__model.push(JSON.stringify({email:{action:'write',ask:'email each supplier asking for prices for 5,000 bottles'}}));
 const reply=await jobs.messageJob(e,j,'email each supplier asking for prices for 5,000 bottles','app');
 assert.match(reply,/Codex is writing/);
 const next=await jobs.nextCodexRun(e,{device:'home'});
 assert.equal(next.run.gmail,true,'email runs use Codex with Gmail');
 assert.match(next.run.prompt,/5,000 bottles[^]*DON'T send[^]*PlastiCo/);
 await jobs.runResult(e,next.run.id,{text:JSON.stringify({emails:[
  {to_email:'sales@plastico.co.il',to_name:'PlastiCo',subject:'Price request',body:'Hi, prices for 5,000 bottles?',address_source:'their research'},
  {to_email:'info@bottletech.co.il',to_name:'BottleTech',subject:'Price request',body:'Hi there, prices?',address_source:'bottletech.co.il/contact'},
  {to_email:'not an address',to_name:'Nobody',subject:'x',body:'y'}],missing:['GlassCo']})});
 const es=db.prepare('SELECT * FROM job_emails ORDER BY number').all();
 assert.deepEqual(es.map(x=>[x.number,x.to_email,x.status]),[[1,'sales@plastico.co.il','draft'],[2,'info@bottletech.co.il','draft']]);
 const cards=posts().filter(p=>p.reply_markup);
 assert.ok(cards.some(p=>/#1 to PlastiCo/.test(p.text)&&p.reply_markup.inline_keyboard[0][0].callback_data===`esend:${es[0].id}`));
 assert.ok(cards.some(p=>p.reply_markup.inline_keyboard[0][0].callback_data===`esendall:${j.id}`));
 assert.match(posts().at(-1).text,/No email address found for: GlassCo, Nobody/);
 assert.equal((await jobs.nextCodexRun(e,{device:'home'})).run,null,'nothing queued to send');
});

test('Send all → Codex sends exactly the drafts; sent ones are tracked and a reply is posted',async()=>{
 globalThis.__tg.length=0;const {env:e,db}=env();const j=await researched(e,db);
 globalThis.__model.push(JSON.stringify({email:{action:'write',ask:'ask for prices'}}));
 await jobs.messageJob(e,j,'ask them for prices','app');
 let r=await jobs.nextCodexRun(e,{device:'home'});
 await jobs.runResult(e,r.run.id,{text:JSON.stringify({emails:[{to_email:'sales@plastico.co.il',to_name:'PlastiCo',subject:'Prices',body:'Exact body one.'},{to_email:'a@b.co.il',to_name:'B',subject:'Prices',body:'Exact body two.'}]})});
 await jobs.pressButton(e,`esendall:${j.id}`);
 assert.deepEqual(db.prepare('SELECT status FROM job_emails').all().map(x=>x.status),['sending','sending']);
 await jobs.pressButton(e,`esendall:${j.id}`);
 r=await jobs.nextCodexRun(e,{device:'home'});
 assert.equal(r.run.gmail,true);
 assert.match(r.run.prompt,/tapped Send[^]*Exact body one\.[^]*Exact body two\./);
 assert.equal((await jobs.nextCodexRun(e,{device:'home'})).run,null,'a second tap sent nothing more');
 await jobs.runResult(e,r.run.id,{text:'{"from":"me@gmail.com","sent":[{"number":1,"message_id":"m1","thread_id":"t1"}],"failed":[{"number":2,"error":"bounced"}]}'});
 const es=db.prepare('SELECT * FROM job_emails ORDER BY number').all();
 assert.equal(es[0].status,'sent');assert.equal(es[0].thread_id,'t1');assert.equal(es[0].from_account,'me@gmail.com');
 assert.equal(es[1].status,'draft','a failed one goes back to a draft');
 assert.ok(posts().some(p=>/✅ #1 sent to PlastiCo/.test(p.text)));
 assert.ok(posts().some(p=>/#2 to B .* didn't send: bounced/.test(p.text)&&p.reply_markup));
 // a reply arrives
 db.prepare("UPDATE job_emails SET checked_at=? WHERE id=?").run(new Date(Date.now()-3600_000).toISOString(),es[0].id);
 globalThis.__threads.t1={messages:[{from_user:true,from:'me',date:es[0].sent_at,text:'Exact body one.'},{from_user:false,from:'Dana <sales@plastico.co.il>',date:new Date(Date.now()+1000).toISOString(),text:'2.10 NIS each, min 3,000.\nOn Thu Dana wrote:\n> Exact body one.'}]};
 await jobs.tickJobs(e);
 assert.equal(db.prepare('SELECT status FROM job_emails WHERE id=?').get(es[0].id).status,'replied');
 const replyPost=posts().find(p=>/PlastiCo replied/.test(p.text));
 assert.match(replyPost.text,/2\.10 NIS each/);assert.doesNotMatch(replyPost.text,/On Thu/,'quoted text is cut');
 globalThis.__model.push(JSON.stringify({email:{action:'status'}}));
 assert.match(await jobs.messageJob(e,j,'who replied?','app'),/#1 PlastiCo.*replied[^]*#2 B.*draft/);
});

test('a Codex send that never finishes fails safely (back to a draft, check Sent first)',async()=>{
 globalThis.__tg.length=0;const {env:e,db}=env();const j=await researched(e,db);
 globalThis.__model.push(JSON.stringify({email:{action:'write',ask:'x'}}));
 await jobs.messageJob(e,j,'email them','app');
 let r=await jobs.nextCodexRun(e,{device:'home'});
 await jobs.runResult(e,r.run.id,{text:JSON.stringify({emails:[{to_email:'sales@plastico.co.il',subject:'S',body:'B'}]})});
 const em=db.prepare('SELECT * FROM job_emails').get();
 await jobs.pressButton(e,`esend:${em.id}`);
 r=await jobs.nextCodexRun(e,{device:'home'});
 db.prepare("UPDATE job_runs SET started_at=? WHERE id=?").run(new Date(Date.now()-3600_000).toISOString(),r.run.id);
 await jobs.tickJobs(e);
 assert.equal(db.prepare('SELECT status FROM job_emails').get().status,'draft');
 assert.ok(posts().some(p=>/check Gmail's Sent folder/.test(p.text)));
});

test('from the main chat: an email chat of its own, where Codex writes the email',async()=>{
 globalThis.__tg.length=0;const {env:e,db}=env();
 const r=await jobs.createEmailChat(e,{title:'Invoice from Dana',ask:'email dana@studio.co.il asking for the October invoice'});
 assert.match(r.where,/Invoice from Dana/);
 const j=db.prepare("SELECT * FROM jobs").get();assert.equal(j.engine,'codex');assert.equal(j.pinned,1);
 const next=await jobs.nextCodexRun(e,{device:'home'});
 assert.equal(next.run.gmail,true);assert.match(next.run.prompt,/October invoice/);
});
