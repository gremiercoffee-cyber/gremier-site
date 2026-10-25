import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
async function load(entry){const b=await build({entryPoints:[entry],bundle:true,write:false,format:'esm',platform:'node'});return import(`data:text/javascript;base64,${Buffer.from(b.outputFiles[0].text).toString('base64')}`);}
const {createImmediateCompletions}=await load('src/immediate-completions.ts');
const {createImmediateShopping}=await load('src/immediate-shopping.ts');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
test('task disappears before save resolves; stale refresh cannot restore it and failures roll back only that item',async()=>{
 const store=createImmediateCompletions(),a=deferred(),b=deferred();let refreshed=0;
 const first=store.complete('a',()=>a.promise,()=>refreshed++);
 assert.ok(store.getSnapshot().hidden.has('a'),'visible change happens before network completion');assert.equal(refreshed,0);
 store.reconcile(['a','b']);assert.ok(store.getSnapshot().hidden.has('a'));
 const second=store.complete('b',()=>b.promise,()=>refreshed++);assert.equal(store.getSnapshot().hidden.size,2);
 b.reject(new Error('offline'));await second;assert.ok(!store.getSnapshot().hidden.has('b'));assert.ok(store.getSnapshot().hidden.has('a'));assert.match(store.getSnapshot().error,/restored/);
 a.resolve({});await first;assert.equal(refreshed,1);store.reconcile(['a','b']);assert.ok(store.getSnapshot().hidden.has('a'),'old refresh after save is also ignored');
 store.reconcile(['b']);assert.equal(store.getSnapshot().hidden.size,0);let retried=false;await store.complete('a',async()=>{retried=true;},()=>{});assert.equal(retried,true,'later reopened tasks can be completed again');
});
test('duplicate taps do not repeat writes and a dropped source row cannot undo a pending completion',async()=>{
 const store=createImmediateCompletions(),request=deferred();let calls=0;
 const run=()=>store.complete('a',()=>{calls++;return request.promise;},()=>{});const first=run();await run();store.reconcile([]);assert.ok(store.getSnapshot().hidden.has('a'));assert.equal(calls,1);request.resolve();await first;
});
test('shopping check changes immediately, permits other purchases, and ignores stale polling until acknowledgement',async()=>{
 const store=createImmediateShopping(),a=deferred(),b=deferred(),item=id=>({id,checked:0,checked_at:null});
 const first=store.toggle(item('a'),true,()=>a.promise,()=>{});assert.equal(store.getSnapshot().checks.get('a').checked,1);assert.ok(store.getSnapshot().checks.get('a').checked_at);
 const second=store.toggle(item('b'),true,()=>b.promise,()=>{});assert.equal(store.getSnapshot().checks.size,2);
 store.reconcile([item('a'),item('b')]);assert.equal(store.getSnapshot().checks.size,2);
 b.reject(new Error('network'));await second;assert.equal(store.getSnapshot().checks.has('b'),false);assert.equal(store.getSnapshot().checks.get('a').checked,1);
 a.resolve();await first;store.reconcile([item('a')]);assert.equal(store.getSnapshot().checks.get('a').checked,1);
 store.reconcile([{...item('a'),checked:1}]);assert.equal(store.getSnapshot().checks.size,0);
});
