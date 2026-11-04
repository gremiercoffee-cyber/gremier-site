import {test} from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';import {readFileSync,readdirSync} from 'node:fs';import {build} from 'esbuild';
const b=await build({stdin:{contents:"export * from './worker/whatsapp';export {learnPass} from './worker/learn';export {collectWhatsAppReplies} from './worker/replies';",resolveDir:process.cwd()},bundle:true,write:false,platform:'node',format:'esm',plugins:[{name:'mock',setup(b){b.onLoad({filter:/[\\/]worker[\\/]ai\.ts$/},()=>({contents:'export class ProviderUnavailable extends Error{} export const getProvider=()=>globalThis.manualModel;',loader:'js'}));}}]});
const m=await import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));
function setup(skipPolicy=false){const db=new DatabaseSync(':memory:');for(const f of readdirSync('migrations').filter(f=>f.endsWith('.sql')&&(!skipPolicy||!f.startsWith('0072'))).sort())db.exec(readFileSync('migrations/'+f,'utf8'));
 const prepare=sql=>{let args=[];return{bind(...a){args=a;return this;},async first(){return db.prepare(sql).get(...args)??null;},async all(){return{results:db.prepare(sql).all(...args)};},async run(){return{meta:{changes:Number(db.prepare(sql).run(...args).changes)}};}};};return{db,env:{DB:{prepare,batch:async ss=>{for(const s of ss)await s.run();}},TIMEZONE:'Asia/Jerusalem'}};}
const incoming={chat:'Avi',sender:'Avi',chatId:'972500000000@c.us',text:'Can you deliver tomorrow?',account:'personal',messages:[{id:'a',text:'Can you deliver tomorrow?',t:Date.now()/1000}]};
test('ordinary WhatsApps cannot create task suggestions even if an old model returns suggest',async()=>{
 const h=setup();globalThis.manualModel={complete:async()=>'{"action":"suggest","title":"Deliver coffee tomorrow","due_at":"2026-11-04"}'};
 await m.handleIncoming(h.env,incoming);assert.equal(h.db.prepare('SELECT count(*) n FROM suggestions').get().n,0);assert.equal(h.db.prepare('SELECT count(*) n FROM items').get().n,0);assert.equal(h.db.prepare('SELECT count(*) n FROM nudges').get().n,0);assert.equal(h.db.prepare('SELECT count(*) n FROM whatsapp_inbox').get().n,1);
});
test('reply obligations enter the queue only after four hours, and responses prevent later resurfacing',async()=>{
 const h=setup();globalThis.manualModel={complete:async()=>'{"action":"reply","response_required":true,"confidence":"high","evidence":"Can you deliver tomorrow?","reply_message_ids":["a"]}'};
 await m.handleIncoming(h.env,incoming);await m.collectWhatsAppReplies(h.env);assert.equal(h.db.prepare('SELECT count(*) n FROM items').get().n,0);
 const old=new Date(Date.now()-4*3600000-1000).toISOString();h.db.prepare('UPDATE whatsapp_inbox SET sent_at=?,received_at=?').run(old,old);await m.collectWhatsAppReplies(h.env);assert.equal(h.db.prepare('SELECT count(*) n FROM items WHERE reply_required=1').get().n,1);
 await m.handleReplied(h.env,{chat:'Avi',chatId:incoming.chatId,account:'personal',text:'Yes',responded_at:new Date().toISOString()});await m.collectWhatsAppReplies(h.env);assert.equal(h.db.prepare("SELECT count(*) n FROM items WHERE status='open'").get().n,0);
});
test('passive learning never receives WhatsApp messages, including forced learning',async()=>{
 const h=setup();h.db.prepare("INSERT INTO whatsapp_inbox(id,hash,chat,sender,text,received_at) VALUES('w','w','Avi','Avi','PRIVATE WHATSAPP FACT',?)").run(new Date().toISOString());let prompts=[];globalThis.manualModel={complete:async req=>{prompts.push(req.prompt);return '{"suggestions":[]}';}};
 assert.equal((await m.learnPass(h.env,true)).learned,0);assert.equal(prompts.length,0);
 h.db.prepare("INSERT INTO messages(id,role,content,mode,created_at) VALUES('d','user','Remember my explicit preference','text',?)").run(new Date(Date.now()+1000).toISOString());await m.learnPass(h.env,true);assert.equal(prompts.length,1);assert.ok(!prompts[0].includes('PRIVATE WHATSAPP FACT'));assert.match(prompts[0],/explicit preference/);
});
test('on-demand WhatsApp search is literal, scoped and read-only',async()=>{
 const h=setup();globalThis.manualModel={complete:async()=>'{"action":"none"}'};await m.handleIncoming(h.env,{...incoming,text:'Quote includes 10% tax'});const r=await m.searchWhatsApp(h.env,{query:'10%',chat:'Avi'});assert.equal(r.messages.length,1);assert.match(r.coverage,/not the full/);assert.equal(h.db.prepare('SELECT count(*) n FROM items').get().n,0);assert.equal((await m.searchWhatsApp(h.env,{query:'missing%'})).messages.length,0);
});
test('cleanup withdraws passive guesses but preserves explicit watches and confirmed work',()=>{
 const h=setup(true);for(const [id,title] of [['passive','📲 Avi: add this?'],['watch','👀 Avi: matches your watch']]){h.db.prepare("INSERT INTO suggestions(id,kind,payload,status,created_at) VALUES(?,'item','{}','pending','x')").run(id);h.db.prepare("INSERT INTO nudges(id,type,title,item_id,created_at) VALUES(?,'suggest',?,?,'x')").run(id,title,id);}
 h.db.exec(readFileSync('migrations/0072_whatsapp_user_directed.sql','utf8'));assert.equal(h.db.prepare("SELECT status FROM suggestions WHERE id='passive'").get().status,'withdrawn');assert.equal(h.db.prepare("SELECT dismissed FROM nudges WHERE id='passive'").get().dismissed,1);assert.equal(h.db.prepare("SELECT status FROM suggestions WHERE id='watch'").get().status,'pending');
});
test('automatic cron no longer discovers meeting tasks from WhatsApp',()=>{const scheduled=readFileSync('worker/index.ts','utf8').split('scheduled(').at(-1);assert.ok(!scheduled.includes('organizeMeetingRounds(env)'));});
