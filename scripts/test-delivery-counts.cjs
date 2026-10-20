const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const model=require('../admin-delivery-model.js');
const products={classic_liter:{category:'liter'},house_blend:{category:'liter'},a:{category:'mini'},b:{category:'mini'},c:{category:'mini'},unfiltered_liter:{category:'liter'},vanilla_syrup:{category:'syrup'},dispenser:{category:'dispenser'}};
test('defaults preserve exact totals, use Classic large and evenly split indivisible minis',()=>{
 const q=model.defaults({large:7,small:8,unfiltered:2,syrup:1},products,{dispenser:2});
 assert.deepEqual(q,{dispenser:2,classic_liter:7,a:3,b:3,c:2,unfiltered_liter:2,vanilla_syrup:1});
 assert.deepEqual(model.totals(q,products),{large:7,small:8,dairyFree:0,unfiltered:2,syrup:1});
});
test('unmapped dairy free keeps its own count without guessing a stock key',()=>{
 const q=model.defaults({dairyFree:5},products);
 assert.deepEqual(q,{_agg_dairy_free:5});
 assert.equal(model.matches({dairyFree:5},q,products),true);
});
test('stale breakdown is rejected; custom breakdown must match every saved category',()=>{
 assert.equal(model.matches({large:20,small:2},{classic_liter:12,a:2},products),false);
 assert.equal(model.matches({large:20,small:2},{classic_liter:10,house_blend:10,a:2},products),true);
 for(const n of [-1,1.5,'garbage',Infinity]) assert.throws(()=>model.count(n));
});
function harness({editing=null,counts={},extras={}}={}){
 const nodes={saveDeliveryBtn:{disabled:false},ldStore:{value:'store-1'},ldDate:{value:'2026-10-20'},ldNotes:{value:''}};
 ['large','small','dairyFree','unfiltered','syrup'].forEach((k,i)=>nodes[['ldLarge','ldSmall','ldDairyFree','ldUnfiltered','ldSyrup'][i]]={value:String(counts[k]||0)});
 const calls=[],toasts=[];
 const ctx={GremierDelivery:model,LD_PRODUCTS:products,ldEditingRow:editing,ldDraftId:'draft-id',ldExtraQuantities:extras,
 document:{getElementById:id=>nodes[id]},allStores:[{id:'store-1'}],crypto:{randomUUID:()=> 'draft-id'},
 sb:{rpc:async(name,args)=>{calls.push({name,args});return {data:{...args.d,updated_at:'saved-version'}}}},
 window:{dispatchEvent(){}},CustomEvent:function(){},ldOfferAllocation:row=>calls.push({offer:row}),
 showToast:t=>toasts.push(t),closeLogDeliveryModal(){},loadStoreDeliveries:async()=>{},console};
 const src=fs.readFileSync('admin.html','utf8');
 vm.runInNewContext(src.slice(src.indexOf('function ldReadCounts()'),src.indexOf('function ldRowCounts(')),ctx);
 vm.runInNewContext(src.slice(src.indexOf('async function saveDelivery()'),src.indexOf('async function deleteDelivery()')),ctx);
 return {ctx,calls,toasts,nodes};
}
test('editing top counts wins over stale saved flavor breakdown',async()=>{
 const h=harness({editing:{id:'draft-id',updated_at:'old-version',quantities:{classic_liter:12}},counts:{large:25,small:8}});
 await h.ctx.saveDelivery();
 const d=h.calls[0].args.d;
 assert.equal(d.qty_large,25);assert.equal(d.qty_small,8);assert.equal(d.quantities.classic_liter,25);
 assert.equal(d.allocation_mode,'default');assert.equal(h.calls[0].args.expected_updated_at,'old-version');
 assert.equal(d.notification_quantities._agg_large,25);assert.equal(d.notification_quantities.classic_liter,undefined);
 assert.equal(h.calls[1].offer.qty_large,25);
});
test('unchanged totals preserve an existing custom allocation when editing notes',async()=>{
 const h=harness({editing:{updated_at:'old-version',quantities:{classic_liter:4,house_blend:8},allocation_mode:'custom'},counts:{large:12}});
 await h.ctx.saveDelivery();assert.equal(h.calls[0].args.d.quantities.house_blend,8);assert.equal(h.calls[0].args.d.allocation_mode,'custom');
});
test('other-product-only delivery saves for its notification; empty delivery does not',async()=>{
 const h=harness({extras:{dispenser:'2'}});await h.ctx.saveDelivery();
 assert.equal(h.calls[0].args.d.quantities.dispenser,2);
 const empty=harness();await empty.ctx.saveDelivery();assert.equal(empty.calls.length,0);assert.match(empty.toasts[0],/at least one/);
});
test('failed save retains the draft and does not open a false success prompt',async()=>{
 const h=harness({counts:{large:5}});h.ctx.sb.rpc=async()=>({error:{message:'Delivery changed'}});
 await h.ctx.saveDelivery();assert.equal(h.calls.length,0);assert.equal(h.ctx.ldDraftId,'draft-id');assert.equal(h.nodes.saveDeliveryBtn.disabled,false);
});
