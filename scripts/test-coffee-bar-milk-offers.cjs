const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const offers=require('../storefront-coffee-bar-offers.js');
const model=require('../coffee-bar-order.js');
const {layout}=require('../storefront-bar-layout.js');
const FULL='9361ff6e-4227-44cc-a23a-428a002f1f4c',BASIC='c211cedd-ef93-4dba-9a6e-b2edb1add6e0';
const milkAddons=['oat','almond','soy'].map(key=>({name:key[0].toUpperCase()+key.slice(1)+' milk',per_liter:true,price:9,milk_type:key,milk_label:key[0].toUpperCase()+key.slice(1)+' milk'}));
const full={id:FULL,name_en:'Full coffee bar',is_coffee_bar:true,category:'coffeebars',variations:[{type:'choice',name:'Guests',options:[{label:'25',price:349},{label:'50',price:599}]},{type:'addons',items:[{name:'Old milk',per_liter:true,price:9,legacy_milk:true},...milkAddons,{name:'House Blend',per_jug:true,price:49},{name:'Extra dispenser',price:49,max:3}]}]};
const basic={id:BASIC,name_en:'Basic coffee bar',is_coffee_bar:true,variations:[{type:'choice',name:'Guests',options:[{label:'25',price:249},{label:'50',price:449}]},{type:'addons',items:[{name:'Caramel syrup',bar_syrup:'caramel',price:59},{name:'Vanilla syrup',bar_syrup:'vanilla',price:59}]}]};
const jug={id:'jug',name_en:'Classic 5L Jerry Can',category:'bulk',price:249},syrup={id:'syrup',name_en:'Vanilla syrup',category:'syrups',price:59};
const catalog=[full,basic,jug,syrup,{id:'mini',category:'minis',name_en:'Mini 4 pack',price:59}];
const basket=()=>[{id:'jug',base_product_id:'jug',qty:1,price:249},{id:'syrup',base_product_id:'syrup',qty:1,price:59},{id:'mini',qty:1,price:59}];
function planner(){
 const context={window:{},document:{readyState:'loading',addEventListener(){}},addEventListener(){},products:catalog,getProductAddons:p=>p.variations?.find(v=>v.type==='addons')?.items||[],isCoffeeBarProduct:p=>p.is_coffee_bar,lang:'en'};
 const source=fs.readFileSync('storefront-planner.js','utf8').replace("  if (document.readyState === 'loading')","  window.testApi={state,suggestion,tiles,milkHtml,takeHomeHtml,adjustMilk};\n  if (document.readyState === 'loading')");
 vm.runInNewContext(source,context);return context.window.testApi;
}
test('50 guests defaults to 3L named parve + 2L dairy, charged at nine per litre',()=>{
 const {state,suggestion,milkHtml}=planner();state.milk='parve';
 const plan=suggestion();assert.equal(plan.liters,3);assert.equal(plan.total,626);assert.equal(plan.milk[0].key,'oat');
 assert.match(milkHtml(plan),/2L dairy \+ 3L Oat milk/);assert.doesNotMatch(milkHtml(plan),/Old milk/);
});
test('one-litre swap and each named milk survive planner, order model and scene',()=>{
 for(const type of ['oat','almond','soy']){
  const {state,suggestion,tiles}=planner();state.milk='parve';state.milkMix={[type]:1};
  const plan=suggestion();assert.equal(plan.total,608);assert.equal(plan.liters,1);assert.equal(plan.milk[0].key,type);
  const selected=full.variations[1].items[plan.milk[0].index];
  const config=model.buildCoffeeBarConfiguration(full,{selected_variations:{Guests:{label:'50'}},selected_addons:[{name:selected.name,liters:plan.liters}]});
  assert.deepEqual(config.milk.map(x=>[x.key,x.liters]),[['dairy',4],[type,1]]);
  const scene=layout({classic:2,milkLiters:5,parveLiters:1,milkType:type,guests:50});
  assert.equal(scene.items.filter(x=>x.kind==='milk'&&x.variant===type).length,1);
  assert.ok(tiles(plan).some(x=>x.title===selected.name));
 }
});
test('milk limits clamp to the selected guest tier and dairy costs no swap fee',()=>{
 const {state,suggestion}=planner();state.milk='parve';state.milkMix={oat:99};
 assert.equal(suggestion().liters,5);state.guests=25;assert.equal(suggestion().liters,2);
 state.milk='dairy';assert.equal(suggestion().liters,0);assert.equal(suggestion().total,349);
});
test('one litre of each milk survives controls, pricing, preview and order snapshot',()=>{
 const {state,suggestion,adjustMilk,milkHtml}=planner();state.milk='parve';
 suggestion();adjustMilk('oat',-1);adjustMilk('oat',-1);adjustMilk('almond',1);adjustMilk('soy',1);
 const plan=suggestion();assert.equal(plan.total,626);assert.equal(plan.liters,3);
 assert.deepEqual(Array.from(plan.milk,m=>[m.key,m.liters]),[['oat',1],['almond',1],['soy',1]]);
 const selected=Array.from(plan.milk,m=>({name:m.addon.name,liters:m.liters}));
 const config=model.buildCoffeeBarConfiguration(full,{selected_variations:{Guests:{label:'50'}},selected_addons:selected});
 assert.deepEqual(config.milk.map(m=>[m.key,m.liters]),[['dairy',2],['oat',1],['almond',1],['soy',1]]);
 const scene=layout({milkLiters:5,milkMix:Object.fromEntries(plan.milk.map(m=>[m.key,m.liters])),guests:50});
 assert.deepEqual(scene.items.filter(m=>m.kind==='milk').map(m=>m.variant),['dairy','dairy','oat','almond','soy']);
 assert.match(milkHtml(plan),/2L dairy \+ 1L Oat milk \+ 1L Almond milk \+ 1L Soy milk/);
});
test('each milk step respects the shared allowance and never makes counts negative',()=>{
 const {state,suggestion,adjustMilk}=planner();state.milk='parve';state.milkMix={oat:2,almond:2,soy:1};
 adjustMilk('soy',1);assert.equal(suggestion().liters,5);assert.equal(suggestion().milk.find(m=>m.key==='soy').liters,1);
 adjustMilk('oat',-1);adjustMilk('soy',1);assert.equal(suggestion().milk.find(m=>m.key==='soy').liters,2);
 for(let i=0;i<9;i++)adjustMilk('oat',-1);
 assert.equal(state.milkMix.oat,0);assert.equal(suggestion().liters,4);
 const allSoy=layout({milkLiters:5,milkMix:{soy:5},guests:50});
 assert.equal(allSoy.items.filter(m=>m.kind==='milk'&&m.variant==='soy').length,5);
});
test('checkout offers use real catalogue prices and selected syrup',()=>{
 const result=offers.offers(basket(),catalog);assert.equal(result.length,2);
 assert.equal(result[0].price,349);assert.equal(result[0].difference,41);
 assert.equal(result[1].price,308);assert.equal(result[1].difference,0);assert.equal(result[1].vanilla,true);
 assert.equal(result[0].guests,25);
 assert.deepEqual(offers.offers(basket().filter(x=>x.id!=='syrup'),catalog),[]);
 assert.deepEqual(offers.offers(basket().map(x=>({...x,is_subscription:true})),catalog),[]);
});
test('returning from builder leaves the original cart intact',()=>{
 const cart=basket(),original=JSON.stringify(cart),session=offers.createSession();session.start(offers.offers(cart,catalog)[0]);
 assert.equal(JSON.stringify(cart),original);session.cancel();assert.equal(JSON.stringify(cart),original);
});
test('booking replaces only the original eligible lines and keeps unrelated products',()=>{
 const cart=basket(),session=offers.createSession();session.start(offers.offers(cart,catalog)[0]);
 assert.equal(session.valid(cart),true);cart.push({id:'newbar',base_product_id:FULL,qty:1,price:349});
 assert.equal(session.complete(full,cart),true);assert.deepEqual(cart.map(x=>x.id),['mini','newbar']);
 assert.equal(session.complete(full,cart),false);
});
test('stale cart changes invalidate replacement, and unsupported guest sizes are not offered',()=>{
 const cart=basket(),session=offers.createSession();session.start(offers.offers(cart,catalog)[0]);cart[0].qty++;
 assert.equal(session.valid(cart),false);
 cart[0].qty=10;assert.deepEqual(offers.offers(cart,catalog),[]);
});
test('take-home section offers actual products and opens their quantity drawer',()=>{
 const html=planner().takeHomeHtml();assert.match(html,/Coffee for home, too/);assert.match(html,/data-take-home="mini"/);
});
test('three-jug bundles retain their actual guest capacity in an upgrade',()=>{
 const bundle={id:'bundle',name_en:'3 × 5L Classic Dark Roast',price:489,category:'bulk'};
 const p=JSON.parse(JSON.stringify(full));p.variations[0].options.push({label:'75',price:799});
 const rows=[{id:'bundle',qty:1,price:489},{id:'syrup',qty:1,price:59}];
 const result=offers.offers(rows,[...catalog.filter(x=>x.id!==FULL),p,bundle]);
 assert.equal(result[0].guests,75);assert.equal(result[0].price,799);assert.equal(result[0].difference,251);
});
