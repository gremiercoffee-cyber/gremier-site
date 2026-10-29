import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {build} from 'esbuild';

// Everything in Telegram: notifications with working buttons, "Later…" times, answering the helper by replying,
// approvals, photos sent to the bot, and the chat knowing it's in Telegram. Fake chat, fake Telegram.
globalThis.__tg=[];globalThis.__chats=[];globalThis.__decided=[];globalThis.__uploads=[];
const fakes={
 assistant:`export async function chat(env,text,mode,cid,opts){globalThis.__chats.push({text,opts});return{reply:{content:'OK: '+text.slice(0,40)},actions:[],conversation:{id:'c1'}}}
  export async function decidePendingAction(env,id,d){globalThis.__decided.push([id,d]);return{ok:true,outcome:'Started.'}}`,
 documents:`export async function uploadFile(env,p){globalThis.__uploads.push(p);return{id:'file1',filename:p.filename}}
  export async function chooseFile(env,id){return{file_id:id,filename:'scan.pdf'}} export async function fileBytes(){return null}`,
 transcribe:`export async function transcribeAudio(){return{text:'voice text'}}`,
};
const out=await build({entryPoints:['worker/telegram.ts'],bundle:true,write:false,format:'esm',platform:'node',plugins:[{name:'fakes',setup(b){
 b.onResolve({filter:/^\.\/(assistant|documents|transcribe)$/},(a)=>/telegram(-cards)?\.ts$/.test(a.importer)?{path:a.path.slice(2),namespace:'fake'}:undefined);
 b.onLoad({filter:/.*/,namespace:'fake'},(a)=>({contents:fakes[a.path],loader:'js'}));
}}]});
const telegram=await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`);
const cardsOut=await build({entryPoints:['worker/telegram-cards.ts'],bundle:true,write:false,format:'esm',platform:'node',plugins:[{name:'fakes',setup(b){
 b.onResolve({filter:/^\.\/(assistant|documents|transcribe)$/},(a)=>/telegram(-cards)?\.ts$/.test(a.importer)?{path:a.path.slice(2),namespace:'fake'}:undefined);
 b.onLoad({filter:/.*/,namespace:'fake'},(a)=>({contents:fakes[a.path],loader:'js'}));
}}]});
const cards=await import(`data:text/javascript;base64,${Buffer.from(cardsOut.outputFiles[0].text).toString('base64')}`);
let msgId=100;
globalThis.fetch=async(url,init)=>{
 const u=String(url);
 if(u.includes('/file/bot'))return new Response(new Uint8Array([1,2,3]),{headers:{'content-type':'image/jpeg'}});
 const method=u.split('/').pop();const body=init?.body&&typeof init.body==='string'?JSON.parse(init.body):{};globalThis.__tg.push({method,body});
 return new Response(JSON.stringify({ok:true,result:method==='getFile'?{file_path:'photos/x.jpg'}:{message_id:++msgId}}),{headers:{'content-type':'application/json'}});};

function env(){
 const db=new DatabaseSync(':memory:');for(const f of readdirSync('migrations').filter(f=>f.endsWith('.sql')).sort())db.exec(readFileSync('migrations/'+f,'utf8'));
 db.prepare('INSERT INTO settings(key,value) VALUES(?,?)').run('timezone','"Asia/Jerusalem"');
 db.prepare('INSERT INTO settings(key,value) VALUES(?,?)').run('telegram',JSON.stringify({owner_id:1,group_id:-100}));
 const prepare=sql=>{let args=[];return{bind(...v){args=v;return this},async first(){return db.prepare(sql).get(...args)??null},async all(){return{results:db.prepare(sql).all(...args)}},async run(){return{meta:{changes:Number(db.prepare(sql).run(...args).changes)}}}}};
 return {db,env:{DB:{prepare},TELEGRAM_BOT_TOKEN:'fixture',COS_ACCESS_TOKEN:'x'}};
}
const sent=()=>globalThis.__tg.filter(t=>t.method==='sendMessage').map(t=>t.body);
const reset=()=>{for(const k of ['__tg','__chats','__decided','__uploads'])globalThis[k].length=0;};
const t0=new Date().toISOString();
function task(db,id='i1'){db.prepare("INSERT INTO items(id,kind,title,status,created_at,updated_at) VALUES(?, 'task', 'Call the accountant', 'open', ?, ?)").run(id,t0,t0);}
function nudge(db,id,type,item){db.prepare("INSERT INTO nudges(id,type,title,body,item_id,created_at) VALUES(?,?,?,?,?,?)").run(id,type,'⏰ Call the accountant','Due now',item,t0);}
const tap=(e,data,mid)=>telegram.handleUpdate(e,{update_id:Date.now()+Math.random(),callback_query:{id:'q',from:{id:1},data,message:{message_id:mid,chat:{id:-100,type:'supergroup'},date:0}}},(p)=>p);
const say=(e,m)=>telegram.handleUpdate(e,{update_id:Date.now()+Math.random(),message:{message_id:++msgId,from:{id:1},chat:{id:-100,type:'supergroup'},date:0,...m}},(p)=>p);
const settle=()=>new Promise(r=>setTimeout(r,30));

test('a reminder arrives in General with its buttons; Done works from Telegram',async()=>{
 reset();const {env:e,db}=env();task(db);nudge(db,'n1','reminder','i1');
 await cards.noticeToTelegram(e,{id:'n1',type:'reminder',title:'⏰ Call the accountant',body:'Due now',item_id:'i1'});
 const m=sent()[0];assert.equal(m.chat_id,-100);assert.equal(m.message_thread_id,undefined,'General topic');
 const btns=m.reply_markup.inline_keyboard.flat();assert.ok(btns.some(b=>b.text.startsWith('Done')));
 await tap(e,btns.find(b=>b.text.startsWith('Done')).callback_data,msgId);await settle();
 assert.equal(db.prepare('SELECT status FROM items WHERE id=?').get('i1').status,'done');
 assert.match(sent().at(-1).text,/Done: Call the accountant/);
});

test('"Later…" offers times here instead of opening the app; a reply sets any time',async()=>{
 reset();const {env:e,db}=env();task(db);nudge(db,'n2','reminder','i1');
 await cards.noticeToTelegram(e,{id:'n2',type:'reminder',title:'x',body:'',item_id:'i1'});
 const later=sent()[0].reply_markup.inline_keyboard.flat().find(b=>b.text.startsWith('Later'));
 await tap(e,later.callback_data,msgId);await settle();
 const ask=sent().at(-1);assert.match(ask.text,/When should I remind you/);
 const tomorrow=ask.reply_markup.inline_keyboard.flat().find(b=>b.text==='Tomorrow morning');
 await tap(e,tomorrow.callback_data,msgId);await settle();
 assert.ok(db.prepare('SELECT due_at FROM items WHERE id=?').get('i1').due_at>t0);
 assert.match(sent().at(-1).text,/Moved “Call the accountant” to/);
 // or a reply with a time goes to the chat about that task
 const askId=db.prepare("SELECT message_id FROM tg_sent WHERE kind='reschedule'").get().message_id;
 await say(e,{text:'Sunday 10am',reply_to_message:{message_id:askId}});await settle();
 assert.match(globalThis.__chats.at(-1).text,/Move my task “Call the accountant” \(id i1\) to Sunday 10am/);
});

test('the helper\'s question: reply to it in Telegram and the answer goes to the helper',async()=>{
 reset();const {env:e,db}=env();
 db.prepare("INSERT INTO browser_jobs(id,instruction,status,question,created_at,updated_at) VALUES('h1','Sign up for CoSend','needs_you','Which plan?',?,?)").run(t0,t0);
 nudge(db,'n3','helper','h1');
 await cards.noticeToTelegram(e,{id:'n3',type:'helper',title:'🖥️ The helper needs you',body:'Which plan?',item_id:'h1'});
 assert.match(sent()[0].text,/Reply to this message with your answer/);
 await say(e,{text:'The free plan',reply_to_message:{message_id:msgId}});await settle();
 const j=db.prepare("SELECT status FROM browser_jobs WHERE id='h1'").get();
 assert.notEqual(j.status,'needs_you','the answer reached the helper');
 assert.match(sent().at(-1).text,/Sent your answer to the helper/);
 assert.equal(globalThis.__chats.length,0);
});

test('approvals are asked once, and Approve works from Telegram',async()=>{
 reset();const {env:e,db}=env();
 db.prepare("INSERT INTO pending_actions(id,action,payload,description,created_at) VALUES('p1','ai_research','{}','Research bottle prices',?)").run(new Date().toISOString());
 await cards.pendingCards(e);await cards.pendingCards(e);
 const asks=sent().filter(m=>/Approve\?/.test(m.text));assert.equal(asks.length,1,'asked once');
 await tap(e,asks[0].reply_markup.inline_keyboard[0][0].callback_data,msgId);await settle();
 assert.deepEqual(globalThis.__decided,[['p1','approve']]);
 assert.match(sent().at(-1).text,/Approved\. Started\./);
});

test('a photo sent to the bot becomes a file in the chat; the chat knows it is in Telegram',async()=>{
 reset();const {env:e}=env();
 await say(e,{caption:'fill this in',photo:[{file_id:'small',width:10,height:10},{file_id:'big',width:100,height:100}]});await settle();
 assert.equal(globalThis.__uploads.length,1);assert.equal(globalThis.__uploads[0].mime,'image/jpeg');
 const c=globalThis.__chats[0];assert.equal(c.text,'fill this in');assert.deepEqual(c.opts.files,['file1']);assert.equal(c.opts.channel,'telegram');
 assert.equal(globalThis.__tg.find(t=>t.method==='getFile').body.file_id,'big','the largest size');
});

test('long button data is kept and sent as a short key that still works',async()=>{
 reset();const {env:e,db}=env();
 const id=await telegram.say(e,-100,'pick',{buttons:[[{text:'A',data:'n~'+'x'.repeat(40)+'~accept_p:'+'y'.repeat(36)}]]});
 const data=sent()[0].reply_markup.inline_keyboard[0][0].callback_data;
 assert.match(data,/^k:/);assert.ok(Buffer.byteLength(data)<=64);
 assert.match(await telegram.buttonFromKey(e,data),/^n~x+~accept_p:y+$/);
 assert.ok(id);
});

// ---- Work sessions and the waiting rule ----
const wsOut=await build({entryPoints:['worker/worksession.ts'],bundle:true,write:false,format:'esm',platform:'node'});
const ws=await import(`data:text/javascript;base64,${Buffer.from(wsOut.outputFiles[0].text).toString('base64')}`);
const wOut=await build({entryPoints:['worker/waiting.ts'],bundle:true,write:false,format:'esm',platform:'node'});
const waiting=await import(`data:text/javascript;base64,${Buffer.from(wOut.outputFiles[0].text).toString('base64')}`);

test('"I\'ll do these now": each task gets Done / Didn\'t get to it / Won\'t do it, and the session wraps up',async()=>{
 reset();const {env:e,db}=env();task(db,'i1');task(db,'i2');task(db,'i3');
 db.prepare("UPDATE items SET title='Email the printer', due_at=? WHERE id='i2'").run(new Date(Date.now()-3600_000).toISOString());
 const r=await ws.startWorkSession(e,{item_ids:['i1','i2','i3','nope'],minutes:45});
 assert.equal(r.tasks.length,3);
 const cardsSent=sent().filter(m=>m.reply_markup);assert.equal(cardsSent.length,3);
 assert.match(sent()[0].text,/Let's go: 3 things.*until/);
 const ids=db.prepare("SELECT message_id, ref FROM tg_sent WHERE kind='work'").all();
 const press=async(ref,what)=>{await tap(e,`w~${ref}~${what}`,ids.find(x=>x.ref===ref).message_id);await settle();};
 await press('i1','done');await press('i2','skip');
 assert.equal(db.prepare("SELECT status FROM items WHERE id='i1'").get().status,'done');
 const i2=db.prepare("SELECT status,due_at FROM items WHERE id='i2'").get();assert.equal(i2.status,'open');assert.ok(Date.parse(i2.due_at)>Date.now(),'moved to tomorrow');
 assert.ok(globalThis.__tg.some(t=>t.method==='editMessageText'&&/Done: Call the accountant/.test(t.body.text)));
 await press('i3','drop');
 assert.equal(db.prepare("SELECT status FROM items WHERE id='i3'").get().status,'dropped');
 assert.match(sent().at(-1).text,/1 done\. 1 for another time\. 1 dropped\./);
 assert.equal(db.prepare("SELECT 1 FROM settings WHERE key='work_session'").get(),undefined,'session over');
});

test('when the time is up, what is left is asked about once',async()=>{
 reset();const {env:e,db}=env();task(db,'i1');task(db,'i2');
 await ws.startWorkSession(e,{item_ids:['i1','i2'],minutes:30});
 const s=JSON.parse(db.prepare("SELECT value FROM settings WHERE key='work_session'").get().value);s.until=new Date(Date.now()-1000).toISOString();
 db.prepare("UPDATE settings SET value=? WHERE key='work_session'").run(JSON.stringify(s));
 await ws.tickWorkSession(e);await ws.tickWorkSession(e);
 assert.equal(sent().filter(m=>/Time's up/.test(m.text)).length,1);
});

test('waiting on someone: quiet at first, a follow-up after 4 days',()=>{
 const fresh={kind:'waiting',title:"Wait for Arnpack's packaging quote",person:'arnpackil@gmail.com',created_at:new Date().toISOString()};
 const old={...fresh,created_at:new Date(Date.now()-5*86400_000).toISOString()};
 assert.equal(waiting.quietWait(fresh),true);assert.equal(waiting.needsFollowUp(old),true);
 assert.equal(waiting.followUpLine(old),"Follow up with arnpackil? No reply in 5 days: Arnpack's packaging quote");
 assert.equal(waiting.isWaiting({kind:'task',title:'Await plans from Gershon'}),true,'a task worded as waiting counts');
 assert.equal(waiting.isWaiting({kind:'task',title:'Call Gershon'}),false);
});
