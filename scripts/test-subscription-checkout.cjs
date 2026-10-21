const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const ts=require('../ops-app/node_modules/typescript'),m=require('../subscription-model.js');
const products=[{id:'coffee',name_en:'Classic',category:'bottles',price:49},{id:'syrup',name_en:'Vanilla Syrup',category:'bottles',price:59},{id:'bulk',name_en:'5L Classic',category:'bulk',price:169},{id:'mini',name_en:'Mini 4-Pack',category:'minis',price:59},{id:'bar',name_en:'Coffee Bar',category:'coffeebars',price:249}];
const choose=(id,qty=1)=>({product_id:id,qty});
test('storefront inline scripts parse after subscription UI changes',()=>{const html=fs.readFileSync('index.html','utf8');for(const match of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)){if(match[2].trim()&&!match[1].includes('application/json'))new vm.Script(match[2]);}});
test('subscriptions bypass saved-card charging and cart quick-pay controls',async()=>{
 const html=fs.readFileSync('index.html','utf8');
 const start=html.indexOf('  window.callCreatePayment = async function (orderId) {'),end=html.indexOf('  try { callCreatePayment =',start);
 let forwarded;const context=vm.createContext({window:{},cart:[{is_subscription:true}],signedIn(){throw Error('Saved-card flow must not run');},_createPayment:async id=>{forwarded=id;return {sale_url:'https://example.test/recurring-card-setup'};}});
 vm.runInContext(html.slice(start,end),context);assert.equal((await context.window.callCreatePayment('fixture')).sale_url,'https://example.test/recurring-card-setup');assert.equal(forwarded,'fixture');
 const expressStart=html.indexOf('  function expressEligible() {'),expressEnd=html.indexOf('  const _renderCart',expressStart);
 vm.runInContext(html.slice(expressStart,expressEnd),context);assert.equal(vm.runInContext('expressEligible()',context),null);
});
function run(file,context){const source=fs.readFileSync(file,'utf8').replace(/^import[\s\S]*?;\r?\n/gm,'');vm.runInContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,context);}
test('browser and server use identical validated subscription pricing and minimums',()=>{
 assert.equal(fs.readFileSync('subscription-model.js','utf8'),fs.readFileSync('supabase/functions/_shared/subscription-model.js','utf8'));
 assert.equal(m.quote([choose('coffee')],products).deliveryEligible,false);
 assert.equal(m.quote([choose('coffee',2)],products).deliveryEligible,true);
 assert.equal(m.quote([choose('bulk')],products).deliveryEligible,true);
 assert.equal(m.quote([choose('coffee'),choose('syrup')],products).deliveryEligible,false);
 assert.throws(()=>m.quote([choose('syrup',3)],products),/alongside/);
 assert.equal(m.quote([choose('coffee',2),choose('syrup')],products).total,147.2);
 for(const rows of [[choose('coffee',21)],[choose('coffee',1.5)],[choose('coffee'),choose('coffee')],[choose('bar')],[choose('unknown')]])assert.throws(()=>m.quote(rows,products));
});
function checkout(){
 let inserted,handler;
 const db={from(table){let row;const q={select(){return q;},in(){return Promise.resolve({data:products});},eq(){return q;},maybeSingle(){return Promise.resolve({data:{default_regular_price:59}});},insert(value){row=value;inserted=value;return q;},single(){return Promise.resolve({data:{id:'fixture-order'}});},then(resolve){return Promise.resolve({data:[{id:'jerusalem',name_en:'Jerusalem',regular_price:29,expedited_price:49,free_above:139}]}).then(resolve);}};if(!['products','delivery_zones','delivery_settings','orders'].includes(table))throw Error('Unexpected table '+table);return q;}};
 const context=vm.createContext({exports:{},Request,Response,URL,console:{log(){},warn(){},error(){}},GremierSubscriptionModel:m,createClient:()=>db,Deno:{env:{get:k=>({SUPABASE_URL:'https://example.test',SUPABASE_SERVICE_ROLE_KEY:'fixture'}[k])},serve:fn=>handler=fn}});
 run('supabase/functions/_shared/security.ts',context);run('supabase/functions/create-website-order/index.ts',context);
 return {context,get inserted(){return inserted;},request:async(items,delivery_type='regular')=>{const response=await handler(new Request('https://example.test',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({customer_name:'Fixture',customer_email:'fixture@example.test',customer_phone:'0501234567',delivery_address:'Fixture address',items,delivery_info:{delivery_type,city_en:'Jerusalem'}})}));return {status:response.status,body:await response.json()};}};
}
const basket=(contents)=>[{product_id:contents[0].product_id,is_subscription:true,subscription_interval:'monthly',subscription_items:contents,price:.01,qty:1}];
test('server rejects one-bottle delivery and syrup-only requests before creating an order',async()=>{
 for(const contents of [[choose('coffee')],[choose('syrup')],[choose('coffee'),choose('syrup')]]){const c=checkout(),r=await c.request(basket(contents));assert.equal(r.status,400);assert.equal(c.inserted,undefined);}
});
test('server allows one-bottle pickup and a single 5L delivery, ignoring client prices',async()=>{
 let c=checkout(),r=await c.request(basket([choose('coffee')]),'pickup');assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(c.inserted.total,44.1);assert.equal(c.inserted.delivery_info.delivery_fee,0);assert.equal(c.inserted.items[0].is_subscription,true);
 c=checkout();r=await c.request(basket([choose('bulk')]));assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(c.inserted.total,152.1);assert.equal(c.inserted.delivery_info.delivery_fee,0);
});
test('two bottles retain delivery fee and three qualify for zone free shipping before discount',async()=>{
 let c=checkout(),r=await c.request(basket([choose('coffee',2)]));assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(c.inserted.subtotal,88.2);assert.equal(c.inserted.total,117.2);assert.equal(c.inserted.delivery_info.subscription.interval,'monthly');
 c=checkout();r=await c.request(basket([choose('coffee',3)]));assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(c.inserted.total,132.3);assert.equal(c.inserted.delivery_info.delivery_fee,0);
});
test('ordinary purchases retain normal pricing and mixed subscription checkouts are blocked',async()=>{
 let c=checkout(),r=await c.request([{product_id:'coffee',qty:1}]);assert.equal(r.status,200);assert.equal(c.inserted.total,78);assert.equal(c.inserted.delivery_info.subscription,null);
 c=checkout();r=await c.request([...basket([choose('coffee',2)]),{product_id:'syrup',qty:1}]);assert.equal(r.status,400);assert.equal(c.inserted,undefined);
});
test('PayMe receives the full recurring amount including shipping with proper interval and callback',()=>{
 const context=vm.createContext({exports:{},console,serve(){},Deno:{env:{get:()=>''},serve(){}},URL,URLSearchParams});run('supabase/functions/create-payment/index.ts',context);
 const order={id:'fixture-order',total:117.2,items:[{is_subscription:true,subscription_interval:'monthly'}],delivery_info:{subscription:{interval:'monthly'}}};context.order=order;
 const payload=vm.runInContext(`buildRecurringPayload(order,getSubscriptionMeta(order),{sellerId:'fixture',paymeClientKey:'',totalShekels:order.total,buyerEmail:'fixture@example.test',buyerPhone:'0501234567',returnUrl:'https://example.test/return',callbackUrl:'https://example.test/webhook'})`,context);
 assert.equal(payload.sub_price,11720);assert.equal(payload.subscription_id,'fixture-order');assert.equal(payload.sub_callback_url,'https://example.test/webhook');assert.equal(payload.sub_iterations,-1);assert.equal(payload.sub_iteration_type,3);
 order.delivery_info.subscription.interval='weekly';assert.equal(vm.runInContext('getSubscriptionMeta(order).interval',context),'weekly');
});
test('verified first payment and renewal each fulfill once; duplicate callbacks never clone twice',async()=>{
 const parent={id:'parent',customer_name:'Fixture',customer_email:'fixture@example.test',customer_phone:'0501234567',subtotal:88.2,total:117.2,items:[{is_subscription:true,subscription_items:[choose('coffee',2)]}],delivery_info:{subscription:{interval:'monthly'},delivery_type:'regular',delivery_date:'2026-10-01',delivery_fee:29}},children=[],fulfilled=[];
 const db={from(table){assert.equal(table,'orders');let patch,child,filters={},applied=false;function apply(){if(!applied&&patch){parent.delivery_info=patch.delivery_info;applied=true;}return {data:patch?[{id:parent.id}]:[]};}const q={update(value){patch=value;return q;},insert(value){child=value;return q;},select(){return q;},eq(k,v){filters[k]=v;return q;},is(){return q;},then(resolve){return Promise.resolve(apply()).then(resolve);},maybeSingle(){return Promise.resolve({data:children.find(c=>c.delivery_info.subscription_iteration_key===filters['delivery_info->>subscription_iteration_key'])||null});},single(){child.id='child-'+(children.length+1);children.push(child);return Promise.resolve({data:{id:child.id}});}};return q;}};
 const context=vm.createContext({exports:{},parent,verified:{subscriptionId:'parent',paid:true,status:2,paymentDate:'2026-10-21'},Deno:{env:{get:()=>''},serve(){}},console:{log(){},warn(){},error(){}},Response,URL,URLSearchParams,receiptCardFields:()=>({}),fulfillPaidOrder:async(_,id)=>fulfilled.push(id)});
 run('supabase/functions/payme-webhook/index.ts',context);vm.runInContext('findSubscriptionParent=async()=>parent;verifySubscriptionWithPayMe=async()=>verified;',context);
 async function notice(type='sub-iteration-success'){context.db=db;context.notice={notify_type:type,subscription_id:'parent',sub_payme_id:'SUB-fixture',sub_payment_date:context.verified?.paymentDate,payme_sale_id:'SALE-fixture'};const r=await vm.runInContext('handleSubscriptionCallback(db,notice)',context);return {status:r.status,body:await r.json()};}
 let r=await notice('sub-active');assert.equal(r.body.first_charge,true);assert.deepEqual(fulfilled,['parent']);
 r=await notice();assert.equal(r.body.duplicate_first,true);assert.equal(children.length,0);
 context.verified.paymentDate='2026-11-21';r=await notice();assert.equal(r.body.renewal,true);assert.equal(children.length,1);assert.equal(fulfilled.length,2);
 assert.deepEqual(children[0].items,parent.items);assert.equal(children[0].total,117.2);assert.equal(children[0].delivery_info.delivery_fee,29);assert.equal(children[0].delivery_info.delivery_date,undefined);
 r=await notice();assert.equal(r.body.already_processed,true);assert.equal(children.length,1);assert.equal(fulfilled.length,2);
 context.verified={subscriptionId:'parent',paid:false,status:1,paymentDate:'2026-12-21'};r=await notice();assert.equal(r.status,403);assert.equal(children.length,1);
 context.verified=null;r=await notice();assert.equal(r.status,503);assert.equal(fulfilled.length,2);
});
