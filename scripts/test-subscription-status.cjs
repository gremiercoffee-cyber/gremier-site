const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {stripTypeScriptTypes}=require('node:module');
const ctx={};vm.createContext(ctx);vm.runInContext(stripTypeScriptTypes(fs.readFileSync('supabase/functions/_shared/subscription-status.ts','utf8')).replace('export ',''),ctx);
const state=ctx.subscriptionState;
test('PayMe active code 2, numeric or string, is active and can be cancelled',()=>{
 for(const code of [2,'2']){const s=state(code);assert.equal(s.active,true);assert.equal(s.cancelled,false);assert.equal(s.status_label,'Active');assert.equal(s.can_cancel,true)}
});
test('only cancelled code 5 is cancelled; pending, paused, failed, completed and retrying remain distinct',()=>{
 for(const [code,status] of [[1,'pending'],[2,'active'],[3,'paused'],[4,'failed'],[5,'cancelled'],[6,'completed'],[7,'retrying']]){const s=state(code);assert.equal(s.status,status);assert.equal(s.cancelled,code===5)}
 assert.equal(state(7).needs_attention,true);assert.equal(state(6).can_cancel,false);assert.equal(state(5).can_cancel,false);assert.equal(state(1).active,false);
});
test('provider lookup failure uses explicit known events, otherwise reports unknown rather than assuming cancellation or activation',()=>{
 assert.equal(state(null,'sub-active').active,true);assert.equal(state(null,'sub-cancel').cancelled,true);assert.equal(state(null,'sub-failure').status,'failed');assert.equal(state(null,'').status,'unknown');assert.equal(state(123,'sub-active').status,'unknown');assert.equal(state(0).status,'unknown');
});
test('the real admin list maps provider status 2 correctly, groups renewals once, and keeps confirmed cancellations distinct',async()=>{
 const rows=[{id:'parent',order_number:235,total:152.1,payment_status:'paid',delivery_info:{payme_subscription_id:'SUB-active'}},{id:'child',total:152.1,delivery_info:{payme_subscription_id:'SUB-active',subscription_parent_order_id:'parent'}},{id:'cancelled',delivery_info:{payme_subscription_id:'SUB-cancelled',subscription_status:'sub-cancel'}},{id:'retry',delivery_info:{payme_subscription_id:'SUB-retry'}},{id:'unknown',delivery_info:{payme_subscription_id:'SUB-unknown'}}];
 const db={from(){const q={select(){return q},not(){return q},order(){return q},limit:async()=>({data:rows,error:null})};return q}};
 const code=fs.readFileSync('supabase/functions/admin-tools/index.ts','utf8');const list=code.slice(code.indexOf('async function listSubscriptions('),code.indexOf('async function cancelSubscription('));
 const c={subscriptionState:state,paymeSubscription:async id=>id==='SUB-unknown'?null:{sub_status:({'SUB-active':2,'SUB-cancelled':5,'SUB-retry':7})[id],sub_paid:true,sub_price:15210}};vm.createContext(c);vm.runInContext(stripTypeScriptTypes(list),c);
 const result=await c.listSubscriptions(db);assert.equal(result.length,4);const active=result.find(s=>s.order_number===235);assert.equal(active.active,true);assert.equal(active.status_label,'Active');assert.equal(active.renewals.length,1);assert.equal(result.filter(s=>s.cancelled).length,1);assert.equal(result.find(s=>s.sub_payme_id==='SUB-retry').status,'retrying');assert.equal(result.find(s=>s.sub_payme_id==='SUB-unknown').status,'unknown');
});
