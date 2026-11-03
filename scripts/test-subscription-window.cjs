// Monthly subscription delivery windows: early (1st–5th) and mid (15th–20th).
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm'),ts=require('../ops-app/node_modules/typescript');
function run(file,context){const source=fs.readFileSync(file,'utf8').replace(/^import[\s\S]*?;\r?\n/gm,'');vm.runInContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,context);}
const ctx=()=>{const c=vm.createContext({exports:{},Intl,Date});run('supabase/functions/_shared/subscription-delivery.ts',c);return c;};
test('window dates: today while open, else the next window start',()=>{const c=ctx(),d=(w,t)=>vm.runInContext(`subscriptionWindowDate('${w}','${t}')`,c);
 assert.equal(d('early','2026-11-03'),'2026-11-03');assert.equal(d('early','2026-11-06'),'2026-12-01');assert.equal(d('early','2026-12-28'),'2027-01-01');
 assert.equal(d('mid','2026-11-03'),'2026-11-15');assert.equal(d('mid','2026-11-18'),'2026-11-18');assert.equal(d('mid','2026-11-21'),'2026-12-15');});
test('monthly orders must choose a window; weekly keep the old rule',()=>{const c=ctx();
 assert.throws(()=>vm.runInContext("subscriptionDeliveryRule('monthly',null,'2026-11-03','')",c),/1st–5th or the 15th–20th/);
 assert.equal(vm.runInContext("subscriptionDeliveryRule('monthly',null,'2026-11-03','mid').first_date",c),'2026-11-15');
 assert.equal(vm.runInContext("subscriptionDeliveryRule('weekly',null,'2026-11-03','').mode",c),'billing');
 assert.equal(vm.runInContext("subscriptionDeliveryRule('monthly',null,'2026-11-03').mode",c),'billing');});
test('renewals target the next window from the charge day',()=>{const c=ctx();c.info={recurring_child:true,delivery_type:'regular',subscription:{interval:'monthly',delivery_schedule:{mode:'window',window:'early'}}};
 assert.equal(vm.runInContext("subscriptionDeliveryTarget(info,'2026-12-22')",c),'2027-01-01');c.info.delivery_type='pickup';assert.equal(vm.runInContext("subscriptionDeliveryTarget(info,'2026-12-22')",c),null);});
test('paid email tells the customer when to expect the box',async()=>{const c=ctx();c.SUBSCRIPTION_DELIVERY_NOTE=c.exports.SUBSCRIPTION_DELIVERY_NOTE;c.SUBSCRIPTION_WINDOWS=c.exports.SUBSCRIPTION_WINDOWS;c.Deno={env:{get:()=>''}};c.console={error(){},log(){}};c.describeCoffeeBar=()=>'';
 run('supabase/functions/_shared/order-email.ts',c);run('supabase/functions/_shared/order-notify.ts',c);vm.runInContext('sendOrderEmails=async p=>{captured=p;return {ok:true}}',c);
 c.order={id:'fixture',customer_email:'fixture@example.test',total:117.2,subtotal:88.2,items:[{is_subscription:true,subscription_interval:'monthly',subscription_window:'early',subscription_items:[{name_en:'Classic',qty:2}]}],delivery_info:{delivery_type:'regular',recurring_child:true,subscription:{interval:'monthly',delivery_schedule:{mode:'window',window:'early'}}}};
 await vm.runInContext('sendOrderPaidNotification(order)',c);
 assert.match(c.captured.customerText,/start of the month \(usually the 1st–5th\), so expect this delivery around \d\d\/\d\d/);assert.match(c.captured.customerText,/בתחילת החודש/);});
