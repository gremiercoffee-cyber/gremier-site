import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {build} from 'esbuild';
const bundle=await build({entryPoints:['worker/assistant.ts'],bundle:true,write:false,format:'esm',platform:'node'});
const {chat}=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
test('a real chat save, project filing, title and telemetry need only one provider request end to end',async()=>{
 const db=new DatabaseSync(':memory:');for(const f of readdirSync('migrations').filter(f=>f.endsWith('.sql')).sort())db.exec(readFileSync('migrations/'+f,'utf8'));
 db.prepare('INSERT INTO settings(key,value) VALUES(?,?)').run('timezone','"Asia/Jerusalem"');
 const prepare=sql=>{let args=[];return{bind(...v){args=v;return this},async first(){return db.prepare(sql).get(...args)??null},async all(){return{results:db.prepare(sql).all(...args)}},async run(){return{meta:{changes:Number(db.prepare(sql).run(...args).changes)}}}}};
 const env={DB:{prepare},OPENAI_API_KEY:'fixture-never-sent',MODEL_BRAIN:'gpt-6.1-terra',MODEL_WRITER:'gpt-6-luna',TIMEZONE:'Asia/Jerusalem'};
 const original=globalThis.fetch,requests=[],deferred=[];
 globalThis.fetch=async(url,init)=>{requests.push(JSON.parse(init?.body??await url.text()));assert.equal(requests.length,1,'Hidden extra AI call');return new Response(JSON.stringify({id:'response1',status:'completed',output:[{type:'function_call',id:'fc1',call_id:'c1',name:'create_item',arguments:JSON.stringify({kind:'reminder',title:'Fill out attendance',due_at:'2026-11-16T09:00:00+02:00',category:'personal'})},{type:'function_call',id:'fc2',call_id:'c2',name:'finish_reply',arguments:'{"reply":"Reminder set."}'}],usage:{input_tokens:1000,output_tokens:75,total_tokens:1075}}),{headers:{'content-type':'application/json'}});};
 try{const result=await chat(env,'Remind me to fill out attendance on November 16 at 9am.','text',null,{defer:p=>deferred.push(p)});await Promise.all(deferred);assert.equal(result.reply.content,'Reminder set.');assert.equal(requests.length,1);assert.equal(db.prepare('SELECT count(*) n FROM items').get().n,1);assert.ok(db.prepare('SELECT title FROM conversations').get().title);const stats=JSON.parse(db.prepare("SELECT value FROM settings WHERE key='chat_rounds_log'").get().value)[0];assert.equal(stats.timing.rounds,1);assert.ok(requests[0].input[0].content.length<12500,'Compact core instructions');assert.equal(requests[0].text.verbosity,'low');}
 finally{globalThis.fetch=original;db.close();}
});
test('occasional tools go after the everyday ones, so the shared opening stays cached',async()=>{
 const r=await build({entryPoints:['worker/assistant.ts'],bundle:true,write:false,format:'esm',platform:'node'});
 const {cacheOrder}=await import(`data:text/javascript;base64,${Buffer.from(r.outputFiles[0].text).toString('base64')}`);
 const names=cacheOrder(['create_item','search_email','calendar_lookup','fill_document','load_tools','save_group','new_topic'].map(name=>({name}))).map(t=>t.name);
 assert.deepEqual(names,['create_item','load_tools','new_topic','search_email','calendar_lookup','fill_document','save_group']);
});

test('a plain reminder sends a small fixed prompt; shopping and Hashgacha rules come only with their tools',async()=>{
 const r=await build({entryPoints:['worker/assistant.ts'],bundle:true,write:false,format:'esm',platform:'node'});
 const m=await import(`data:text/javascript;base64,${Buffer.from(r.outputFiles[0].text).toString('base64')}`);
 const plain=m.promptFor(new Set());
 assert.ok(plain.length<2600,'small general rules: '+plain.length);
 assert.doesNotMatch(plain,/Hashgacha|shopping-list/);
 assert.match(m.promptFor(new Set(['shopping'])),/shopping-list tools/);
 assert.match(m.promptFor(new Set(['hashgacha'])),/online submissions/);
 const all=m.assistantTools({},'chat',[]);
 const core=m.toolsFor(all,new Set(),new Set());
 assert.ok(!core.some(t=>['save_time_block','coffee_app','save_task','prepare_whatsapps','computer_helper'].includes(t.name)),'feature tools wait until needed');
 assert.ok(JSON.stringify(core).length<7500,'core tools: '+JSON.stringify(core).length);
 const loadTools=core.find(t=>t.name==='load_tools');
 const loaded=await loadTools.handler({features:['shopping']});
 assert.match(loaded.instructions,/shopping-list tools/);assert.ok(core.some(t=>t.name==='add_shopping_items'),'loaded mid-turn');
});
test('a reminder time without a timezone is read as the user local time, not UTC',async()=>{
 const r=await build({entryPoints:['worker/assistant.ts'],bundle:true,write:false,format:'esm',platform:'node'});
 const m=await import(`data:text/javascript;base64,${Buffer.from(r.outputFiles[0].text).toString('base64')}`);
 const db=new DatabaseSync(':memory:');for(const f of readdirSync('migrations').filter(f=>f.endsWith('.sql')).sort())db.exec(readFileSync('migrations/'+f,'utf8'));
 db.prepare('INSERT INTO settings(key,value) VALUES(?,?)').run('timezone','"Asia/Jerusalem"');
 const prepare=sql=>{let args=[];return{bind(...v){args=v;return this},async first(){return db.prepare(sql).get(...args)??null},async all(){return{results:db.prepare(sql).all(...args)}},async run(){return{meta:{changes:Number(db.prepare(sql).run(...args).changes)}}}}};
 const create=m.assistantTools({DB:{prepare},TIMEZONE:'Asia/Jerusalem'},'chat',[]).find(t=>t.name==='create_item');
 const a=await create.handler({kind:'reminder',title:'Call the supplier',due_at:'2026-10-28T10:00'});
 assert.equal(a.due_at,'2026-10-28T08:00:00.000Z','Israel is UTC+2 in late October');
 const b=await create.handler({kind:'reminder',title:'Pay rent',due_at:'2026-10-28T10:00:00+03:00'});
 assert.equal(b.due_at,'2026-10-28T08:00:00.000Z','a summer-time guess after the clocks changed is read as local 10:00');
 const c=await create.handler({kind:'reminder',title:'Book the van',due_at:'2026-10-28T10:00:00+02:00'});
 assert.equal(c.due_at,'2026-10-28T08:00:00.000Z','the correct offset is kept');
 const d=await create.handler({kind:'reminder',title:'Order beans',due_at:'2026-10-28T10:00:00Z'});
 assert.equal(d.due_at,'2026-10-28T10:00:00.000Z','UTC is kept');
 const e=await create.handler({kind:'reminder',title:'Summer',due_at:'2026-07-01T10:00:00+03:00'});
 assert.equal(e.due_at,'2026-07-01T07:00:00.000Z','summer time is right in July');
 db.close();
});
