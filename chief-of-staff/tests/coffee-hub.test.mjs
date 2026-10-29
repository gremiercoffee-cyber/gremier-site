import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {build} from 'esbuild';

// Talking to the coffee admin app: "I have 20 Classic liters" sets the stock (the app takes a change, so the
// difference is sent); stock rules are remembered and go with every outlook; only known actions are allowed.
const out=await build({entryPoints:['worker/hub.ts'],bundle:true,write:false,format:'esm',platform:'node'});
const hub=await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`);
let calls=[];
globalThis.fetch=async(url,init)=>{const b=JSON.parse(init.body);calls.push(b);
 const result=b.action==='stock'?{inventory:[{product:'classic_liter',qty:30}],concentrate_l:[{type:'decaf',liters:2}],beans_kg:[],labeled:[]}:{ok:true};
 return new Response(JSON.stringify({ok:true,result}),{headers:{'content-type':'application/json'}});};
function env(){
 const db=new DatabaseSync(':memory:');for(const f of readdirSync('migrations').filter(f=>f.endsWith('.sql')).sort())db.exec(readFileSync('migrations/'+f,'utf8'));
 const prepare=sql=>{let args=[];return{bind(...v){args=v;return this},async first(){return db.prepare(sql).get(...args)??null},async all(){return{results:db.prepare(sql).all(...args)}},async run(){return{meta:{changes:Number(db.prepare(sql).run(...args).changes)}}}}};
 return {db,env:{DB:{prepare},HUB_KEY:'ghk_test'}};
}

test('"I have 20 Classic liters": the app gets the difference, and the reply has before → now',async()=>{
 calls=[];const {env:e}=env();
 const r=await hub.setCoffeeStock(e,{product:'classic_liter',value:20});
 assert.deepEqual(calls.at(-1),{action:'adjust_stock',kind:'inventory',product:'classic_liter',delta:-10});
 assert.deepEqual({before:r.before,now:r.now,app_updated:r.app_updated},{before:30,now:20,app_updated:true});
 calls=[];const c=await hub.setCoffeeStock(e,{kind:'concentrate',product:'decaf',value:5.5});
 assert.equal(calls.at(-1).delta,3.5);assert.equal(c.before,2);
 calls=[];await hub.setCoffeeStock(e,{product:'classic_liter',value:30});
 assert.equal(calls.some(x=>x.action==='adjust_stock'),false,'no change, nothing sent');
});

test('stock rules are remembered and sent with every outlook',async()=>{
 calls=[];const {env:e}=env();
 await hub.saveCoffeeRule(e,{key:'decaf',mode:'on_demand',note:'only brew decaf for orders'});
 await hub.saveCoffeeRule(e,{key:'decaf_liter',keep:2});
 await hub.hubCall(e,'outlook');
 assert.deepEqual(calls.at(-1).rules,{decaf:{mode:'on_demand',note:'only brew decaf for orders'},decaf_liter:{keep:2}});
 await hub.saveCoffeeRule(e,{key:'decaf',remove:true});
 await hub.hubCall(e,'outlook');assert.deepEqual(Object.keys(calls.at(-1).rules),['decaf_liter']);
 await assert.rejects(hub.saveCoffeeRule(e,{key:'x'}),/Which coffee/);
});

test('only the known read and write actions reach the app',async()=>{
 const {env:e}=env();
 await hub.hubCall(e,'log_bottling',{product:'classic_liter',units:24});
 await assert.rejects(hub.hubCall(e,'delete_everything'),/not-allowed/);
});
