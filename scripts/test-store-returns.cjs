const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const ts=require('../ops-app/node_modules/typescript'),ui=require('../admin-store-returns.js');
const run=(file,context)=>vm.runInContext(ts.transpileModule(fs.readFileSync(file,'utf8').replace(/^import[\s\S]*?;\r?\n/gm,''),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,context);
const STORE='s1';
function world({returns=[],credits=[],bill=null,qty=10,price=30}={}){
 const state={returns,credits:credits.slice(),bill,upsert:null,html:''};
 const table=(name)=>{
  const f=[];let del=false;
  const rows=()=>({store_returns:state.returns,store_return_credits:state.credits}[name]||[]).filter(r=>f.every(fn=>fn(r)));
  const q={select(){return q;},eq(k,v){f.push(r=>r[k]===v);return q;},is(k){f.push(r=>r[k]==null);return q;},lt(k,v){f.push(r=>r[k]<v);return q;},gte(){return q;},order(){return q;},
   delete(){del=true;return q;},
   insert(v){state.credits.push(...v);return Promise.resolve({error:null});},
   upsert(v){state.upsert=v;return Promise.resolve({error:null});},
   maybeSingle(){return Promise.resolve({data:state.bill});},
   then(ok){
    if(del){state.credits=state.credits.filter(r=>!f.every(fn=>fn(r)));return Promise.resolve({error:null}).then(ok);}
    if(name==='store_deliveries')return Promise.resolve({data:[{store_id:STORE,qty_large:qty,stores:{name:'Shop',price_large:price,price_small:0,price_syrup:0}}],error:null}).then(ok);
    return Promise.resolve({data:rows(),error:null}).then(ok);
   }};
  return q;
 };
 const db={from:table,storage:{from:()=>({upload:async()=>({error:null}),getPublicUrl:()=>({data:{publicUrl:'u'}})})}};
 let handler;
 const context=vm.createContext({exports:{},console,Request,Response,URL,Date,Intl,Math,Number,String,Object,JSON,Promise,Uint8Array,btoa,VAT_RATE:.18,forbidden:()=>new Response('no',{status:403}),isServiceOrAdmin:async()=>true,createClient:()=>db,
  fetch:async(u,o)=>{state.html=JSON.parse(o.body).source;return {ok:true,arrayBuffer:async()=>new ArrayBuffer(1)};},Deno:{env:{get:()=>'x'},serve:f=>handler=f}});
 run('supabase/functions/_shared/store-return-credits.ts',context);context.applyReturnCredits=context.exports.applyReturnCredits;
 run('supabase/functions/monthly-billing/index.ts',context);
 return {state,bill:async()=>{const r=await handler(new Request('https://x.test',{method:'POST',body:JSON.stringify({year:2026,month:11})}));assert.equal(r.status,200,await r.clone().text());return r.json();}};
}
const ret=(id,amount,date='2026-11-09')=>({id,store_id:STORE,amount_minor:amount,return_date:date,cancelled_at:null});
test('a return comes off the bill and VAT is charged on what is left',async()=>{
 const w=world({returns:[ret('r1',6000)]});await w.bill();
 assert.equal(w.state.upsert.total,240);assert.equal(w.state.upsert.credit_minor,6000);
 assert.match(w.state.html,/-60\.00/);assert.match(w.state.html,/₪43\.20/);assert.match(w.state.html,/₪283\.20/);
});
test('making the statement again never takes the credit twice',async()=>{
 const w=world({returns:[ret('r1',6000)]});await w.bill();await w.bill();await w.bill();
 assert.equal(w.state.upsert.total,240);assert.equal(w.state.credits.length,1);
});
test('a credit bigger than the bill leaves it at zero and carries the rest',async()=>{
 const w=world({returns:[ret('r1',50000)]});await w.bill();
 assert.equal(w.state.upsert.total,0);assert.equal(w.state.credits[0].amount_minor,30000);
});
test('the carried part comes off the following month',async()=>{
 const w=world({returns:[ret('r1',50000)],credits:[{return_id:'r1',store_id:STORE,year:2026,month:10,amount_minor:30000}]});await w.bill();
 assert.equal(w.state.upsert.total,100);assert.equal(w.state.upsert.credit_minor,20000);
});
test('a return filed after this month ends waits for its own bill',async()=>{
 const w=world({returns:[ret('r1',6000,'2026-12-02')]});await w.bill();
 assert.equal(w.state.upsert.total,300);assert.equal(w.state.credits.length,0);
});
test('a cancelled return gives no credit',async()=>{
 const w=world({returns:[{...ret('r1',6000),cancelled_at:'2026-11-10'}]});await w.bill();
 assert.equal(w.state.upsert.total,300);
});
test('a bill already sent does not pick up a new credit, and keeps one it had',async()=>{
 const a=world({returns:[ret('r1',6000)],bill:{billed_at:'2026-11-30'}});await a.bill();
 assert.equal(a.state.upsert.total,300);assert.equal(a.state.credits.length,0);
 const b=world({returns:[ret('r1',6000),ret('r2',1000)],credits:[{return_id:'r1',store_id:STORE,year:2026,month:11,amount_minor:6000}],bill:{paid_at:'2026-12-01'}});await b.bill();
 assert.equal(b.state.upsert.total,240);assert.equal(b.state.credits.length,1);
});
test('a month already on a VAT invoice is left alone',async()=>{
 const w=world({returns:[ret('r1',6000)],bill:{tax_invoice_id:'inv'}});await w.bill();
 assert.equal(w.state.upsert,null);assert.equal(w.state.credits.length,0);
});
test('the form works out the credit from the store’s own prices',()=>{
 assert.equal(ui.creditMinor({price_large:35,price_small:10.5},{large:2,small:3}),10150);
 assert.equal(ui.creditMinor(undefined,{large:2}),0);
});
