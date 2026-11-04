import {test} from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';import {readFileSync,readdirSync} from 'node:fs';import {build} from 'esbuild';
const b=await build({stdin:{contents:"export {default as worker} from './worker/index';export {nowChecklist} from './worker/situations';export {isWaiting,needsFollowUp} from './worker/waiting';",resolveDir:process.cwd()},bundle:true,write:false,platform:'node',format:'esm'});const m=await import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));
function setup(){const db=new DatabaseSync(':memory:');for(const file of readdirSync('migrations').filter(f=>f.endsWith('.sql')).sort())db.exec(readFileSync('migrations/'+file,'utf8'));
 const prepare=sql=>{let a=[];return{bind(...v){a=v;return this;},async first(){return db.prepare(sql).get(...a)??null;},async all(){return{results:db.prepare(sql).all(...a)};},async run(){return{meta:{changes:Number(db.prepare(sql).run(...a).changes)}};}};};const env={AGENT_KEY:'agent-fixture',COS_ACCESS_TOKEN:'owner-fixture',TIMEZONE:'Asia/Jerusalem',DB:{prepare,batch:async ss=>{db.exec('BEGIN');try{const out=[];for(const s of ss)out.push(await s.run());db.exec('COMMIT');return out;}catch(e){db.exec('ROLLBACK');throw e;}}}};
 const call=async(path,method='GET',body,authorized=true)=>{const r=await m.worker.fetch(new Request('https://fixture/api/agent'+path,{method,headers:{...(authorized?{'x-agent-key':'agent-fixture'}:{}),'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})}),env,{waitUntil(){}});return{status:r.status,data:await r.json()};};return{db,env,call};}
const create=h=>h.call('/chats','POST',{title:'Supplier project',client_ref:'codex-thread-fixture'});
test('agent chat API authenticates independently and never returns credentials',async()=>{
 const h=setup();assert.equal((await h.call('/capabilities','GET',undefined,false)).status,401);const r=await h.call('/capabilities');assert.equal(r.status,200);assert.equal(r.data.telegram_chatbot_replaced,false);assert.ok(!JSON.stringify(r.data).includes('agent-fixture'));
});
test('creating an app chat is idempotent by persistent Codex thread reference and does not call a model',async()=>{
 const h=setup(),original=fetch;globalThis.fetch=async()=>{throw Error('No network needed');};try{const a=await create(h),b=await create(h);assert.equal(a.status,201);assert.equal(a.data.id,b.data.id);assert.equal(h.db.prepare('SELECT count(*) n FROM conversations').get().n,1);}finally{globalThis.fetch=original;}
});
test('chat messages retry safely, conflict on a reused key and invalidate stale checkpoints',async()=>{
 const h=setup(),{data:c}=await create(h);const path='/chats/'+c.id;const a=await h.call(path+'/messages','POST',{role:'user',content:'Find packaging',idempotency_key:'owner-1'});assert.equal(a.status,201);
 assert.equal((await h.call(path+'/messages','POST',{role:'user',content:'Find packaging',idempotency_key:'owner-1'})).data.id,a.data.id);assert.equal((await h.call(path+'/messages','POST',{role:'user',content:'Different',idempotency_key:'owner-1'})).status,409);
 assert.equal((await h.call(path,'PATCH',{checkpoint:'Old',base_revision:c.revision})).status,409);const latest=await h.call(path);const updated=await h.call(path,'PATCH',{checkpoint:'Owner wants printed carriers',base_revision:latest.data.revision});assert.equal(updated.status,200);
 const context=await h.call(path+'/context?query=packaging');assert.equal(context.status,200);assert.equal(context.data.chat.checkpoint,'Owner wants printed carriers');assert.equal(context.data.messages.length,1);assert.ok(!JSON.stringify(context.data).includes('owner-fixture'));
});
test('external messages cannot fabricate action receipts, approve jobs, or write into Health chats',async()=>{
 const h=setup(),{data:c}=await create(h);const r=await h.call('/chats/'+c.id+'/messages','POST',{role:'assistant',content:'I prepared a comparison.',idempotency_key:'reply-1',meta:[{tool:'send_email',summary:'sent'}]});assert.equal(r.status,201);const saved=h.db.prepare('SELECT meta FROM messages WHERE id=?').get(r.data.id);assert.deepEqual(JSON.parse(saved.meta),{source:'external_codex'});
 h.db.exec("INSERT INTO conversations(id,title,created_at,last_message_at,privacy_scope) VALUES('health','Private health','x','x','health')");assert.equal((await h.call('/chats/health')).status,404);assert.ok(!(await h.call('/chats')).data.some(c=>c.id==='health'));
 for(const path of ['/cos/settings','/cos/jobs/button','/cos/act','/cos/replies/id/send'])assert.equal((await h.call(path,'POST',{})).status,403);
 assert.equal(h.db.prepare('SELECT count(*) n FROM pending_actions').get().n,0);
});
test('Codex can create projects and ordinary tasks through existing validation; wait-for becomes tracking',async()=>{
 const h=setup();const project=await h.call('/cos/projects','POST',{name:'Packaging',description:'Quotes',area:'business'});assert.equal(project.status,201);
 const task=await h.call('/cos/items','POST',{title:'Wait for Arnpack quote',kind:'task',person:'Arnpack',project_id:project.data.id,source:'codex'});assert.equal(task.status,201);assert.equal(task.data.kind,'waiting');assert.equal((await h.call('/waiting')).data.length,1);
 const bad=await h.call('/cos/items','POST',{});assert.equal(bad.status,400);
});
test('long-quiet waits never become Now checkboxes, while their follow-up remains due',async()=>{
 const h=setup();for(const [id,kind,title] of [['legacy','task','Wait for quote'],['tracked','waiting','Supplier quote'],['real','task','Follow up with supplier']])h.db.prepare("INSERT INTO items(id,kind,title,status,priority,created_at,updated_at) VALUES(?,?,?,'open',1,'2000-01-01','2000-01-01')").run(id,kind,title);
 const k=await m.nowChecklist(h.env);assert.deepEqual(k.items.map(i=>i.id),['real']);assert.equal(m.needsFollowUp({kind:'waiting',title:'Quote',created_at:'2000-01-01'}),true);assert.equal(m.isWaiting({kind:'task',title:'Paint waiting room'}),false);
});
test('external chat can be archived without deleting evidence or cluttering the active list',async()=>{
 const h=setup(),{data:c}=await create(h);assert.equal((await h.call('/chats/'+c.id,'PATCH',{base_revision:c.revision,archived:true})).status,200);assert.equal((await h.call('/chats')).data.length,0);assert.equal(h.db.prepare('SELECT count(*) n FROM agent_chats').get().n,1);
});

test('compact assistant brief applies category, excludes passive waits and ignores completed items',async()=>{
 const h=setup();await h.call('/cos/items','POST',{title:'Spreadsheet for Daniel',kind:'task',category:'yeshiva'});await h.call('/cos/items','POST',{title:'Grind beans',kind:'task',category:'coffee'});await h.call('/cos/items','POST',{title:'Wait for report',kind:'waiting',category:'yeshiva'});
 const tasks=await h.call('/cos/items?status=open&category=yeshiva');assert.equal(tasks.status,200);assert.ok(tasks.data.every(i=>i.category==='yeshiva'));
 const brief=await h.call('/cos/assistant/brief?category=yeshiva');assert.equal(brief.status,200);assert.equal(brief.data.items.length,1);assert.equal(brief.data.items[0].title,'Spreadsheet for Daniel');assert.ok(!JSON.stringify(brief.data).includes('agent-fixture'));assert.equal((await h.call('/cos/assistant/brief?category=unknown')).status,400);
});
