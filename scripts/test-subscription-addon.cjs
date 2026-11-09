const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const ts=require('../ops-app/node_modules/typescript'),m=require('../subscription-model.js');
const products=[{id:'coffee',name_en:'Classic',category:'bottles',price:49},{id:'bar',name_en:'Bar',category:'coffeebars',is_coffee_bar:true,price:349}];
const run=(file,context)=>vm.runInContext(ts.transpileModule(fs.readFileSync(file,'utf8').replace(/^import[\s\S]*?;\r?\n/gm,''),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,context);
function order(addon){
 let inserted,handler;
 const db={from(){const q={select(){return q;},in(){return Promise.resolve({data:products});},eq(){return q;},maybeSingle(){return Promise.resolve({data:{}});},insert(v){inserted=v;return q;},single(){return Promise.resolve({data:{id:'o1'}});},then(r){return Promise.resolve({data:[]}).then(r);}};return q;}};
 const context=vm.createContext({exports:{},Request,Response,URL,console:{log(){},warn(){},error(){}},GremierSubscriptionModel:m,...require('../coffee-bar-order.js'),createClient:()=>db,subscriptionAddonOrder:async()=>addon,pickAddress:()=>({}),packConfig:()=>null,quotePack:()=>null,linkJourneyOrder:async()=>{},Deno:{env:{get:k=>({SUPABASE_URL:'https://x.test',SUPABASE_SERVICE_ROLE_KEY:'k'}[k])},serve:f=>handler=f}});
 run('supabase/functions/_shared/subscription-delivery.ts',context);run('supabase/functions/_shared/security.ts',context);run('supabase/functions/_shared/weekly-promo.ts',context);
 context.shabbatPromoActive=()=>true;context.shabbatGuaranteedZone=()=>true;
 run('supabase/functions/create-website-order/index.ts',context);
 return {send:async(body)=>{const r=await handler(new Request('https://x.test',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}));return {status:r.status,body:await r.json(),inserted};}};
}
const addon={customerName:'A',customerEmail:'a@x.test',customerPhone:'05',deliveryAddress:'Street 1',deliveryInfo:{delivery_type:'regular',delivery_date:'2026-12-01',subscription_addon:{sub_payme_id:'SUB123456'}},note:'pack with box'};
test('an add-on is full price, free to deliver, and uses the subscription address, never the browser',async()=>{
 const r=await order(addon).send({items:[{product_id:'coffee',qty:2,price:1}],subscription_addon:{sub_payme_id:'SUB123456'},customer_name:'Someone else',delivery_address:'Elsewhere',coupon_code:'X',gift_card_code:'Y'});
 assert.equal(r.status,200,JSON.stringify(r.body));
 assert.equal(r.inserted.total,98);assert.equal(r.inserted.delivery_info.delivery_fee,0);assert.equal(r.inserted.customer_name,'A');assert.equal(r.inserted.delivery_address,'Street 1');
 assert.equal(r.inserted.delivery_info.delivery_date,'2026-12-01');assert.match(r.inserted.notes,/pack with box/);assert.equal(r.inserted.delivery_info.subscription,null);assert.equal(r.inserted.delivery_info.payme_subscription_id,undefined);
});
test('coffee bars and other non-subscription items cannot be added',async()=>{
 const r=await order(addon).send({items:[{product_id:'bar',qty:1}],subscription_addon:{sub_payme_id:'SUB123456'}});
 assert.equal(r.status,400);assert.equal(r.inserted,undefined);
});
function box(openRow){
 const context=vm.createContext({exports:{},console,Intl,Date,Deno:{env:{get:()=>''}}});
 run('supabase/functions/_shared/subscription-delivery.ts',context);context.subscriptionDeliveryTarget=context.exports.subscriptionDeliveryTarget;
 run('supabase/functions/_shared/subscription-addon.ts',context);
 const q={select(){return q;},eq(){return q;},not(){return q;},order(){return q;},limit(){return Promise.resolve({data:openRow?[openRow]:[]});}};
 return {sb:{from:()=>q},nextBoxDate:context.exports.nextBoxDate};
}
const windowInfo={delivery_type:'regular',subscription:{interval:'monthly',delivery_schedule:{mode:'window',window:'mid'}}};
test('the next box is the undelivered one when there is one',async()=>{
 const b=box({order_number:7,delivery_info:windowInfo}),r=await b.nextBoxDate(b.sb,'SUB123456',windowInfo,'2099-01-03');
 assert.equal(r.order_number,7);assert.ok(r.date<'2099-01-01');
});
test("otherwise it follows the next charge, inside the customer's delivery window",async()=>{
 const b=box(null),r=await b.nextBoxDate(b.sb,'SUB123456',windowInfo,'2099-01-03');
 assert.equal(r.date,'2099-01-15');assert.equal(r.order_number,null);
});

function forever({fee=39,subPrice=88.2,current}={}){
 const zones=[{name_en:'Jerusalem',regular_price:39,expedited_price:59,free_above:139,is_active:true}];
 const box=[{product_id:'coffee',name_en:'Classic',price:44.1,regular_price:49,qty:2}];
 const parent={id:'p',items:[{price:88.2,qty:1,subscription_items:box}],subtotal:88.2,total:88.2+fee,delivery_info:{delivery_fee:fee,city_en:'Jerusalem',delivery_type:'regular',...(current?{subscription_current:current}:{})}};
 const calls={set:[],update:[]};
 const db={from(t){const q={select(){return q;},eq(){return q;},maybeSingle(){return Promise.resolve({data:t==='orders'?parent:{default_regular_price:99}});},update(v){calls.update.push(v);return {eq:()=>Promise.resolve({error:null})};},then(r){return Promise.resolve({data:t==='products'?[...products,{id:'syrup',name_en:'Vanilla Syrup',category:'bottles',price:59}]:zones,error:null}).then(r);}};return q;}};
 const context=vm.createContext({exports:{},console,Intl,Date,Math,Number,String,Map,Array,JSON,GremierSubscriptionModel:m,Deno:{env:{get:()=>''}}});
 run('supabase/functions/_shared/subscription-delivery.ts',context);run('supabase/functions/_shared/delivery-pricing.ts',context);
 Object.assign(context,{quoteDeliveryFee:context.exports.quoteDeliveryFee,loadDeliveryPricingTables:async()=>({zones,settings:{}}),describe:async()=>({active:true,order_id:'p',next_date:'2099-02-01'}),paymeSubscription:async()=>({sub_price:String(Math.round((subPrice+fee)*100))}),setSubscriptionPrice:async(id,a)=>{calls.set.push(a);return {ok:true};},subscriptionDeliveryTarget:context.exports.subscriptionDeliveryTarget});
 run('supabase/functions/_shared/subscription-addon.ts',context);
 return {add:(items,o)=>context.exports.addToEveryBox(db,'SUB123456',items,o),calls,box:context.exports.currentBox};
}
test('every-delivery only previews until the customer confirms, at 10% off',async()=>{
 const f=forever({fee:0,subPrice:147}),r=await f.add([{product_id:'coffee',qty:1}],{commit:false});
 assert.equal(r.ok,true,r.error);assert.equal(r.current,147);assert.equal(r.next,191.1);assert.equal(f.calls.set.length,0);assert.equal(f.calls.update.length,0);
});
test('reaching the free-delivery amount drops the delivery fee from the new charge',async()=>{
 const f=forever(),r=await f.add([{product_id:'coffee',qty:1}],{commit:false});
 assert.equal(r.current,127.2);assert.equal(r.delivery_became_free,true);assert.equal(r.next,132.3);
});
test('confirming changes PayMe, keeps the first order for the books, and sets what renewals copy',async()=>{
 const f=forever(),r=await f.add([{product_id:'coffee',qty:1}],{commit:true,expected:132.3});
 assert.equal(r.ok,true,r.error);assert.equal(f.calls.set[0],13230);
 const saved=f.calls.update[0];assert.deepEqual(Object.keys(saved),['delivery_info']);
 const now=saved.delivery_info.subscription_current;assert.equal(now.total,132.3);assert.equal(now.delivery_fee,0);assert.equal(now.items[0].subscription_items[0].qty,3);
});
test('a stale confirmation changes nothing',async()=>{const f=forever(),r=await f.add([{product_id:'coffee',qty:1}],{commit:true,expected:100});assert.equal(r.ok,false);assert.equal(f.calls.set.length,0);});
test('coffee bars cannot be added to every delivery',async()=>{const f=forever(),r=await f.add([{product_id:'bar',qty:1}],{commit:true,expected:1});assert.equal(r.ok,false);assert.equal(f.calls.set.length,0);});
test('subscribers pay 19 instead of the standard 39; other delivery prices are unchanged',()=>{assert.equal(m.deliveryFee(39),19);assert.equal(m.deliveryFee(99),99);assert.equal(m.deliveryFee(0),0);});
