import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {build} from 'esbuild';

// Talking to the coffee admin app: "I have 20 Classic liters" sets the counted stock, sending the amount that was
// read as `expected` so the app refuses it if stock moved meanwhile; stock rules are remembered and go with every outlook; only known actions are allowed.
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

test('"I have 20 Classic liters": the app gets the count and the amount read, and the reply has before → now',async()=>{
 calls=[];const {env:e}=env();
 const r=await hub.setCoffeeStock(e,{product:'classic_liter',value:20});
 assert.deepEqual(calls.at(-1),{action:'set_stock',kind:'inventory',product:'classic_liter',qty:20,expected:30,reason:'Counted (told Chief of Staff)'});
 assert.deepEqual({before:r.before,now:r.now,app_updated:r.app_updated},{before:30,now:20,app_updated:true});
 calls=[];const c=await hub.setCoffeeStock(e,{kind:'concentrate',product:'decaf',value:5.5});
 assert.deepEqual([calls.at(-1).qty,calls.at(-1).expected],[5.5,2]);assert.equal(c.change,3.5);
 calls=[];await hub.setCoffeeStock(e,{product:'classic_liter',value:30});
 assert.equal(calls.some(x=>x.action==='set_stock'),false,'no change, nothing sent');
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

test('production steps are credited to the owner unless someone is named; new actions are allowed',async()=>{
 calls=[];const {env:e}=env();
 await hub.coffeeChange(e,'log_bottling',{product:'classic_liter',units:24});
 assert.equal(calls.at(-1).worker_id,'owner');
 await hub.coffeeChange(e,'start_brew',{product:'decaf',kg:3,worker_id:'w-1'});
 assert.equal(calls.at(-1).worker_id,'w-1');
 await hub.coffeeChange(e,'schedule_store_delivery',{store:'Good Store',quantities:{classic_liter:6},date:'2026-11-10',time:'10:00'});
 assert.equal(calls.at(-1).worker_id,undefined);
 await hub.coffeeChange(e,'reschedule_job',{job_id:'j1',date:'2026-11-11'});
 await hub.hubCall(e,'production_people');await hub.hubCall(e,'marketing_sales',{from:'2026-10-01',to:'2026-10-31'});
 await assert.rejects(hub.coffeeChange(e,'stock'),/Not a coffee change/);
});
