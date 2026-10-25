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
 const env={DB:{prepare},OPENAI_API_KEY:'fixture-never-sent',MODEL_BRAIN:'gpt-6.1-sol',MODEL_WRITER:'gpt-6-luna',TIMEZONE:'Asia/Jerusalem'};
 const original=globalThis.fetch,requests=[],deferred=[];
 globalThis.fetch=async(url,init)=>{requests.push(JSON.parse(init?.body??await url.text()));assert.equal(requests.length,1,'Hidden extra AI call');return new Response(JSON.stringify({id:'response1',status:'completed',output:[{type:'function_call',id:'fc1',call_id:'c1',name:'create_item',arguments:JSON.stringify({kind:'reminder',title:'Fill out attendance',due_at:'2026-11-16T09:00:00+02:00',category:'personal'})},{type:'function_call',id:'fc2',call_id:'c2',name:'finish_reply',arguments:'{"reply":"Reminder set."}'}],usage:{input_tokens:1000,output_tokens:75,total_tokens:1075}}),{headers:{'content-type':'application/json'}});};
 try{const result=await chat(env,'Remind me to fill out attendance on November 16 at 9am.','text',null,{defer:p=>deferred.push(p)});await Promise.all(deferred);assert.equal(result.reply.content,'Reminder set.');assert.equal(requests.length,1);assert.equal(db.prepare('SELECT count(*) n FROM items').get().n,1);assert.ok(db.prepare('SELECT title FROM conversations').get().title);const stats=JSON.parse(db.prepare("SELECT value FROM settings WHERE key='chat_rounds_log'").get().value)[0];assert.equal(stats.timing.rounds,1);assert.ok(requests[0].input[0].content.length<12500,'Compact core instructions');assert.equal(requests[0].text.verbosity,'low');}
 finally{globalThis.fetch=original;db.close();}
});
