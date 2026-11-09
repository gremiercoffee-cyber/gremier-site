const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const ts=require('../ops-app/node_modules/typescript');
const src=fs.readFileSync('supabase/functions/_shared/fulfill-paid-order.ts','utf8');
const start=src.indexOf('async function linkPaymentLinkOrderToMember'),end=src.indexOf('/** Loyalty, once per paid order');
const code=ts.transpileModule(src.slice(start,end),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText+';this.link=linkPaymentLinkOrderToMember;';
function run(order,members){
 const ctx=vm.createContext({String});vm.runInContext(code,ctx);const calls={updates:[],pattern:null};
 const db={from(t){const q={select(){return q;},eq(){return q;},is(){return Promise.resolve({error:null});},maybeSingle(){return Promise.resolve({data:order});},ilike(_,v){calls.pattern=v;return q;},limit(){return Promise.resolve({data:members});},update(v){calls.updates.push(v);return q;}};return q;}};
 return ctx.link(db,'o1').then(()=>calls);
}
const link={user_id:null,customer_email:'A_b@x.test',source:'payment_link',delivery_info:{}};
test('a paid payment link is attached to the member with that email',async()=>{const c=await run(link,[{id:'m1'}]);assert.equal(c.updates.length,1);assert.equal(c.updates[0].user_id,'m1');assert.equal(c.pattern,'A\\_b@x.test');});
test('no member, or more than one, leaves the order alone',async()=>{assert.equal((await run(link,[])).updates.length,0);assert.equal((await run(link,[{id:'1'},{id:'2'}])).updates.length,0);});
test('an order already on an account is not moved',async()=>{assert.equal((await run({...link,user_id:'x'},[{id:'m1'}])).updates.length,0);});
test('signed-out website orders are not attached by a typed email',async()=>{assert.equal((await run({...link,source:'website'},[{id:'m1'}])).updates.length,0);});
